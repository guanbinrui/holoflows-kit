export interface DomProxyOptions<Before extends Element = HTMLSpanElement, After extends Element = HTMLSpanElement> {
    /** Create the `before` node of the DomProxy */ createBefore(): Before
    /** Create the `after` node of the DomProxy */ createAfter(): After
    /** ShadowRootInit for creating the shadow of `before` */ beforeShadowRootInit: ShadowRootInit
    /** ShadowRootInit for creating the shadow of `after` */ afterShadowRootInit: ShadowRootInit
}

/**
 * DomProxy provide an interface that be stable even dom is changed.
 *
 * DomProxy provide 3 nodes. `before`, `current` and `after`.
 * `current` is a fake dom node powered by Proxy,
 * it will forward all your operations to the `realCurrent`.
 *
 * `before` and `after` is a true `span` that always point to before and after of `realCurrent`
 *
 * Special Handlers:
 *
 * *forward*: forward to current `realCurrent`
 *
 * *undo*: undo effect when `realCurrent` changes
 *
 * *move*: move effect to new `realCurrent`
 *
 * - style (forward, undo, move)
 * - addEventListener (forward, undo, move)
 * - appendChild (forward, undo, move)
 */
export const DomProxy = function<
    ProxiedElement extends Element = HTMLSuperSet,
    Before extends Element = HTMLSpanElement,
    After extends Element = HTMLSpanElement
>(options: Partial<DomProxyOptions<Before, After>> = {}): DomProxy<ProxiedElement, Before, After> {
    // Options
    const { createAfter, createBefore, afterShadowRootInit, beforeShadowRootInit } = {
        ...({
            createAfter: () => document.createElement('span'),
            createBefore: () => document.createElement('before'),
            afterShadowRootInit: { mode: 'open' },
            beforeShadowRootInit: { mode: 'open' },
        } as DomProxyOptions),
        ...options,
    } as DomProxyOptions<Before, After>
    //
    let isDestroyed = false
    // Nodes
    let virtualBefore: Before | null = null
    let virtualBeforeShadow: ShadowRoot | null = null
    let current: Element | null = document.createElement('div')
    let virtualAfter: After | null = null
    let virtualAfterShadow: ShadowRoot | null = null
    /** All changes applied on the `proxy` */
    let changes: (ActionTypes[keyof ActionTypes])[] = []
    /** Read Traps */
    const readonlyTraps: ProxyHandler<any> = {
        ownKeys: () => {
            changes.push({ type: 'ownKeys', op: undefined })
            if (current) return Object.getOwnPropertyNames(current)
            return []
        },
        get: (t, key, r) => {
            changes.push({ type: 'get', op: key })
            const current_: any = current
            if (current) {
                if (typeof current_[key] === 'function')
                    return new Proxy(current_[key], {
                        apply: (target, thisArg, args) => {
                            changes.push({ type: 'callMethods', op: { name: key, param: args, thisArg } })
                            return current_[key](...args)
                        },
                    })
                else if (key === 'style')
                    return new Proxy((current as HTMLElement).style, {
                        set: (t, styleKey, styleValue, r) => {
                            changes.push({
                                type: 'modifyStyle',
                                op: { name: styleKey, value: styleValue, originalValue: current_.style[styleKey] },
                            })
                            current_.style[styleKey] = styleValue
                            return true
                        },
                    })
                return current_[key]
            }
            return undefined
        },
        has: (t, key) => {
            changes.push({ type: 'has', op: key })
            if (current) return key in current
            return false
        },
        getOwnPropertyDescriptor: (t, key) => {
            changes.push({ type: 'getOwnPropertyDescriptor', op: key })
            if (current) {
                return Reflect.getOwnPropertyDescriptor(current, key)
            }
            return {
                configurable: true,
                enumerable: false,
                value: undefined,
                writable: true,
            }
        },
        isExtensible: t => {
            changes.push({ type: 'isExtensible', op: undefined })
            if (current) return Reflect.isExtensible(current)
            return true
        },
        getPrototypeOf: t => {
            changes.push({ type: 'getPrototypeOf', op: undefined })
            if (current) return Reflect.getPrototypeOf(current)
            return {}
        },
    }
    /** Write Traps */
    const modifyTraps: (record: boolean) => ProxyHandler<any> = record => ({
        deleteProperty: (t, key: keyof HTMLElement) => {
            record && changes.push({ type: 'delete', op: key })
            if (current) {
                return Reflect.deleteProperty(current, key)
            }
            return false
        },
        set: (t, key: keyof HTMLElement, value, r) => {
            record && changes.push({ type: 'set', op: [key, value] })
            if (current) {
                return ((current as any)[key] = value)
            }
            return true
        },
        defineProperty: (t, key, attributes) => {
            record && changes.push({ type: 'defineProperty', op: [key, attributes] })
            if (current) {
                return Reflect.defineProperty(current, key, attributes)
            }
            return true
        },
        preventExtensions: t => {
            record && changes.push({ type: 'preventExtensions', op: undefined })
            if (current) return Reflect.preventExtensions(current)
            return true
        },
        setPrototypeOf: (t, prototype) => {
            record && changes.push({ type: 'setPrototypeOf', op: prototype })
            if (current) return Reflect.setPrototypeOf(current, prototype)
            return true
        },
    })
    const modifyTrapsWrite = modifyTraps(true)
    const modifyTrapsNotWrite = modifyTraps(false)
    const proxy = Proxy.revocable({}, { ...readonlyTraps, ...modifyTrapsWrite })
    function hasStyle(e: Element): e is HTMLElement {
        return !!(e as any).style
    }
    /** Call before realCurrent change */
    function undoEffects(nextCurrent?: Element | null) {
        for (const change of changes) {
            if (change.type === 'callMethods') {
                const attr: keyof HTMLElement = change.op.name as any
                if (attr === 'addEventListener') {
                    current && current.removeEventListener(...(change.op.param as [any, any, any]))
                } else if (attr === 'appendChild') {
                    if (!nextCurrent) {
                        const node = (change.op.thisArg as Parameters<HTMLElement['appendChild']>)[0]
                        current && node && current.removeChild(node)
                    }
                }
            } else if (change.type === 'modifyStyle') {
                const { name, value, originalValue } = change.op
                if (current && hasStyle(current)) {
                    current.style[name as any] = originalValue
                }
            }
        }
    }
    /** Call after realCurrent change */
    function redoEffects() {
        if (!current) return
        const t = {}
        for (const change of changes) {
            if (change.type === 'setPrototypeOf') modifyTrapsNotWrite.setPrototypeOf!(t, change.op)
            else if (change.type === 'preventExtensions') modifyTrapsNotWrite.preventExtensions!(t)
            else if (change.type === 'defineProperty')
                modifyTrapsNotWrite.defineProperty!(t, change.op[0], change.op[1])
            else if (change.type === 'set') modifyTrapsNotWrite.set!(t, change.op[0], change.op[1], t)
            else if (change.type === 'delete') modifyTrapsNotWrite.deleteProperty!(t, change.op)
            else if (change.type === 'callMethods') {
                const replayable: (keyof Element)[] = ['appendChild', 'addEventListener', 'before', 'after']
                const key: keyof Element = change.op.name as any
                if (replayable.indexOf(key) !== -1) {
                    ;(current[key] as any)(...change.op.param)
                }
            } else if (change.type === 'modifyStyle') {
                ;(current as HTMLElement).style[change.op.name as any] = change.op.value
            }
        }
    }
    return {
        get weakBefore() {
            if (isDestroyed) return null
            return virtualBefore
        },
        get before() {
            if (isDestroyed) throw new TypeError('Try to access `before` node after VirtualNode is destroyed')
            if (!virtualBefore) {
                virtualBefore = createBefore()
                current && current.before(virtualBefore)
            }
            return virtualBefore
        },
        get beforeShadow(): ShadowRoot {
            if (!virtualBeforeShadow) virtualBeforeShadow = this.before.attachShadow(beforeShadowRootInit)
            return virtualBeforeShadow
        },
        get current(): ProxiedElement {
            if (isDestroyed) throw new TypeError('Try to access `current` node after VirtualNode is destroyed')
            return proxy.proxy
        },
        get weakAfter() {
            if (isDestroyed) return null
            return virtualAfter
        },
        get after(): After {
            if (isDestroyed) throw new TypeError('Try to access `after` node after VirtualNode is destroyed')
            if (!virtualAfter) {
                virtualAfter = createAfter()
                current && current.after(virtualAfter)
            }
            return virtualAfter
        },
        get afterShadow(): ShadowRoot {
            if (!virtualAfterShadow) virtualAfterShadow = this.after.attachShadow(afterShadowRootInit)
            return virtualAfterShadow
        },
        get realCurrent(): ProxiedElement | null {
            if (isDestroyed) return null
            return current as any
        },
        set realCurrent(node: ProxiedElement | null) {
            if (isDestroyed) throw new TypeError('You can not set current for a destroyed proxy')
            if (node === current) return
            undoEffects(node)
            if (node === null || node === undefined) {
                current = document.createElement('div')
                if (virtualBefore) virtualBefore.remove()
                if (virtualAfter) virtualAfter.remove()
            } else {
                current = node
                if (virtualAfter) current.after(virtualAfter)
                if (virtualBefore) current.before(virtualBefore)
                redoEffects()
            }
        },
        destroy() {
            isDestroyed = true
            proxy.revoke()
            virtualBeforeShadow = null
            virtualAfterShadow = null
            if (virtualBefore) virtualBefore.remove()
            if (virtualAfter) virtualAfter.remove()
            virtualBefore = null
            virtualAfter = null
            current = null
        },
    }
}

export interface DomProxy<
    ProxiedElement extends Element = HTMLSuperSet,
    Before extends Element = HTMLSpanElement,
    After extends Element = HTMLSpanElement
> {
    /** Destroy the DomProxy */
    destroy(): void
    /** Returns the `before` element without implicitly create it. */
    readonly weakBefore: Before | null
    /** Returns the `before` element, if it doesn't exist, create it implicitly. */
    readonly before: Before
    /** Returns the `ShadowRoot` of the `before` element. */
    readonly beforeShadow: ShadowRoot
    /**
     * A proxy that always point to `realCurrent`,
     * and if `realCurrent` changes, all action will be forwarded to new `realCurrent`
     */
    readonly current: ProxiedElement
    /** Returns the `after` element without implicitly create it. */
    readonly weakAfter: After | null
    /** Returns the `after` element, if it doesn't exist, create it implicitly. */
    readonly after: After
    /** Returns the `ShadowRoot` of the `after` element. */
    readonly afterShadow: ShadowRoot
    /**
     * The real current of the `current`
     */
    realCurrent: ProxiedElement | null
}
//#region HTMLSuperSet
type HTMLSuperSet = HTMLElement &
    HTMLAnchorElement &
    HTMLAppletElement &
    HTMLAreaElement &
    HTMLAudioElement &
    HTMLBaseElement &
    HTMLBaseFontElement &
    HTMLQuoteElement &
    HTMLBodyElement &
    HTMLBRElement &
    HTMLButtonElement &
    HTMLCanvasElement &
    HTMLTableCaptionElement &
    HTMLTableColElement &
    HTMLTableColElement &
    HTMLDataElement &
    HTMLDataListElement &
    HTMLModElement &
    HTMLDetailsElement &
    HTMLDialogElement &
    HTMLDirectoryElement &
    HTMLDivElement &
    HTMLDListElement &
    HTMLEmbedElement &
    HTMLFieldSetElement &
    HTMLFontElement &
    HTMLFormElement &
    HTMLFrameElement &
    HTMLFrameSetElement &
    HTMLHeadingElement &
    HTMLHeadingElement &
    HTMLHeadingElement &
    HTMLHeadingElement &
    HTMLHeadingElement &
    HTMLHeadingElement &
    HTMLHeadElement &
    HTMLHRElement &
    HTMLHtmlElement &
    HTMLIFrameElement &
    HTMLImageElement &
    HTMLInputElement &
    HTMLModElement &
    HTMLLabelElement &
    HTMLLegendElement &
    HTMLLIElement &
    HTMLLinkElement &
    HTMLMapElement &
    HTMLMarqueeElement &
    HTMLMenuElement &
    HTMLMetaElement &
    HTMLMeterElement &
    HTMLObjectElement &
    HTMLOListElement &
    HTMLOptGroupElement &
    HTMLOptionElement &
    HTMLOutputElement &
    HTMLParagraphElement &
    HTMLParamElement &
    HTMLPictureElement &
    HTMLPreElement &
    HTMLProgressElement &
    HTMLQuoteElement &
    HTMLScriptElement &
    HTMLSelectElement &
    HTMLSlotElement &
    HTMLSourceElement &
    HTMLSpanElement &
    HTMLStyleElement &
    HTMLTableElement &
    HTMLTableSectionElement &
    HTMLTableDataCellElement &
    HTMLTemplateElement &
    HTMLTextAreaElement &
    HTMLTableSectionElement &
    HTMLTableHeaderCellElement &
    HTMLTableSectionElement &
    HTMLTimeElement &
    HTMLTitleElement &
    HTMLTableRowElement &
    HTMLTrackElement &
    HTMLUListElement &
    HTMLVideoElement &
    HTMLElement
//#endregion
type Keys = string | number | symbol
type ActionRecord<T extends string, F> = { type: T; op: F }
interface ActionTypes {
    delete: ActionRecord<'delete', Keys>
    set: ActionRecord<'set', [Keys, any]>
    defineProperty: ActionRecord<'defineProperty', [Keys, PropertyDescriptor]>
    preventExtensions: ActionRecord<'preventExtensions', void>
    setPrototypeOf: ActionRecord<'setPrototypeOf', any>
    get: ActionRecord<'get', Keys>
    ownKeys: ActionRecord<'ownKeys', undefined>
    has: ActionRecord<'has', Keys>
    getOwnPropertyDescriptor: ActionRecord<'getOwnPropertyDescriptor', Keys>
    isExtensible: ActionRecord<'isExtensible', undefined>
    getPrototypeOf: ActionRecord<'getPrototypeOf', undefined>
    callMethods: ActionRecord<'callMethods', { name: Keys; param: any[]; thisArg: any }>
    modifyStyle: ActionRecord<'modifyStyle', { name: Keys; value: string; originalValue: string }>
}

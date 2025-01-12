/**
 * WatcherClass provides an abstract implementation of a watcher to the LiveSelector
 *
 * You should extend it and implement your own watch logic.
 *
 * Built-in watcher:
 *
 * - Mutation Observer watcher (based on MutationObserver api, watch DOM changes)
 * - Interval watcher (based on time interval)
 * - Event watcher (based on addEventListener)
 */
import { DomProxy, DomProxyOptions } from './Proxy'
import mitt from 'mitt'
import { LiveSelector } from './LiveSelector'

import differenceWith from 'lodash-es/differenceWith'
import intersectionWith from 'lodash-es/intersectionWith'
import uniqWith from 'lodash-es/uniqWith'
import { Deadline, requestIdleCallback } from '../util/requestIdleCallback'
import { isNil } from 'lodash-es'

/**
 * Use LiveSelector to watch dom change
 */
export abstract class Watcher<T, Before extends Element, After extends Element, SingleMode extends boolean>
    implements PromiseLike<ResultOf<SingleMode, T>> {
    constructor(
        /**
         * The liveSelector that this object holds.
         */
        protected readonly liveSelector: LiveSelector<T, SingleMode>,
    ) {}
    //#region How to start and stop the watcher
    /** Let the watcher start to watching */
    public startWatch(...args: any[]): this {
        this.isWatching = true
        this._warning_forget_watch_.ignored = true
        this.watcherChecker()
        return this
    }
    /** Stop the watcher */
    public stopWatch(...args: any[]): void {
        this.isWatching = false
    }
    /** Is the watcher running */
    protected isWatching = false
    //#endregion
    //#region useForeach
    /** Saved useForeach */
    /**
     * its type is too complicate to analyse by TypeScript,
     * recover its type after TypeScript can type narrow `this`
     */
    protected useForeachFn?: unknown
    /**
     * Just like React hooks. Provide callbacks for each node changes.
     *
     * @param forEachFunction - You can return a set of functions that will be called on changes.
     *
     * @remarks
     *
     * Return value of `fn`
     *
     * - `void`: No-op
     *
     * - `((oldNode: T) => void)`: it will be called when the node is removed.
     *
     * - `{ onRemove?: (old: T) => void; onTargetChanged?: (newNode: T, oldNode: T) => void; onNodeMutation?: (node: T) => void }`,
     *
     * - - `onRemove` will be called when node is removed.
     *
     * - - `onTargetChanged` will be called when the node is still existing but target has changed.
     *
     * - - `onNodeMutation` will be called when the node is the same, but it inner content or attributes are modified.
     *
     * @example
     * ```
     * // ? if your LiveSelector return Element
     * watcher.useForeach((node, key, realNode) => {
     *     console.log(node.innerHTML) // when a new key is found
     *     return {
     *         onRemove() { console.log('The node is gone!') },
     *         onTargetChanged() {
     *             console.log('Key is the same, but the node has changed!')
     *             console.log(node.innerHTML) // `node` is still the latest node!
     *             // appendChild, addEventListener will not lost too!
     *             // ! But `realNode` is still the original node. Be careful with it.
     *         },
     *         onNodeMutation() {
     *             console.log('Key and node are both the same, but node has been mutated.')
     *         }
     *     }
     * })
     *
     * // ? if your LiveSelector does not return Element but something else
     * watcher.useForeach((value, key) => {
     *     console.log(value) // your value here.
     *     return {
     *         onRemove() { console.log('The value is gone!') },
     *         onTargetChanged(value) {
     *             console.log('Key is the same, but the value has changed!')
     *             console.log(value) // New value
     *         }
     *     }
     * })
     *
     * ```
     */
    public useForeach(
        forEachElement: T extends Element
            ? (virtualNode: DomProxy<T & Node, Before, After>, key: unknown, realNode: Node) => useForeachReturns<T>
            : never,
    ): this
    /**
     * When T is not an Element, use this overload
     */
    public useForeach(forEachValue: T extends Element ? never : (node: T, key: unknown) => useForeachReturns<T>): this
    public useForeach() {
        const forEach = arguments[0]
        if (forEach === undefined) return this
        if (typeof forEach !== 'function') throw new TypeError('useForeach must be a function.')
        if (this.useForeachFn) {
            console.warn("You can't chain useForeach currently. The old one will be replaced.")
        }
        this.useForeachFn = forEach
        return this
    }
    //#endregion
    //#region .then()
    /**
     * Start the watcher, once it emitted data, stop watching.
     * @param map - Map function transform T to Result
     * @param options - Options for watcher
     * @param starter - How to start the watcher
     *
     * @remarks This is an implementation of `PromiseLike`
     *
     * @example
     * ```ts
     * const value = await watcher
     * const value2 = await watcher(undefined, undefined, { minimalResultsRequired: 5 })
     * // If your watcher need parameters for startWatch
     * const value3 = await watcher(undefined, undefined, {}, s => s.startWatch(...))
     * ```
     */
    // The PromiseLike<T> interface
    public then<TResult1 = ResultOf<SingleMode, T>, TResult2 = never>(
        onfulfilled?: ((value: ResultOf<SingleMode, T>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
        options: { minimalResultsRequired?: number } = {},
        starter: (this: this, self: this) => void = watcher => watcher.startWatch(),
    ): Promise<TResult1 | TResult2> {
        const { minimalResultsRequired } = {
            ...({
                minimalResultsRequired: 1,
            } as Required<typeof options>),
            ...options,
        }
        const map = onfulfilled || (x => x)
        const then = async () => {
            if (minimalResultsRequired < 1)
                throw new TypeError('Invalid minimalResultsRequired, must equal to or bigger than 1')
            if (this.singleMode && minimalResultsRequired > 1) {
                console.warn('In single mode, the watcher will ignore the option minimalResultsRequired')
            }
            const result = this.liveSelector.evaluateOnce()
            if (Array.isArray(result) && result.length >= minimalResultsRequired) {
                // If we get the value now, return it
                return result.map(v => map(v))
            } else if (this.singleMode) {
                // If in single mode, return the value now
                return result
            }
            // Or return a promise to wait the value
            return new Promise<ResultOf<SingleMode, TResult1>>((resolve, reject) => {
                starter.bind(this)(this)
                const f: EventCallback<OnIterationEvent<T>> = v => {
                    const nodes = v.values.current
                    if (this.singleMode && nodes.length >= 1) {
                        const returns = map(nodes[0] as ResultOf<SingleMode, T>)
                        resolve(Promise.resolve(returns as any))
                    }
                    if (nodes.length < minimalResultsRequired) return
                    this.stopWatch()
                    Promise.all(nodes.map(map as any)).then(resolve as any, reject)
                    this.removeListener('onIteration', f)
                }
                this.addListener('onIteration', f)
            })
        }
        return then().then(onfulfilled, onrejected)
    }
    //#endregion
    //#region Multiple mode
    /** Found key list of last watch */
    protected lastKeyList: readonly unknown[] = []
    /** Found Node list of last watch */
    protected lastNodeList: readonly T[] = []
    /** Saved callback map of last watch */
    protected lastCallbackMap = new Map<unknown, useForeachReturns<T>>()
    /** Saved virtual node of last watch */
    protected lastVirtualNodesMap = new Map<unknown, DomProxy<any, Before, After>>()
    /** Find node from the given list by key */
    protected findNodeFromListByKey = (list: readonly T[], keys: readonly unknown[]) => (key: unknown) => {
        const i = keys.findIndex(x => this.keyComparer(x, key))
        if (i === -1) return null
        return list[i]
    }
    /** Watcher callback with single mode is off */
    private normalModeWatcherCallback(currentIteration: readonly T[]) {
        /** Key list in this iteration */
        const thisKeyList: readonly unknown[] =
            this.mapNodeToKey === defaultMapNodeToKey ? currentIteration : currentIteration.map(this.mapNodeToKey)

        //#region Warn about repeated keys
        {
            const uniq = uniqWith(thisKeyList, this.keyComparer)
            if (uniq.length < thisKeyList.length) {
                this._warning_repeated_keys.warn(() =>
                    console.warn(
                        'There are repeated keys in your watcher. uniqKeys:',
                        uniq,
                        'allKeys:',
                        thisKeyList,
                        ', to omit this warning, call `.omitWarningForRepeatedKeys()`',
                    ),
                )
            }
        }
        //#endregion

        // New maps for the next generation
        /** Next generation Callback map */
        const nextCallbackMap = new Map<unknown, useForeachReturns<T>>()
        /** Next generation VirtualNode map */
        const nextVirtualNodesMap = new Map<unknown, DomProxy<any, Before, After>>()

        //#region Key is gone
        // Do: Delete node
        const findFromLast = this.findNodeFromListByKey(this.lastNodeList, this.lastKeyList)
        const goneKeys = differenceWith(this.lastKeyList, thisKeyList, this.keyComparer)
        {
            for (const oldKey of goneKeys) {
                const virtualNode = this.lastVirtualNodesMap.get(oldKey)
                const callbacks = this.lastCallbackMap.get(oldKey)
                const node = findFromLast(oldKey)!
                this.requestIdleCallback(
                    () => {
                        applyUseForeachCallback(callbacks)('remove')(node)
                        if (virtualNode) virtualNode.destroy()
                    },
                    // Delete node don't need a short timeout.
                    { timeout: 2000 },
                )
            }
        }
        //#endregion

        //#region Key is new
        // Do: Add node
        const findFromNew = this.findNodeFromListByKey(currentIteration, thisKeyList)
        const newKeys = differenceWith(thisKeyList, this.lastKeyList, this.keyComparer)
        {
            for (const newKey of newKeys) {
                if (!this.useForeachFn) break
                const node = findFromNew(newKey)
                if (node instanceof Node) {
                    const virtualNode = DomProxy<typeof node, Before, After>(this.domProxyOption)
                    virtualNode.realCurrent = node
                    // This step must be sync.
                    const callbacks = (this.useForeachFn as useForeachFnWithNode<T, Before, After>)(
                        virtualNode,
                        newKey,
                        node,
                    )
                    if (callbacks && typeof callbacks !== 'function' && 'onNodeMutation' in callbacks) {
                        virtualNode.observer.init = {
                            subtree: true,
                            childList: true,
                            characterData: true,
                            attributes: true,
                        }
                        virtualNode.observer.callback = m => callbacks.onNodeMutation!(node, m)
                    }
                    nextCallbackMap.set(newKey, callbacks)
                    nextVirtualNodesMap.set(newKey, virtualNode)
                } else {
                    const callbacks = (this.useForeachFn as useForeachFnWithoutNode<T>)(node!, newKey)
                    applyUseForeachCallback(callbacks)('warn mutation')(this._warning_mutation_)
                    nextCallbackMap.set(newKey, callbacks)
                }
            }
        }
        //#endregion

        //#region Key is the same, but node is changed
        // Do: Change reference
        const oldSameKeys = intersectionWith(this.lastKeyList, thisKeyList, this.keyComparer)
        const newSameKeys = intersectionWith(thisKeyList, this.lastKeyList, this.keyComparer)
        type U = [T, T, unknown, unknown]
        const changedNodes = oldSameKeys
            .map(x => [findFromLast(x), findFromNew(x), x, newSameKeys.find(newK => this.keyComparer(newK, x))] as U)
            .filter(([a, b]) => this.valueComparer(a, b) === false)
        for (const [oldNode, newNode, oldKey, newKey] of changedNodes) {
            const fn = this.lastCallbackMap.get(oldKey)
            if (newNode instanceof Node) {
                const virtualNode = this.lastVirtualNodesMap.get(oldKey)!
                virtualNode.realCurrent = newNode
            }
            // This should be ordered. So keep it sync now.
            applyUseForeachCallback(fn)('target change')(newNode, oldNode)
        }
        //#endregion

        // Key is the same, node is the same
        // Do: nothing

        // #region Final: Copy the same keys
        for (const newKey of newSameKeys) {
            const oldKey = oldSameKeys.find(oldKey => this.keyComparer(newKey, oldKey))
            nextCallbackMap.set(newKey, this.lastCallbackMap.get(oldKey))
            nextVirtualNodesMap.set(newKey, this.lastVirtualNodesMap.get(oldKey)!)
        }
        this.lastCallbackMap = nextCallbackMap
        this.lastVirtualNodesMap = nextVirtualNodesMap
        this.lastKeyList = thisKeyList
        this.lastNodeList = currentIteration

        if (this.isEventsListening.onIteration && changedNodes.length + goneKeys.length + newKeys.length) {
            // Make a copy to prevent modifications
            this.emit('onIteration', {
                keys: {
                    current: thisKeyList,
                    new: newKeys,
                    removed: goneKeys,
                },
                values: {
                    current: currentIteration,
                    new: newKeys.map(findFromNew),
                    removed: goneKeys.map(findFromLast),
                },
            } as OnIterationEvent<T>)
        }
        if (this.isEventsListening.onChange)
            for (const [oldNode, newNode, oldKey, newKey] of changedNodes) {
                this.emit('onChange', { oldValue: oldNode, newValue: newNode, oldKey, newKey })
            }
        if (this.isEventsListening.onRemove)
            for (const key of goneKeys) {
                this.emit('onRemove', { key, value: findFromLast(key)! })
            }
        if (this.isEventsListening.onAdd)
            for (const key of newKeys) {
                this.emit('onAdd', { key, value: findFromNew(key)! })
            }
        // For firstVirtualNode
        const first = currentIteration[0]
        if (first instanceof Node) {
            this._firstVirtualNode.realCurrent = first
        } else if (first === undefined || first === null) {
            this._firstVirtualNode.realCurrent = null
        }
        //#endregion

        //#region Prompt developer to open single mode
        if (currentIteration.length > 1) this._warning_single_mode.ignored = true
        if (currentIteration.length === 1) this._warning_single_mode.warn()
        //#endregion
    }
    //#endregion
    //#region Single mode
    /**
     * Enable single mode.
     *
     * @privateRemarks
     * Subclass need to implement it to get the correct type.
     * Example to subclass implementor:
     *
     * ```ts
     * class MyWatcher<T, Before extends Element, After extends Element, SingleMode extends boolean>
     * extends Watcher<T, Before, After, SingleMode> {
     *      public enableSingleMode: MyWatcher<T, Before, After, true> = this._enableSingleMode as any
     * }
     * ```
     */
    public abstract enableSingleMode(): Watcher<T, Before, After, true>
    /**
     * @privateRemarks
     * Every subclass should call this.
     */
    protected _enableSingleMode() {
        this._warning_single_mode.ignored = true
        this.singleMode = true
        this.liveSelector.enableSingleMode()
        return this
    }
    /**
     * Is the single mode is on.
     */
    protected singleMode = false
    /** Last iteration value for single mode */
    protected singleModeLastValue?: T
    /** Does it has a last iteration value in single mode? */
    protected singleModeHasLastValue = false
    /** Callback for single mode */
    protected singleModeCallback?: useForeachReturns<T>
    /** Watcher callback for single mode */
    private singleModeWatcherCallback(firstValue: T) {
        if (firstValue === undefined) {
            this.firstVirtualNode.realCurrent = null
        }
        if (firstValue instanceof Node) {
            this.firstVirtualNode.realCurrent = firstValue
        }
        // ? Case: value is gone
        if (this.singleModeHasLastValue && isNil(firstValue)) {
            applyUseForeachCallback(this.singleModeCallback)('remove')(this.singleModeLastValue!)
            if (this.singleModeLastValue instanceof Node) {
                this._firstVirtualNode.realCurrent = null
            }
            this.emit('onRemove', { key: undefined, value: this.singleModeLastValue! })
            this.singleModeLastValue = undefined
            this.singleModeHasLastValue = false
        }
        // ? Case: value is new
        else if (!this.singleModeHasLastValue && firstValue) {
            if (isWatcherWithNode(this, firstValue)) {
                const val = firstValue as T & Node
                if (this.useForeachFn) {
                    this.singleModeCallback = (this.useForeachFn as useForeachFnWithNode<T, Before, After>)(
                        this.firstVirtualNode,
                        val,
                        val,
                    )
                }
            } else {
                if (this.useForeachFn) {
                    this.singleModeCallback = (this.useForeachFn as useForeachFnWithoutNode<T>)(firstValue, undefined)
                    applyUseForeachCallback(this.singleModeCallback)('warn mutation')(this._warning_mutation_)
                }
            }
            this.emit('onAdd', { key: undefined, value: firstValue })
            this.singleModeLastValue = firstValue
            this.singleModeHasLastValue = true
        }
        // ? Case: value has changed
        else if (this.singleModeHasLastValue && !this.valueComparer(this.singleModeLastValue!, firstValue)) {
            applyUseForeachCallback(this.singleModeCallback)('target change')(firstValue, this.singleModeLastValue!)
            this.emit('onChange', {
                newKey: undefined,
                oldKey: undefined,
                newValue: firstValue,
                oldValue: this.singleModeLastValue,
            } as OnChangeEvent<T>)
            this.singleModeLastValue = firstValue
            this.singleModeHasLastValue = true
        }
        // ? Case: value is not changed
        else {
            // ? Do nothing
        }
        return
    }
    //#endregion
    //#region Watcher callback
    /** Should be called every watch */
    private watcherChecker = (deadline?: Deadline) => {
        if (!this.isWatching) return

        const thisNodes: readonly T[] | T | undefined = this.liveSelector.evaluateOnce()

        if (this.singleMode) return this.singleModeWatcherCallback(thisNodes as T)
        else return this.normalModeWatcherCallback(thisNodes as readonly T[])
    }
    //#endregion
    //#region LiveSelector settings
    /**
     * The dom proxy option used in DomProxy()
     */
    protected domProxyOption: Partial<DomProxyOptions<Before, After>> = {}
    /**
     * Set option for DomProxy
     * @param option - DomProxy options
     */
    setDomProxyOption(option: Partial<DomProxyOptions<Before, After>>): this {
        this.domProxyOption = option
        const oldProxy = this._firstVirtualNode
        if (
            oldProxy.has('after') ||
            oldProxy.has('before') ||
            oldProxy.has('afterShadow') ||
            oldProxy.has('beforeShadow') ||
            oldProxy.realCurrent
        ) {
            console.warn("Don't set DomProxy before using it.")
        }
        this._firstVirtualNode = DomProxy(option)
        return this
    }
    //#endregion
    //#region events
    /** Event emitter */
    protected readonly eventEmitter = new mitt()
    private isEventsListening: Record<'onIteration' | 'onChange' | 'onRemove' | 'onAdd', boolean> = {
        onAdd: false,
        onChange: false,
        onIteration: false,
        onRemove: false,
    }
    addListener(event: 'onIteration', fn: EventCallback<OnIterationEvent<T>>): this
    addListener(event: 'onChange', fn: EventCallback<OnChangeEvent<T>>): this
    addListener(event: 'onRemove', fn: EventCallback<OnAddOrRemoveEvent<T>>): this
    addListener(event: 'onAdd', fn: EventCallback<OnAddOrRemoveEvent<T>>): this
    addListener(event: string, fn: (...args: any[]) => void): this {
        if (event === 'onIteration') this.noNeedInSingleMode('addListener("onIteration", ...)')
        this.eventEmitter.on(event, fn)
        ;(this.isEventsListening as any)[event] = true
        return this
    }
    removeListener(event: 'onIteration', fn: EventCallback<OnIterationEvent<T>>): this
    removeListener(event: 'onChange', fn: EventCallback<OnChangeEvent<T>>): this
    removeListener(event: 'onRemove', fn: EventCallback<OnAddOrRemoveEvent<T>>): this
    removeListener(event: 'onAdd', fn: EventCallback<OnAddOrRemoveEvent<T>>): this
    removeListener(event: string, fn: (...args: any[]) => void): this {
        this.eventEmitter.off(event, fn)
        return this
    }
    protected emit(event: 'onIteration', data: OnIterationEvent<T>): void
    protected emit(event: 'onChange', data: OnChangeEvent<T>): void
    protected emit(event: 'onRemove', data: OnAddOrRemoveEvent<T>): void
    protected emit(event: 'onAdd', data: OnAddOrRemoveEvent<T>): void
    protected emit(event: string, data: any) {
        return this.eventEmitter.emit(event, data)
    }
    //#endregion
    //#region firstVirtualNode
    /** The first virtual node */
    protected _firstVirtualNode = DomProxy<any, Before, After>(this.domProxyOption)
    /**
     * This virtualNode always point to the first node in the LiveSelector
     */
    public get firstVirtualNode() {
        return (this._firstVirtualNode as unknown) as T extends Node ? DomProxy<T, Before, After> : never
    }
    //#endregion
    //#region Watcher settings
    /**
     * Map `Node -> Key`, in case of you don't want the default behavior
     */
    protected mapNodeToKey: (node: T, index: number, arr: readonly T[]) => unknown = defaultMapNodeToKey
    /**
     * Compare between `key` and `key`, in case of you don't want the default behavior
     */
    protected keyComparer: (a: unknown, b: unknown) => boolean = defaultEqualityComparer
    /**
     * Compare between `value` and `value`, in case of you don't want the default behavior
     */
    protected valueComparer: (a: T, b: T) => boolean = defaultEqualityComparer
    /**
     * To help identify same nodes in different iteration,
     * you need to implement a map function that map `node` to `key`
     *
     * If the key is changed, the same node will call through `forEachRemove` then `forEach`
     *
     * @param keyAssigner - map `node` to `key`, defaults to `node => node`
     *
     * @example
     * ```ts
     * watcher.assignKeys(node => node.innerText)
     * ```
     */
    public assignKeys<Q = unknown>(keyAssigner: (node: T, index: number, arr: readonly T[]) => Q) {
        this.noNeedInSingleMode(this.assignKeys.name)
        this.mapNodeToKey = keyAssigner
        return this
    }
    /**
     * To help identify same nodes in different iteration,
     * you need to implement a map function to compare `node` and `key`
     *
     * You probably don't need this.
     *
     * @param keyComparer - compare between two keys, defaults to `===`
     * @param valueComparer - compare between two value, defaults to `===`
     *
     * @example
     * ```ts
     * watcher.setComparer(
     *     (a, b) => JSON.stringify(a) === JSON.stringify(b),
     *     (a, b) => a.equals(b)
     * )
     * ```
     */
    public setComparer<Q = unknown>(keyComparer?: (a: Q, b: Q) => boolean, valueComparer?: (a: T, b: T) => boolean) {
        if (keyComparer) this.noNeedInSingleMode(this.setComparer.name)
        if (keyComparer) this.keyComparer = keyComparer
        if (valueComparer) this.valueComparer = valueComparer
        return this
    }
    //#endregion
    //#region Schedule a watcher callback run
    private isWatcherCheckerRunning = false
    private needCheckerRunAgainAfterCurrentSchedule = false
    /**
     * Schedule a watcher check
     */
    protected scheduleWatcherCheck = () => {
        if (this.isWatcherCheckerRunning) {
            this.needCheckerRunAgainAfterCurrentSchedule = true
            return
        }
        this.isWatcherCheckerRunning = true
        this.watcherChecker()
        // Now watcherChecker is sync so this path will run at most once.
        while (this.needCheckerRunAgainAfterCurrentSchedule) {
            this.watcherChecker()
            this.needCheckerRunAgainAfterCurrentSchedule = false
        }
        this.isWatcherCheckerRunning = false
    }
    //#endregion
    //#region Utils
    /**
     * Get virtual node by key.
     * Virtual node will be unavailable if it is deleted
     * @param key - Key used to find DomProxy
     */
    public getVirtualNodeByKey(key: unknown) {
        this.noNeedInSingleMode(this.getVirtualNodeByKey.name)
        return (
            this.lastVirtualNodesMap.get([...this.lastVirtualNodesMap.keys()].find(_ => this.keyComparer(_, key))) ||
            null
        )
    }
    /** window.requestIdleCallback, or polyfill. */
    protected readonly requestIdleCallback = requestIdleCallback
    /** For debug usage. Just keep it. */
    private readonly stack = new Error().stack || ''
    //#endregion
    //#region Warnings
    /**
     * Warning to remember if developer forget to call the startWatch.
     */
    protected _warning_forget_watch_ = warning({
        fn: stack => console.warn('Did you forget to call `.startWatch()`?\n', stack),
    })
    private _warning_repeated_keys = warning({ once: true })
    /**
     * If you're expecting repeating keys, call this function, this will omit the warning.
     */
    public omitWarningForRepeatedKeys() {
        this.noNeedInSingleMode(this.omitWarningForRepeatedKeys.name)
        this._warning_repeated_keys.ignored = true
        return this
    }

    private _warning_single_mode = warning({
        once: 15,
        fn(stack) {
            console.warn(
                `Your watcher seems like only watching 1 node.
If you can make sure there is only 1 node to watch, call \`.enableSingleMode()\` on the watcher.
Or to ignore this message, call \`.enableBatchMode()\` on the watcher.\n`,
                stack,
            )
        },
    })
    /**
     * Dismiss the warning that let you enable single mode but the warning is false positive.
     */
    public enableBatchMode(): this {
        this._warning_single_mode.ignored = true
        return this
    }
    private noNeedInSingleMode(method: string) {
        if (this.singleMode) console.warn(`Method ${method} has no effect in SingleMode watcher`)
    }

    private _warning_mutation_ = warning({
        fn(stack) {
            console.warn('When watcher is watching LiveSelector<not Node>, onNodeMutation will not be ignored\n', stack)
        },
    })
    //#endregion
}

//#region Default implementations
function defaultEqualityComparer(a: unknown, b: unknown) {
    return a === b
}
function defaultMapNodeToKey(node: unknown) {
    return node
}
//#endregion
//#region Events
// ? Event data
type OnChangeEvent<T> = {
    oldKey: unknown
    newKey: unknown
    oldValue: T
    newValue: T
}
type OnAddOrRemoveEvent<T> = {
    key: unknown
    value: T
}
type OnIterationEvent<T> = {
    keys: Record<'removed' | 'new' | 'current', unknown[]>
    values: Record<'removed' | 'new' | 'current', T[]>
}
// ? Event callbacks
/** Callback on Remove */
type RemoveCallback<T> = (oldNode: T) => void
/** Callback on target changed */
type TargetChangedCallback<T> = (newNode: T, oldNode: T) => void
/** Callback on  */
type MutationCallback<T> = (node: T, mutations: MutationRecord[]) => void
type EventCallback<T> = (fn: T) => void
//#endregion
//#region useForeach types and helpers
/**
 * Return value of useForeach
 */
type useForeachReturns<T> =
    | void
    | RemoveCallback<T>
    | {
          onRemove?: RemoveCallback<T>
          onTargetChanged?: TargetChangedCallback<T>
          /** This will not be called if T is not Node */
          onNodeMutation?: MutationCallback<T>
      }

type useForeachFnWithNode<T, Before extends Element, After extends Element> = {
    (virtualNode: DomProxy<T & Node, Before, After>, key: unknown, realNode: Node): useForeachReturns<T>
}
type useForeachFnWithoutNode<T> = {
    (node: T, key: unknown): useForeachReturns<T>
}

function applyUseForeachCallback<T>(callback: useForeachReturns<T>) {
    const cb = callback as useForeachReturns<Node>
    let remove: any, change: any, mutation: any
    if (cb === undefined) {
    } else if (typeof cb === 'function') remove = cb
    else if (cb) {
        const { onNodeMutation, onRemove, onTargetChanged } = cb
        ;[remove, change, mutation] = [onRemove, onTargetChanged, onNodeMutation]
    }
    // Return
    interface applyUseForeach {
        (type: 'remove'): RemoveCallback<T>
        (type: 'target change'): TargetChangedCallback<T>
        (type: 'mutation'): MutationCallback<T>
        (type: 'warn mutation'): (x: ReturnType<typeof warning>) => void
    }
    return ((type: string) => (...args: any[]) => {
        if (type === 'remove') remove && remove(...args)
        else if (type === 'target change') change && change(...args)
        else if (type === 'mutation') mutation && mutation(...args)
        else if (type === 'warn mutation') mutation && args[0]()
    }) as applyUseForeach
}
//#endregion
//#region Typescript generic helper
type ResultOf<SingleMode extends boolean, Result> = SingleMode extends true ? (Result) : (Result)[]
function isWatcherWithNode<T>(
    watcher: Watcher<T, any, any, any>,
    node: T,
): watcher is typeof watcher extends Watcher<infer U, infer P, infer Q, infer R> ? Watcher<U & Node, P, Q, R> : never {
    return node instanceof Node
}
//#endregion
//#region Warnings
interface WarningOptions {
    /** warn only one time (or at nth time) pre instance, defaults to true */
    once: boolean | number
    /** only run in dev, defaults to false */
    dev: boolean
    /** default warn function */
    fn: (stack: string) => void
}
function warning(_: Partial<WarningOptions> = {}) {
    const { dev, once, fn } = { ...({ dev: false, once: true, fn: () => {} } as WarningOptions), ..._ }
    if (dev) if (process.env.NODE_ENV !== 'development') return { warn(f = fn) {}, ignored: true, stack: '' }
    const [_0, _1, _2, ...lines] = (new Error().stack || '').split('\n')
    const stack = lines.join('\n')
    let warned = 0
    const obj = {
        ignored: false,
        stack,
        warn(f = fn) {
            if (obj.ignored) return
            if (warned && once) return
            if (typeof once === 'number' && warned <= once) return
            warned++
            f(stack)
        },
    }
    return obj
}
//#endregion

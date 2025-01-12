/**
 * All context that possible in when developing a WebExtension
 */
export type Contexts = 'background' | 'content' | 'webpage' | 'unknown' | 'options' | 'debugging'
/**
 * Get current running context.
 *
 * @remarks
 * - background: background script
 * - content: content script
 * - webpage: a normal webpage
 * - unknown: unknown context
 */
export function GetContext(): Contexts {
    if (typeof location === 'undefined') return 'unknown'
    if (typeof browser !== 'undefined') {
        if (location.protocol.match('-extension')) {
            if (
                browser.extension && browser.extension.getBackgroundPage
                    ? browser.extension.getBackgroundPage().location.href === location.href
                    : ['generated', 'background', 'page', '.html'].every(x => location.pathname.match(x))
            )
                return 'background'
            return 'options'
        }
        if (browser.runtime && browser.runtime.getManifest) return 'content'
    }
    // What about rollup?
    if (location.hostname === 'localhost') return 'debugging'
    return 'webpage'
}
/**
 * Make sure this file only run in wanted context
 * @param context - Wanted context or contexts
 * @param name - name to throw
 */
export function OnlyRunInContext(context: Contexts | Contexts[], name: string): void
/**
 * Make sure this file only run in wanted context
 * @param context - Wanted context or contexts
 * @param throws - set to false, OnlyRunInContext will not throws but return a boolean
 */
export function OnlyRunInContext(context: Contexts | Contexts[], throws: false): boolean
export function OnlyRunInContext(context: Contexts | Contexts[], name: string | false) {
    const ctx = GetContext()
    if (Array.isArray(context) ? context.indexOf(ctx) === -1 : context !== ctx) {
        if (typeof name === 'string')
            throw new TypeError(`${name} run in the wrong context. (Wanted ${context}, actually ${ctx})`)
        else return false
    }
    return true
}

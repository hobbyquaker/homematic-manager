/**
 * Hands a URL to the host, and says whether the host took it. `false` - no host, or a preload
 * that predates the command - means the browser has to follow the link itself.
 */
export type OpenExternal = (url: string) => Promise<boolean>;

/**
 * The click handler of a real link that the desktop app opens in the user's browser (task 23,
 * B-47).
 *
 * The anchor stays an anchor - `target="_blank"` with `rel="noopener noreferrer"` - so that in a
 * browser, and for the middle button, the context menu and a screen reader, it is the plain link it
 * looks like. In Electron a plain left click is answered by the host bridge instead and the default
 * is prevented, because a renderer that opened a window itself would be a window nobody wanted.
 * Main decides what it opens (an allow-list), not this function.
 */
export function followExternalLink(event: MouseEvent, href: string, openExternal: OpenExternal | undefined): void {
    if (!openExternal || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
        return;
    }
    event.preventDefault();
    void openExternal(href).then((handled) => {
        if (!handled) {
            window.open(href, '_blank', 'noopener,noreferrer');
        }
    });
}

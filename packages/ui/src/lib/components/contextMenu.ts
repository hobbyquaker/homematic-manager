/** One entry of {@link ContextMenu}; a separator has no label. */
export interface ContextMenuItem {
    readonly id: string;
    readonly label?: string;
    readonly separator?: boolean;
    readonly disabled?: boolean;
    readonly danger?: boolean;
}

/** Keeps a menu inside the viewport, the way jQuery UI's `position` collision handling did. */
export function clampMenuPosition(
    x: number,
    y: number,
    menu: {width: number; height: number},
    viewport: {width: number; height: number},
    margin = 4,
): {x: number; y: number} {
    const maxX = Math.max(margin, viewport.width - menu.width - margin);
    const maxY = Math.max(margin, viewport.height - menu.height - margin);
    return {x: Math.min(Math.max(margin, x), maxX), y: Math.min(Math.max(margin, y), maxY)};
}

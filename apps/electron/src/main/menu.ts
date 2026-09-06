/**
 * The application menu.
 *
 * 2.x had two menus, "Application" (About, Quit) and "Edit" (Cut, Copy, Paste), built from the old
 * `selector:` strings that only ever worked on macOS - on Windows and Linux its Cut/Copy/Paste did
 * nothing at all. This is the same menu with `role`s, which work everywhere, plus the two things
 * every desktop app is expected to have and 2.x did not: a View menu with reload, developer tools
 * and zoom, and a Help menu that opens the issue tracker.
 *
 * The template is plain data and the actions are callbacks, so the test reads the menu without
 * Electron. `Menu.buildFromTemplate()` is called once, in `index.ts`.
 */

/** The subset of `MenuItemConstructorOptions` this template uses. */
export interface MenuTemplateItem {
    label?: string;
    role?: string;
    type?: 'separator';
    accelerator?: string;
    click?: () => void;
    submenu?: MenuTemplateItem[];
}

export interface MenuOptions {
    readonly appName: string;
    readonly isMac: boolean;
    readonly onAbout: () => void;
    readonly onCheckForUpdates: () => void;
    /** `false` hides the entry: no updater in development, and none when it is switched off. */
    readonly updatesEnabled: boolean;
    readonly onOpenIssues: () => void;
    readonly onOpenLogFolder: () => void;
    readonly onSettings: () => void;
}

/** The menu of 2.7, with the roles it should have had. */
export function buildMenuTemplate(options: MenuOptions): MenuTemplateItem[] {
    const about: MenuTemplateItem = {label: `About ${options.appName}`, click: options.onAbout};
    const checkForUpdates: MenuTemplateItem[] = options.updatesEnabled
        ? [{label: 'Check for Updates...', click: options.onCheckForUpdates}]
        : [];
    const settings: MenuTemplateItem = {
        label: 'Settings...',
        accelerator: options.isMac ? 'Command+,' : 'Ctrl+,',
        click: options.onSettings,
    };

    const application: MenuTemplateItem = options.isMac
        ? {
              label: options.appName,
              submenu: [
                  about,
                  ...checkForUpdates,
                  {type: 'separator'},
                  settings,
                  {type: 'separator'},
                  {role: 'services'},
                  {type: 'separator'},
                  {role: 'hide'},
                  {role: 'hideOthers'},
                  {role: 'unhide'},
                  {type: 'separator'},
                  {role: 'quit'},
              ],
          }
        : {
              label: 'File',
              submenu: [settings, {type: 'separator'}, {role: 'quit'}],
          };

    const edit: MenuTemplateItem = {
        label: 'Edit',
        submenu: [
            {role: 'undo'},
            {role: 'redo'},
            {type: 'separator'},
            {role: 'cut'},
            {role: 'copy'},
            {role: 'paste'},
            {role: 'selectAll'},
        ],
    };

    const view: MenuTemplateItem = {
        label: 'View',
        submenu: [
            {role: 'reload'},
            {role: 'forceReload'},
            {role: 'toggleDevTools'},
            {type: 'separator'},
            {role: 'resetZoom'},
            {role: 'zoomIn'},
            {role: 'zoomOut'},
            {type: 'separator'},
            {role: 'togglefullscreen'},
        ],
    };

    const window: MenuTemplateItem = {
        label: 'Window',
        submenu: options.isMac
            ? [{role: 'minimize'}, {role: 'zoom'}, {type: 'separator'}, {role: 'front'}]
            : [{role: 'minimize'}, {role: 'close'}],
    };

    const help: MenuTemplateItem = {
        role: 'help',
        label: 'Help',
        submenu: [
            {label: 'Report an Issue on GitHub', click: options.onOpenIssues},
            {label: 'Open the Log Folder', click: options.onOpenLogFolder},
            ...(options.isMac ? [] : [{type: 'separator' as const}, about, ...checkForUpdates]),
        ],
    };

    return [application, edit, view, window, help];
}

/** Where "Report an Issue" goes. */
export const ISSUES_URL = 'https://github.com/hobbyquaker/homematic-manager/issues';

/** The project page: what the GitHub icon in the header opens (task 23). */
export const PROJECT_URL = 'https://github.com/hobbyquaker/homematic-manager';

/**
 * The one URL the *renderer* may ask main to open, and it is a list of one.
 *
 * {@link isAllowedExternalUrl} is the rule for the links main itself follows, and it is a rule -
 * any https URL on four hosts. What comes over the IPC channel is not: the renderer asks for
 * exactly the project page or it gets nothing, so a cross-site scripting bug in the UI cannot use
 * `shell.openExternal` as a way to launch a URL of its choosing on the user's desktop.
 */
export function externalUrlFromRenderer(requested: unknown): string | undefined {
    return requested === PROJECT_URL ? PROJECT_URL : undefined;
}

/**
 * May this URL be opened in the user's browser?
 *
 * Everything the menu and the UI can open is ours, and `shell.openExternal()` will happily run a
 * `file:` or a `smb:` URL, so the answer is a list and not a check.
 */
export function isAllowedExternalUrl(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'https:') {
        return false;
    }
    return ['github.com', 'www.github.com', 'homematic-forum.de', 'www.homematic-forum.de'].includes(parsed.hostname);
}

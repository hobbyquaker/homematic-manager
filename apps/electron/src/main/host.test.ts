import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {ErrorLog, installErrorHandlers} from './errorLog.js';
import {DISABLE_AUTO_UPDATE_ENV, readHostSettings, writeHostSettings} from './hostSettings.js';
import {buildMenuTemplate, isAllowedExternalUrl, ISSUES_URL, type MenuTemplateItem} from './menu.js';
import {fileRoots, resolvePaths} from './paths.js';
import {createStartupTrace, STARTUP_TRACE_ENV, startupTraceEnabled} from './startupTrace.js';

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-host-'));
});

afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true});
});

describe('resolvePaths', () => {
    it('finds data/dist next to the checkout in development', () => {
        const paths = resolvePaths({
            packaged: false,
            resourcesPath: '/ignored',
            appPath: path.join('/repo', 'apps', 'electron'),
            userData: path.join('/profile', 'Homematic Manager'),
        });
        expect(paths.data).toBe(path.join('/repo', 'data', 'dist'));
        expect(paths.icons).toBe(path.join('/repo', 'data', 'dist', 'icons'));
    });

    it('finds it in the app resources when packaged', () => {
        const paths = resolvePaths({
            packaged: true,
            resourcesPath: path.join('/opt', 'hmm', 'resources'),
            appPath: path.join('/opt', 'hmm', 'resources', 'app.asar'),
            userData: path.join('/profile', 'Homematic Manager'),
        });
        expect(paths.data).toBe(path.join('/opt', 'hmm', 'resources', 'data'));
    });

    it('keeps everything writable under userData', () => {
        const userData = path.join('/profile', 'Homematic Manager');
        const paths = resolvePaths({packaged: true, resourcesPath: '/r', appPath: '/a', userData});
        expect(paths.images).toBe(path.join(userData, 'images'));
        expect(paths.logs).toBe(path.join(userData, 'logs'));
        expect(paths.hostSettingsFile).toBe(path.join(userData, 'host.json'));
        expect(paths.userData).toBe(userData);
    });

    it('gives the backend exactly two readable roots', () => {
        const paths = resolvePaths({packaged: true, resourcesPath: '/r', appPath: '/a', userData: '/u'});
        expect(fileRoots(paths)).toEqual({data: paths.data, images: paths.images});
    });
});

describe('host settings', () => {
    it('defaults to updates on when there is no file', () => {
        expect(readHostSettings(path.join(dir, 'host.json'), {})).toEqual({disableAutoUpdate: false});
    });

    it('reads the flag from the file', () => {
        const file = path.join(dir, 'host.json');
        writeHostSettings(file, {disableAutoUpdate: true});
        expect(readHostSettings(file, {})).toEqual({disableAutoUpdate: true});
    });

    it('survives a broken file', () => {
        const file = path.join(dir, 'host.json');
        fs.writeFileSync(file, 'nonsense');
        expect(readHostSettings(file, {})).toEqual({disableAutoUpdate: false});
    });

    it('lets the environment switch updates off without a writable profile', () => {
        const file = path.join(dir, 'host.json');
        expect(readHostSettings(file, {[DISABLE_AUTO_UPDATE_ENV]: '1'})).toEqual({disableAutoUpdate: true});
        expect(readHostSettings(file, {[DISABLE_AUTO_UPDATE_ENV]: 'false'})).toEqual({disableAutoUpdate: false});
        expect(readHostSettings(file, {[DISABLE_AUTO_UPDATE_ENV]: ''})).toEqual({disableAutoUpdate: false});
    });
});

describe('ErrorLog', () => {
    it('writes a line per error and returns the message', () => {
        const log = new ErrorLog({dir, now: () => new Date('2026-09-05T10:00:00.000Z')});
        const message = log.append('uncaughtException', new Error('boom'));
        expect(message).toContain('boom');
        const content = fs.readFileSync(log.file, 'utf8');
        expect(content).toContain('2026-09-05T10:00:00.000Z uncaughtException: Error: boom');
    });

    it('describes what was thrown, whatever it was', () => {
        const log = new ErrorLog({dir});
        expect(log.append('a', {code: 'EADDRINUSE'})).toBe('{"code":"EADDRINUSE"}');
        expect(log.append('b', 'a string')).toBe('a string');
        expect(log.append('c', undefined)).toBe('undefined');
        const circular: Record<string, unknown> = {};
        circular['self'] = circular;
        expect(log.append('d', circular)).toBe('[object Object]');
    });

    it('rotates one generation when the file grows', () => {
        const log = new ErrorLog({dir, maxBytes: 100});
        for (let i = 0; i < 20; i += 1) {
            log.append('scope', new Error(`error number ${i}`));
        }
        expect(fs.existsSync(`${log.file}.1`)).toBe(true);
        // One generation, and the live file holds only what came after the last rotation.
        const lines = fs.readFileSync(log.file, 'utf8').split('\n').filter(Boolean);
        expect(lines.filter((line) => line.includes('scope: Error'))).toHaveLength(1);
        expect(lines.join('\n')).toContain('error number 19');
    });

    it('hands back the tail for a bug report, and nothing when there is no file', () => {
        const log = new ErrorLog({dir});
        expect(log.tail()).toBe('');
        log.append('scope', 'first');
        log.append('scope', 'second');
        expect(log.tail(20)).toHaveLength(20);
        expect(log.tail()).toContain('second');
    });

    it('falls back to stderr when the log cannot be written', () => {
        fs.writeFileSync(path.join(dir, 'blocked'), 'not a directory');
        const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
        try {
            const log = new ErrorLog({dir: path.join(dir, 'blocked', 'logs')});
            expect(() => log.append('scope', new Error('x'))).not.toThrow();
            expect(stderr).toHaveBeenCalledOnce();
        } finally {
            stderr.mockRestore();
        }
    });
});

describe('installErrorHandlers', () => {
    it('logs every error but shows the dialog only once', () => {
        const target = new EventEmitter();
        const log = new ErrorLog({dir});
        const dialogs: string[] = [];
        const handlers = installErrorHandlers({
            log,
            showDialog: (message) => dialogs.push(message),
            target,
        });

        target.emit('uncaughtException', new Error('first'));
        target.emit('uncaughtException', new Error('second'));
        target.emit('unhandledRejection', 'third');

        expect(dialogs).toHaveLength(1);
        expect(dialogs[0]).toContain('first');
        const content = fs.readFileSync(log.file, 'utf8');
        expect(content).toContain('first');
        expect(content).toContain('second');
        expect(content).toContain('unhandledRejection: third');
        handlers.dispose();
    });

    it('does not turn a failing dialog into the next unhandled error', () => {
        const target = new EventEmitter();
        const handlers = installErrorHandlers({
            log: new ErrorLog({dir}),
            showDialog: () => {
                throw new Error('no display');
            },
            target,
        });
        expect(() => target.emit('uncaughtException', new Error('boom'))).not.toThrow();
        handlers.dispose();
    });

    it('lets the rest of main report through the same path', () => {
        const target = new EventEmitter();
        const dialogs: string[] = [];
        const handlers = installErrorHandlers({
            log: new ErrorLog({dir}),
            showDialog: (message) => dialogs.push(message),
            target,
        });
        handlers.report('backend', new Error('the profile directory is read-only'));
        expect(dialogs[0]).toContain('read-only');
        handlers.dispose();
        target.emit('uncaughtException', new Error('after dispose'));
        expect(dialogs).toHaveLength(1);
    });
});

describe('the application menu', () => {
    const menu = (isMac: boolean, updatesEnabled = true): MenuTemplateItem[] =>
        buildMenuTemplate({
            appName: 'Homematic Manager',
            isMac,
            updatesEnabled,
            onAbout: () => undefined,
            onCheckForUpdates: () => undefined,
            onOpenIssues: () => undefined,
            onOpenLogFolder: () => undefined,
            onSettings: () => undefined,
        });

    const roles = (items: MenuTemplateItem[] | undefined): string[] =>
        (items ?? []).map((item) => item.role ?? item.label ?? item.type ?? '');

    it('has the five menus, with the app menu first on macOS', () => {
        expect(menu(true).map((item) => item.label)).toEqual(['Homematic Manager', 'Edit', 'View', 'Window', 'Help']);
        expect(menu(false)[0]?.label).toBe('File');
    });

    it('keeps About and Quit of 2.x, with roles instead of the old selectors', () => {
        expect(roles(menu(true)[0]?.submenu)).toContain('About Homematic Manager');
        expect(roles(menu(true)[0]?.submenu)).toContain('quit');
        expect(roles(menu(false)[0]?.submenu)).toContain('quit');
    });

    it('keeps cut, copy and paste - which only worked on macOS in 2.x', () => {
        for (const isMac of [true, false]) {
            expect(roles(menu(isMac)[1]?.submenu)).toEqual(
                expect.arrayContaining(['cut', 'copy', 'paste', 'selectAll']),
            );
        }
    });

    it('adds the View menu 2.x did not have', () => {
        expect(roles(menu(false)[2]?.submenu)).toEqual(
            expect.arrayContaining(['reload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut']),
        );
    });

    it('offers About and the update check outside the app menu on Windows and Linux', () => {
        const help = menu(false)[4]?.submenu ?? [];
        expect(help.map((item) => item.label)).toEqual(
            expect.arrayContaining(['Report an Issue on GitHub', 'About Homematic Manager', 'Check for Updates...']),
        );
    });

    it('hides the update check when the updater is off', () => {
        const items = JSON.stringify(menu(false, false).map((entry) => roles(entry.submenu)));
        expect(items).not.toContain('Check for Updates');
        expect(JSON.stringify(menu(true, false))).not.toContain('Check for Updates');
    });

    it('wires every click', () => {
        const seen: string[] = [];
        const template = buildMenuTemplate({
            appName: 'Homematic Manager',
            isMac: false,
            updatesEnabled: true,
            onAbout: () => seen.push('about'),
            onCheckForUpdates: () => seen.push('updates'),
            onOpenIssues: () => seen.push('issues'),
            onOpenLogFolder: () => seen.push('logs'),
            onSettings: () => seen.push('settings'),
        });
        for (const entry of template) {
            for (const item of entry.submenu ?? []) {
                item.click?.();
            }
        }
        expect(seen.sort()).toEqual(['about', 'issues', 'logs', 'settings', 'updates']);
    });
});

describe('isAllowedExternalUrl', () => {
    it('allows the issue tracker', () => {
        expect(isAllowedExternalUrl(ISSUES_URL)).toBe(true);
    });

    it('allows the forum', () => {
        expect(isAllowedExternalUrl('https://homematic-forum.de/forum/')).toBe(true);
    });

    it('refuses anything else, and everything that is not https', () => {
        expect(isAllowedExternalUrl('http://github.com/x')).toBe(false);
        expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false);
        expect(isAllowedExternalUrl('https://evil.example/github.com')).toBe(false);
        expect(isAllowedExternalUrl('smb://share/x')).toBe(false);
        expect(isAllowedExternalUrl('not a url')).toBe(false);
    });
});

describe('startup trace', () => {
    it('is off unless the environment says otherwise', () => {
        expect(startupTraceEnabled({})).toBe(false);
        expect(startupTraceEnabled({[STARTUP_TRACE_ENV]: ''})).toBe(false);
        expect(startupTraceEnabled({[STARTUP_TRACE_ENV]: '0'})).toBe(false);
        expect(startupTraceEnabled({[STARTUP_TRACE_ENV]: 'false'})).toBe(false);
        expect(startupTraceEnabled({[STARTUP_TRACE_ENV]: 'FALSE'})).toBe(false);
        expect(startupTraceEnabled({[STARTUP_TRACE_ENV]: '1'})).toBe(true);
        expect(startupTraceEnabled({[STARTUP_TRACE_ENV]: 'yes'})).toBe(true);
    });

    it('writes nothing at all when it is off', () => {
        const lines: string[] = [];
        const trace = createStartupTrace({enabled: false, write: (line) => lines.push(line)});
        trace('anything');
        expect(lines).toEqual([]);
    });

    it('writes one prefixed line per phase, with the elapsed milliseconds', () => {
        const lines: string[] = [];
        let now = 12;
        const trace = createStartupTrace({enabled: true, elapsed: () => now, write: (line) => lines.push(line)});
        trace('module: entered');
        now = 345;
        trace('start: backend opened', '/tmp/profile');
        expect(lines).toEqual([
            '[hmm-startup +12ms] module: entered\n',
            '[hmm-startup +345ms] start: backend opened /tmp/profile\n',
        ]);
    });

    it('never throws when the stream it writes to does', () => {
        // A diagnostic that breaks the start-up it diagnoses is worse than none: a packaged app on
        // Windows has no stderr at all, and writing to a closed one throws EPIPE.
        const trace = createStartupTrace({
            enabled: true,
            write: () => {
                throw new Error('EPIPE');
            },
        });
        expect(() => trace('module: entered')).not.toThrow();
    });
});

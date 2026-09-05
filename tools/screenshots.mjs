#!/usr/bin/env node
/**
 * The README screenshots, taken from the running 3.0 UI instead of drawn by hand.
 *
 * `npm run screenshots` starts the web host of `apps/web` in `--demo` mode - the UI on its
 * `MockTransport` fixture, no backend, no CCU, nothing that could differ between two machines -
 * drives chromium through three workflows and writes six PNGs into `docs/`:
 *
 * | file | what it shows |
 * | --- | --- |
 * | `hmm1.png` / `hmm1-dark.png` | the Devices tab with a device's channel sub-grid open |
 * | `hmm2.png` / `hmm2-dark.png` | the paramset editor with the write preview on top of it |
 * | `hmm3.png` / `hmm3-dark.png` | the Links tab with the link (easy-mode) dialog |
 *
 * Why the demo fixture and not the simulator the e2e suite uses: a screenshot has to be
 * *reproducible* and has to read as a real installation. The fixture has German friendly names,
 * two interfaces, service messages and an RSSI matrix; the e2e fixture has four devices with test
 * addresses and English names, because assertions read better that way. The language is German
 * because `DEMO_CONNECTION.language` is `de` and the README is German.
 *
 * The theme is pinned through `localStorage` (`hmm.theme`), not through the OS preference, so the
 * light and the dark run differ in exactly one thing. 1280x800 at scale 1 is the size the README
 * wants: wide enough that the toolbar does not collapse, small enough to stay under 300 kB.
 *
 * After writing, each file is passed through `oxipng` or `pngquant` when one of them is on the
 * PATH; neither is a dependency, and a missing optimiser is a note, not an error. The run fails if
 * a file ends up over the budget, because a README that pulls a megabyte is a bug.
 *
 * Usage:
 *   npm run build && npm run screenshots          # docs/hmm{1,2,3}[-dark].png
 *   node tools/screenshots.mjs --out /tmp/shots   # somewhere else
 *   node tools/screenshots.mjs --keep             # leave the host running, print the URL
 */

import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

import {createWebHost} from 'homematic-manager';
import {chromium} from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The README budget. A page that pulls more than this per image is not a README any more. */
const MAX_BYTES = 300 * 1024;

const VIEWPORT = {width: 1280, height: 800};

/** Devices of the demo fixture the shots use, by the role they play here. */
const SWITCH_DEVICE = 'MEQ0123456';
const SWITCH_CHANNEL = `${SWITCH_DEVICE}:1`;
const LINK_ROW = '0001D8A9B7C6D5:1->000A1B2C3D4E5F:4';

/** `--out <dir>`, `--keep`. */
function parseArgv(argv) {
    const out = {outDir: path.join(ROOT, 'docs'), keep: false};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--out') {
            index += 1;
            out.outDir = path.resolve(argv[index] ?? '');
        } else if (argument === '--keep') {
            out.keep = true;
        } else {
            throw new Error(`unknown option ${argument} (see the header of tools/screenshots.mjs)`);
        }
    }
    return out;
}

/**
 * The three shots, in order, on one page.
 *
 * Each one leaves the UI in a known state and closes what it opened, so the next shot starts from
 * the grid rather than from whatever the previous dialog left behind.
 */
async function shoot(page, url, outDir, suffix) {
    const file = (n) => path.join(outDir, `hmm${n}${suffix}.png`);
    const written = [];

    /* 1 - Devices, with the channel sub-grid of one device open. */
    await page.goto(`${url}?demo#/BidCos-RF/devices`);
    await page.getByTestId('devices-table').waitFor({state: 'visible'});
    const device = page.locator(`[data-row-id="${SWITCH_DEVICE}"]`);
    await device.waitFor({state: 'visible'});
    // "Expand row" is one of the two strings the DataTable does not translate (see the e2e README).
    await device.getByRole('button', {name: 'Expand row'}).click();
    await page.locator(`[data-row-id="${SWITCH_CHANNEL}"]`).waitFor({state: 'visible'});
    await settle(page);
    await page.screenshot({path: file(1)});
    written.push(file(1));

    /* 2 - the paramset editor of that channel, with the write preview on top. */
    await page.getByTestId(`paramset-${SWITCH_CHANNEL}-MASTER`).click();
    await page.getByTestId('paramset-dialog').waitFor({state: 'visible'});
    await page.getByTestId('param-TRANSMIT_TRY_MAX').getByRole('spinbutton').fill('8');
    await page.getByTestId('param-LOGGING').getByRole('combobox').selectOption({index: 0});
    await page.getByTestId('paramset-preview').click();
    await page.getByTestId('write-preview').waitFor({state: 'visible'});
    await page.getByTestId('preview-TRANSMIT_TRY_MAX').waitFor({state: 'visible'});
    await settle(page);
    await page.screenshot({path: file(2)});
    written.push(file(2));

    /* 3 - Links, with the link dialog and its easy-mode profile picker. */
    // Two stacked modals are still open, and a `goto` that changes only the hash does not reload -
    // the dialogs would sit on top of the links grid. The blank page in between forces a real load.
    await page.goto('about:blank');
    await page.goto(`${url}?demo#/HmIP-RF/links`);
    await page.getByTestId('links-table').waitFor({state: 'visible'});
    const row = page.locator(`[data-row-id="${LINK_ROW}"]`);
    await row.waitFor({state: 'visible'});
    await row.click();
    await page.getByTestId('links-edit').click();
    await page.getByTestId('link-paramset-dialog').waitFor({state: 'visible'});
    await page.getByTestId('link-profile').waitFor({state: 'visible'});
    // The dialog opens on "expert" because the demo link's values match no profile. The easy mode
    // is what this shot is about, so switch the expert view off and pick a profile: the parameter
    // list collapses to the handful of fields the profile leaves open.
    await page.getByTestId('link-expert').uncheck();
    // Profile 2 of `SWITCH_VIRTUAL_RECEIVER.json` in the demo fixture: "Treppenhauslicht".
    await page.getByTestId('link-profile').selectOption('2');
    await settle(page);
    await page.screenshot({path: file(3)});
    written.push(file(3));

    return written;
}

/** Fonts loaded, transitions over, nothing animating: a screenshot that is the same twice. */
async function settle(page) {
    await page.evaluate(async () => {
        await document.fonts.ready;
    });
    await page.waitForTimeout(250);
}

/** `oxipng` or `pngquant` if the machine has one; otherwise the file stays as chromium wrote it. */
function optimise(files) {
    const tool = ['oxipng', 'pngquant'].find((name) => spawnSync(name, ['--version'], {stdio: 'ignore'}).status === 0);
    if (!tool) {
        console.log('no oxipng or pngquant on PATH - the PNGs stay as chromium wrote them');
        return;
    }
    for (const file of files) {
        const args =
            tool === 'oxipng'
                ? ['-o', '4', '--strip', 'safe', '--quiet', file]
                : ['--quality', '65-90', '--speed', '1', '--force', '--ext', '.png', file];
        execFileSync(tool, args, {stdio: 'inherit'});
    }
    console.log(`optimised with ${tool}`);
}

async function main() {
    const {outDir, keep} = parseArgv(process.argv.slice(2));
    await fs.mkdir(outDir, {recursive: true});

    // Loopback, port 0, no auth: nothing to hand the browser, and no port to collide with.
    const host = await createWebHost({demo: true, host: '127.0.0.1', port: 0, auth: false});
    console.log(`demo host on ${host.url}`);
    if (keep) {
        console.log('--keep: the host stays up, stop it with ctrl-c');
        return;
    }

    const browser = await chromium.launch();
    const written = [];
    try {
        for (const theme of ['light', 'dark']) {
            const context = await browser.newContext({
                viewport: VIEWPORT,
                deviceScaleFactor: 1,
                // The UI reads the preference on start; setting both means neither the OS nor the
                // stored value can make the two runs differ in anything but the theme.
                colorScheme: theme,
            });
            await context.addInitScript(
                ([key, value]) => {
                    window.localStorage.setItem(key, value);
                },
                ['hmm.theme', theme],
            );
            const page = await context.newPage();
            written.push(...(await shoot(page, host.url, outDir, theme === 'dark' ? '-dark' : '')));
            await context.close();
        }
    } finally {
        await browser.close();
        await host.close();
    }

    optimise(written);

    let over = 0;
    for (const file of written) {
        const {size} = await fs.stat(file);
        const kb = (size / 1024).toFixed(1);
        console.log(`${path.relative(ROOT, file)}  ${kb} kB`);
        if (size > MAX_BYTES) {
            over += 1;
            console.error(`  over the ${MAX_BYTES / 1024} kB budget`);
        }
    }
    if (over > 0) {
        throw new Error(`${over} screenshot(s) over the size budget`);
    }
}

await main();

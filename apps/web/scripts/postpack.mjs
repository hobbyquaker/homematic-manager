#!/usr/bin/env node

/**
 * `postpack`: undo what `prepack.mjs` materialised for the tarball.
 *
 * Everything it copied goes away again, for two reasons. The bundled
 * `node_modules/@homematic-manager/*` copies would shadow the workspace symlinks, and every later
 * `npm run dev` in this checkout would silently run against a frozen copy of the backend. And `ui/`
 * and `data/` are copies of files that are already linted and formatted where they belong; left
 * behind they turn every `npm run lint` at the repository root into a walk over a minified bundle.
 *
 * Nothing is lost by removing them: in a checkout `defaultUiDir()` and `defaultMetadataDir()` fall
 * back to `packages/ui/dist` and `data/dist` anyway.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const relative of ['node_modules/@homematic-manager', 'ui', 'data', 'LICENSE']) {
    const target = path.join(packageDir, relative);
    if (fs.existsSync(target)) {
        fs.rmSync(target, {recursive: true, force: true});
        console.log(`postpack: removed ${relative}`);
    }
}

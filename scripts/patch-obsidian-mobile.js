#!/usr/bin/env node
'use strict';

/**
 * patch-obsidian-mobile.js
 *
 * Applies build-time patches to the extracted Obsidian mobile bundle
 * (obsidian-mobile/app.js) so that:
 *
 *   1. The internal `Platform` object is exposed as `window.__owPlatform`.
 *   2. The entry IIFE merges `window.__owPlatformOverrides` into the
 *      Platform flags via `Object.assign`, so callers can override defaults.
 *   3. The body `is-mobile` class is gated on the post-override `isMobile`
 *      flag instead of being added unconditionally.
 *
 * Importable:
 *   const { applyPatches, PATCHES } = require('./patch-obsidian-mobile');
 *
 * CLI-runnable:
 *   node scripts/patch-obsidian-mobile.js <path-to-app.js>
 *
 * If any regex no longer matches exactly the expected number of times,
 * `applyPatches` throws — silent failures here produce subtly broken
 * bundles that are hard to debug.
 */

const fsp = require('fs/promises');
const path = require('path');

const PATCHES = [
  {
    name: 'expose-platform',
    find:    /var (\w{1,3})=\{isDesktop:!1,isMobile:!1,isDesktopApp:!1/,
    replace: 'var $1=window.__owPlatform={isDesktop:!1,isMobile:!1,isDesktopApp:!1',
    expectedMatches: 1,
  },
  {
    name: 'iife-overrides',
    find:    /(\w+)\.isMobileApp=!0,\1\.isMobile=!0,\1\.isAndroidApp=(\w+),\1\.isIosApp=(\w+),/,
    replace: 'Object.assign($1,{isMobileApp:!0,isMobile:!0,isAndroidApp:$2,isIosApp:$3},window.__owPlatformOverrides||{}),',
    expectedMatches: 1,
  },
  {
    name: 'is-mobile-class',
    find:    /document\.body\.addClass\("is-mobile"\),/,
    replace: 'window.__owPlatform.isMobile&&document.body.addClass("is-mobile"),',
    expectedMatches: 1,
  },
];

async function applyPatches(appJsPath) {
  let content = await fsp.readFile(appJsPath, 'utf8');

  for (const patch of PATCHES) {
    // Count matches using a global flag (cloned from the non-global regex).
    const globalRegex = new RegExp(patch.find.source, 'g');
    const matches = content.match(globalRegex) || [];

    if (matches.length !== patch.expectedMatches) {
      throw new Error(
        `Patch "${patch.name}" expected ${patch.expectedMatches} match(es), ` +
        `found ${matches.length}. The minifier may have changed the bundle ` +
        `layout. Update the regex in scripts/patch-obsidian-mobile.js.`
      );
    }

    content = content.replace(patch.find, patch.replace);
    console.log(`  patched: ${patch.name} (${matches.length}x)`);
  }

  await fsp.writeFile(appJsPath, content, 'utf8');
}

module.exports = { applyPatches, PATCHES };

// CLI mode
if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/patch-obsidian-mobile.js <path-to-app.js>');
    process.exit(1);
  }
  applyPatches(path.resolve(target))
    .then(() => console.log('Done.'))
    .catch(err => { console.error('Error:', err.message); process.exit(1); });
}

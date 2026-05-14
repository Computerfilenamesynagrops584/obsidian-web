/**
 * System plugin overlay.
 *
 * This module scans <repo>/plugins/ at startup and tracks plugin ids
 * whose source lives in the repo (not in any user's vault). The HTTP
 * FS API (server/api/fs.js) consults these helpers to overlay system
 * plugin files on top of the vault's filesystem:
 *
 *   - Reads/stats for .obsidian/plugins/<id>/<file> fall back to the
 *     repo copy when the vault doesn't have it.
 *   - Reads of .obsidian/community-plugins.json have system ids merged
 *     in, so Obsidian sees them as enabled.
 *   - Writes of .obsidian/community-plugins.json have system ids
 *     stripped, so we don't pollute the user's vault.
 *
 * Result: a user can open any vault and the layout-switcher plugin
 * (and any future system plugin) appears automatically — without us
 * ever touching files inside the vault directory.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const SYSTEM_PLUGINS_DIR = path.resolve(__dirname, '..', 'plugins');

// Populated by init() — set of plugin ids whose source is in SYSTEM_PLUGINS_DIR.
const SYSTEM_PLUGIN_IDS = new Set();

function init() {
  SYSTEM_PLUGIN_IDS.clear();

  let entries;
  try {
    entries = fs.readdirSync(SYSTEM_PLUGINS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('[system-plugins] no ' + SYSTEM_PLUGINS_DIR + ' directory — no system plugins loaded');
      return;
    }
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;
    const manifestPath = path.join(SYSTEM_PLUGINS_DIR, dirName, 'manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      console.warn('[system-plugins] skipping ' + dirName + ': cannot read manifest.json (' + err.message + ')');
      continue;
    }
    if (!manifest || typeof manifest.id !== 'string') {
      console.warn('[system-plugins] skipping ' + dirName + ': manifest.json has no string id');
      continue;
    }
    if (manifest.id !== dirName) {
      console.warn('[system-plugins] skipping ' + dirName + ': directory name does not match manifest id "' + manifest.id + '"');
      continue;
    }
    SYSTEM_PLUGIN_IDS.add(manifest.id);
  }

  const ids = getSystemPluginIds();
  console.log('[system-plugins] Loaded ' + ids.length + ' system plugins' + (ids.length ? ': ' + ids.join(', ') : ''));
}

function getSystemPluginIds() {
  return Array.from(SYSTEM_PLUGIN_IDS).sort();
}

/**
 * True if relPath points to either a known system plugin directory
 * (.obsidian/plugins/<id>) or any file inside it.
 */
function isSystemPluginPath(relPath) {
  if (typeof relPath !== 'string') return false;
  const m = relPath.match(/^\.obsidian\/plugins\/([^/]+)(?:\/.*)?$/);
  if (!m) return false;
  return SYSTEM_PLUGIN_IDS.has(m[1]);
}

/**
 * Resolve relPath against SYSTEM_PLUGINS_DIR if it points to a real file
 * inside a known system plugin directory. Returns absolute path or null.
 *
 * Path-traversal safe: resolved path must stay inside SYSTEM_PLUGINS_DIR.
 */
function tryGetSystemFilePath(relPath) {
  if (typeof relPath !== 'string') return null;

  const prefix = '.obsidian/plugins/';
  if (!relPath.startsWith(prefix)) return null;

  const rest = relPath.slice(prefix.length);
  if (!rest) return null;

  const parts = rest.split('/');
  const id = parts[0];
  if (!SYSTEM_PLUGIN_IDS.has(id)) return null;

  // Resolve against the repo plugin dir. Path traversal guard:
  // resolved path must stay inside SYSTEM_PLUGINS_DIR.
  const pluginRoot = path.join(SYSTEM_PLUGINS_DIR, id);
  const resolved = path.resolve(pluginRoot, '.' + path.sep + parts.slice(1).join('/'));
  const normalizedRoot = path.resolve(pluginRoot);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    return null;
  }

  // Must actually exist on disk. Caller treats null as "no overlay file".
  try {
    fs.statSync(resolved);
  } catch (_) {
    return null;
  }
  return resolved;
}

/**
 * Merge system plugin ids into a community-plugins.json array. Dedup.
 */
function mergeCommunityList(arr) {
  const base = Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  const set = new Set(base);
  for (const id of SYSTEM_PLUGIN_IDS) set.add(id);
  return Array.from(set);
}

/**
 * Strip system plugin ids from a community-plugins.json array
 * (so we don't pollute the user's vault when Obsidian writes it back).
 */
function stripCommunityList(arr) {
  if (!Array.isArray(arr)) return arr;
  return arr.filter((x) => typeof x === 'string' && !SYSTEM_PLUGIN_IDS.has(x));
}

module.exports = {
  init,
  getSystemPluginIds,
  isSystemPluginPath,
  tryGetSystemFilePath,
  mergeCommunityList,
  stripCommunityList,
  SYSTEM_PLUGINS_DIR,
};

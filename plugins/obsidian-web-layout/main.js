'use strict';

/**
 * Obsidian Web — Layout Switcher.
 *
 * Lets the user pick between three layout modes on the web wrapper:
 *   - auto    → use viewport heuristics (default)
 *   - mobile  → force the mobile layout
 *   - desktop → force the desktop layout
 *
 * The mode is persisted in localStorage under "obsidian-web:layout-mode".
 * client-mobile/boot.js reads this key and sets window.__owPlatformOverrides
 * before the Obsidian bundle initializes Platform.
 *
 * In real Obsidian (desktop or mobile app) window.__owPlatform does not
 * exist, so this plugin loads as a no-op — no ribbon icon, no commands.
 */

const obsidian = require('obsidian');

const LAYOUT_KEY = 'obsidian-web:layout-mode';
const MODES = ['auto', 'mobile', 'desktop'];

function getMode() {
  return localStorage.getItem(LAYOUT_KEY) || 'auto';
}

function setMode(mode) {
  if (!MODES.includes(mode)) return;
  if (mode === 'auto') {
    // Remove the key so boot.js falls back to viewport detection.
    localStorage.removeItem(LAYOUT_KEY);
  } else {
    localStorage.setItem(LAYOUT_KEY, mode);
  }
  showReloadOverlay(mode);
  setTimeout(() => location.reload(), 150);
}

function showReloadOverlay(mode) {
  const div = document.createElement('div');
  div.style.cssText = [
    'position:fixed', 'inset:0',
    'background:var(--background-primary)',
    'color:var(--text-normal)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'font:14px var(--font-interface, sans-serif)',
    'z-index:99999',
  ].join(';');
  div.textContent = 'Switching to ' + mode + ' mode…';
  document.body.appendChild(div);
}

function modeLabel(mode) {
  return mode === 'auto'    ? 'Auto (by viewport)'
       : mode === 'mobile'  ? 'Mobile layout'
       : mode === 'desktop' ? 'Desktop layout'
       : mode;
}

module.exports = class ObsidianWebLayoutPlugin extends obsidian.Plugin {
  async onload() {
    // Only activate on obsidian-web (where __owPlatform exists).
    // In real Obsidian desktop/mobile, this plugin is a no-op.
    if (typeof window.__owPlatform === 'undefined') {
      console.log('[obsidian-web-layout] not on obsidian-web — plugin idle');
      return;
    }

    this.addRibbonIcon('monitor-smartphone', 'Layout mode', (evt) => this.showMenu(evt));

    for (const mode of MODES) {
      this.addCommand({
        id: 'set-layout-' + mode,
        name: 'Set layout: ' + modeLabel(mode),
        callback: () => setMode(mode),
      });
    }
  }

  showMenu(evt) {
    const current = getMode();
    const menu = new obsidian.Menu();
    for (const mode of MODES) {
      menu.addItem((item) =>
        item
          .setTitle(modeLabel(mode))
          .setChecked(mode === current)
          .onClick(() => setMode(mode))
      );
    }
    menu.showAtMouseEvent(evt);
  }
};

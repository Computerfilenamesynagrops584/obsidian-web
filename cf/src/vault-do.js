/**
 * VaultDO — Durable Object that holds the entire vault in memory.
 *
 * One global instance (idFromName('demo')) serves all users simultaneously.
 *
 * Lifecycle:
 *   - constructor: initialise files from template (runs on every cold start
 *     after eviction, so eviction == natural reset).
 *   - alarm(): periodic forced reset even with active connections.
 *   - WebSocket hibernation: sockets survive DO eviction between messages;
 *     the DO is re-instantiated transparently.
 *
 * Storage modes (controlled by wrangler.toml [vars]):
 *   DEMO_MODE = "true"  → in-memory only, alarm reset, no auth.
 *   DEMO_MODE = "false" → writes also go to R2 (env.R2 binding),
 *                         loaded back on cold start.
 */

import { TEMPLATE_FILES } from './template.js';
import { buildBootstrap }  from './api/bootstrap.js';
import { handleFs }        from './api/fs.js';
import { handleElectron }  from './api/electron.js';
import { handleVaults }    from './api/vaults.js';
import { handleProxy }     from './api/proxy.js';

const DEFAULT_RESET_HOURS = 4;

export class VaultDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.resetIntervalMs =
      parseInt(env.RESET_INTERVAL_HOURS || DEFAULT_RESET_HOURS, 10) * 60 * 60 * 1000;

    // Initialise from template (or R2 in personal mode).
    // ctx.blockConcurrencyWhile ensures construction completes before
    // the first fetch() is handled.
    ctx.blockConcurrencyWhile(() => this._init());
  }

  async _init() {
    if (this.env.DEMO_MODE !== 'true' && this.env.R2) {
      await this._loadFromR2();
    } else {
      this._loadTemplate();
    }
    // Ensure the reset alarm persists across evictions.
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + this.resetIntervalMs);
    }
  }

  _loadTemplate() {
    this.files = new Map();
    const now = Date.now();
    for (const [path, content] of TEMPLATE_FILES) {
      const size = new TextEncoder().encode(content).length;
      this.files.set(path, { content, mtime: now, size });
    }
    this.dirs = computeDirs(this.files);
  }

  async _loadFromR2() {
    this.files = new Map();
    try {
      const list = await this.env.R2.list();
      await Promise.all(list.objects.map(async (obj) => {
        const item = await this.env.R2.get(obj.key);
        if (!item) return;
        const content = await item.text();
        this.files.set(obj.key, {
          content,
          mtime: obj.uploaded?.getTime() ?? Date.now(),
          size: obj.size,
        });
      }));
    } catch (_) {
      // R2 unavailable or empty — fall back to template.
      this._loadTemplate();
      return;
    }
    if (this.files.size === 0) this._loadTemplate();
    this.dirs = computeDirs(this.files);
  }

  // ── Alarm: periodic reset ──────────────────────────────────────────────────

  async alarm() {
    console.log('[vault-do] alarm fired — resetting vault');
    this._loadTemplate();
    // Notify all connected WebSocket clients that files changed so Obsidian
    // re-reads any open notes.
    for (const [path] of this.files) {
      if (!path.startsWith('.obsidian/')) {
        this._broadcast({ type: 'change', path });
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + this.resetIntervalMs);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _broadcast(message) {
    const json = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(json); } catch (_) {}
    }
  }

  rebuildDirs() {
    this.dirs = computeDirs(this.files);
  }

  // In demo mode, template files are protected from deletion so the vault
  // always has meaningful content for visitors to see.
  isProtected(path) {
    return this.env.DEMO_MODE === 'true' && TEMPLATE_FILES.has(path);
  }

  // ── fetch: main request handler ────────────────────────────────────────────

  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // ── WebSocket upgrade (/api/watch) ────────────────────────────────────
    if (request.headers.get('Upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      // acceptWebSocket enables hibernation: the DO can be evicted between
      // messages without closing the socket.
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'ready' }));
      return new Response(null, { status: 101, webSocket: client });
    }

    // ── API routes ────────────────────────────────────────────────────────
    if (pathname.startsWith('/api/fs/'))             return handleFs(request, url, this);
    if (pathname.startsWith('/api/bootstrap'))       return Response.json(buildBootstrap(this));
    if (pathname.startsWith('/api/electron/'))       return handleElectron(request, url, this);
    if (pathname.startsWith('/api/vaults/'))         return handleVaults(request, url);
    if (pathname.startsWith('/api/proxy-request'))   return handleProxy(request);

    return new Response('Not found', { status: 404 });
  }

  // ── WebSocket hibernation callbacks ────────────────────────────────────────
  // Required when using ctx.acceptWebSocket().

  async webSocketMessage(_ws, _message) {
    // Clients don't send messages to the watch socket.
  }

  async webSocketClose(_ws, _code, _reason) {}
  async webSocketError(_ws, _error) {}
}

// ── computeDirs ───────────────────────────────────────────────────────────────
//
// Derives the full directory listing map from the files map.
// Hidden directories (.obsidian) are tracked in their own dir entry
// but NOT surfaced in the root listing (mirroring server/api/bootstrap.js
// behaviour: root readdir skips hidden entries).

export function computeDirs(files) {
  const dirs = new Map();
  dirs.set('', []);

  for (const [filePath, data] of files) {
    const parts = filePath.split('/');
    const fileName = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join('/');

    // File entry in its parent dir.
    if (!dirs.has(parentPath)) dirs.set(parentPath, []);
    dirs.get(parentPath).push({
      name: fileName,
      isFile: true,
      isDirectory: false,
      isSymbolicLink: false,
      mtime: data.mtime,
      size: data.size,
    });

    // Ensure every ancestor directory exists and appears in its own parent.
    for (let depth = 1; depth < parts.length; depth++) {
      const dirName = parts[depth - 1];
      const ancestorPath = parts.slice(0, depth - 1).join('/');
      const dirPath = parts.slice(0, depth).join('/');

      if (!dirs.has(dirPath)) dirs.set(dirPath, []);

      // Root listing: skip hidden dirs (e.g. .obsidian) — same as server.
      if (ancestorPath === '' && dirName.startsWith('.')) continue;

      if (!dirs.has(ancestorPath)) dirs.set(ancestorPath, []);
      const parentEntries = dirs.get(ancestorPath);
      if (!parentEntries.find(e => e.name === dirName)) {
        parentEntries.push({
          name: dirName,
          isFile: false,
          isDirectory: true,
          isSymbolicLink: false,
          mtime: data.mtime,
          size: 0,
        });
      }
    }
  }

  return dirs;
}

# Obsidian Web - Plan & Status

Live wrapper that runs Obsidian's renderer in a normal browser by replacing
its Electron dependencies with HTTP shims. Obsidian's own code stays
untouched so we can swap in newer versions without forking.

## Architecture

```
Browser
├── client/ (our code)
│   ├── index.html  - custom loader, defines script order
│   ├── boot.js     - installs window.require + globals
│   └── shims/      - one file per Node/Electron module we replace
└── obsidian/  (extracted from AppImage, never modified)
    ├── app.js
    ├── enhance.js / i18n.js / app.css / lib/* / public/*
    └── (starter.js / starter.html unused - replaced by our boot)

Server (server/)
├── index.js              - Express + WebSocket
├── vault-registry.js     - persistent recent-vault registry (data/vaults.json)
├── api/bootstrap.js      - single-shot preload: electron IPC + .obsidian/ + dirs cache
├── api/fs.js             - REST file system over HTTP (scoped per vault id)
├── api/electron.js       - stubs for ipcRenderer.sendSync channels
├── api/vaults.js         - vault list/open/remove/move API
└── api/watch.js          - chokidar -> WebSocket for fs.watch (per vault)

Vault
└── plain Markdown files (the user's actual content)
```

## Status

- Boot loads, all shims install successfully.
- Obsidian recognises the vault, sets the page title to "vault - Obsidian 1.12.7".
- File system operations work: stat, readdir, read, write, mkdir, unlink, rename.
- Obsidian creates and writes `.obsidian/` config files.
- Obsidian opens notes in tabs and saves edits back to disk.
- Hebrew RTL renders correctly out of the box.
- WebSocket-based fs.watch wiring is in place, with polling support for rclone/FUSE vaults (`WATCH_POLLING=true`).
- Bootstrap fetch is async: spinner renders immediately, Obsidian scripts injected dynamically after cache is ready.
- Metadata indexing completes after serving `/worker.js` from the root URL.
- File rename through the Obsidian UI works end-to-end.
- `scripts/update-obsidian.js` downloads the latest official Obsidian release and regenerates `obsidian/`.
- `/starter` serves a wrapped Obsidian starter screen with recent vaults.
- Vaults are tracked in a server-side registry and FS/watch requests are scoped by vault id.
- `/api/bootstrap` returns electron IPC + `.obsidian/` tree + dirs cache in one shot (brotli ~6MB).
  - Server-side mtime-based invalidation cache: HIT latency 4–20ms (down from ~800ms).
  - Server pre-compresses the response on build; HIT sends the pre-compressed Buffer directly.
  - Warm-up runs at server start so the first browser request is always a cache HIT.
- Can be deployed to any Linux box behind a reverse proxy. The app itself
  has no auth — use Cloudflare Access, HTTP Basic, or similar.

### Known issues / loose ends

#### A. Folder picker is still prompt-based
The starter now works through `/starter` and lists recent vaults from the
server registry. The temporary directory picker is `window.prompt()` with a
server path. Later we should replace it with a real server-side folder browser.

#### B. fs.watch on FUSE/rclone vaults
On FUSE-backed vaults (e.g. rclone), inotify doesn't work. chokidar falls
back to polling mode (`WATCH_POLLING=true`). External changes (e.g. from
another device via cloud storage) are only detected after the FUSE layer
picks them up.

#### ~~C. Some sync XHR calls 404 silently~~ ✅ נפתר
`__owSyncRequest` עם `opts.silent404=true` זורק ENOENT נקי במקום הודעת HTTP verbose.
`statSync` ו-`readFileSync` מפעילים את הדגל. הרעש מקוד שלנו נעלם; ה-browser XHR
log עדיין מופיע (לא ניתן לדכא) אבל רק בDevTools.

#### D. crypto fully stubbed
We only implement randomBytes. createHash returns empty buffers. If any
plugin or core feature uses crypto seriously, it will break.

See `docs/investigations.md` for solved issues and debugging notes.

## Roadmap

### Phase 1 — boot and editing MVP (done)
1. Load Obsidian's renderer without modifying `obsidian/app.js`.
2. Verify that indexing completes and the editor pane renders a note.
3. Click on a note in the file tree and confirm it opens.
4. Edit a note and confirm it saves to disk on the server.
5. Rename a file through the UI and confirm it persists to disk.
6. Regenerate `obsidian/` from the latest official release.

### Phase 2 — quality of life
5. Silence noisy 404s in sync-http; treat ENOENT as a normal not-found.
6. ✅ Implement a small in-memory cache on the client for stat/readdir results
   (invalidated by fs.watch events). Done via bootstrap + `__owBootstrapCache`.
7. ✅ Pre-flight bundle: `/api/bootstrap` endpoint returns electron IPC + `.obsidian/` +
   dirs cache in one shot. Pre-compressed on server; HIT latency 4–20ms.
8. Persist a per-vault session id so reloads don't re-index from scratch.

### Phase 3 — multi-vault + auth
9. Vault list / create / open / remove API. (done for MVP)
10. Wire the starter page so the vault picker actually works. (done with prompt picker)
11. Auth: currently provided by Cloudflare Access in front of the tunnel.
    Application-level auth (HTTP Basic / JWT) is still open — needed if the
    server is ever exposed without a CF tunnel.
12. Replace prompt picker with a server-side folder browser.

### Phase 4 — production quality
13. Handle very large files (range requests, streaming for >256MB writes).
14. Plugins: figure out which ones need extra shims, which work as-is.
15. Auto-update checks: compare current `obsidian/package.json` with the
    latest GitHub release and warn before incompatible upgrades.
16. Compatibility test suite: a Playwright harness that boots, opens a
    note, edits it, switches views, and checks no console errors.
17. Replace deprecated sync XHR with SharedArrayBuffer + Atomics.wait
    if any browser starts blocking sync XHR.

### Phase 5 — performance
18. Client-side cache for file content (LRU, invalidated by fs.watch).
19. Differential sync: send only diffs on writes.
20. Bundle splitting / lazy loading of `lib/*` (PixiJS, PDF.js, MathJax,
    Mermaid, Reveal) - they account for most of the byte weight.
21. Service worker for offline read-only mode.

## Open architectural questions

- **Plugins.** Obsidian plugins are JS files loaded at runtime. Most
  Mobile-compatible plugins should work. Desktop-only plugins that use
  Node APIs directly will fail; we can either shim more APIs or document
  which plugins are unsupported.
- **`window.process`.** We expose a minimal stub. If a plugin reads
  process.versions.node and gates behaviour on it, we may need to be
  more careful (claiming we're "node 20" might trigger code paths we
  can't satisfy).
- **Obsidian Sync.** Will not work - it's a paid Electron-only service.
  The web wrapper effectively replaces it: every device uses the same
  server-side vault.
- **Mobile.** PWA + responsive layout could work; Obsidian's mobile
  build path uses Capacitor which might offer cleaner targeting. Not
  in scope yet.

## Files to know about

| File | Purpose |
|------|---------|
| `server/index.js` | HTTP/WS entry point; triggers bootstrap warm-up on listen |
| `server/config.js` | port, host, vault path, obsidian path |
| `server/vault-registry.js` | persistent recent-vault registry |
| `server/api/bootstrap.js` | single-shot preload endpoint; server-side mtime cache; pre-compression |
| `server/api/vaults.js` | vault list/open/remove/move API |
| `server/api/fs.js` | REST file ops (scoped per vault id) |
| `server/api/electron.js` | sendSync channel handlers |
| `server/api/watch.js` | chokidar bridge (per-connection vault watcher) |
| `client/index.html` | script load order |
| `client/starter.html` | wrapped Obsidian starter entry |
| `client/boot.js` | window.require, modules table, platform globals |
| `client/shims/sync-http.js` | sync XMLHttpRequest helpers |
| `client/shims/original-fs.js` | fs over HTTP |
| `client/shims/electron.js` | ipcRenderer + remote stubs |
| `client/shims/path.js` | POSIX path utilities |
| `client/shims/url.js` | pathToFileURL, fileURLToPath |
| `client/shims/os.js` | tmpdir, hostname, etc. |
| `client/shims/btime.js` | birthtime stub (no-op) |
| `obsidian/` | extracted, untouched |
| `test-vault/` | scratch vault for development |

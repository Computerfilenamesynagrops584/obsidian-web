/**
 * Demo vault template.
 *
 * All vault files as plain strings, keyed by relative path.
 * Loaded into the Durable Object's in-memory Map on startup and on each reset.
 *
 * Keep the total size small (ideally < 100 KB uncompressed) so the bootstrap
 * response stays fast.
 */

const RESET_HOURS = 4;

export const TEMPLATE_FILES = new Map([

  // ── .obsidian config ──────────────────────────────────────────────────────
  ['.obsidian/app.json', JSON.stringify({
    legacyEditor: false,
    livePreview: true,
    defaultViewMode: 'preview',
  }, null, 2)],

  ['.obsidian/appearance.json', JSON.stringify({
    theme: '',
    cssTheme: '',
    baseFontSize: 16,
  }, null, 2)],

  ['.obsidian/core-plugins.json', JSON.stringify([
    'file-explorer', 'global-search', 'switcher', 'graph',
    'backlink', 'outgoing-link', 'tag-pane', 'properties',
    'command-palette', 'editor-status', 'word-count',
  ])],

  ['.obsidian/core-plugins-migration.json', JSON.stringify({ 'file-explorer': true })],

  // ── Notes ─────────────────────────────────────────────────────────────────

  ['Welcome.md', `# Welcome to Obsidian Web

> **Obsidian's desktop app — running in your browser, no Electron needed.**

This is a live demo of **obsidian-web**, an open-source project that runs Obsidian's original renderer in a standard browser by replacing every Electron dependency with lightweight HTTP shims.

**Everything works in the browser:** edit notes, create folders, rename files. Your changes are stored in a [Cloudflare Durable Object](https://developers.cloudflare.com/durable-objects/) and reset automatically every ${RESET_HOURS} hours.

---

## Things to try

- **Edit this note** — click the pencil icon above to switch to edit mode
- **Create a new note** — click the "new note" icon in the file tree
- **Quick open** — \`Ctrl+O\` (or \`Cmd+O\` on Mac)
- **Command palette** — \`Ctrl+P\` (or \`Cmd+P\`)
- **Search** — \`Ctrl+Shift+F\` for full-text search
- **Backlinks** — open [[How It Works]] and check the backlinks panel
- **Graph view** — click the graph icon in the left sidebar

---

## Notes in this demo

- [[How It Works]] — architecture and technical details
- [[Features/Markdown Showcase]] — Obsidian's Markdown rendering
- [[Features/Links and Backlinks]] — bidirectional linking
- [[Features/Tags]] — tag-based organization

---

> **Note:** this is a shared demo vault. Your edits are visible to others and reset every ${RESET_HOURS} hours. Core demo files cannot be deleted, but you can create and delete your own notes freely.

#demo #welcome
`],

  ['How It Works.md', `# How It Works

**obsidian-web** runs Obsidian's original renderer code (\`app.js\`) completely unmodified. Instead of forking Obsidian, we replace the Node.js and Electron APIs it depends on with browser-compatible shims.

## Architecture

\`\`\`
Browser
├── client/shims/         ← replace Node/Electron APIs
│   ├── original-fs.js    ← fs.readFile → HTTP requests
│   ├── electron.js       ← ipcRenderer → HTTP + bootstrap cache
│   ├── sync-http.js      ← statSync → synchronous XHR
│   ├── path.js           ← POSIX path utilities
│   └── ...               ← os, url, crypto, etc.
├── client/boot.js        ← installs window.require, fetches bootstrap
└── obsidian/app.js       ← Obsidian's code, completely untouched
\`\`\`

## This demo: Cloudflare Workers

In this deployment, instead of a Node.js server, all the backend runs on **Cloudflare Workers + Durable Objects**:

| Component | What it does |
|-----------|-------------|
| **Worker** | Routes requests: \`/api/*\` → Durable Object, everything else → static CDN |
| **Durable Object** | Holds the vault in memory (\`Map<path, content>\`), serves the FS API |
| **Bootstrap** | Single \`/api/bootstrap\` call preloads all files + directory listings |
| **WebSocket** | Pushes real-time file change events to all connected tabs |
| **Alarm** | Resets the vault to its template every ${RESET_HOURS} hours |

## The shim approach

When Obsidian calls \`require('fs')\`, our \`boot.js\` intercepts it and returns our HTTP-based \`original-fs.js\` shim. When Obsidian calls \`ipcRenderer.sendSync('vault')\`, our \`electron.js\` shim returns pre-cached values from the bootstrap payload. No Electron process is needed.

Key shims:
- **fs** — translates \`readFile\`, \`writeFile\`, \`stat\`, \`readdir\`, \`watch\` to HTTP/WebSocket
- **electron** — stubs \`ipcRenderer\`, \`remote\`, \`webFrame\`, \`Menu\`, \`dialog\`
- **crypto** — \`randomBytes\` via Web Crypto, \`createHash\` with async WebCrypto digest
- **path / os / url** — standard POSIX implementations

## Links

- [[Welcome]] ← back to the main page
- [[Features/Markdown Showcase]]

#architecture #obsidian-web
`],

  ['Features/Markdown Showcase.md', `# Markdown Showcase

Everything Obsidian's renderer supports works here — it's the same code.

## Text Formatting

**Bold**, *italic*, ~~strikethrough~~, \`inline code\`, ==highlight==

## Lists

1. Ordered item
2. Another item
   - Nested unordered
   - Also nested
     - Triple nested

## Task Lists

- [x] Boot Obsidian in the browser
- [x] File system shims over HTTP
- [x] Real-time sync via WebSocket
- [ ] Plugin support

## Code Blocks

\`\`\`typescript
interface VaultFile {
  content: string;
  mtime:   number;
  size:    number;
}

// The Durable Object holds every file in memory
const vault = new Map<string, VaultFile>();
\`\`\`

## Tables

| Feature       | Node Server | Cloudflare DO |
|---------------|:-----------:|:-------------:|
| FS API        | ✅           | ✅             |
| WebSocket     | ✅           | ✅             |
| Persistent    | ✅           | R2 (optional) |
| Global CDN    | ❌           | ✅             |
| Always-on     | ❌           | ✅             |

## Blockquote

> Obsidian's renderer runs untouched in the browser.
> Only the Electron/Node.js APIs are replaced with HTTP shims.

## Callouts

> [!info] How this works
> This note is rendered by Obsidian's real Markdown pipeline — CodeMirror for editing, their custom renderer for preview. We don't reimplement anything.

> [!warning] Demo vault
> Changes reset every ${RESET_HOURS} hours. Create your own notes to experiment!

## Math

$$E = mc^2$$

## Horizontal Rule

---

← [[Welcome]] | [[Features/Links and Backlinks]]

#markdown #features
`],

  ['Features/Links and Backlinks.md', `# Links and Backlinks

Obsidian's killer feature — bidirectional links between notes.

## Internal Links

- [[Welcome]] — back to start
- [[How It Works]] — architecture
- [[Features/Markdown Showcase]] — formatting examples

## Link with alias

[[Welcome|Back to the welcome page]] — same note, different display text.

## Backlinks Panel

Open this note and click the **backlinks icon** in the right sidebar. You'll see every note that links here.

Notes linking to this page:
- [[Welcome]] (from the notes list)
- [[Features/Markdown Showcase]] (from the bottom navigation)

## Outgoing Links

The **outgoing links** panel shows all links *from* this note to other notes.

## Unresolved Links

[[A Note That Does Not Exist]] — Obsidian highlights unresolved links in a different color. Click it to create the note.

← [[Features/Markdown Showcase]] | [[Features/Tags]]

#links #backlinks #graph
`],

  ['Features/Tags.md', `# Tags

Tags in Obsidian let you categorize notes without a rigid folder structure.

## Inline Tags

Use \`#tagname\` anywhere in a note: #features #tags #demo

## Tag Pane

Open the **Tag Pane** from the left sidebar to see all tags in the vault and how many notes use each one.

## Nested Tags

#features/markdown
#features/links
#features/tags

Nested tags appear as a hierarchy in the tag pane.

## Tags in This Vault

| Tag | Notes |
|-----|-------|
| #demo | Welcome, Tags |
| #features | Markdown, Links, Tags |
| #architecture | How It Works |

← [[Features/Links and Backlinks]] | [[Welcome]]

#tags #features #demo
`],

]);

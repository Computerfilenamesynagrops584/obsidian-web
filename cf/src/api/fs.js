/**
 * File system API — mirrors server/api/fs.js.
 *
 * Translates HTTP endpoints into operations on vault.files / vault.dirs.
 * Paths are always relative to the vault root (no path escaping needed —
 * there is no real filesystem to escape from).
 */

// ── Path utilities (no Node.js `path` module in Workers) ─────────────────────

function basename(p) {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? p : p.slice(idx + 1);
}

function dirname(p) {
  const idx = p.lastIndexOf('/');
  return idx === -1 ? '' : p.slice(0, idx);
}

// ── Response helpers ──────────────────────────────────────────────────────────

function ok() {
  return Response.json({ ok: true });
}

function notFound(p) {
  return Response.json(
    { error: `ENOENT: no such file or directory, '${p}'`, code: 'ENOENT' },
    { status: 404 },
  );
}

function serverError(err) {
  return Response.json(
    { error: err.message, code: err.code || null },
    { status: 500 },
  );
}

function makeStats(data, isDir = false) {
  const now = Date.now();
  return {
    isFile:        !isDir,
    isDirectory:   isDir,
    isSymbolicLink: false,
    size:          data?.size ?? 0,
    mtime:         data?.mtime ?? now,
    ctime:         data?.mtime ?? now,
    atime:         data?.mtime ?? now,
    birthtime:     data?.mtime ?? now,
    mode:          isDir ? 0o040755 : 0o100644,
  };
}

function getPath(url) {
  return decodeURIComponent(url.searchParams.get('path') || '');
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleFs(request, url, vault) {
  const op     = url.pathname.replace(/^\/api\/fs\//, '');
  const method = request.method;

  try {
    if (op === 'stat'    && method === 'GET')    return stat(url, vault);
    if (op === 'readdir' && method === 'GET')    return readdir(url, vault);
    if (op === 'read'    && method === 'GET')    return read(url, vault);
    if (op === 'write'   && method === 'PUT')    return write(request, url, vault);
    if (op === 'mkdir'   && method === 'POST')   return mkdir(request, vault);
    if (op === 'unlink'  && method === 'DELETE') return unlink(url, vault);
    if (op === 'rmdir'   && method === 'DELETE') return rmdir(url, vault);
    if (op === 'rename'  && method === 'POST')   return rename(request, vault);
    if (op === 'copy'    && method === 'POST')   return copy(request, vault);
    return new Response('Not found', { status: 404 });
  } catch (err) {
    return serverError(err);
  }
}

// ── Operations ────────────────────────────────────────────────────────────────

function stat(url, vault) {
  const p = getPath(url);
  if (vault.files.has(p))  return Response.json(makeStats(vault.files.get(p), false));
  if (vault.dirs.has(p))   return Response.json(makeStats(null, true));
  return notFound(p);
}

function readdir(url, vault) {
  const p = getPath(url);
  if (!vault.dirs.has(p)) return notFound(p);
  const entries = vault.dirs.get(p).map(e => ({
    name:           e.name,
    isFile:         e.isFile,
    isDirectory:    e.isDirectory,
    isSymbolicLink: e.isSymbolicLink,
    stats:          makeStats(e, e.isDirectory),
  }));
  return Response.json(entries);
}

function read(url, vault) {
  const p        = getPath(url);
  const encoding = url.searchParams.get('encoding');
  // Directory read → EISDIR (Node's fs.readFile on a directory returns this).
  // Obsidian checks for EISDIR to confirm a path is a directory; returning
  // ENOENT instead causes it to think the vault doesn't exist.
  if (vault.dirs.has(p) && !vault.files.has(p)) {
    return Response.json(
      { error: `EISDIR: illegal operation on a directory, read '${p}'`, code: 'EISDIR' },
      { status: 400 },
    );
  }
  if (!vault.files.has(p)) return notFound(p);
  const { content } = vault.files.get(p);
  if (encoding) {
    return new Response(content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(new TextEncoder().encode(content), {
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}

async function write(request, url, vault) {
  const p        = getPath(url);
  const encoding = url.searchParams.get('encoding');
  const content  = encoding ? await request.text() : new TextDecoder().decode(await request.arrayBuffer());
  const size     = new TextEncoder().encode(content).length;
  const mtime    = Date.now();

  vault.files.set(p, { content, mtime, size });
  vault.rebuildDirs();

  // Persist to R2 in personal mode.
  if (vault.env.R2) await vault.env.R2.put(p, content);

  vault._broadcast({ type: 'change', path: p });
  return ok();
}

async function mkdir(request, vault) {
  const body = await request.json();
  const p    = body.path || '';
  if (!vault.dirs.has(p)) {
    vault.dirs.set(p, []);
    vault.rebuildDirs();
  }
  return ok();
}

function unlink(url, vault) {
  const p = getPath(url);
  if (!vault.files.has(p)) return notFound(p);
  if (vault.isProtected(p)) {
    return Response.json(
      { error: 'This file is part of the demo and cannot be deleted.', code: 'EACCES' },
      { status: 403 },
    );
  }
  vault.files.delete(p);
  vault.rebuildDirs();
  if (vault.env.R2) vault.env.R2.delete(p).catch(() => {});
  vault._broadcast({ type: 'unlink', path: p });
  return ok();
}

function rmdir(url, vault) {
  const p = getPath(url);
  if (!vault.dirs.has(p)) return notFound(p);
  // Remove all files under this directory, skipping protected template files.
  for (const key of [...vault.files.keys()]) {
    if (key === p || key.startsWith(p + '/')) {
      if (vault.isProtected(key)) continue;
      vault.files.delete(key);
      if (vault.env.R2) vault.env.R2.delete(key).catch(() => {});
    }
  }
  vault.rebuildDirs();
  vault._broadcast({ type: 'unlinkDir', path: p });
  return ok();
}

async function rename(request, vault) {
  const { oldPath, newPath } = await request.json();
  if (!vault.files.has(oldPath)) return notFound(oldPath);
  const data = vault.files.get(oldPath);
  vault.files.set(newPath, { ...data, mtime: Date.now() });
  vault.files.delete(oldPath);
  vault.rebuildDirs();
  if (vault.env.R2) {
    await vault.env.R2.put(newPath, data.content);
    await vault.env.R2.delete(oldPath);
  }
  vault._broadcast({ type: 'rename', path: oldPath });
  vault._broadcast({ type: 'add',    path: newPath });
  return ok();
}

async function copy(request, vault) {
  const { src, dest } = await request.json();
  if (!vault.files.has(src)) return notFound(src);
  const data = vault.files.get(src);
  vault.files.set(dest, { ...data, mtime: Date.now() });
  vault.rebuildDirs();
  if (vault.env.R2) await vault.env.R2.put(dest, data.content);
  vault._broadcast({ type: 'add', path: dest });
  return ok();
}

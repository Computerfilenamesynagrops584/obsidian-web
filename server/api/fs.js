/**
 * File system HTTP API.
 *
 * Maps Node.js fs operations to HTTP endpoints. The client-side shim
 * (client/shims/original-fs.js) translates fs calls into requests here.
 *
 * All paths are relative to the configured vault root for safety.
 */

const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Imported lazily to avoid circular require — bootstrap.js exports serverCache.
function invalidateBootstrapCache(vaultId) {
  try {
    const { serverCache } = require('./bootstrap');
    if (serverCache) serverCache.delete(vaultId);
  } catch (_) {}
}

function createFsRouter(vaultRegistry, fallbackVaultRoot) {
  const router = express.Router();

  function getVaultRoot(req) {
    const vaultId = req.query.vault || (req.body && req.body.vault);
    if (vaultId) {
      const vault = vaultRegistry.get(vaultId);
      if (!vault) {
        const err = new Error('unknown vault: ' + vaultId);
        err.code = 'ENOVAULT';
        throw err;
      }
      return vault.path;
    }
    return fallbackVaultRoot;
  }

  // Resolve a path relative to the vault root, ensuring it stays inside.
  function resolveSafe(req, relPath) {
    if (typeof relPath !== 'string') {
      throw new Error('path must be a string');
    }
    const vaultRoot = getVaultRoot(req);
    const absolute = path.resolve(vaultRoot, '.' + path.sep + relPath);
    const normalizedRoot = path.resolve(vaultRoot);
    if (absolute !== normalizedRoot && !absolute.startsWith(normalizedRoot + path.sep)) {
      throw new Error('path escapes vault root: ' + relPath);
    }
    return absolute;
  }

  // Convert an fs.Stats object into a JSON-friendly form.
  function serializeStats(stats) {
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymbolicLink: stats.isSymbolicLink(),
      size: stats.size,
      mtime: stats.mtime.getTime(),
      ctime: stats.ctime.getTime(),
      atime: stats.atime.getTime(),
      birthtime: stats.birthtime.getTime(),
      mode: stats.mode,
    };
  }

  function handleError(res, err) {
    // ENOTDIR (readdir on a file) and EISDIR (read on a directory) are
    // routine "wrong shape" errors that Obsidian handles via try/catch.
    // We return 404 so the client-side fetch wrapper treats them like
    // any other "not found" without alarming console errors.
    const status = err.code === 'ENOENT' ? 404
      : err.code === 'EACCES' ? 403
      : err.code === 'EISDIR' ? 404
      : err.code === 'ENOTDIR' ? 404
      : err.code === 'ENOVAULT' ? 404
      : 500;
    res.status(status).json({
      error: err.message,
      code: err.code || null,
    });
  }

  // Stat a single entry.
  router.get('/stat', async (req, res) => {
    try {
      const target = resolveSafe(req, req.query.path || '');
      const stats = await fsp.stat(target);
      res.json(serializeStats(stats));
    } catch (err) {
      handleError(res, err);
    }
  });

  // List directory contents (with stats so the client can avoid extra round-trips).
  router.get('/readdir', async (req, res) => {
    try {
      const target = resolveSafe(req, req.query.path || '');
      // Helpful debug: log the resolved absolute path when readdir is called.
      // Useful for tracking down "readdir on a file" mysteries.
      if (process.env.OW_DEBUG) {
        console.log('[readdir]', req.query.path, '->', target);
      }
      const entries = await fsp.readdir(target, { withFileTypes: true });
      const result = await Promise.all(entries.map(async (entry) => {
        const child = path.join(target, entry.name);
        let stats = null;
        try {
          const s = await fsp.stat(child);
          stats = serializeStats(s);
        } catch (_) {
          // Broken symlink or permission issue: still return the name.
        }
        return {
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
          isSymbolicLink: entry.isSymbolicLink(),
          stats,
        };
      }));
      res.json(result);
    } catch (err) {
      handleError(res, err);
    }
  });

  // Read a file (text or binary depending on ?encoding).
  router.get('/read', async (req, res) => {
    try {
      const target = resolveSafe(req, req.query.path || '');
      const encoding = req.query.encoding || null;
      if (encoding) {
        const data = await fsp.readFile(target, encoding);
        res.type('text/plain; charset=utf-8').send(data);
      } else {
        const data = await fsp.readFile(target);
        res.type('application/octet-stream').send(data);
      }
    } catch (err) {
      handleError(res, err);
    }
  });

  // Write a file. Body is the raw content (text or binary).
  // ?encoding=utf8 means the server treats body as utf-8 text.
  router.put('/write', express.raw({ type: '*/*', limit: '256mb' }), async (req, res) => {
    try {
      const target = resolveSafe(req, req.query.path || '');
      const encoding = req.query.encoding || null;
      const data = encoding ? req.body.toString(encoding) : req.body;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, data, encoding ? { encoding } : undefined);
      invalidateBootstrapCache(req.query.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/mkdir', express.json(), async (req, res) => {
    try {
      const target = resolveSafe(req, req.body.path || '');
      const recursive = req.body.recursive !== false;
      await fsp.mkdir(target, { recursive });
      invalidateBootstrapCache(req.body.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.delete('/unlink', async (req, res) => {
    try {
      const target = resolveSafe(req, req.query.path || '');
      await fsp.unlink(target);
      invalidateBootstrapCache(req.query.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.delete('/rmdir', async (req, res) => {
    try {
      const target = resolveSafe(req, req.query.path || '');
      const recursive = req.query.recursive === '1';
      if (recursive) {
        await fsp.rm(target, { recursive: true, force: false });
      } else {
        await fsp.rmdir(target);
      }
      invalidateBootstrapCache(req.query.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/rename', express.json(), async (req, res) => {
    try {
      const oldPath = resolveSafe(req, req.body.oldPath || '');
      const newPath = resolveSafe(req, req.body.newPath || '');
      await fsp.rename(oldPath, newPath);
      invalidateBootstrapCache(req.body.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/copy', express.json(), async (req, res) => {
    try {
      const src = resolveSafe(req, req.body.src || '');
      const dest = resolveSafe(req, req.body.dest || '');
      await fsp.copyFile(src, dest);
      invalidateBootstrapCache(req.body.vault);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}

module.exports = createFsRouter;

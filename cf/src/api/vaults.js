/**
 * Vaults API — mirrors server/api/vaults.js.
 *
 * In the CF deployment there is exactly one vault ('demo').
 * All open/list calls return that vault regardless of the requested path.
 */

export function handleVaults(request, url) {
  const op = url.pathname.replace(/^\/api\/vaults\//, '');

  if (op === 'list') {
    return Response.json({ demo: { path: '/vault', ts: Date.now(), open: true } });
  }

  if (op === 'open') {
    return Response.json({ ok: true, id: 'demo' });
  }

  if (op === 'remove') {
    // No-op in demo — can't remove the only vault.
    return Response.json({ ok: true });
  }

  if (op === 'move') {
    // No-op in demo.
    return Response.json({ ok: true, value: '' });
  }

  return new Response('Not found', { status: 404 });
}

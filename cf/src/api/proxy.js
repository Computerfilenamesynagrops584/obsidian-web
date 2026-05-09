/**
 * Outbound HTTP proxy — mirrors server/api/proxy.js.
 *
 * Obsidian uses ipcRenderer.send('request-url', …) for outbound HTTP
 * (community plugin list, Templater, etc.). CORS prevents the browser from
 * making those requests directly, so we proxy them server-side.
 *
 * An allowlist restricts this to known Obsidian/GitHub hostnames so it
 * cannot be used as an open proxy.
 */

const ALLOWED_HOSTS = new Set([
  'releases.obsidian.md',
  'api.github.com',
  'github.com',
  'raw.githubusercontent.com',
  'forum.obsidian.md',
  'obsidian.md',
  'templater-unsplash-2.fly.dev',
]);

function isAllowed(urlStr) {
  try {
    const { hostname } = new URL(urlStr);
    if (ALLOWED_HOSTS.has(hostname))               return true;
    if (hostname.endsWith('.obsidian.md'))         return true;
    if (hostname.endsWith('.github.com'))          return true;
    if (hostname.endsWith('.githubusercontent.com')) return true;
    return false;
  } catch (_) {
    return false;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function handleProxy(request) {
  const body = await request.json().catch(() => null);
  if (!body?.url) {
    return Response.json({ error: 'url required' }, { status: 400 });
  }

  if (!isAllowed(body.url)) {
    console.warn('[proxy] blocked:', body.url);
    return Response.json({ error: 'host not allowed' }, { status: 403 });
  }

  const outHeaders = {
    'User-Agent': 'Obsidian/1.12.7',
    ...(body.headers || {}),
  };
  if (body.contentType) outHeaders['Content-Type'] = body.contentType;

  let outBody;
  if (body.body) {
    outBody = body.binary
      ? Uint8Array.from(atob(body.body), c => c.charCodeAt(0))
      : body.body;
  }

  try {
    const resp = await fetch(body.url, {
      method:  body.method || 'GET',
      headers: outHeaders,
      body:    outBody,
    });

    const respHeaders = {};
    for (const [k, v] of resp.headers) respHeaders[k.toLowerCase()] = v;

    const respBody = await resp.arrayBuffer();
    return Response.json({
      status:  resp.status,
      headers: respHeaders,
      body:    arrayBufferToBase64(respBody),
    });
  } catch (err) {
    console.error('[proxy] fetch error:', err.message);
    return Response.json({ error: err.message }, { status: 502 });
  }
}

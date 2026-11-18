// When the APK bundles the frontend locally (served from https://localhost),
// every /api/... path must be prefixed with the server's real origin.
// VITE_API_URL is set at build time for Android; empty on the web, where
// relative paths reach the same nginx that served the page.
export const API_BASE = import.meta.env.VITE_API_URL || '';

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

/** JSON fetch with cookies, a timeout, and the server's error message on failure. */
export async function api(path, { method = 'GET', body, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    const e = new Error(err.name === 'AbortError' ? 'The server took too long to answer' : "Can't reach the server");
    e.offline = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

/**
 * Counts a page view on the live site: the path, and whether this browser is
 * signed into the web admin (so an owner checking the site isn't counted as a
 * customer). Nothing else: no cookie, no id, no query string. See
 * api/src/usage.ts.
 *
 * Only on the production host, so staging copies and local dev don't count.
 */
export function recordView() {
  const api = import.meta.env.PUBLIC_KED_API_URL?.replace(/\/$/, '');
  if (!api || !import.meta.env.SITE || import.meta.env.BASE_URL !== '/') return;
  if (location.hostname !== new URL(import.meta.env.SITE).hostname) return;
  if (location.pathname.startsWith('/admin')) return;
  let owner = false;
  try {
    owner = !!localStorage.getItem('ked-admin-session');
  } catch {
    // private window: counts as a visitor
  }
  try {
    // text/plain keeps it a simple request, so the beacon needs no preflight.
    navigator.sendBeacon(`${api}/v1/visit`, new Blob([JSON.stringify({ path: location.pathname, owner })], { type: 'text/plain' }));
  } catch {
    // never let counting break the page
  }
}

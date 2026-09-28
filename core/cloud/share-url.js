export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export function buildShareUrl(appBaseUrl, shareId) {
  const base = new URL(appBaseUrl);
  if (!['https:','http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/') || !SHARE_ID_PATTERN.test(shareId)) throw new Error('Invalid sharing configuration');
  const url = new URL('p/',base); url.searchParams.set('g',shareId);
  if (url.href.length > 80) throw new Error('Share URL exceeds 80 characters');
  return url.href;
}
export function parseShareId(input) {
  try {
    const url = new URL(input);
    const entries = [...url.searchParams.entries()];
    if (!['https:','http:'].includes(url.protocol) || url.hash || url.username || url.password ||
        entries.length !== 1 || entries[0][0] !== 'g' || !SHARE_ID_PATTERN.test(entries[0][1])) return null;
    return entries[0][1];
  } catch { return null; }
}

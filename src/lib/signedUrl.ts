/**
 * TTL (seconds) for Supabase Storage signed URLs.
 * Anyone who holds a URL can use it until it expires — shortening this limits exposure after share revoke.
 * Min 60, max 86400. Default 900 (15 minutes).
 */
export function getSignedUrlExpiresSeconds(): number {
  const raw = process.env.SIGNED_URL_EXPIRES_SECONDS;
  if (raw === undefined || raw === '') return 900;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 900;
  return Math.min(86400, Math.max(60, n));
}

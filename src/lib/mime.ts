import { extname } from 'path';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isAllowedImageMime(mime: string | undefined): boolean {
  if (!mime) return false;
  return ALLOWED.has(mime.toLowerCase());
}

/** Map common MIME aliases and infer from extension when the browser sends empty or generic types. */
export function normalizeImageMime(mime: string | undefined, originalname: string): string {
  const m = mime?.trim().toLowerCase();
  if (m === 'image/jpg' || m === 'image/pjpeg') return 'image/jpeg';
  if (m === 'image/x-png') return 'image/png';
  if (m && ALLOWED.has(m)) return m;
  const ext = (originalname.split('.').pop() ?? '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return m ?? '';
}

export function extensionForMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

/** MIME for any uploaded file; falls back when client sends empty or invalid. */
export function normalizeUploadedFileMime(mime: string | undefined): string {
  const m = mime?.trim().toLowerCase();
  if (m && m.length > 0 && m.length < 200 && m.includes('/')) return m;
  return 'application/octet-stream';
}

/** Storage filename extension: prefer safe extension from original name, else MIME subtype, else `bin`. */
export function extensionForUploadedFile(originalname: string, mime: string): string {
  const fromName = extname(originalname || '').replace(/^\./, '').toLowerCase();
  if (fromName && /^[a-z0-9][a-z0-9.-]{0,20}$/i.test(fromName)) {
    const safe = fromName.replace(/[^a-z0-9]/gi, '');
    if (safe.length >= 1 && safe.length <= 16) return safe;
  }
  const subtype = mime.split('/')[1]?.split('+')[0]?.replace(/[^a-z0-9]/gi, '') || '';
  if (subtype && subtype.length <= 16) return subtype;
  return 'bin';
}

/**
 * Fix multipart filenames: browsers send UTF-8 bytes; multer often exposes them as latin1.
 * @see https://github.com/expressjs/multer/issues/1104
 */
export function decodeMulterUtf8Filename(originalname: string): string {
  if (!originalname) return '';
  try {
    return Buffer.from(originalname, 'latin1').toString('utf8');
  } catch {
    return originalname;
  }
}

/** Ukrainian + Russian Cyrillic → Latin (practical romanization). */
const CYR_TO_LAT: Record<string, string> = {
  А: 'A',
  а: 'a',
  Б: 'B',
  б: 'b',
  В: 'V',
  в: 'v',
  Г: 'H',
  г: 'h',
  Ґ: 'G',
  ґ: 'g',
  Д: 'D',
  д: 'd',
  Е: 'E',
  е: 'e',
  Є: 'Ye',
  є: 'ye',
  Ж: 'Zh',
  ж: 'zh',
  З: 'Z',
  з: 'z',
  И: 'Y',
  и: 'y',
  І: 'I',
  і: 'i',
  Ї: 'Yi',
  ї: 'yi',
  Й: 'Y',
  й: 'y',
  К: 'K',
  к: 'k',
  Л: 'L',
  л: 'l',
  М: 'M',
  м: 'm',
  Н: 'N',
  н: 'n',
  О: 'O',
  о: 'o',
  П: 'P',
  п: 'p',
  Р: 'R',
  р: 'r',
  С: 'S',
  с: 's',
  Т: 'T',
  т: 't',
  У: 'U',
  у: 'u',
  Ф: 'F',
  ф: 'f',
  Х: 'Kh',
  х: 'kh',
  Ц: 'Ts',
  ц: 'ts',
  Ч: 'Ch',
  ч: 'ch',
  Ш: 'Sh',
  ш: 'sh',
  Щ: 'Shch',
  щ: 'shch',
  Ь: '',
  ь: '',
  Ю: 'Yu',
  ю: 'yu',
  Я: 'Ya',
  я: 'ya',
  // Russian
  Ё: 'Yo',
  ё: 'yo',
  Ъ: '',
  ъ: '',
  Ы: 'Y',
  ы: 'y',
  Э: 'E',
  э: 'e',
};

function transliterateChars(s: string): string {
  let out = '';
  for (const ch of s) {
    out += CYR_TO_LAT[ch] ?? ch;
  }
  return out;
}

function sanitizeFileBaseSegment(s: string): string {
  return transliterateChars(s)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Safe file name for storage (ASCII + extension). */
export function normalizeUploadedFileDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'file';
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === trimmed.length - 1) {
    const base = sanitizeFileBaseSegment(trimmed);
    return base || 'file';
  }
  const base = trimmed.slice(0, lastDot);
  const ext = trimmed.slice(lastDot + 1);
  const baseT = sanitizeFileBaseSegment(base);
  const extSafe = transliterateChars(ext).replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'bin';
  return `${baseT || 'file'}.${extSafe}`;
}

/** Folder / human-readable title: keeps spaces, no path chars. */
export function normalizeFolderName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'folder';
  let out = transliterateChars(trimmed);
  out = out.replace(/[/\\]/g, '_').replace(/\0/g, '');
  out = out.replace(/\s+/g, ' ').trim();
  return out || 'folder';
}

function looksLikeFileWithExtension(name: string): boolean {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === name.length - 1) return false;
  const ext = name.slice(lastDot + 1);
  return ext.length >= 1 && ext.length <= 8 && /^[a-zA-Z0-9\u0400-\u04FF]+$/.test(ext);
}

/** Rename / mixed: file-like names vs folder titles. */
export function normalizeItemName(raw: string): string {
  const t = raw.trim();
  if (!t) return 'item';
  return looksLikeFileWithExtension(t) ? normalizeUploadedFileDisplayName(t) : normalizeFolderName(t);
}

/** Max upload size in bytes. Env `MAX_UPLOAD_FILE_SIZE_MB` (default 10). */
export function getMaxUploadBytes(): number {
  const mb = parseFloat(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? '10');
  if (Number.isFinite(mb) && mb > 0) return Math.floor(mb * 1024 * 1024);
  return 10 * 1024 * 1024;
}

export function getMaxUploadMbLabel(): string {
  const mb = parseFloat(process.env.MAX_UPLOAD_FILE_SIZE_MB ?? '10');
  if (Number.isFinite(mb) && mb > 0) return String(mb);
  return '10';
}

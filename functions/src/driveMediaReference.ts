const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,128}$/;
const DRIVE_HOSTS = new Set(['drive.google.com', 'docs.google.com']);

export function extractDriveFileId(reference: unknown): string {
  const value = typeof reference === 'string'
    ? reference.trim()
    : reference && typeof reference === 'object' && 'drive_file_id' in reference
      ? String((reference as { drive_file_id?: unknown }).drive_file_id || '').trim()
      : '';
  if (DRIVE_FILE_ID.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid Google Drive media reference.');
  }
  if (url.protocol !== 'https:' || !DRIVE_HOSTS.has(url.hostname.toLocaleLowerCase())) {
    throw new Error('Only Google Drive media references are supported.');
  }
  const pathMatch = /^\/file\/d\/([^/]+)(?:\/|$)/.exec(url.pathname);
  const candidate = pathMatch?.[1]
    || (url.pathname === '/open' || url.pathname === '/uc' ? url.searchParams.get('id') : null)
    || '';
  if (!DRIVE_FILE_ID.test(candidate)) throw new Error('Invalid Google Drive file ID.');
  return candidate;
}


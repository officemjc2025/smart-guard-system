import { writeFileSync } from 'node:fs';

// Used only by bootstrap scripts for files that do not exist. Existing files
// are always preserved so local credentials cannot be overwritten.
export function applyPatch(path, content) {
  writeFileSync(path, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

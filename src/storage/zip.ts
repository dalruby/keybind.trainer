// Export all data as a zip with the same folder layout, and import it back.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { parseProfile } from '../model/profile';
import { parseSession } from '../model/session';
import { formatIssue } from '../model/yamlDoc';
import type { FileStore } from './fileStore';
import type { Repository } from './repository';

export async function exportZip(store: FileStore): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const path of await store.list('')) {
    const text = await store.read(path);
    if (text !== null) files[path] = strToU8(text);
  }
  return zipSync(files, { level: 6 });
}

export interface ImportResult {
  imported: string[];
  /** Same path already exists with different content. */
  conflicts: string[];
  unchanged: string[];
  invalid: { path: string; problem: string }[];
}

const PROFILE_RE = /^profiles\/[^/]+\.yaml$/;
const SESSION_RE = /^sessions\/[^/]+\/[^/]+\.yaml$/;

/**
 * Import profiles and sessions from a zip. Files are validated first; existing
 * files are only replaced when `overwrite` is set.
 */
export async function importZip(data: Uint8Array, repo: Repository, overwrite: boolean): Promise<ImportResult> {
  const result: ImportResult = { imported: [], conflicts: [], unchanged: [], invalid: [] };
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    result.invalid.push({ path: '(file)', problem: 'not a valid zip file' });
    return result;
  }
  for (const [rawPath, bytes] of Object.entries(entries)) {
    // Accept zips that wrap everything in one top-level folder.
    const path = rawPath.replace(/^[^/]+\/(?=(profiles|sessions)\/)/, '');
    if (path.endsWith('/') || rawPath.startsWith('__MACOSX/')) continue;
    const isProfile = PROFILE_RE.test(path);
    if (!isProfile && !SESSION_RE.test(path)) continue;
    const text = strFromU8(bytes);
    const parsed = isProfile ? parseProfile(text) : parseSession(text);
    if (!parsed.ok) {
      result.invalid.push({ path, problem: parsed.issues.map(formatIssue).join('; ') });
      continue;
    }
    const current = await repo.store.read(path);
    if (current === text) {
      result.unchanged.push(path);
    } else if (current !== null && !overwrite) {
      result.conflicts.push(path);
    } else {
      await repo.writeFile(path, text);
      result.imported.push(path);
    }
  }
  return result;
}

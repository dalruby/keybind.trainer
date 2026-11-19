// Decides where data lives: a chosen folder (with this browser as backup),
// or only this browser when no folder is available.

import { BrowserFileStore } from './browserStore';
import { backupFiles } from './fileStore';
import {
  FolderFileStore,
  folderAccessSupported,
  folderPermission,
  forgetFolder,
  pickFolder,
  rememberedFolder,
  type FsDirHandle,
} from './folderStore';
import { Repository } from './repository';

export type StorageState =
  | { kind: 'browser'; folderSupported: boolean }
  | { kind: 'needs-permission'; handle: FsDirHandle }
  | { kind: 'folder'; handle: FsDirHandle };

export const browserStore = new BrowserFileStore();

/** Work out the current storage state without prompting the user. */
export async function detectStorage(): Promise<StorageState> {
  if (!folderAccessSupported()) return { kind: 'browser', folderSupported: false };
  const handle = await rememberedFolder();
  if (!handle) return { kind: 'browser', folderSupported: true };
  const perm = await folderPermission(handle, false);
  return perm === 'granted' ? { kind: 'folder', handle } : { kind: 'needs-permission', handle };
}

/** Re-grant access to the remembered folder. Must be called from a click. */
export async function reconnectFolder(handle: FsDirHandle): Promise<StorageState> {
  const perm = await folderPermission(handle, true);
  return perm === 'granted' ? { kind: 'folder', handle } : { kind: 'needs-permission', handle };
}

/** Let the user pick a folder. Must be called from a click. Null if cancelled. */
export async function chooseFolder(): Promise<StorageState | null> {
  const handle = await pickFolder();
  return handle ? { kind: 'folder', handle } : null;
}

export async function disconnectFolder(): Promise<StorageState> {
  await forgetFolder();
  return { kind: 'browser', folderSupported: folderAccessSupported() };
}

export function repositoryFor(state: StorageState): Repository {
  if (state.kind === 'folder') return new Repository(new FolderFileStore(state.handle), browserStore);
  return new Repository(browserStore);
}

/** After loading from a folder, refresh the browser backup copy. */
export async function refreshBackup(repo: Repository): Promise<void> {
  if (repo.mirror && repo.mirror !== repo.store) await backupFiles(repo.store, repo.mirror);
}

export { Repository } from './repository';
export type { ProfileEntry, SessionEntry, LoadResult } from './repository';

// Files in a folder on disk, via the File System Access API (Chrome/Edge).
// The folder handle is remembered in IndexedDB; the browser asks again for
// permission after a restart, which needs a click from the user.

import { createStore, del, get, set } from 'idb-keyval';
import type { FileStore } from './fileStore';

// Minimal typings for the parts of the File System Access API we use.
export interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
export interface FsDirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FsFileHandle | FsDirHandle>;
  getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FsDirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
  removeEntry(name: string): Promise<void>;
  queryPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
}

const isNotFound = (e: unknown) => e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');

export class FolderFileStore implements FileStore {
  constructor(readonly root: FsDirHandle) {}

  get label(): string {
    return this.root.name;
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: FsDirHandle, base: string) => {
      for await (const entry of dir.values()) {
        const path = base + entry.name;
        if (entry.kind === 'directory') {
          // Only descend into directories that can contain matching paths.
          if (prefix.startsWith(path + '/') || (path + '/').startsWith(prefix)) await walk(entry, path + '/');
        } else if (path.startsWith(prefix) && path.endsWith('.yaml')) {
          out.push(path);
        }
      }
    };
    await walk(this.root, '');
    return out.sort();
  }

  async read(path: string): Promise<string | null> {
    try {
      const { dir, name } = await this.resolve(path, false);
      const file = await (await dir.getFileHandle(name)).getFile();
      return await file.text();
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async write(path: string, text: string): Promise<void> {
    const { dir, name } = await this.resolve(path, true);
    const handle = await dir.getFileHandle(name, { create: true });
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
  }

  async remove(path: string): Promise<void> {
    try {
      const { dir, name } = await this.resolve(path, false);
      await dir.removeEntry(name);
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }

  private async resolve(path: string, create: boolean): Promise<{ dir: FsDirHandle; name: string }> {
    const parts = path.split('/');
    const name = parts.pop()!;
    let dir = this.root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return { dir, name };
  }
}

// --- choosing and remembering the folder ---------------------------------------

const settings = createStore('keybind-trainer-settings', 'settings');
const HANDLE_KEY = 'folder';

type PickerWindow = Window & { showDirectoryPicker?: (opts?: { mode?: 'readwrite'; id?: string }) => Promise<FsDirHandle> };

export function folderAccessSupported(): boolean {
  return typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

/** Ask the user for a folder (needs a click). Returns null if they cancel. */
export async function pickFolder(): Promise<FsDirHandle | null> {
  try {
    const handle = await (window as PickerWindow).showDirectoryPicker!({ mode: 'readwrite', id: 'keybind-trainer' });
    await set(HANDLE_KEY, handle, settings);
    return handle;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

export async function rememberedFolder(): Promise<FsDirHandle | null> {
  return (await get<FsDirHandle>(HANDLE_KEY, settings)) ?? null;
}

export async function forgetFolder(): Promise<void> {
  await del(HANDLE_KEY, settings);
}

export async function folderPermission(handle: FsDirHandle, request: boolean): Promise<PermissionState> {
  const opts = { mode: 'readwrite' as const };
  if (request && handle.requestPermission) return handle.requestPermission(opts);
  return handle.queryPermission ? handle.queryPermission(opts) : 'granted';
}

// Files kept in this browser's IndexedDB. Used as a backup copy of the folder,
// and as the only store when no folder is connected.

import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval';
import type { FileStore } from './fileStore';

export class BrowserFileStore implements FileStore {
  readonly label = 'this browser';
  private store: UseStore;

  constructor(dbName = 'keybind-trainer') {
    this.store = createStore(dbName, 'files');
  }

  async list(prefix: string): Promise<string[]> {
    const all = (await keys(this.store)) as string[];
    return all.filter((k) => typeof k === 'string' && k.startsWith(prefix)).sort();
  }
  async read(path: string): Promise<string | null> {
    return (await get<string>(path, this.store)) ?? null;
  }
  async write(path: string, text: string): Promise<void> {
    await set(path, text, this.store);
  }
  async remove(path: string): Promise<void> {
    await del(path, this.store);
  }
}

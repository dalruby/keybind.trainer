import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { BrowserFileStore } from '../src/storage/browserStore';
import { MemoryFileStore, backupFiles, copyFiles, filesOnlyIn } from '../src/storage/fileStore';
import { FolderFileStore, type FsDirHandle, type FsFileHandle } from '../src/storage/folderStore';
import { Repository, profilePath } from '../src/storage/repository';
import { exportZip, importZip } from '../src/storage/zip';
import { wowBarsTemplate } from '../src/model/templates';
import { serializeProfile } from '../src/model/profile';
import type { Session } from '../src/model/types';
import { bindingSnapshot } from '../src/model/fingerprint';

// --- an in-memory stand-in for a File System Access directory handle ---------
function fakeDir(name: string): FsDirHandle {
  const dirs = new Map<string, FsDirHandle>();
  const files = new Map<string, string>();
  const notFound = () => new DOMException('not found', 'NotFoundError');
  const fileHandle = (fname: string): FsFileHandle => ({
    kind: 'file',
    name: fname,
    getFile: async () => ({ text: async () => files.get(fname)! }),
    createWritable: async () => {
      let buf = '';
      return { write: async (d: string) => void (buf += d), close: async () => void files.set(fname, buf) };
    },
  });
  const dir: FsDirHandle = {
    kind: 'directory',
    name,
    async *values() {
      for (const d of dirs.values()) yield d;
      for (const f of files.keys()) yield fileHandle(f);
    },
    async getDirectoryHandle(n, opts) {
      if (!dirs.has(n)) {
        if (!opts?.create) throw notFound();
        dirs.set(n, fakeDir(n));
      }
      return dirs.get(n)!;
    },
    async getFileHandle(n, opts) {
      if (!files.has(n)) {
        if (!opts?.create) throw notFound();
        files.set(n, '');
      }
      return fileHandle(n);
    },
    async removeEntry(n) {
      if (!files.delete(n) && !dirs.delete(n)) throw notFound();
    },
  };
  return dir;
}

function sessionFor(profileId: string, startedAt = '2026-11-19T20:15:03.120Z'): Session {
  const profile = wowBarsTemplate(profileId);
  const b = profile.bindings[0];
  return {
    schema: 1,
    profile: profileId,
    mode: 'normal',
    startedAt,
    durationPlanned: 60,
    durationActual: 60,
    bindings: { [b.id]: bindingSnapshot(b, profile) },
    attempts: [{ b: b.id, t: 0.5, rt: 400 }],
  };
}

describe.each([
  ['memory', () => new MemoryFileStore()],
  ['browser (IndexedDB)', () => new BrowserFileStore(`test-${Math.random()}`)],
  ['folder', () => new FolderFileStore(fakeDir('data'))],
])('%s store', (_name, make) => {
  it('writes, lists by prefix, reads and removes files', async () => {
    const s = make();
    await s.write('profiles/a.yaml', 'A');
    await s.write('sessions/a/1.yaml', 'S1');
    await s.write('sessions/b/1.yaml', 'S2');
    expect(await s.list('')).toEqual(['profiles/a.yaml', 'sessions/a/1.yaml', 'sessions/b/1.yaml']);
    expect(await s.list('sessions/a/')).toEqual(['sessions/a/1.yaml']);
    expect(await s.read('profiles/a.yaml')).toBe('A');
    expect(await s.read('profiles/missing.yaml')).toBeNull();
    await s.write('profiles/a.yaml', 'A2');
    expect(await s.read('profiles/a.yaml')).toBe('A2');
    await s.remove('profiles/a.yaml');
    await s.remove('profiles/a.yaml'); // removing twice is fine
    expect(await s.list('profiles/')).toEqual([]);
  });
});

describe('Repository', () => {
  it('saves and loads profiles with their sessions, writing to the mirror too', async () => {
    const store = new MemoryFileStore();
    const mirror = new MemoryFileStore();
    const repo = new Repository(store, mirror);
    await repo.saveProfile(wowBarsTemplate('wow'));
    const path = await repo.saveSession(sessionFor('wow'));
    expect(path).toBe('sessions/wow/2026-11-19T20-15-03.yaml');
    expect(await repo.saveSession(sessionFor('wow'))).toBe('sessions/wow/2026-11-19T20-15-03-2.yaml');

    const loaded = await repo.load();
    expect(loaded.profiles).toHaveLength(1);
    expect(loaded.profiles[0].profile?.bindings).toHaveLength(40);
    expect(loaded.profiles[0].sessions).toHaveLength(2);
    expect([...mirror.files.keys()].sort()).toEqual([...store.files.keys()].sort());
  });

  it('reports invalid files and id/file name mismatches instead of failing', async () => {
    const store = new MemoryFileStore();
    await store.write('profiles/broken.yaml', 'id: broken\nname: [x\n');
    await store.write('profiles/renamed.yaml', serializeProfile(wowBarsTemplate('original')));
    await store.write('sessions/ghost/x.yaml', 'whatever: 1');
    const loaded = await new Repository(store).load();
    const broken = loaded.profiles.find((p) => p.fileId === 'broken')!;
    expect(broken.profile).toBeUndefined();
    expect(broken.issues[0].line).toBeDefined();
    const renamed = loaded.profiles.find((p) => p.fileId === 'renamed')!;
    expect(renamed.issues[0].message).toContain('must match the file name');
    expect(loaded.orphanSessions).toHaveLength(1);
  });

  it('moves sessions along when a profile id changes', async () => {
    const store = new MemoryFileStore();
    const repo = new Repository(store);
    await repo.saveProfile(wowBarsTemplate('old'));
    await repo.saveSession(sessionFor('old'));
    await repo.saveProfile(wowBarsTemplate('new'), 'old');
    expect(await store.list('')).toEqual(['profiles/new.yaml', 'sessions/new/2026-11-19T20-15-03.yaml']);
    const loaded = await repo.load();
    expect(loaded.profiles[0].sessions[0].session?.profile).toBe('new');
  });

  it('deletes a profile with or without its sessions', async () => {
    const store = new MemoryFileStore();
    const repo = new Repository(store);
    await repo.saveProfile(wowBarsTemplate('a'));
    await repo.saveSession(sessionFor('a'));
    await repo.deleteProfile('a', false);
    expect(await store.list('')).toEqual(['sessions/a/2026-11-19T20-15-03.yaml']);
    await repo.saveProfile(wowBarsTemplate('a'));
    await repo.deleteProfile('a', true);
    expect(await store.list('')).toEqual([]);
  });
});

describe('backup helpers', () => {
  it('backupFiles updates the copy but never deletes from it', async () => {
    const folder = new MemoryFileStore();
    const browser = new MemoryFileStore();
    await browser.write('profiles/only-in-browser.yaml', 'B');
    await folder.write('profiles/a.yaml', 'A');
    expect(await backupFiles(folder, browser)).toBe(1);
    expect(await browser.list('')).toEqual(['profiles/a.yaml', 'profiles/only-in-browser.yaml']);
    expect(await filesOnlyIn(browser, folder)).toEqual(['profiles/only-in-browser.yaml']);
  });

  it('copyFiles skips existing files unless overwriting', async () => {
    const a = new MemoryFileStore();
    const b = new MemoryFileStore();
    await a.write('x.yaml', 'new');
    await b.write('x.yaml', 'old');
    expect(await copyFiles(a, b, { overwrite: false })).toEqual([]);
    expect(await copyFiles(a, b, { overwrite: true })).toEqual(['x.yaml']);
    expect(await b.read('x.yaml')).toBe('new');
  });
});

describe('zip export/import', () => {
  it('round-trips all files', async () => {
    const source = new Repository(new MemoryFileStore());
    await source.saveProfile(wowBarsTemplate('wow'));
    await source.saveSession(sessionFor('wow'));
    const zip = await exportZip(source.store);

    const target = new Repository(new MemoryFileStore());
    const result = await importZip(zip, target, false);
    expect(result.imported.sort()).toEqual(['profiles/wow.yaml', 'sessions/wow/2026-11-19T20-15-03.yaml']);
    expect(await target.store.read(profilePath('wow'))).toBe(await source.store.read(profilePath('wow')));
  });

  it('reports conflicts, unchanged and invalid files', async () => {
    const source = new MemoryFileStore();
    await source.write('profiles/a.yaml', serializeProfile(wowBarsTemplate('a')));
    await source.write('profiles/b.yaml', serializeProfile(wowBarsTemplate('b', 'B from zip')));
    await source.write('profiles/bad.yaml', 'id: bad\n');
    const zip = await exportZip(source);

    const target = new Repository(new MemoryFileStore());
    await target.saveProfile(wowBarsTemplate('a'));
    await target.saveProfile(wowBarsTemplate('b', 'B local'));
    const result = await importZip(zip, target, false);
    expect(result.unchanged).toEqual(['profiles/a.yaml']);
    expect(result.conflicts).toEqual(['profiles/b.yaml']);
    expect(result.invalid.map((i) => i.path)).toEqual(['profiles/bad.yaml']);
    expect((await importZip(zip, target, true)).imported).toEqual(['profiles/b.yaml']);
  });

  it('rejects files that are not zips', async () => {
    const result = await importZip(new Uint8Array([1, 2, 3]), new Repository(new MemoryFileStore()), false);
    expect(result.invalid[0].problem).toBe('not a valid zip file');
  });
});

// A minimal text-file store addressed by relative paths like
// "profiles/wow.yaml". The folder, the browser mirror and tests all implement it.

export interface FileStore {
  /** Human-readable description, e.g. the folder name. */
  readonly label: string;
  /** All file paths starting with `prefix` (recursive), sorted. */
  list(prefix: string): Promise<string[]>;
  /** File contents, or null if the file does not exist. */
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, string>();
  constructor(readonly label = 'memory') {}

  async list(prefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort();
  }
  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }
  async write(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

/** Copy every file from one store to another. Returns the paths copied. */
export async function copyFiles(
  from: FileStore,
  to: FileStore,
  opts: { overwrite: boolean; prefix?: string },
): Promise<string[]> {
  const copied: string[] = [];
  for (const path of await from.list(opts.prefix ?? '')) {
    if (!opts.overwrite && (await to.read(path)) !== null) continue;
    const text = await from.read(path);
    if (text === null) continue;
    await to.write(path, text);
    copied.push(path);
  }
  return copied;
}

/**
 * Bring `to` up to date with `from`: writes new and changed files. Files only
 * in `to` are kept, so a backup never loses data because a folder is empty or
 * a different folder was picked.
 */
export async function backupFiles(from: FileStore, to: FileStore): Promise<number> {
  let changed = 0;
  for (const path of await from.list('')) {
    const text = await from.read(path);
    if (text !== null && (await to.read(path)) !== text) {
      await to.write(path, text);
      changed++;
    }
  }
  return changed;
}

/** Paths present in `a` but not in `b`. */
export async function filesOnlyIn(a: FileStore, b: FileStore): Promise<string[]> {
  const inB = new Set(await b.list(''));
  return (await a.list('')).filter((p) => !inB.has(p));
}

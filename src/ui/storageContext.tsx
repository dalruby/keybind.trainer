// Shares the storage state, repository and loaded data between pages.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { detectStorage, refreshBackup, repositoryFor, type LoadResult, type Repository, type StorageState } from '../storage';

interface StorageContextValue {
  storage: StorageState | null;
  setStorage: (s: StorageState) => void;
  repo: Repository | null;
  data: LoadResult | null;
  /** Re-read all files (and refresh the browser backup). */
  reload: () => Promise<void>;
  loadError: string | null;
}

const Ctx = createContext<StorageContextValue | null>(null);

export function StorageProvider({ children }: { children: ReactNode }) {
  const [storage, setStorage] = useState<StorageState | null>(null);
  const [data, setData] = useState<LoadResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const repo = useMemo(() => (storage ? repositoryFor(storage) : null), [storage]);

  useEffect(() => {
    detectStorage()
      .then(setStorage)
      .catch((e) => setLoadError(String(e)));
  }, []);

  const reload = useCallback(async () => {
    if (!repo) return;
    try {
      setData(await repo.load());
      setLoadError(null);
      await refreshBackup(repo);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [repo]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(() => ({ storage, setStorage, repo, data, reload, loadError }), [storage, repo, data, reload, loadError]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStorage(): StorageContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStorage must be used inside StorageProvider');
  return v;
}

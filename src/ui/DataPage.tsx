import { useCallback, useEffect, useRef, useState } from 'react';
import { wowBarsTemplate } from '../model/templates';
import { fingerIdOf, type Profile } from '../model/types';
import { formatIssue, type Issue } from '../model/yamlDoc';
import {
  browserStore,
  chooseFolder,
  detectStorage,
  disconnectFolder,
  reconnectFolder,
  refreshBackup,
  repositoryFor,
  type LoadResult,
  type ProfileEntry,
  type Repository,
  type StorageState,
} from '../storage';
import { copyFiles, filesOnlyIn } from '../storage/fileStore';
import { exportZip, importZip, type ImportResult } from '../storage/zip';

type Notice = { kind: 'ok' | 'error'; text: string };

export function DataPage() {
  const [storage, setStorage] = useState<StorageState | null>(null);
  const [data, setData] = useState<LoadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const repoRef = useRef<Repository | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const repo = repoRef.current;
    if (!repo) return;
    const loaded = await repo.load();
    setData(loaded);
    await refreshBackup(repo);
  }, []);

  /** Run an action, showing errors instead of failing silently. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void run(async () => setStorage(await detectStorage()));
  }, []);

  useEffect(() => {
    if (!storage) return;
    repoRef.current = repositoryFor(storage);
    void run(reload);
  }, [storage, reload]);

  const onChooseFolder = () =>
    run(async () => {
      const next = await chooseFolder();
      if (!next) return;
      const folderRepo = repositoryFor(next);
      const browserOnly = await filesOnlyIn(browserStore, folderRepo.store);
      if (
        browserOnly.length &&
        window.confirm(
          `This browser has ${browserOnly.length} file(s) that are not in "${folderRepo.store.label}". Copy them into the folder?\n\nExisting files in the folder are not changed.`,
        )
      ) {
        await copyFiles(browserStore, folderRepo.store, { overwrite: false });
      }
      setStorage(next);
    });

  const onReconnect = () =>
    run(async () => {
      if (storage?.kind === 'needs-permission') setStorage(await reconnectFolder(storage.handle));
    });

  const onDisconnect = () =>
    run(async () => {
      if (!window.confirm('Stop using this folder? The files stay on disk, and this browser keeps its own copy.')) return;
      setStorage(await disconnectFolder());
    });

  const onAddExample = () =>
    run(async () => {
      const repo = repoRef.current!;
      const taken = new Set(data?.profiles.map((p) => p.fileId));
      let id = 'wow-bars';
      for (let n = 2; taken.has(id); n++) id = `wow-bars-${n}`;
      await repo.saveProfile(wowBarsTemplate(id, id === 'wow-bars' ? undefined : `WoW action bars 1–4 (${id.slice(9)})`));
      await reload();
      setNotice({ kind: 'ok', text: `Added profiles/${id}.yaml` });
    });

  const onDelete = (entry: ProfileEntry) =>
    run(async () => {
      const name = entry.profile?.name ?? entry.fileId;
      const n = entry.sessions.length;
      const msg = n
        ? `Delete "${name}" and its ${n} session file(s)? This can't be undone.`
        : `Delete "${name}"? This can't be undone.`;
      if (!window.confirm(msg)) return;
      await repoRef.current!.deleteProfile(entry.fileId, true);
      await reload();
      setNotice({ kind: 'ok', text: `Deleted ${entry.path}` });
    });

  const onExport = () =>
    run(async () => {
      const zip = await exportZip(repoRef.current!.store);
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `keybind-trainer-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    });

  const onImportFile = (file: File) =>
    run(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const repo = repoRef.current!;
      let result = await importZip(bytes, repo, false);
      if (
        result.conflicts.length &&
        window.confirm(`${result.conflicts.length} file(s) already exist with different contents:\n\n${result.conflicts.join('\n')}\n\nReplace them?`)
      ) {
        const second = await importZip(bytes, repo, true);
        result = { ...second, imported: [...result.imported, ...second.imported], conflicts: [] };
      }
      await reload();
      setNotice({ kind: result.invalid.length ? 'error' : 'ok', text: describeImport(result) });
    });

  const location = storage?.kind === 'folder' ? `folder "${storage.handle.name}"` : 'this browser';

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>Data</h1>
          <p className="muted">Profiles and session results, stored as YAML files you can open and edit in any text editor.</p>
        </div>
      </header>

      <section className="card">
        <h2>Storage</h2>
        <StorageStatus storage={storage} />
        <div className="row-actions">
          {storage?.kind === 'needs-permission' && (
            <button onClick={onReconnect} disabled={busy}>
              Reconnect folder
            </button>
          )}
          {storage && !(storage.kind === 'browser' && !storage.folderSupported) && (
            <button className={storage.kind === 'browser' ? '' : 'secondary'} onClick={onChooseFolder} disabled={busy}>
              {storage.kind === 'browser' ? 'Choose folder' : 'Choose another folder'}
            </button>
          )}
          {storage && storage.kind !== 'browser' && (
            <button className="secondary" onClick={onDisconnect} disabled={busy}>
              Stop using folder
            </button>
          )}
          <button className="secondary" onClick={() => run(reload)} disabled={busy || !storage}>
            Reload files
          </button>
        </div>
      </section>

      {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}

      <section className="card">
        <div className="card-title">
          <h2>Profiles</h2>
          <div className="row-actions">
            <button onClick={onAddExample} disabled={busy || !data}>
              Add WoW bars example
            </button>
          </div>
        </div>
        {!data && <p className="muted">Loading…</p>}
        {data && data.profiles.length === 0 && (
          <p className="muted">No profiles in {location} yet. Add the example, or import a backup.</p>
        )}
        <div className="profile-list">
          {data?.profiles.map((entry) => (
            <ProfileRow key={entry.path} entry={entry} onDelete={() => onDelete(entry)} busy={busy} />
          ))}
        </div>
        {data && data.orphanSessions.length > 0 && (
          <p className="muted small">
            {data.orphanSessions.length} session file(s) belong to a profile that no longer exists (in{' '}
            <code>sessions/</code>). They are kept, but not shown.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Backup</h2>
        <p className="muted small">
          Export everything as a zip with the same <code>profiles/</code> and <code>sessions/</code> layout, or import
          one. Existing files are only replaced if you confirm.
        </p>
        <div className="row-actions">
          <button className="secondary" onClick={onExport} disabled={busy || !data}>
            Export zip
          </button>
          <button className="secondary" onClick={() => fileInput.current?.click()} disabled={busy || !data}>
            Import zip
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void onImportFile(file);
            }}
          />
        </div>
      </section>
    </main>
  );
}

function StorageStatus({ storage }: { storage: StorageState | null }) {
  if (!storage) return <p className="muted">Checking…</p>;
  switch (storage.kind) {
    case 'folder':
      return (
        <p>
          <span className="badge ok">Folder</span> Saving to <strong>{storage.handle.name}</strong>. This browser keeps a
          backup copy.
        </p>
      );
    case 'needs-permission':
      return (
        <p>
          <span className="badge bad">Needs permission</span> The browser needs your OK to use{' '}
          <strong>{storage.handle.name}</strong> again. Until then, you see the backup copy kept in this browser.
        </p>
      );
    case 'browser':
      return storage.folderSupported ? (
        <p>
          <span className="badge neutral">This browser only</span> Choose a folder to keep your data as YAML files on
          disk.
        </p>
      ) : (
        <p>
          <span className="badge neutral">This browser only</span> This browser can't save to a folder (use Chrome or
          Edge for that). Use Export zip for backups.
        </p>
      );
  }
}

function ProfileRow({ entry, onDelete, busy }: { entry: ProfileEntry; onDelete: () => void; busy: boolean }) {
  const { profile } = entry;
  const badSessions = entry.sessions.filter((s) => s.issues.length);
  return (
    <div className={`profile-row ${profile ? '' : 'invalid'}`}>
      <div className="profile-main">
        <div>
          <strong>{profile?.name ?? entry.fileId}</strong>{' '}
          <code className="muted">{entry.path}</code>
        </div>
        {profile ? (
          <div className="muted small">
            {profile.device && <>{profile.device} · </>}
            {profile.bindings.length} bindings · {entry.sessions.length - badSessions.length} sessions ·{' '}
            {fingerSummary(profile)}
          </div>
        ) : (
          <IssueList issues={entry.issues} />
        )}
        {badSessions.map((s) => (
          <div key={s.path} className="small">
            <code>{s.path}</code>
            <IssueList issues={s.issues} />
          </div>
        ))}
      </div>
      <button className="secondary danger" onClick={onDelete} disabled={busy}>
        Delete
      </button>
    </div>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  const shown = issues.slice(0, 5);
  return (
    <ul className="issues">
      {shown.map((i, n) => (
        <li key={n}>{formatIssue(i)}</li>
      ))}
      {issues.length > shown.length && <li>…and {issues.length - shown.length} more</li>}
    </ul>
  );
}

/** "left: pinky 30, index 24, middle 8, ring 8" style summary of finger use. */
function fingerSummary(profile: Profile): string {
  const counts = new Map<string, number>();
  for (const b of profile.bindings) for (const k of b.keys) {
    const id = fingerIdOf(k, profile);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const byHand = new Map<string, string[]>();
  for (const [id, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const [hand, finger] = id.split('.');
    byHand.set(hand, [...(byHand.get(hand) ?? []), `${finger} ${n}`]);
  }
  return [...byHand].map(([hand, parts]) => `${hand}: ${parts.join(', ')}`).join(' · ');
}

function describeImport(r: ImportResult): string {
  const parts = [`Imported ${r.imported.length} file(s)`];
  if (r.unchanged.length) parts.push(`${r.unchanged.length} already up to date`);
  if (r.conflicts.length) parts.push(`${r.conflicts.length} kept as they were`);
  if (r.invalid.length) parts.push(`${r.invalid.length} skipped as invalid: ${r.invalid.map((i) => `${i.path} (${i.problem})`).join('; ')}`);
  return parts.join(', ') + '.';
}

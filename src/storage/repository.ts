// Reads and writes profiles and sessions as YAML files in a FileStore.
// Layout: profiles/<id>.yaml and sessions/<profile id>/<start time>.yaml

import { parseProfile } from '../model/profile';
import { updateProfileText } from '../model/profileEdit';
import { parseSession, serializeSession, sessionFileStem } from '../model/session';
import type { Profile, Session } from '../model/types';
import type { Issue } from '../model/yamlDoc';
import type { FileStore } from './fileStore';

export const profilePath = (id: string) => `profiles/${id}.yaml`;
export const sessionDir = (profileId: string) => `sessions/${profileId}/`;

export interface SessionEntry {
  path: string;
  session?: Session;
  issues: Issue[];
}

export interface ProfileEntry {
  path: string;
  /** Id from the file name; the profile's own id must match it. */
  fileId: string;
  profile?: Profile;
  issues: Issue[];
  sessions: SessionEntry[];
}

export interface LoadResult {
  profiles: ProfileEntry[];
  /** Session folders with no matching profile file. */
  orphanSessions: SessionEntry[];
}

const stem = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.yaml$/, '');

export class Repository {
  /**
   * @param store  where files are read from and written to
   * @param mirror optional second store that receives every write (backup)
   */
  constructor(
    readonly store: FileStore,
    readonly mirror?: FileStore,
  ) {}

  async load(): Promise<LoadResult> {
    const profiles: ProfileEntry[] = [];
    for (const path of await this.store.list('profiles/')) {
      if (!/^profiles\/[^/]+\.yaml$/.test(path)) continue;
      const fileId = stem(path);
      const entry: ProfileEntry = { path, fileId, issues: [], sessions: [] };
      const text = await this.store.read(path);
      const parsed = parseProfile(text ?? '');
      if (!parsed.ok) entry.issues = parsed.issues;
      else if (parsed.value.id !== fileId) {
        entry.issues = [{ path: ['id'], message: `id "${parsed.value.id}" must match the file name "${fileId}.yaml"` }];
      } else entry.profile = parsed.value;
      profiles.push(entry);
    }

    const byId = new Map(profiles.map((p) => [p.fileId, p]));
    const orphanSessions: SessionEntry[] = [];
    for (const path of await this.store.list('sessions/')) {
      const m = /^sessions\/([^/]+)\/[^/]+\.yaml$/.exec(path);
      if (!m) continue;
      const entry: SessionEntry = { path, issues: [] };
      const parsed = parseSession((await this.store.read(path)) ?? '');
      if (!parsed.ok) entry.issues = parsed.issues;
      else if (parsed.value.profile !== m[1]) {
        entry.issues = [{ path: ['profile'], message: `profile "${parsed.value.profile}" must match the folder "${m[1]}"` }];
      } else entry.session = parsed.value;
      const owner = byId.get(m[1]);
      if (owner) owner.sessions.push(entry);
      else orphanSessions.push(entry);
    }
    return { profiles, orphanSessions };
  }

  async readProfileText(id: string): Promise<string | null> {
    return this.store.read(profilePath(id));
  }

  /**
   * Save a profile, keeping comments and formatting of the existing file where
   * possible. If its id changed, the file and session folder are renamed.
   */
  async saveProfile(profile: Profile, previousId?: string): Promise<void> {
    const current = await this.store.read(profilePath(previousId ?? profile.id));
    await this.writeFile(profilePath(profile.id), updateProfileText(current, profile));
    if (previousId && previousId !== profile.id) {
      for (const path of await this.store.list(sessionDir(previousId))) {
        const text = await this.store.read(path);
        const parsed = text === null ? null : parseSession(text);
        const newPath = sessionDir(profile.id) + path.slice(sessionDir(previousId).length);
        if (parsed?.ok) await this.writeFile(newPath, serializeSession({ ...parsed.value, profile: profile.id }));
        else if (text !== null) await this.writeFile(newPath, text);
        await this.remove(path);
      }
      await this.remove(profilePath(previousId));
    }
  }

  async deleteProfile(id: string, withSessions: boolean): Promise<void> {
    await this.remove(profilePath(id));
    if (withSessions) for (const path of await this.store.list(sessionDir(id))) await this.remove(path);
  }

  /** Save a session under a unique file name; returns its path. */
  async saveSession(session: Session): Promise<string> {
    const base = sessionDir(session.profile) + sessionFileStem(session.startedAt);
    let path = `${base}.yaml`;
    for (let n = 2; (await this.store.read(path)) !== null; n++) path = `${base}-${n}.yaml`;
    await this.writeFile(path, serializeSession(session));
    return path;
  }

  /** Write a file to the store and the mirror. */
  async writeFile(path: string, text: string): Promise<void> {
    await this.store.write(path, text);
    if (this.mirror && this.mirror !== this.store) await this.mirror.write(path, text);
  }

  private async remove(path: string): Promise<void> {
    await this.store.remove(path);
    if (this.mirror && this.mirror !== this.store) await this.mirror.remove(path);
  }
}

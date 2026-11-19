import { Document, isMap, isSeq } from 'yaml';
import { ID_PATTERN, TO_STRING, isRecord, parseYaml, type Checker, type Parsed } from './yamlDoc';
import { SCHEMA_VERSION, type Attempt, type BindingSnapshot, type Miss, type Session, type SessionMode } from './types';

const MODES: SessionMode[] = ['normal', 'weak-spot'];

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

export function parseSession(text: string): Parsed<Session> {
  const parsed = parseYaml(text);
  if (!parsed.ok) return parsed;
  const session = readSession(parsed.value, parsed.checker);
  if (parsed.checker.issues.length || !session) return { ok: false, issues: parsed.checker.issues };
  return { ok: true, value: session };
}

function readSession(v: unknown, c: Checker): Session | null {
  if (!isRecord(v)) {
    c.add([], 'a session must be a mapping');
    return null;
  }
  if ((v.schema ?? SCHEMA_VERSION) !== SCHEMA_VERSION) c.add(['schema'], `unsupported schema version ${String(v.schema)}`);
  if (typeof v.profile !== 'string' || !ID_PATTERN.test(v.profile)) c.add(['profile'], 'profile id is required');
  if (!MODES.includes(v.mode as SessionMode)) c.add(['mode'], `mode must be one of: ${MODES.join(', ')}`);
  if (typeof v.startedAt !== 'string' || Number.isNaN(Date.parse(v.startedAt))) {
    c.add(['startedAt'], 'startedAt must be an ISO date/time');
  }
  if (!isNum(v.durationPlanned) || v.durationPlanned <= 0) c.add(['durationPlanned'], 'durationPlanned must be a positive number of seconds');
  if (!isNum(v.durationActual) || v.durationActual < 0) c.add(['durationActual'], 'durationActual must be a number of seconds');
  if (v.bounces !== undefined && (!isNum(v.bounces) || v.bounces < 0)) c.add(['bounces'], 'bounces must be a number');

  const bindings: Record<string, BindingSnapshot> = {};
  if (!isRecord(v.bindings)) {
    c.add(['bindings'], 'bindings must be a mapping of binding id to { fp, keys }');
  } else {
    for (const [id, snap] of Object.entries(v.bindings)) {
      if (!isRecord(snap) || typeof snap.fp !== 'string' || !isStrList(snap.keys)) {
        c.add(['bindings', id], 'expected { fp: <text>, keys: [<hand.finger:Code>, ...] }');
        continue;
      }
      bindings[id] = { fp: snap.fp, keys: snap.keys };
    }
  }

  const attempts: Attempt[] = [];
  if (!Array.isArray(v.attempts)) {
    c.add(['attempts'], 'attempts must be a list');
  } else {
    v.attempts.forEach((a, i) => {
      const path = ['attempts', i];
      if (!isRecord(a) || typeof a.b !== 'string' || !isNum(a.t)) {
        c.add(path, 'expected { b: <binding id>, t: <seconds>, rt: <ms> }');
        return;
      }
      if (!(a.b in bindings)) c.add([...path, 'b'], `binding "${a.b}" is not listed under bindings`);
      if (a.rt !== undefined && (!isNum(a.rt) || a.rt < 0)) c.add([...path, 'rt'], 'rt must be a number of ms');
      const attempt: Attempt = { b: a.b, t: a.t };
      if (isNum(a.rt)) attempt.rt = a.rt;
      if (a.miss !== undefined) {
        if (!Array.isArray(a.miss)) {
          c.add([...path, 'miss'], 'miss must be a list');
        } else {
          const misses: Miss[] = [];
          a.miss.forEach((m, j) => {
            if (!isRecord(m) || !isStrList(m.k) || !isNum(m.at)) {
              c.add([...path, 'miss', j], 'expected { k: [<codes>], at: <ms> }');
            } else misses.push({ k: m.k, at: m.at });
          });
          if (misses.length) attempt.miss = misses;
        }
      }
      attempts.push(attempt);
    });
  }

  if (c.issues.length) return null;
  const session: Session = {
    schema: SCHEMA_VERSION,
    profile: v.profile as string,
    mode: v.mode as SessionMode,
    startedAt: v.startedAt as string,
    durationPlanned: v.durationPlanned as number,
    durationActual: v.durationActual as number,
    bindings,
    attempts,
  };
  if (isNum(v.bounces)) session.bounces = v.bounces;
  return session;
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Serialize a session with one line per binding snapshot and per attempt. */
export function serializeSession(s: Session): string {
  const obj: Record<string, unknown> = {
    schema: s.schema,
    profile: s.profile,
    mode: s.mode,
    startedAt: s.startedAt,
    durationPlanned: s.durationPlanned,
    durationActual: round(s.durationActual, 1),
  };
  if (s.bounces !== undefined) obj.bounces = s.bounces;
  obj.bindings = s.bindings;
  obj.attempts = s.attempts.map((a) => {
    const out: Record<string, unknown> = { b: a.b, t: round(a.t, 3) };
    if (a.rt !== undefined) out.rt = round(a.rt, 1);
    if (a.miss?.length) out.miss = a.miss.map((m) => ({ k: m.k, at: round(m.at, 1) }));
    return out;
  });

  const doc = new Document(obj);
  doc.commentBefore =
    ' keybind.trainer session. t = seconds since start, rt = ms to the correct input,\n' +
    ' miss = wrong inputs (k = keys held, at = ms after the prompt).';
  for (const key of ['bindings', 'attempts']) {
    const node = doc.get(key, true);
    if (isMap(node)) for (const pair of node.items) if (isMap(pair.value)) pair.value.flow = true;
    if (isSeq(node)) for (const item of node.items) if (isMap(item)) item.flow = true;
  }
  return doc.toString(TO_STRING);
}

/** File name stem for a session: its start time with characters safe on Windows. */
export function sessionFileStem(startedAt: string): string {
  return new Date(startedAt).toISOString().slice(0, 19).replace(/:/g, '-');
}

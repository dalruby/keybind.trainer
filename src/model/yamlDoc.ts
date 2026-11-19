// Shared helpers for parsing YAML with positions and reporting validation
// issues with line numbers, so hand-edit mistakes are easy to find.

import { Document, LineCounter, isNode, parseDocument, type ToStringOptions } from 'yaml';

export type IssuePath = (string | number)[];

export interface Issue {
  path: IssuePath;
  message: string;
  /** 1-based, if the location could be determined. */
  line?: number;
  col?: number;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

export const TO_STRING: ToStringOptions = {
  lineWidth: 0,
};

export function formatPath(path: IssuePath): string {
  return path.reduce<string>((s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${p}` : p), '');
}

export function formatIssue(issue: Issue): string {
  const where = issue.line !== undefined ? `line ${issue.line}: ` : '';
  const path = issue.path.length ? `${formatPath(issue.path)}: ` : '';
  return `${where}${path}${issue.message}`;
}

/** Collects issues and resolves each path to a line in the source. */
export class Checker {
  readonly issues: Issue[] = [];

  constructor(
    private doc: Document,
    private lines: LineCounter,
  ) {}

  add(path: IssuePath, message: string): void {
    this.issues.push({ path, message, ...this.locate(path) });
  }

  private locate(path: IssuePath): { line?: number; col?: number } {
    // Walk up the path until a node with a known position is found.
    for (let n = path.length; n >= 0; n--) {
      const node = n === 0 ? this.doc.contents : this.doc.getIn(path.slice(0, n), true);
      if (isNode(node) && node.range) {
        const pos = this.lines.linePos(node.range[0]);
        return { line: pos.line, col: pos.col };
      }
    }
    return {};
  }
}

/** Parse YAML text; returns syntax errors as issues, or the document and plain value. */
export function parseYaml(
  text: string,
): { ok: true; doc: Document; value: unknown; checker: Checker } | { ok: false; issues: Issue[] } {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length) {
    return {
      ok: false,
      issues: doc.errors.map((e) => {
        const pos = lines.linePos(e.pos[0]);
        return { path: [], message: e.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, ''), line: pos.line, col: pos.col };
      }),
    };
  }
  return { ok: true, doc, value: doc.toJS(), checker: new Checker(doc, lines) };
}

// --- small type guards used by the validators ---------------------------------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

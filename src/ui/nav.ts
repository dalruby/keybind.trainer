// A single "are you sure you want to leave?" guard, used by pages with
// unsaved changes. App consults it when the hash changes.

let guard: (() => boolean) | null = null;

/** Register a guard; it returns true when it is fine to leave. Returns an unregister function. */
export function setNavGuard(fn: () => boolean): () => void {
  guard = fn;
  return () => {
    if (guard === fn) guard = null;
  };
}

export function mayLeave(): boolean {
  return guard ? guard() : true;
}

export function navigate(hash: string): void {
  window.location.hash = hash;
}

/** Parse "#/profile/abc?from=x" into path segments and query. */
export function parseHash(hash: string): { parts: string[]; query: URLSearchParams } {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(query) };
}

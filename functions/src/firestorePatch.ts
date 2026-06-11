/**
 * Expand dotted keys into nested objects ({"jobs.x.status": v} → {jobs: {x: {status: v}}}).
 *
 * Firestore's set(..., {merge:true}) stores dotted keys as LITERAL field names — only update()
 * interprets the dots as field paths. Callers that build update()-style patches need this to
 * fall back to set() when the target doc doesn't exist yet (update() can't create docs).
 */
export function nestDottedKeys(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = cur[parts[i]];
      if (typeof next === 'object' && next !== null) {
        cur = next as Record<string, unknown>;
      } else {
        cur = cur[parts[i]] = {};
      }
    }
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}

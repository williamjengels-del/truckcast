// Event-name alias resolution helpers.
//
// Given a set of normalized event names typed by operators, resolve
// each to its canonical normalized form using the
// `event_name_aliases` table. Pure read helpers — admin write path
// lives in /api/admin/event-aliases.
//
// Used by:
//   - platform-registry.ts (updatePlatformRegistry, getPlatformEvents,
//     getPlatformEventsExcludingUser) — folds alias-form events into
//     the canonical bucket at compute time and serves cached
//     aggregates under the canonical key.
//   - EventForm hint lookup — resolves the alias before reading
//     platform_events so an operator typing "Saturday Farmer's
//     Market" still sees the canonical bucket's aggregate hints.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export interface AliasRow {
  alias_normalized: string;
  canonical_normalized: string;
  alias_display: string;
  canonical_display: string;
}

/**
 * Resolve a list of normalized names to their canonical forms.
 * Returns a Map keyed by input normalized; values are canonical
 * normalized (or the input itself if no alias).
 *
 * One DB round-trip regardless of input size.
 */
export async function resolveAliases(
  client: AnyClient,
  normalizedInputs: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const n of normalizedInputs) out.set(n, n); // default: identity
  if (normalizedInputs.length === 0) return out;

  const { data } = await client
    .from("event_name_aliases")
    .select("alias_normalized, canonical_normalized")
    .in("alias_normalized", normalizedInputs);

  for (const row of (data ?? []) as AliasRow[]) {
    out.set(row.alias_normalized, row.canonical_normalized);
  }
  return out;
}

/**
 * Inverse: given canonical normalized forms, return all alias-form
 * normalized strings that map to them — including the canonicals
 * themselves. Used by updatePlatformRegistry to widen the events
 * fetch so the canonical bucket folds in alias-form rows.
 *
 * Result Map: canonical_normalized -> Set<all normalized forms that
 * roll up to it> (always includes the canonical itself).
 */
export async function expandCanonicalsToAliases(
  client: AnyClient,
  canonicalNormalizedInputs: string[]
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const c of canonicalNormalizedInputs) {
    out.set(c, new Set([c]));
  }
  if (canonicalNormalizedInputs.length === 0) return out;

  const { data } = await client
    .from("event_name_aliases")
    .select("alias_normalized, canonical_normalized")
    .in("canonical_normalized", canonicalNormalizedInputs);

  for (const row of (data ?? []) as AliasRow[]) {
    const set = out.get(row.canonical_normalized);
    if (set) set.add(row.alias_normalized);
  }
  return out;
}

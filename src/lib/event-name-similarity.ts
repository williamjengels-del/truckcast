// Near-miss detection for event-name aliasing.
//
// Two heuristics, both run on the normalized (lowercase + trim)
// strings:
//
//   - Levenshtein ratio = 1 - levDistance / max(lenA, lenB).
//     Sensitive to character-level edits — catches plural-vs-singular
//     ('Fenton Food Truck Nights' vs 'Fenton Food Truck Night',
//     ratio ≈ 0.96), apostrophe drift, abbreviations.
//
//   - Jaccard token similarity = |A∩B| / |A∪B| over word tokens
//     (length > 2 to filter noise like 'a' / 'in'). Catches reorder
//     and minor extra-word noise that Levenshtein over-penalizes.
//
// Both are noisy individually. Combining them with an OR threshold
// (either ≥ 0.7) catches near-misses without over-flagging
// coincidentally similar but distinct events. Admin still reviews —
// the algorithm is a filter, not a decision.

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m: number[][] = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] =
        b[i - 1] === a[j - 1]
          ? m[i - 1][j - 1]
          : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

export function levRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

function tokenize(s: string): Set<string> {
  // Split on any non-alphanumeric, drop tokens of length ≤ 2 (those
  // are mostly stop-word noise that inflates the union without
  // adding signal).
  return new Set(
    s
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  );
}

export function jaccard(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const uni = new Set([...A, ...B]).size;
  return uni === 0 ? 0 : inter / uni;
}

export interface EventNameInput {
  /** Normalized form (lowercase + trim) — used for matching. */
  normalized: string;
  /** Original casing/spacing — used for display. */
  display: string;
  /** Operator count of the platform_events bucket. */
  operator_count: number;
}

export interface SuggestionPair {
  a: EventNameInput;
  b: EventNameInput;
  lev_distance: number;
  lev_ratio: number;
  jaccard: number;
  /** Composite score for ranking — max of the two ratios. */
  score: number;
  /** Stable canonicalized pair key, sorted lexically. */
  pair_key: string;
}

export interface SuggestionThresholds {
  /** Minimum lev_ratio OR jaccard to surface a pair. Default 0.7. */
  minRatio?: number;
  /** Hard minimum on token jaccard regardless of lev_ratio. Default 0.4. */
  minJaccard?: number;
  /** Cap output length. Default 50. */
  limit?: number;
}

/**
 * O(n²) pairwise comparison. Fine for n in the low thousands — for the
 * VendCast platform_events scale (currently ~200 buckets, plausibly a
 * few thousand at maturity) this is well under 100ms in practice.
 *
 * Excludes pairs whose normalized key is in `excludePairKeys` —
 * caller passes the union of (existing aliases) + (dismissed pairs).
 */
export function findSuggestionPairs(
  inputs: EventNameInput[],
  excludePairKeys: Set<string>,
  thresholds: SuggestionThresholds = {}
): SuggestionPair[] {
  const minRatio = thresholds.minRatio ?? 0.7;
  const minJaccard = thresholds.minJaccard ?? 0.4;
  const limit = thresholds.limit ?? 50;

  const pairs: SuggestionPair[] = [];
  for (let i = 0; i < inputs.length; i++) {
    for (let j = i + 1; j < inputs.length; j++) {
      const a = inputs[i];
      const b = inputs[j];
      const key = pairKey(a.normalized, b.normalized);
      if (excludePairKeys.has(key)) continue;
      const lr = levRatio(a.normalized, b.normalized);
      const jc = jaccard(a.normalized, b.normalized);
      // Filter rule: at least one of (lev_ratio, jaccard) clears the
      // bar AND the jaccard floor is met. The jaccard floor knocks
      // out near-misses that share characters but no real words
      // ("foo bar" vs "fox baz" can have a deceptively high lev
      // ratio at small lengths).
      if (jc < minJaccard) continue;
      if (lr < minRatio && jc < minRatio) continue;
      const score = Math.max(lr, jc);
      const lev_distance = Math.round(
        (1 - lr) * Math.max(a.normalized.length, b.normalized.length)
      );
      pairs.push({
        a,
        b,
        lev_distance,
        lev_ratio: lr,
        jaccard: jc,
        score,
        pair_key: key,
      });
    }
  }
  pairs.sort((x, y) => y.score - x.score || y.jaccard - x.jaccard);
  return pairs.slice(0, limit);
}

/**
 * Canonical pair key — lexically sorted "<lower>||<higher>" so A↔B
 * and B↔A produce the same string. Used for dismissal storage and
 * deduplication.
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

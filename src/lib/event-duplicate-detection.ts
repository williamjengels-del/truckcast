// Duplicate detection for CSV import / event-creation flows.
//
// Two passes against a per-date bucket of existing events:
//
//   1. Exact match on (normalized event_name, event_date). The
//      historical behavior — apostrophes, casing, trailing spaces all
//      trip this, which is exactly the bug the screenshot capture
//      surfaced ("Sunset Hill's Maker's Market" vs "Sunset Hills
//      Maker's Market" both got imported as separate events).
//
//   2. Fuzzy match using the same Levenshtein + Jaccard heuristics
//      already in production for admin event-aliasing. Same date,
//      lev_ratio OR jaccard ≥ minRatio, jaccard floor met. This is
//      what catches the Sunset Hills pair without over-flagging
//      legitimately distinct events on the same day.
//
// Returns one match per incoming row at most — exact wins over fuzzy,
// and within fuzzy the highest-scoring same-date candidate wins.

import { levRatio, jaccard } from "./event-name-similarity";

// Token-subset detection — separate heuristic from lev/jaccard.
// Catches the comma-prefixed location case ("Tower Grove Park, Food
// Truck Friday" vs "Food Truck Friday") where one name's tokens
// are a strict subset of the other's. Lev/jaccard alone don't catch
// this without lowering thresholds enough to over-flag distinct
// events. Requires ≥ 2 shared tokens (>2 chars each, per the
// existing tokenizer) so we don't flag near-empty names against
// long ones.
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  );
}

function isTokenSubset(smaller: Set<string>, larger: Set<string>): boolean {
  if (smaller.size < 2) return false;
  for (const t of smaller) if (!larger.has(t)) return false;
  return true;
}

export type DuplicateMatchType = "exact" | "fuzzy";

export interface IncomingRow {
  event_name: string;
  event_date: string;
}

export interface ExistingEvent {
  id: string;
  event_name: string;
  event_date: string;
  net_sales: number | null;
}

export interface DuplicateMatch {
  event_name: string;
  event_date: string;
  existing_event_id: string;
  existing_event_name: string;
  existing_net_sales: number | null;
  match_type: DuplicateMatchType;
  similarity_score: number | null;
}

interface DetectThresholds {
  /** Minimum lev_ratio OR jaccard to surface a fuzzy pair. Default 0.7. */
  minRatio?: number;
  /** Hard minimum on token jaccard regardless of lev_ratio. Default 0.4. */
  minJaccard?: number;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function detectDuplicates(
  incoming: IncomingRow[],
  existing: ExistingEvent[],
  thresholds: DetectThresholds = {}
): DuplicateMatch[] {
  const minRatio = thresholds.minRatio ?? 0.7;
  const minJaccard = thresholds.minJaccard ?? 0.4;

  const byDate = new Map<string, ExistingEvent[]>();
  for (const ev of existing) {
    const list = byDate.get(ev.event_date);
    if (list) list.push(ev);
    else byDate.set(ev.event_date, [ev]);
  }

  const matches: DuplicateMatch[] = [];

  for (const row of incoming) {
    if (!row.event_name || !row.event_date) continue;
    const sameDate = byDate.get(row.event_date);
    if (!sameDate || sameDate.length === 0) continue;

    const incomingNorm = normalize(row.event_name);

    // Exact match (normalized) — wins outright.
    const exact = sameDate.find(
      (ev) => normalize(ev.event_name) === incomingNorm
    );
    if (exact) {
      matches.push({
        event_name: row.event_name,
        event_date: row.event_date,
        existing_event_id: exact.id,
        existing_event_name: exact.event_name,
        existing_net_sales: exact.net_sales,
        match_type: "exact",
        similarity_score: 1,
      });
      continue;
    }

    // Fuzzy: score every same-date existing row, pick the best.
    // Two parallel rules, both flag a candidate:
    //   - lev/jaccard above the standard near-miss thresholds
    //     (catches apostrophe drift, plural-vs-singular, casing).
    //   - token subset (smaller name's tokens are all contained
    //     in the larger), catches comma-prefixed location duplicates
    //     ("Tower Grove Park, Food Truck Friday" vs "Food Truck
    //     Friday") that lev/jaccard miss without over-lowering
    //     thresholds.
    const incomingTokens = tokenize(incomingNorm);
    let best: { ev: ExistingEvent; score: number } | null = null;
    for (const ev of sameDate) {
      const existingNorm = normalize(ev.event_name);
      const lr = levRatio(incomingNorm, existingNorm);
      const jc = jaccard(incomingNorm, existingNorm);

      let candidateScore: number | null = null;

      if (jc >= minJaccard && (lr >= minRatio || jc >= minRatio)) {
        candidateScore = Math.max(lr, jc);
      } else {
        const existingTokens = tokenize(existingNorm);
        const [smaller, larger] =
          incomingTokens.size <= existingTokens.size
            ? [incomingTokens, existingTokens]
            : [existingTokens, incomingTokens];
        if (isTokenSubset(smaller, larger)) {
          // Subset score = ratio of shared tokens to the larger
          // set. A pure prefix-add ("X, Foo") gives a score < 1
          // proportional to how much was added.
          candidateScore = larger.size > 0 ? smaller.size / larger.size : 0;
        }
      }

      if (candidateScore !== null && (!best || candidateScore > best.score)) {
        best = { ev, score: candidateScore };
      }
    }

    if (best) {
      matches.push({
        event_name: row.event_name,
        event_date: row.event_date,
        existing_event_id: best.ev.id,
        existing_event_name: best.ev.event_name,
        existing_net_sales: best.ev.net_sales,
        match_type: "fuzzy",
        similarity_score: best.score,
      });
    }
  }

  return matches;
}

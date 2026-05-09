/**
 * Toast POS email parsing utilities.
 *
 * Toast's API is partner-locked, so we parse their daily summary emails
 * instead. The subject line follows this format:
 *   "Business Name - DayOfWeek, Month Day, Year"
 * The body contains a line like:
 *   "Total Net Sales  $1,234.56"
 */

export interface ToastParseResult {
  date: string; // YYYY-MM-DD
  netSales: number;
  rawSubject: string;
}

/**
 * Parse the content of a Toast daily summary email.
 * Accepts either the full email (including subject line) or body-only text.
 *
 * Recognized subject formats:
 *   "Subject: Wok-O Taco - Saturday, April 5, 2025"
 *   "Wok-O Taco - Saturday, April 5, 2025"
 *
 * Recognized sales line formats:
 *   "Total Net Sales  $1,234.56"
 *   "Total Net Sales $1234.56"
 *   "Net Sales: $1,234.56"
 */
export function parseToastEmail(rawText: string): ToastParseResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // --- Extract date ---
  let date: string | null = null;
  let rawSubject = "";

  for (const line of lines) {
    // Remove "Subject:" and "Fwd:"/"Re:" prefixes if present
    const normalized = line
      .replace(/^Subject:\s*/i, "")
      .replace(/^(?:Fwd|Re):\s*/i, "");

    // Look for pattern: "... - Weekday, Month Day[, Year]"
    // Year is optional — Toast sometimes omits it in forwarded subjects
    const subjectMatch = normalized.match(
      /[-–]\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*(\w+ \d{1,2})(?:,?\s*(\d{4}))?/i
    );
    if (subjectMatch) {
      rawSubject = normalized;
      const datePart = subjectMatch[1]; // e.g. "April 3"
      // pos-9: when Toast omits the year (e.g. forwarded subject got
      // the year stripped), default to current year — but if the
      // resulting date is in the future relative to today, drop one
      // year. Toast sends end-of-day emails; an email about "April 3"
      // that arrives after April 3 of the current year and is therefore
      // valid; if today is March and we see "April 3" without a year,
      // it's almost certainly last year's email being reprocessed.
      const now = new Date();
      let yearGuess = subjectMatch[2]
        ? Number(subjectMatch[2])
        : now.getFullYear();
      let parsed = new Date(`${datePart}, ${yearGuess}`);
      if (
        !subjectMatch[2] &&
        !isNaN(parsed.getTime()) &&
        parsed.getTime() > now.getTime()
      ) {
        yearGuess -= 1;
        parsed = new Date(`${datePart}, ${yearGuess}`);
      }
      if (!isNaN(parsed.getTime())) {
        // Defensive: detect day-rollover bugs. `new Date("April 31, 2025")`
        // silently rolls to "May 1" — would attribute Toast revenue to
        // the wrong day with no warning. Re-parse the input month name
        // and compare against the parsed Date's month; mismatch means
        // we just rolled and the input is malformed.
        const inputMonth = datePart.split(/\s+/)[0].toLowerCase();
        const months = [
          "january", "february", "march", "april", "may", "june",
          "july", "august", "september", "october", "november", "december",
        ];
        const inputMonthIdx = months.findIndex((m) =>
          inputMonth.startsWith(m.slice(0, 3))
        );
        if (inputMonthIdx >= 0 && parsed.getMonth() !== inputMonthIdx) {
          // Rolled over (e.g. Apr 31 → May 1). Skip this match and let
          // the loop try the next candidate or fall through to error.
          continue;
        }
        // Format as YYYY-MM-DD in local time
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, "0");
        const d = String(parsed.getDate()).padStart(2, "0");
        date = `${y}-${m}-${d}`;
        break;
      }
    }
  }

  if (!date) {
    throw new Error(
      'Could not find a date in this email. Make sure to include the subject line, e.g. "Business Name - Saturday, April 5, 2025".'
    );
  }

  // --- Extract net sales ---
  // pos-11: tightened to validate proper comma placement + end-of-number
  // boundary. The prior [\d,]+ accepted "$1,2345.67" → 12345.67 (10x off)
  // silently. The naive tighter regex without end-boundary still
  // partially-matched "1,234" out of "1,2345.67" → 1234 (~10000x off).
  //
  // The (?![,\d.]) lookahead rejects any residual digit/comma/dot
  // immediately after the captured value — guarantees we're not
  // truncating a malformed number.
  const NET_SALES_VALUE = /\$?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?![,\d.])/;
  let netSales: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pattern 1: value on same line — "Net Sales $1,234.56" or "Net Sales: $1,234.56"
    const sameLine = line.match(
      new RegExp(`(?:total\\s+)?net\\s+sales[:\\s]+${NET_SALES_VALUE.source}`, "i")
    );
    if (sameLine) {
      netSales = parseFloat(sameLine[1].replace(/,/g, ""));
      break;
    }

    // Pattern 2: label on this line, dollar amount on next line (HTML table cells)
    if (/(?:total\s+)?net\s+sales/i.test(line)) {
      const nextLine = lines[i + 1] ?? "";
      const nextMatch = nextLine.match(NET_SALES_VALUE);
      if (nextMatch) {
        netSales = parseFloat(nextMatch[1].replace(/,/g, ""));
        break;
      }
    }
  }

  if (netSales === null || isNaN(netSales)) {
    throw new Error(
      'Could not find "Total Net Sales" in this email. Make sure to paste the full email content.'
    );
  }

  return { date, netSales, rawSubject };
}

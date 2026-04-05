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
    // Remove "Subject:" prefix if present
    const normalized = line.replace(/^Subject:\s*/i, "");

    // Look for pattern: "... - Weekday, Month Day, Year"
    const subjectMatch = normalized.match(
      /[-–]\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*(\w+ \d{1,2},?\s*\d{4})/i
    );
    if (subjectMatch) {
      rawSubject = normalized;
      const dateStr = subjectMatch[1].replace(",", "");
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
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
  let netSales: number | null = null;

  for (const line of lines) {
    // Match lines containing "net sales" followed by a dollar amount
    const salesMatch = line.match(
      /(?:total\s+)?net\s+sales[:\s]+\$?([\d,]+(?:\.\d{1,2})?)/i
    );
    if (salesMatch) {
      netSales = parseFloat(salesMatch[1].replace(/,/g, ""));
      break;
    }
  }

  if (netSales === null || isNaN(netSales)) {
    throw new Error(
      'Could not find "Total Net Sales" in this email. Make sure to paste the full email content.'
    );
  }

  return { date, netSales, rawSubject };
}

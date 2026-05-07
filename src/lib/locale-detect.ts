// Browser-locale detection helpers.
//
// Used by /dashboard/onboarding step 1 to pre-fill timezone and state
// for new operators rather than defaulting to "America/Chicago" + a
// blank state dropdown. Defaults pre-fill is overrideable — operators
// who fly across time zones or share laptops can change it.
//
// Heuristic only. Browser exposes timezone reliably (Intl.DateTimeFormat)
// but not state. We map the most common US timezones to their dominant
// state. Multi-state timezones (Central, Mountain) default to the state
// with the largest population; close-but-wrong is fine because operators
// override blindly anyway when they see a wrong default. Skipping
// pre-fill for ambiguous cases would just leave it blank, which is the
// pre-existing behavior.

const TZ_TO_LIKELY_STATE: Record<string, string> = {
  // Eastern
  "America/New_York": "NY",
  "America/Detroit": "MI",
  "America/Indiana/Indianapolis": "IN",
  "America/Indiana/Knox": "IN",
  "America/Indiana/Marengo": "IN",
  "America/Indiana/Petersburg": "IN",
  "America/Indiana/Tell_City": "IN",
  "America/Indiana/Vevay": "IN",
  "America/Indiana/Vincennes": "IN",
  "America/Indiana/Winamac": "IN",
  "America/Kentucky/Louisville": "KY",
  "America/Kentucky/Monticello": "KY",
  // Central — TX has the largest pop on Central, biggest food-truck
  // market in the timezone, so it's the most useful default.
  "America/Chicago": "TX",
  "America/Indiana/Tell_City_Central": "IN",
  "America/Menominee": "MI",
  "America/North_Dakota/Beulah": "ND",
  "America/North_Dakota/Center": "ND",
  "America/North_Dakota/New_Salem": "ND",
  // Mountain
  "America/Denver": "CO",
  "America/Boise": "ID",
  // Mountain-no-DST (Arizona)
  "America/Phoenix": "AZ",
  // Pacific
  "America/Los_Angeles": "CA",
  // Alaska / Hawaii / outlying
  "America/Anchorage": "AK",
  "America/Juneau": "AK",
  "America/Metlakatla": "AK",
  "America/Nome": "AK",
  "America/Sitka": "AK",
  "America/Yakutat": "AK",
  "Pacific/Honolulu": "HI",
};

/** Detect the browser's IANA timezone, or null in environments
 *  without Intl support. Pure SSR-safe-ish: caller should run from
 *  useEffect since Intl in some browsers behaves differently per
 *  user setting. */
export function detectBrowserTimezone(): string | null {
  if (typeof Intl === "undefined") return null;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.length > 0 ? tz : null;
  } catch {
    return null;
  }
}

/** Best-guess US state from the browser timezone. Returns null when
 *  the timezone isn't in the heuristic table. The operator can
 *  override on the form. */
export function guessStateFromTimezone(timezone: string | null): string | null {
  if (!timezone) return null;
  return TZ_TO_LIKELY_STATE[timezone] ?? null;
}

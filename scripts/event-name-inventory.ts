// Read-only event-name inventory — for the event-type reclassification
// proposal (2026-05-15). Groups an operator's events by event_name and
// reports count, current type(s), mode, sample location, median revenue.
// No writes. Service-role client.
//
// Usage: npx tsx scripts/event-name-inventory.ts <user-id>
import { createClient } from "@supabase/supabase-js";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: npx tsx scripts/event-name-inventory.ts <user-id>");
  process.exit(2);
}
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key, { auth: { persistSession: false } });

interface Row {
  event_name: string;
  event_type: string | null;
  event_mode: string | null;
  location: string | null;
  city: string | null;
  net_sales: number | null;
  invoice_revenue: number | null;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const { data, error } = await supabase
    .from("events")
    .select("event_name, event_type, event_mode, location, city, net_sales, invoice_revenue")
    .eq("user_id", userId);
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  const byName = new Map<string, Row[]>();
  for (const r of rows) {
    const n = (r.event_name ?? "").trim();
    if (!n) continue;
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n)!.push(r);
  }

  const out: {
    name: string;
    count: number;
    types: string;
    mode: string;
    loc: string;
    med: number;
  }[] = [];

  for (const [name, evts] of byName) {
    const types = [...new Set(evts.map((e) => e.event_type ?? "(none)"))].join(" / ");
    const modes = [...new Set(evts.map((e) => e.event_mode ?? "(none)"))].join("/");
    const loc =
      evts.find((e) => e.location)?.location ??
      evts.find((e) => e.city)?.city ??
      "(no location)";
    const revs = evts
      .map((e) => (e.net_sales ?? 0) + (e.event_mode === "catering" ? e.invoice_revenue ?? 0 : 0))
      .filter((v) => v > 0);
    out.push({
      name,
      count: evts.length,
      types,
      mode: modes,
      loc,
      med: median(revs),
    });
  }

  out.sort((a, b) => b.count - a.count);

  console.log(`\nEVENT-NAME INVENTORY — user ${userId}`);
  console.log(`Distinct event names: ${out.length} | total events: ${rows.length}\n`);
  console.log(
    `${"event_name".padEnd(40)}${"n".padStart(4)}${"med$".padStart(8)}  ${"mode".padEnd(10)}${"current type".padEnd(24)}location`
  );
  console.log("-".repeat(130));
  for (const r of out) {
    console.log(
      `${r.name.slice(0, 39).padEnd(40)}${String(r.count).padStart(4)}${("$" + r.med.toFixed(0)).padStart(8)}  ${r.mode.slice(0, 9).padEnd(10)}${r.types.slice(0, 23).padEnd(24)}${(r.loc ?? "").slice(0, 40)}`
    );
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

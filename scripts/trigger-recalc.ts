// One-off recalc trigger via service role. Mirrors the /api/recalculate
// route but bypasses auth — used in the data-cleanup pipeline so we can
// refresh forecasts after backfills without round-tripping through the
// browser.
import { createClient } from "@supabase/supabase-js";
import { recalculateForUser } from "../src/lib/recalculate.ts";

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: npx tsx scripts/_trigger-recalc.ts <user-id>");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  console.log("Triggering recalc for", userId);
  const result = await recalculateForUser(userId, sb);
  console.log("\nResult:", result);
}

import { requireAdmin } from "@/lib/admin";
import { BetaClient } from "./beta-client";

export default async function BetaInvitesPage() {
  await requireAdmin();
  return <BetaClient />;
}

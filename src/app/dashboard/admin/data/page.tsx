import { requireAdmin } from "@/lib/admin";
import { DataClient } from "./data-client";

export default async function AdminDataPage() {
  await requireAdmin();
  return <DataClient />;
}

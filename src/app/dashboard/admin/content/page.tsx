import { requireAdmin } from "@/lib/admin";
import { ContentClient } from "./content-client";

export default async function AdminContentPage() {
  await requireAdmin();
  return <ContentClient />;
}

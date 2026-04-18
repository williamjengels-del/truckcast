import { DataClient } from "./data-client";

// Auth gated by /dashboard/admin/layout.tsx.
export default function AdminDataPage() {
  return <DataClient />;
}

import { ContentClient } from "./content-client";

// Auth gated by /dashboard/admin/layout.tsx.
export default function AdminContentPage() {
  return <ContentClient />;
}

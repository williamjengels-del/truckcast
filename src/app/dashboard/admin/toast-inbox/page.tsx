import { ToastInboxClient } from "./toast-inbox-client";

// Auth gated by /dashboard/admin/layout.tsx. Server wrapper kept for
// parity with the other admin pages and so we can add server-side
// fetches later without restructuring.
export default function AdminToastInboxPage() {
  return <ToastInboxClient />;
}

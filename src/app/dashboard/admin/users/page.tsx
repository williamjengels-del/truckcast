import { UsersClient } from "./users-client";

// Auth gated by /dashboard/admin/layout.tsx. Server wrapper kept so we
// can add server-side data fetching later without another restructure.
export default function AdminUsersPage() {
  return <UsersClient />;
}

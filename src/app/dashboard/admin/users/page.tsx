import { requireAdmin } from "@/lib/admin";
import { UsersClient } from "./users-client";

export default async function AdminUsersPage() {
  await requireAdmin();
  return <UsersClient />;
}

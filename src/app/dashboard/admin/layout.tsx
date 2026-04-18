import { requireAdmin } from "@/lib/admin";
import { AdminTabs } from "./admin-tabs";

/**
 * Admin section layout.
 *
 * Two jobs:
 *   1. Single admin gate for every page under /dashboard/admin/**.
 *      Previously each page.tsx called requireAdmin() individually;
 *      that worked but meant the auth check was scattered across 7+
 *      files. Now it runs here exactly once, and adding new admin
 *      pages requires no per-file boilerplate.
 *   2. Persistent tab nav across admin pages so the section feels
 *      coherent instead of a pile of independent screens.
 *
 * Sub-pages (page.tsx under this layout) no longer need to call
 * requireAdmin() themselves — the layout runs first and redirects
 * non-admins to /dashboard before any child server component renders.
 * API routes under /api/admin/** still gate independently because
 * layouts don't apply to route handlers.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <AdminTabs />
      {children}
    </div>
  );
}

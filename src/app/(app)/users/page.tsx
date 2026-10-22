import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { loadUsersPageData } from "@/components/users/data";
import { UserManagement } from "@/components/users/user-management";
import { AddUserDialog } from "@/components/users/add-user-dialog";
import { AiAccessCard } from "@/components/users/ai-access-card";

export const dynamic = "force-dynamic";

/** Uživatelé, role, hesla, schránky a přístup k AI — jen super admin. */
export default async function UsersPage() {
  const me = await requireFeature("users");
  const [data, access] = await Promise.all([loadUsersPageData(), getAccess()]);
  const owners = Object.fromEntries(data.users.map((u) => [u.id, u.fullName]));
  const activeUsers = data.users.filter((u) => u.active).length;
  const usersWithAi = data.users.filter((u) => u.active && u.role !== "super_admin" && u.aiAccess).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Uživatelé"
        description="Účty, role, hesla, e-mailové schránky a přístup k AI. Každý vidí jen to, co potřebuje."
        actions={<AddUserDialog mailboxes={data.mailboxes} owners={owners} disabled={!data.ready} />}
      />

      {!data.ready && (
        <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm sm:flex-row sm:items-center">
          <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
          <span className="flex-1">
            Správa uživatelů potřebuje servisní klíč Supabase (SUPABASE_SECRET_KEY). Doplň ho v průvodci nastavením.
          </span>
          <Button asChild size="sm" variant="outline">
            <Link href="/setup">Průvodce nastavením</Link>
          </Button>
        </div>
      )}
      {data.error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Uživatele se nepodařilo načíst: {data.error}</span>
        </div>
      )}

      <UserManagement
        users={data.users}
        mailboxes={data.mailboxes}
        currentUserId={me.id}
        aiForAll={access.ctx.aiEnabled && access.ctx.aiCaptureForAll}
      />

      <AiAccessCard
        aiEnabled={access.ctx.aiEnabled}
        aiCaptureForAll={access.ctx.aiCaptureForAll}
        aiConfigured={access.ctx.aiConfigured}
        usersWithAi={usersWithAi}
        activeUsers={activeUsers}
      />
    </div>
  );
}

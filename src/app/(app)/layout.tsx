import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { AccessBridge } from "@/components/access-provider";
import { PasswordChangeGate } from "@/components/password-change-gate";
import { requireUser, getAccess } from "@/lib/auth/session";
import { getBadgeCounts } from "@/lib/data/queries";
import { MailLiveProvider } from "@/components/mail/mail-live-provider";

// Každý požadavek ověřuje přihlášení a oprávnění — nikdy statické předrenderování
// (bez env při buildu by se jinak stránky aplikace „zapekly" jako statické).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Login-first: bez aktivního účtu se do aplikace nedostane nikdo.
  const user = await requireUser();
  const [{ features }, counts] = await Promise.all([getAccess(), getBadgeCounts()]);

  return (
    <MailLiveProvider enabled={features.includes("mail")} initialUnread={counts?.inbox}>
      <div className="flex h-screen overflow-hidden">
        <AccessBridge features={features} role={user.role} userId={user.id} quoteNeedsApproval={user.quoteNeedsApproval !== false} />
        <Sidebar counts={counts} features={features} userName={user.fullName} roleLabel={user.roleLabel} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar user={user} features={features} />
          <PasswordChangeGate required={user.mustChangePassword} />
          <main className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-28 pt-5 sm:px-6 md:pb-14">
            <div className="mx-auto w-full max-w-7xl animate-fade-in">{children}</div>
          </main>
          <MobileNav features={features} counts={counts} user={{ fullName: user.fullName, roleLabel: user.roleLabel }} />
        </div>
      </div>
    </MailLiveProvider>
  );
}

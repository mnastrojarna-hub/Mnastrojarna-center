import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { AccessBridge } from "@/components/access-provider";
import { PasswordChangeGate } from "@/components/password-change-gate";
import { requireUser, getAccess } from "@/lib/auth/session";
import { getBadgeCounts } from "@/lib/data/queries";
import { listQuoteApprovers } from "@/lib/data/current-user";
import { MailLiveProvider } from "@/components/mail/mail-live-provider";
import { FileViewerProvider } from "@/components/file-viewer/file-viewer-provider";
import { TabChunkPreload } from "@/components/jobs/detail/tab-chunk-preload";
import { ChunkReload } from "@/components/layout/chunk-reload";
import { UiPrefsProvider } from "@/components/ui-prefs/use-ui-prefs";
import { getUiPrefs } from "@/lib/data/ui-prefs";
import { ScrollMemory } from "@/components/nav/scroll-memory";
import { ActivityHeartbeat } from "@/components/activity-heartbeat";

// Každý požadavek ověřuje přihlášení a oprávnění — nikdy statické předrenderování
// (bez env při buildu by se jinak stránky aplikace „zapekly" jako statické).
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Login-first: bez aktivního účtu se do aplikace nedostane nikdo.
  const user = await requireUser();
  // osobní předvolby vzhledu (sbalené menu, rozložení Pošty) — sdílené celou aplikací, platí hned při vykreslení
  const [{ features }, counts, quoteApprovers, uiPrefs] = await Promise.all([
    getAccess(), getBadgeCounts(), listQuoteApprovers(), getUiPrefs(user.id),
  ]);

  // AccessBridge obaluje vše: oprávnění platí už při vykreslení na serveru a při hydrataci (viz access-provider)
  return (
    <AccessBridge
      features={features} role={user.role} userId={user.id} quoteNeedsApproval={user.quoteNeedsApproval !== false}
      quoteApprovers={quoteApprovers}
    >
      <UiPrefsProvider userId={user.id} server={uiPrefs}>
      <MailLiveProvider enabled={features.includes("mail")} initialUnread={counts?.inbox}>
        <FileViewerProvider>
          {/* výška = VIDITELNÁ část okna (dvh): 100vh na telefonu počítá i místo pod adresním řádkem, takže spodek
                stránky byl pod okrajem obrazovky a pod spodní lištou (majitel 7. 11.) */}
          <div className="flex h-screen overflow-hidden supports-[height:100dvh]:h-dvh">
            <TabChunkPreload />
            {/* zastaralý JavaScript po nasazení (chunk se nestáhne) → stránka se jednou obnoví místo prázdného místa */}
            <ChunkReload />
            {/* paměť posunu: Zpět / Vpřed a obnovení vrátí <main> i vnitřní panely tam, kde uživatel skončil */}
            <ScrollMemory />
            {/* poslední aktivita (kdy kdo naposledy kliknul) — vidí super admin ve Správě uživatelů */}
            <ActivityHeartbeat />
            <Sidebar counts={counts} features={features} userName={user.fullName} roleLabel={user.roleLabel} />
            <div className="flex flex-1 flex-col overflow-hidden">
              <Topbar user={user} features={features} />
              <PasswordChangeGate required={user.mustChangePassword} />
              <main data-scroll-key="main" className="flex-1 overflow-y-auto overscroll-contain scrollbar-thin px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 md:pb-14">
                <div className="mx-auto w-full max-w-7xl animate-fade-in">{children}</div>
              </main>
              <MobileNav features={features} counts={counts} user={{ fullName: user.fullName, roleLabel: user.roleLabel }} />
            </div>
          </div>
        </FileViewerProvider>
      </MailLiveProvider>
      </UiPrefsProvider>
    </AccessBridge>
  );
}

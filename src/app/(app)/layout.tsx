import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { getCurrentUser } from "@/lib/data/current-user";
import { getBadgeCounts } from "@/lib/data/queries";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, counts] = await Promise.all([getCurrentUser(), getBadgeCounts()]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar counts={counts} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar user={user} />
        <main className="flex-1 overflow-y-auto scrollbar-thin px-4 pb-24 pt-5 sm:px-6 md:pb-8">
          <div className="mx-auto w-full max-w-7xl animate-fade-in">{children}</div>
        </main>
        <MobileNav />
      </div>
    </div>
  );
}

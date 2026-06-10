import { Logo } from "@/components/logo";
import { SetupWizard } from "@/components/setup-wizard";
import { getSetupStatus } from "@/lib/setup/status";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const status = await getSetupStatus();

  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo showSlogan />
          <h1 className="mt-3 text-xl font-semibold">Průvodce nastavením</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            Připojení Supabase, databáze, super admin a API klíče — všechno se nastavuje
            přímo tady v aplikaci, bez editace souborů.
          </p>
        </div>
        <SetupWizard status={status} />
      </div>
    </div>
  );
}

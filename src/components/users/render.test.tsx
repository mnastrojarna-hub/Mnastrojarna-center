import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Smoke test UI bez Next.js: router a serverové akce jsou nahrazené
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/app/actions/users", () => ({
  createUser: vi.fn(), updateUser: vi.fn(), setUserPassword: vi.fn(), deleteUser: vi.fn(), sendUserResetCode: vi.fn(),
}));
vi.mock("@/app/actions/mailbox-owner", () => ({ setMailboxOwner: vi.fn() }));
vi.mock("@/app/actions/commission-rules", () => ({
  listCommissionRules: vi.fn(), saveCommissionRule: vi.fn(), deleteCommissionRule: vi.fn(), markStatementPaid: vi.fn(),
}));
vi.mock("@/app/actions/ai-access", () => ({ saveAiAccessSettings: vi.fn() }));
vi.mock("@/app/auth/password", () => ({
  requestPasswordReset: vi.fn(), resetPasswordWithCode: vi.fn(), updatePasswordAfterRecovery: vi.fn(),
  changeOwnPassword: vi.fn(), updateOwnProfile: vi.fn(),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { UserManagement } from "./user-management";
import { AddUserDialog } from "./add-user-dialog";
import { AiAccessCard } from "./ai-access-card";
import { RolePicker } from "./role-picker";
import { ProfileForm } from "@/components/account/profile-form";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { AuthShell } from "@/components/account/auth-shell";
import { ForgotPasswordFlow } from "@/app/forgot-password/forgot-password-flow";
import { NewPasswordForm } from "@/app/reset-password/new-password-form";
import type { ManagedUser, MailboxOption } from "./types";

const users: ManagedUser[] = [
  {
    id: "u-admin", email: "sef@mnastrojarna.cz", fullName: "Jan Šéf", role: "super_admin", active: true, aiAccess: false,
    phone: "+420 777 000 111", position: "jednatel", commissionPercent: 0, lastSeenAt: new Date().toISOString(),
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: "u-sales", email: "obchod@mnastrojarna.cz", fullName: "Petra Obchodní", role: "obchodnik", active: true, aiAccess: true,
    phone: null, position: "obchod", commissionPercent: 8.5, lastSeenAt: null, createdAt: "2026-02-01T00:00:00Z",
  },
  {
    id: "u-emp", email: "dilna@mnastrojarna.cz", fullName: "Karel Dílna", role: "zamestnanec", active: false, aiAccess: false,
    phone: null, position: null, commissionPercent: 0, lastSeenAt: null, createdAt: "2026-03-01T00:00:00Z",
  },
];
const mailboxes: MailboxOption[] = [
  { id: "m1", email: "obchod@mnastrojarna.cz", displayName: "Obchod", ownerId: "u-sales", active: true, provider: "imap" },
  { id: "m2", email: "info@mnastrojarna.cz", displayName: null, ownerId: null, active: true, provider: "imap" },
];

function render(node: React.ReactNode): string {
  // bez textových oddělovačů <!-- --> z SSR, ať jde hledat souvislý text
  return renderToString(<TooltipProvider>{node}</TooltipProvider>).replace(/<!-- -->/g, "");
}

describe("správa uživatelů — render", () => {
  it("seznam uživatelů s rolemi, schránkami a přepínači", () => {
    const html = render(<UserManagement users={users} mailboxes={mailboxes} currentUserId="u-admin" aiForAll={false} />);
    expect(html).toContain("Jan Šéf");
    expect(html).toContain("Petra Obchodní");
    expect(html).toContain("Super admin");
    expect(html).toContain("Obchodník");
    expect(html).toContain("Zaměstnanec");
    expect(html).toContain("obchod@mnastrojarna.cz");
    expect(html).toContain("neaktivní");
    expect(html).toContain("8,5 %");
    expect(html).toContain("ty");
  });
  it("smlouva a provize v řádku uživatele", () => {
    const withRule: ManagedUser[] = [{
      ...users[1], id: "u-vit", fullName: "Vít Volný", commissionPercent: 0,
      commissionRules: [{
        id: "r1", ownerId: "u-vit", name: "Dodatek", base: "margin_tiered", basis: "collected", rate: 0,
        tiers: [{ from: 0, to: 500000, rate: 0 }, { from: 500000, to: 1000000, rate: 0.1 }, { from: 1000000, to: 2000000, rate: 0.15 }, { from: 2000000, to: null, rate: 0.2 }],
        validFrom: "2000-01-01", payoutDays: 20, note: null, createdAt: "2026-10-22T00:00:00Z",
      }],
    }, users[1]];
    const html = render(<UserManagement users={withRule} mailboxes={mailboxes} currentUserId="u-admin" aiForAll={false} />);
    expect(html).toContain("Pásmová provize · 0/10/15/20 %");
    expect(html).toContain("8,5 % ze zisku · bez smlouvy");
    expect(html).toContain("Smlouva a provize");
  });
  it("prázdný seznam", () => {
    const html = render(<UserManagement users={[]} mailboxes={[]} currentUserId="x" aiForAll />);
    expect(html).toContain("Zatím žádní uživatelé");
  });
  it("tlačítko pro přidání a karta AI přístupu", () => {
    expect(render(<AddUserDialog mailboxes={mailboxes} owners={{ "u-sales": "Petra" }} />)).toContain("Přidat uživatele");
    const ai = render(<AiAccessCard aiEnabled aiCaptureForAll={false} aiConfigured={false} usersWithAi={1} activeUsers={2} />);
    expect(ai).toContain("AI zapnuto (hlavní vypínač)");
    expect(ai).toContain("AI čtení dokladů z fotky pro všechny uživatele");
    expect(ai).toContain("Není nastaven klíč Claude API");
  });
  it("výběr role ukazuje popisy", () => {
    const html = render(<RolePicker value="obchodnik" onChange={() => {}} />);
    expect(html).toContain("Kniha zakázek, zákazníci, dodavatelé, vlastní pošta, marže a vlastní provize.");
  });
});

describe("účet a obnova hesla — render", () => {
  it("formuláře Můj účet", () => {
    expect(render(<ProfileForm fullName="Jan" phone={null} email="jan@x.cz" />)).toContain("Jméno a příjmení");
    const pw = render(<ChangePasswordForm email="jan@x.cz" />);
    expect(pw).toContain("Současné heslo");
    expect(pw).toContain("/forgot-password?email=jan%40x.cz");
  });
  it("zapomenuté heslo — krok 1 a rámec stránky", () => {
    const html = render(
      <AuthShell title="Zapomenuté heslo" showHints>
        <ForgotPasswordFlow initialEmail="jan@x.cz" />
      </AuthShell>,
    );
    expect(html).toContain("Poslat kód");
    expect(html).toContain("jan@x.cz");
    expect(html).toContain("Kniha zakázek");
    expect(html).toContain("Vyfoť doklad");
  });
  it("nové heslo po odkazu", () => {
    expect(render(<NewPasswordForm email="jan@x.cz" />)).toContain("Uložit nové heslo");
  });
});

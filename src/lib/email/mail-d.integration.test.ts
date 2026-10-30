import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_ENABLED, loadLocalEnv, localAdmin, localSql } from "@/test/local-supabase";
import { decodePart, mimeLeaves } from "@/lib/email/mime-parts";
import { SIGNATURE_LOGO_CID } from "@/lib/email/signature";

/**
 * Pošta D proti lokálnímu Supabase + testovacímu poštovnímu serveru: grafický podpis s logem
 * (uložení jen sobě, RLS/trigger, okno psaní → HTML + vložené logo právě jednou i v odpovědi,
 * e-mail ve jménu uživatele s pozdravem z AI → jeden podpis, starý textový podpis jako záloha),
 * kategorie odeslané pošty (podle předmětu / odpovědi) a oprava kategorie (kdo, kdy, korekce AI,
 * filtr složky Odeslané).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/email/mail-d.integration.test.ts
 */

type Srv = {
  ports: Record<string, number>;
  caFile: string;
  sent: { from: string; to: string[]; raw: string }[];
  addMessage: (u: string, m: Record<string, unknown>) => number;
  close: () => Promise<void>;
};

const USER = "podpis@nastrojarstvi.test";
const PASS = "Podpis-Heslo-1";

const session = vi.hoisted(() => ({ current: null as null | { id: string; email: string; fullName: string; role: string } }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/supabase/server", async () => {
  const lib = await import("@/test/local-supabase");
  const admin = () => lib.localAdmin();
  return {
    isSupabaseConfigured: () => true,
    hasServiceKey: () => true,
    createAdminClient: admin,
    createOperatorClient: async () => admin(),
    createClient: async () => { throw new Error("Bez session (test)."); },
  };
});
vi.mock("@/lib/auth/session", () => {
  const FEATURES: Record<string, string[]> = {
    obchodnik: ["orders", "workflow", "documents", "customers", "suppliers", "mail", "margins"],
  };
  const user = () => {
    const u = session.current!;
    return { ...u, initials: "XX", roleLabel: u.role, aiAccess: false, active: true, hasProfile: true };
  };
  const can = (f: string) => (FEATURES[session.current?.role ?? ""] ?? []).includes(f);
  return {
    getSessionUser: async () => user(),
    getAccess: async () => ({ user: user(), ctx: {}, features: FEATURES[session.current!.role], can }),
    checkFeature: async (f: string) => (can(f) ? { user: user() } : { error: "Bez oprávnění." }),
    apiRequire: async () => ({ user: user() }),
    requireUser: async () => user(),
    requireFeature: async () => user(),
  };
});

/** Části odeslané zprávy: text, HTML a vložené obrázky (Content-ID). */
function parts(raw: string) {
  const leaves = mimeLeaves(Buffer.from(raw, "latin1"));
  const text = leaves.filter((l) => l.contentType === "text/plain").map((l) => decodePart(l).toString("utf8")).join("\n");
  const html = leaves.filter((l) => l.contentType === "text/html").map((l) => decodePart(l).toString("utf8")).join("\n");
  const cids = (raw.match(/^Content-ID:\s*<[^>]+>/gim) ?? []).map((h) => h.replace(/^Content-ID:\s*/i, ""));
  return { text, html, cids, leaves };
}
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe.skipIf(!LOCAL_ENABLED)("Pošta D ↔ lokální Supabase + testovací SMTP: podpis s logem a kategorie", () => {
  let srv: Srv;
  let svc: SupabaseClient;
  const users: Record<"a" | "b" | "c" | "d", { id: string; email: string }> = {} as never;
  let boxId = "";
  let signature = "";
  let newEmailId = "";
  const TAG = `mailD${Date.now()}`;

  beforeAll(async () => {
    const env = loadLocalEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SECRET_KEY = env.SUPABASE_SECRET_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const mod = (await import(path.resolve(__dirname, "../../../tools/e2e/mail-test-server.mjs"))) as {
      startMailTestServer: (o: { dir: string; base: number }) => Promise<Srv>;
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mail-d-"));
    for (let i = 0; ; i++) {
      try {
        srv = await mod.startMailTestServer({ dir, base: 47000 + Math.floor(Math.random() * 900) * 10 });
        break;
      } catch (err) {
        if (i >= 5 || !/EADDRINUSE/.test(String(err))) throw err;
      }
    }
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), fs.readFileSync(srv.caFile, "utf8")]);
    process.env.MAIL_TEST_PROVIDERS = JSON.stringify([
      { domains: ["nastrojarstvi.test", "mnastrojarna.test"], label: "hosting90 (test)",
        imap: [{ host: "127.0.0.1", port: srv.ports.imaps, tls: "tls" }], pop3: [], smtp: [{ host: "127.0.0.1", port: srv.ports.smtps, tls: "tls" }] },
    ]);
    svc = localAdmin();
    const NAMES = { a: "Adam Podpisový", b: "Bára Kolegyně", c: "Cyril Starý", d: "Dana Adminová" } as const;
    for (const key of ["a", "b", "c", "d"] as const) {
      const email = `${TAG}-${key}@local.test`;
      const password = `Heslo-${TAG}-1!`;
      const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: NAMES[key] } });
      if (error) throw new Error(error.message);
      users[key] = { id: data.user!.id, email };
      await svc.from("profiles").update({
        role: key === "d" ? "super_admin" : "obchodnik", full_name: NAMES[key], active: true,
        ...(key === "a" ? { phone: "777123456", position: "obchod" } : {}),
        ...(key === "c" ? { mail_signature: "Cyril Starý\ntel. 777 000 111" } : {}),
      }).eq("id", data.user!.id);
    }
    await svc.from("mailboxes").delete().eq("email", USER);
  }, 60_000);

  afterAll(async () => {
    if (boxId) {
      await svc.from("emails").delete().eq("mailbox_id", boxId);
      await svc.from("mailboxes").delete().eq("id", boxId);
    }
    for (const u of Object.values(users)) {
      await svc.from("emails").delete().eq("owner_id", u.id);
      await svc.from("ai_corrections").delete().eq("created_by", u.id);
      await svc.from("mailboxes").delete().eq("owner_id", u.id);
      await svc.auth.admin.deleteUser(u.id).catch(() => undefined);
    }
    delete process.env.MAIL_TEST_PROVIDERS;
    await srv?.close();
  });

  const as = (key: "a" | "b" | "c") => {
    session.current = { id: users[key].id, email: users[key].email, fullName: key, role: "obchodnik" };
  };
  /** SQL jako přihlášený uživatel (REST / RLS cesta). */
  const sqlAs = (uid: string, statement: string) =>
    localSql(`begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true); ${statement}; rollback;`);

  it("schránka připojená sama + stažení pošty", async () => {
    as("a");
    const my = await import("./my-mailbox");
    const det = await my.detectMine(users.a.id, { email: USER, password: PASS });
    expect(det.ok).toBe(true);
    const saved = await my.saveMine(users.a.id, { email: USER, password: PASS, config: det.config! });
    expect(saved.ok).toBe(true);
    boxId = saved.id!;
    const ingest = await import("./ingest");
    await ingest.syncMailbox({ mailboxIds: [boxId], manual: true });
    expect(Number(localSql(`select count(*) from emails where mailbox_id = '${boxId}' and direction = 'in'`))).toBeGreaterThanOrEqual(3);
  }, 90_000);

  it("Nastavení pošty: výchozí podpis (Firemní, z profilu) → uložím si vlastní pro schránku; kolega ho uložit nesmí", async () => {
    as("a");
    const act = await import("@/app/actions/mail-signature");
    const st = await act.signatureEditorAction();
    expect(st.ok).toBe(true);
    if (!st.ok) return;
    expect(st.mailbox).toBe(USER);
    expect(st.source).toBe("auto");
    expect(st.value).toMatchObject({ variant: "firemni", fullName: "Adam Podpisový", role: "obchod", phone: "+420 777 123 456", email: USER });
    expect(st.company.name).toBe("Mnástrojárna s.r.o."); // podle logomanuálu, i když nastavení má „MNástrojárna"
    const res = await act.saveSignatureSettingsAction({ mailbox: USER, settings: { ...st.value, role: "obchodní zástupce", note: `Podpis ${TAG}` } });
    expect(res.ok).toBe(true);
    const stored = JSON.parse(localSql(`select mail_signatures::text from profiles where id = '${users.a.id}'`));
    expect(stored.mailboxes[USER]).toMatchObject({ role: "obchodní zástupce", note: `Podpis ${TAG}`, variant: "firemni" });
    expect(localSql(`select count(*) from audit_log where action = 'mail_signature_saved' and entity_id = '${users.a.id}'`)).toBe("1");
    // kolega: cizí osobní schránka v jeho výběru není → uložení odmítnuto
    as("b");
    const other = await act.saveSignatureSettingsAction({ mailbox: USER, settings: st.value });
    expect(other).toMatchObject({ ok: false, error: expect.stringMatching(/jen pro vlastní nebo firemní schránku/) });
  }, 60_000);

  it("RLS / trigger: podpis si přes REST mění jen majitel — kolega ne, super admin cizí také ne", () => {
    const upd = (uid: string, set: string) => sqlAs(uid, `with u as (update profiles set ${set} where id = '${users.a.id}' returning 1) select 'rows=' || count(*) from u`).split("\n").at(-1);
    expect(upd(users.b.id, `mail_signatures = '{"v":1}'`)).toBe("rows=0"); // RLS: cizí profil vůbec nevidí k úpravě
    expect(() => upd(users.d.id, `mail_signatures = '{"v":1}'`)).toThrow(/Podpis e-mailu si upravuje každý sám/);
    expect(() => upd(users.d.id, "mail_signature = 'x'")).toThrow(/Podpis e-mailu si upravuje každý sám/);
    // sám sobě smí (a super admin smí dál měnit jiné údaje kolegy)
    expect(upd(users.a.id, `mail_signatures = '{"v":1}'`)).toBe("rows=1");
    expect(upd(users.d.id, "phone = '111'")).toBe("rows=1");
    expect(localSql(`select mail_signatures->'mailboxes'->'${USER}'->>'note' from profiles where id = '${users.a.id}'`)).toBe(`Podpis ${TAG}`);
  });

  it("okno psaní: podpis v textu (jde upravit) → odejde jako HTML s logem právě jednou + textová verze; v aplikaci logo z webu; kategorie podle předmětu", async () => {
    as("a");
    const compose = await import("@/app/actions/mail-compose");
    const ctx = await compose.composeContextAction({});
    expect(ctx).toMatchObject({ ok: true, from: USER });
    signature = ctx.signature!;
    expect(signature).toMatch(/^S pozdravem\n\nAdam Podpisový\nobchodní zástupce \| Mnástrojárna s\.r\.o\./);
    expect(signature).toContain(`Podpis ${TAG}`);
    const before = srv.sent.length;
    const res = await compose.sendComposedAction({
      mode: "new", to: "nakup@zakaznik.test", subject: `Nabídka dílů ${TAG}`, body: `Dobrý den,\n\nposílám nabídku.\n\n-- \n${signature}\n`,
    });
    expect(res).toMatchObject({ ok: true, fromAddress: USER });
    expect(srv.sent.length).toBe(before + 1);
    const p = parts(srv.sent.at(-1)!.raw);
    expect(p.cids).toEqual([`<${SIGNATURE_LOGO_CID}>`]); // logo jako vložená příloha, jednou
    expect(count(p.html, `cid:${SIGNATURE_LOGO_CID}`)).toBe(1);
    expect(count(p.html, 'data-mn-signature="1"')).toBe(1);
    expect(p.html).toContain("Adam Podpisový");
    expect(p.html).toContain("posílám nabídku.");
    expect(p.text).toContain("Adam Podpisový"); // textová verze pro klienty bez HTML
    expect(p.leaves.some((l) => l.contentType === "image/png" && decodePart(l).subarray(1, 4).toString() === "PNG")).toBe(true);
    newEmailId = res.emailId!;
    const { data: row } = await svc.from("emails").select("body_html, has_attachments, category").eq("id", newEmailId).single();
    const r = row as { body_html: string; has_attachments: boolean; category: string };
    expect(r.body_html).toContain('src="/brand/mnastrojarna-email-logo@2x.png"');
    expect(r.body_html).not.toContain("cid:");
    expect(r.has_attachments).toBe(false); // logo není příloha
    expect(r.category).toBe("poptavka"); // naše nabídka = obchodní případ poptávky
    const data = await import("@/lib/data/mail-threads");
    const { data: tr } = await svc.from("emails").select("thread_id").eq("id", newEmailId).single();
    const thread = await data.getThread((tr as { thread_id: string }).thread_id);
    expect(thread.messages!.at(-1)!.signedHtml).toContain('data-mn-signature="1"');
  }, 60_000);

  it("odpověď: citace se starým podpisem → grafický podpis jen jednou; kategorie převzatá z poptávky", async () => {
    as("a");
    const { data: orig } = await svc.from("emails").select("id, from_email, category").eq("mailbox_id", boxId).eq("subject", "Podpis: Poptávka hřídele 50 ks").single();
    const o = orig as { id: string; from_email: string; category: string };
    expect(o.category).toBe("poptavka");
    const compose = await import("@/app/actions/mail-compose");
    const quoted = signature.split("\n").map((l) => `> ${l}`).join("\n");
    const body = `Dobrý den, termín potvrdíme zítra.\n\n-- \n${signature}\n\nDne 20. 10. 2026 Jan Dvořák napsal(a):\n> Dobrý den,\n${quoted}\n`;
    const res = await compose.sendComposedAction({ mode: "reply", sourceEmailId: o.id, to: o.from_email, subject: "Re: Podpis: Poptávka hřídele 50 ks", body });
    expect(res.ok).toBe(true);
    const p = parts(srv.sent.at(-1)!.raw);
    expect(p.cids).toHaveLength(1);
    expect(count(p.html, `cid:${SIGNATURE_LOGO_CID}`)).toBe(1);
    expect(count(p.html, 'data-mn-signature="1"')).toBe(1);
    expect(p.html).toContain("<blockquote");
    expect(localSql(`select category from emails where id = '${res.emailId}'`)).toBe("poptavka");
    // podpis smazaný v okně psaní → jen text, žádné logo
    const plain = await compose.sendComposedAction({ mode: "new", to: "x@zakaznik.test", subject: `Bez podpisu ${TAG}`, body: "Jen text." });
    expect(plain.ok).toBe(true);
    const q = parts(srv.sent.at(-1)!.raw);
    expect(q.cids).toHaveLength(0);
    expect(q.html).toBe("");
  }, 60_000);

  it("e-mail ve jménu uživatele (schválená odpověď AI): pozdrav z AI pryč, podpis s logem připojený jednou", async () => {
    const { sendMail } = await import("./send");
    const res = await sendMail({
      to: "dvorak@strojmetal.test", subject: `Re: Objednávka ${TAG}`,
      text: "Dobrý den,\n\nobjednávku jsme přijali, potvrzení pošleme do zítřka.\n\nS pozdravem,\nMNástrojárna s.r.o.",
      from: { ownerId: users.a.id }, senderId: users.a.id, signature: { userId: users.a.id, mode: "append" },
    });
    expect(res.sent).toBe(true);
    const p = parts(srv.sent.at(-1)!.raw);
    expect(count(p.text, "S pozdravem")).toBe(1);
    expect(p.text).not.toContain("MNástrojárna");
    expect(p.text).toContain("Adam Podpisový");
    expect(p.cids).toHaveLength(1);
    expect(count(p.html, 'data-mn-signature="1"')).toBe(1);
    expect(localSql(`select category from emails where id = '${res.emailId}'`)).toBe("objednavka");
  }, 60_000);

  it("starý textový podpis (Mail A) zůstává zálohou: v okně psaní text, odejde bez HTML", async () => {
    as("c");
    const compose = await import("@/app/actions/mail-compose");
    const ctx = await compose.composeContextAction({});
    expect(ctx.signature).toBe("Cyril Starý\ntel. 777 000 111");
    const act = await import("@/app/actions/mail-signature");
    const st = await act.signatureEditorAction();
    expect(st).toMatchObject({ ok: true, source: "legacy", legacyText: "Cyril Starý\ntel. 777 000 111" });
  }, 30_000);

  it("oprava kategorie (odeslaná i přijatá): uloženo s autorem a časem, korekce pro AI, filtr složky Odeslané", async () => {
    as("a");
    const mail = await import("@/app/actions/mail");
    expect(await mail.setEmailCategory(newEmailId, "objednavka")).toEqual({ ok: true });
    const row = localSql(`select category || '|' || category_set_by || '|' || (category_set_at is not null) from emails where id = '${newEmailId}'`);
    expect(row).toBe(`objednavka|${users.a.id}|true`);
    const corr = localSql(`select ai_value || '|' || corrected_value || '|' || (context like 'Odeslaný e-mail%') from ai_corrections where created_by = '${users.a.id}' and field = 'category' order by created_at desc limit 1`);
    expect(corr).toBe("Poptávka|Objednávka|true");
    expect(localSql(`select count(*) from audit_log where action = 'email_category_set' and entity_id = '${newEmailId}' and actor_id = '${users.a.id}'`)).toBe("1");
    expect(await mail.setEmailCategory(newEmailId, "spam")).toMatchObject({ ok: false, error: expect.stringMatching(/nemůže být spam/) });
    const data = await import("@/lib/data/mail-threads");
    const sent = await data.listThreads({ folder: "sent", category: "Objednávka" });
    const hit = sent.items.find((t) => t.emailId === newEmailId);
    expect(hit?.category).toBe("Objednávka");
    expect((await data.listThreads({ folder: "sent", category: "Faktura" })).items.some((t) => t.emailId === newEmailId)).toBe(false);
    // přijatá: oprava + filtr Přijatých
    const { data: inc } = await svc.from("emails").select("id").eq("mailbox_id", boxId).eq("subject", "Podpis: Nabídka materiálu").single();
    const incId = (inc as { id: string }).id;
    expect(await mail.setEmailCategory(incId, "faktura")).toEqual({ ok: true });
    expect(localSql(`select category || '|' || ai_pending from emails where id = '${incId}'`)).toBe("faktura|false");
    const inbox = await data.listThreads({ folder: "inbox", category: "Faktura" });
    expect(inbox.items.some((t) => t.emailId === incId)).toBe(true);
    // kolega cizí poštu nepřeřadí
    as("b");
    expect(await mail.setEmailCategory(incId, "poptavka")).toMatchObject({ ok: false });
  }, 60_000);
});

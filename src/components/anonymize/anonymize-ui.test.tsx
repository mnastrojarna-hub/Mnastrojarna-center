import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: vi.fn() }) } }) }));
vi.mock("@/app/actions/drawing-anon", () => ({
  cancelQueuedSend: vi.fn(), sendQueuedWithoutPending: vi.fn(), saveAnonSettings: vi.fn(), requeueChangedConfig: vi.fn(),
  queueLegacyDrawings: vi.fn(), setAnonMode: vi.fn(), sendQueuedWithOriginals: vi.fn(),
}));
const acc = vi.hoisted(() => ({ role: null as string | null }));
vi.mock("@/components/access-provider", () => ({
  useAccess: () => ({ role: acc.role, features: [], userId: null, can: () => false }),
}));

import { FileAnonBadge, JobAnonBadge } from "./anon-badge";
import { describeCounts, drawingsWord, fileAnonLabel, jobAnonBadge, sendQueueText } from "./anon-status";
import { AnonReviewList } from "./anon-review-section";
import { AnonymizeToolButton, AnonymizeToolDialog, toolRejectReason } from "./anonymize-tool-dialog";
import { AnonymizeEditor } from "./anonymize-editor";
import { SupplierPackButton, AnonSummaryLine, canAnonymize, ForSupplierLink, ORIGINAL_CONFIRM } from "./anon-file-menu";
import { previewUrl, downloadUrl } from "./anon-api";
import { DrawingAnonSettings } from "@/components/settings/drawing-anon-settings";
import { DEFAULT_ANON_SETTINGS } from "@/lib/anonymize/settings";
import type { JobFile } from "@/lib/jobs/types";

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");

const badge = (over: Partial<Parameters<typeof jobAnonBadge>[0] & object> = {}) => ({
  total: 0, done: 0, review: 0, failed: 0, pending: 0, unsupported: 0, skipped: 0, sendWaiting: 0, ...over,
});

describe("stavy anonymizace — texty", () => {
  it("odznak zakázky: čipy podle naléhavosti, každý s vlastní barvou, nejvýš 2 + „+N“", () => {
    expect(jobAnonBadge(badge({ total: 3, done: 3 }))!.parts.map((p) => p.text)).toEqual(["Výkresy 3/3 ✓"]);
    // starší „ke kontrole" se počítá jako hotovo (žádný čip „ke kontrole")
    const b = jobAnonBadge(badge({ total: 6, done: 1, review: 1, failed: 1, pending: 1, unsupported: 1, skipped: 1, sendWaiting: 1 }))!;
    expect(b.parts.map((p) => p.text)).toEqual(["Odeslání čeká", "1 selhal", "Čeká…", "Výkresy 2/4", "1 nelze automaticky"]);
    expect(b.parts.map((p) => p.tone)).toEqual(["warn", "error", "busy", "muted", "muted"]);
    expect(b.visible.map((p) => p.text)).toEqual(["Odeslání čeká", "1 selhal"]);
    expect(b.more).toBe(3);
    expect(b.title).toContain("1 nelze automaticky");
    expect(b.tone).toBe("error");
    expect(jobAnonBadge(badge({ total: 2, skipped: 2 }))).toBeNull();
    expect(jobAnonBadge(badge({ total: 2, pending: 2, waitingBudget: 2 }))!.parts[0].text).toBe("Čeká (limit)");
  });

  it("soubor: nic nesmazáno = hotovo (název firmy na výkrese není); denní limit bez spinneru; surová chyba se nezobrazí", () => {
    const empty = fileAnonLabel({ status: "done", reviewed: true, total: 0 });
    expect(empty.label).toBe("Anonymizováno");
    expect(empty.tone).toBe("ok");
    expect(empty.hint).toMatch(/Název firmy se na výkrese nenašel/);
    expect(fileAnonLabel({ status: "done", reviewed: false, total: 0 }).tone).toBe("ok");
    expect(fileAnonLabel({ status: "done", reviewed: true, total: 3 }).label).toBe("Anonymizováno ✓");
    const lim = fileAnonLabel({ status: "pending", reason: "Denní limit AI pro automatiku je vyčerpán — pokračuje zítra (nebo spusť ručně)." });
    expect(lim.label).toBe("Čeká (denní limit)");
    expect(lim.tone).toBe("muted");
    expect(fileAnonLabel({ status: "failed", reason: "Cannot read properties of undefined (reading 'Pages')" }).hint).not.toMatch(/Cannot read/);
    expect(drawingsWord(1)).toBe("1 výkres");
    expect(drawingsWord(3)).toBe("3 výkresy");
    expect(drawingsWord(0)).toBe("0 výkresů");
    expect(drawingsWord(7)).toBe("7 výkresů");
  });

  it("hláška fronty odeslání: rod, množné číslo, selhání, odchází", () => {
    const q = { id: "q", kind: "job_document", status: "waiting" as const, to: "d@x.cz", fileCount: 2, pendingCount: 2, createdAt: "", reason: null, mine: true, blockingFileId: null };
    expect(sendQueueText(q)).toBe("odejde po dokončení anonymizace (2 výkresy).");
    expect(sendQueueText({ ...q, pendingCount: 0 })).toBe("odchází…");
    expect(sendQueueText({ ...q, reason: "Nemáš přiřazenou e-mailovou schránku." })).toBe("Odeslání se nepovedlo — Nemáš přiřazenou e-mailovou schránku. Zkusí se znovu.");
    expect(sendQueueText({ ...q, status: "blocked", reason: "výkres je ke kontrole" })).toMatch(/^je pozastavený/);
    expect(sendQueueText({ ...q, kind: "purchase_order", status: "blocked", reason: null })).toMatch(/^je pozastavená/);
  });

  it("soubor: hotovo / starší „ke kontrole“ = hotovo / přeskočeno s důvodem", () => {
    expect(fileAnonLabel({ status: "done", reviewed: true }).label).toBe("Anonymizováno ✓");
    const legacy = fileAnonLabel({ status: "review", reason: "AI si není jistá" });
    expect(legacy.label).toBe("Anonymizováno");
    expect(legacy.tone).toBe("ok");
    expect(legacy.label).not.toMatch(/kontrol/i);
    expect(fileAnonLabel({ status: "skipped", reason: "Není výkres" }).label).toBe("Není výkres");
    expect(fileAnonLabel({ status: "skipped", reason: "Náš výkres — neanonymizovat" }).label).toBe("Náš výkres");
    expect(describeCounts({ company: 1, person: 2, path: 1 })).toBe("firma, 2 jména, cesta na disk");
  });

  it("odkazy na routy (náhled před/po, stažení s potvrzením)", () => {
    expect(previewUrl("f1", { variant: "anon", page: 2, table: "adhoc" })).toBe("/api/drawings/anonymize/f1/preview?table=adhoc&page=2&variant=anon");
    expect(downloadUrl("f1", { reviewed: true })).toBe("/api/drawings/anonymize/f1/download?reviewed=1");
  });
});

describe("render komponent anonymizace", () => {
  it("odznaky", () => {
    const a = html(<JobAnonBadge badge={badge({ total: 2, done: 1, review: 1 })} />);
    expect(a).not.toContain("ke kontrole");
    expect(a).toContain("Výkresy 2/2 ✓");
    expect(a).toContain('data-anon-badge="ok"');
    const many = html(<JobAnonBadge badge={badge({ total: 6, done: 1, review: 1, failed: 1, pending: 1, unsupported: 1, sendWaiting: 1 })} />);
    expect(many).toContain("+3");
    expect(many).not.toContain("1 nejde (DWG)</span>");
    expect(html(<FileAnonBadge status="done" reviewed total={0} />)).toContain("Anonymizováno");
    expect(html(<FileAnonBadge status="review" />)).not.toContain("Ke kontrole");
    expect(html(<FileAnonBadge status="pending" />)).toContain("Anonymizuje se…");
    expect(html(<FileAnonBadge status={null} />)).toBe("");
  });

  it("tlačítko v hlavičce Poptávek + samostatný nástroj (bez zakázky)", () => {
    expect(html(<AnonymizeToolButton />)).toContain("Anonymizovat výkres");
    // Radix Dialog se na serveru nevykreslí (portál) — obsah ověří E2E; tady jen že se vykreslí bez chyby
    expect(() => html(<AnonymizeToolDialog open onOpenChange={() => undefined} />)).not.toThrow();
  });

  it("sekce Ke kontrole: Zkontrolovat + Schválit, selhání = Anonymizovat znovu, hromadně", () => {
    const out = html(
      <AnonReviewList
        pendingCount={4}
        pendingFileIds={["a", "b"]}
        items={[
          { id: "f1", jobId: "j1", jobNumber: "Z-26-001", jobTitle: "Hřídel", filename: "12-345.pdf", anonFilename: "12-345_B.pdf", status: "review", reason: "Bez AI (jen pravidla)", counts: { company: 1, person: 2 }, at: "2026-10-24T08:00:00Z" },
          { id: "f2", jobId: "j1", jobNumber: "Z-26-001", jobTitle: null, filename: "foto.jpg", anonFilename: null, status: "failed", reason: "Písmo se nevykreslilo", counts: {}, at: null },
          { id: "f3", jobId: "j1", jobNumber: "Z-26-001", jobTitle: null, filename: "fotka-razitka.jpg", anonFilename: "Z-26-001-V3.jpg", status: "review", reason: "Fotka bez AI", counts: {}, at: null },
        ]}
      />,
    );
    expect(out).toContain("Anonymizovat vše, co čeká (4)");
    expect(out).not.toContain("nebo se nepovedla");
    // hlavní popisek = původní název, pod ním anonymní název pro dodavatele
    expect(out).toContain("12-345.pdf");
    expect(out).toMatch(/pro dodavatele: (<[^>]+>)?12-345_B\.pdf/);
    expect(out).toContain("Z-26-001");
    expect(out).toContain("Zkontrolovat");
    expect(out).toContain("Schválit");
    expect(out).toContain("Anonymizovat znovu");
    expect(out).toContain("firma, 2 jména");
    // miniatura: malý výřez (w=320), ne plný render
    expect(out).toContain("/api/drawings/anonymize/f1/preview?variant=anon");
    expect(out).toContain("w=320");
    // starší řádek „ke kontrole" (před migrací): nic nesmazáno → „Schválit" otevře editor
    expect(out).toContain("Název firmy se na výkrese nenašel");
    expect(out).toMatch(/data-approve="editor"[^>]*>|data-approve="editor"/);
    expect(out).toContain('data-approve="direct"');
  });

  it("samostatný nástroj odmítne nepodporovaný formát předem (ne „selhala“)", () => {
    expect(toolRejectReason({ name: "sestava.dwg", size: 10 })).toMatch(/Nelze anonymizovat/);
    expect(toolRejectReason({ name: "vykres.pdf", size: 10 })).toBeNull();
    expect(toolRejectReason({ name: "obr.heic", size: 10 })).toBeNull();
    expect(toolRejectReason({ name: "velky.pdf", size: 60 * 1024 * 1024 })).toMatch(/50 MB/);
  });

  it("editor (zavřený i otevřený) se vykreslí bez chyby", () => {
    expect(() => html(<AnonymizeEditor open={false} onOpenChange={() => undefined} fileId="f1" sourceName="a.pdf" />)).not.toThrow();
    expect(() => html(<AnonymizeEditor open onOpenChange={() => undefined} fileId="f1" sourceName="a.pdf" />)).not.toThrow();
  });

  const file = (over: Partial<JobFile> = {}): JobFile => ({
    id: "f1", kind: "vykres", title: null, filename: "12-345.pdf", mimeType: "application/pdf", sizeBytes: 1, version: 1, archived: false,
    replacedBy: null, quoteId: null, uploadedBy: null, createdAt: "2026-10-24T08:00:00Z", aiConfidence: null, note: null, hasAiData: false,
    origin: "email", issuer: "zakaznik",
    anon: { status: "done", filename: "12-345_B.pdf", at: null, by: null, actorKind: "ai", reason: null, reviewed: false, reviewedAt: null, counts: { company: 1, path: 1 }, total: 2, warnings: [], excludedPages: [1], method: "raster_pdf" },
    ...over,
  });

  it("dokumenty: ZIP pro dodavatele jen s anonymizovanými, souhrn smazaného, náš doklad nekandiduje", () => {
    expect(html(<SupplierPackButton jobId="j1" files={[file()]} />)).toContain("ZIP pro dodavatele");
    expect(html(<SupplierPackButton jobId="j1" files={[file({ anon: null })]} />)).toBe("");
    expect(html(<AnonSummaryLine file={file()} />)).toContain("Pro dodavatele smazáno: firma, cesta na disk · vyřazené strany 1");
    expect(canAnonymize(file({ origin: "generated" }))).toBe(false);
    expect(canAnonymize(file({ issuer: "my" }))).toBe(false);
    // jen 2D výkresy: Word, text, 3D model ani objednávka zákazníka nekandidují; DWG ano („nelze automaticky")
    expect(canAnonymize(file({ filename: "x.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))).toBe(false);
    expect(canAnonymize(file({ filename: "x.txt", mimeType: "text/plain" }))).toBe(false);
    expect(canAnonymize(file({ kind: "model_3d", filename: "dil.step", mimeType: null }))).toBe(false);
    expect(canAnonymize(file({ kind: "objednavka", filename: "PO-4471.pdf" }))).toBe(false);
    expect(canAnonymize(file({ filename: "sestava.dwg", mimeType: null }))).toBe(true);
    expect(canAnonymize(file())).toBe(true);
    // stejné pravidlo jako server (isAnonCandidate): faktura / nabídka bez vystavitele ani zamčený soubor ne
    expect(canAnonymize(file({ kind: "faktura", issuer: null }))).toBe(false);
    expect(canAnonymize(file({ kind: "nabidka", issuer: null }))).toBe(false);
    expect(canAnonymize(file({ locked: "price" }))).toBe(false);
    expect(html(<SupplierPackButton jobId="j1" files={[file({ kind: "faktura", issuer: null })]} />)).toBe("");
    // viditelná akce „Pro dodavatele" u hotové / ke kontrole, ne u originálu
    expect(html(<ForSupplierLink file={file()} onReviewDownload={() => undefined} />)).toContain("Pro dodavatele");
    expect(html(<ForSupplierLink file={file()} onReviewDownload={() => undefined} />)).toContain("/api/drawings/anonymize/f1/download");
    expect(html(<ForSupplierLink file={file({ anon: null })} onReviewDownload={() => undefined} />)).toBe("");
    // důvod je vidět i na mobilu (ne jen v tooltipu)
    const failed = file({ anon: { ...file().anon!, status: "failed", reason: "PDF je poškozené nebo zaheslované — nejde otevřít." } });
    expect(html(<AnonSummaryLine file={failed} />)).toContain("PDF je poškozené");
    const unsup = file({ anon: { ...file().anon!, status: "unsupported", reason: "Formát nelze anonymizovat — pošli PDF." } });
    expect(html(<AnonSummaryLine file={unsup} />)).toContain("Formát nelze anonymizovat");
    const empty = file({ anon: { ...file().anon!, reviewed: true, counts: {}, total: 0, excludedPages: [] } });
    expect(html(<AnonSummaryLine file={empty} />)).toContain("Název firmy se na výkrese nenašel");
    // starší „ke kontrole" = přímé stažení „Pro dodavatele" (bez potvrzování náhledu)
    const legacy = html(<ForSupplierLink file={file({ anon: { ...file().anon!, status: "review", reason: "AI si není jistá" } })} onReviewDownload={() => undefined} />);
    expect(legacy).toContain("/api/drawings/anonymize/f1/download");
    expect(legacy).not.toContain("Pro dodavatele…");
    expect(html(<AnonSummaryLine file={file({ anon: { ...file().anon!, status: "review", reason: "AI si není jistá" } })} />)).not.toContain("AI si není jistá");
  });

  it("„Poslat originál…“ u formátu, který anonymizovat nejde: jen super admin, stažení přes ?original=1", () => {
    const dwg = file({ filename: "sestava.dwg", mimeType: null, anon: { ...file().anon!, status: "unsupported", reason: "DWG nejde anonymizovat — ulož jako DXF." } });
    acc.role = "obchodnik";
    expect(html(<ForSupplierLink file={dwg} onReviewDownload={() => undefined} />)).toBe("");
    acc.role = "super_admin";
    const out = html(<ForSupplierLink file={dwg} onReviewDownload={() => undefined} />);
    expect(out).toContain("Poslat originál…");
    expect(out).toContain('data-testid="anon-send-original"');
    // hotová kopie: super admin dostane „Pro dodavatele", ne originál
    expect(html(<ForSupplierLink file={file()} onReviewDownload={() => undefined} />)).not.toContain("Poslat originál");
    acc.role = null;
    expect(downloadUrl("f9", { original: true })).toBe("/api/drawings/anonymize/f9/download?original=1");
    expect(ORIGINAL_CONFIRM).toMatch(/ORIGINÁL.*super admin/);
  });

  it("nastavení: skupiny, termíny, limit, přepočet a staré výkresy; jen super admin ukládá", () => {
    const props = { settings: DEFAULT_ANON_SETTINGS, mode: "full" as const, runnerWarning: "Chybí CRON_SECRET — …", spentTodayUsd: 1.234, legacyCount: 7, changedCount: 2, reviewCount: 3 };
    const out = html(<DrawingAnonSettings {...props} canEdit />);
    for (const t of ["Anonymizace výkresů zapnutá", "Kreslil / konstruoval", "Cesty na disk", "Vždy smazat", "Nikdy nemazat", "Dnes utraceno",
      "Přepočítat po změně pravidel (2)", "Zpracovat staré výkresy (7)", "3 — anonymizace se nepovedla", "Chybí CRON_SECRET", "plná automatika",
      "nic nejde „Ke kontrole“", "Výchozí je jen název firmy"]) expect(out, t).toContain(t);
    expect(out).not.toContain("Se schválením");
    // výchozí přepínače: jen název firmy zapnutý
    expect((out.match(/role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/g) ?? []).length).toBeGreaterThan(0);
    // jednotný český formát částek (ne „$0.00" vedle „$0,40")
    expect(out).toMatch(/1,23\s?US\$/u);
    expect(out).not.toContain("$1.23");
    const ro = html(<DrawingAnonSettings {...props} canEdit={false} />);
    expect(ro).toContain("Nastavení mění jen super admin");
    // AI pro fotky a skeny: chybějící klíč řečeno jasně
    const noKey = html(<DrawingAnonSettings {...props} canEdit aiWarning="AI klíč chybí — fotky a skeny čekají na ruční kontrolu." />);
    expect(noKey).toContain("AI klíč chybí — fotky a skeny čekají na ruční kontrolu");
    expect(noKey).toContain('data-testid="anon-ai-status" data-tone="warn"');
    expect(html(<DrawingAnonSettings {...props} canEdit aiOk="AI pro fotky a skeny je zapnutá" />)).toContain('data-tone="ok"');
  });
});

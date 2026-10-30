import { describe, it, expect } from "vitest";
import {
  classifyFailure, FAST_ATTEMPTS, INTERNAL_FINAL_TEXT, INTERNAL_RETRY_TEXT, LEGACY_PDF_FAILURE_TEXT, LEGACY_TECH_FAILURE_TEXT, MAX_ATTEMPTS,
  PDF_INVALID_TEXT, PDF_PASSWORD_TEXT, retryPlan, userFacingFailure,
} from "./failure-text";
import { subjectOf } from "./queue";

describe("hláška selhání pro uživatele (žádná surová anglická chyba, poctivě)", () => {
  it("chyba prostředí / běhu u PDF NENÍ „poškozené“ — přechodná, zkusí se znovu (bug z produkce 30. 10.)", () => {
    for (const m of ["Path2D is not defined", "ImageData is not defined", "DOMMatrix is not defined", "Cannot read properties of undefined (reading 'Pages')", "TypeError: x is not a function", "JavaScript heap out of memory"]) {
      const f = classifyFailure(m);
      expect(f.text, m).toBe(INTERNAL_RETRY_TEXT);
      expect(f.text, m).not.toMatch(/poškozené|zaheslované|Požádej o nový soubor/);
      expect(f.transient, m).toBe(true);
    }
  });
  it("„poškozené“ jen když PDF nerozebere pdf.js", () => {
    expect(userFacingFailure("Invalid PDF structure.")).toBe(PDF_INVALID_TEXT);
    expect(classifyFailure("InvalidPDFException: The PDF file is empty, i.e. its size is zero bytes.").kind).toBe("corrupt");
    expect(classifyFailure(PDF_INVALID_TEXT).transient).toBe(false);
  });
  it("„zaheslované“ jen u hesla k otevření (pdf.js PasswordException), ne u šifrování s heslem vlastníka", () => {
    expect(userFacingFailure("No password given")).toBe(PDF_PASSWORD_TEXT);
    expect(classifyFailure("PasswordException: Incorrect Password").kind).toBe("password");
    // pdf-lib „is encrypted" = jen šifrování (i heslo vlastníka) — otevření to nebrání
    expect(classifyFailure("Input document to `PDFDocument.load` is encrypted. You can use `PDFDocument.load(..., { ignoreEncryption: true })`").kind).toBe("internal");
  });
  it("úložiště, čas, síť, přetížená AI → přechodné, „zkusí se znovu automaticky“", () => {
    for (const m of ["Soubor se nepodařilo stáhnout: fetch failed", "Uložení anonymizované kopie selhalo: Gateway Timeout", "Vykreslení stránky trvalo příliš dlouho.", "connect ECONNRESET 10.0.0.1:443", "429 rate_limit_error", "Overloaded"]) {
      const f = classifyFailure(m);
      expect(f.transient, m).toBe(true);
      expect(f.text, m).toMatch(/zkusí se znovu automaticky/);
    }
    expect(classifyFailure("Soubor nemá uloženou cestu.").transient).toBe(false);
    // smazaný originál: opakování nepomůže, poctivý důvod
    const gone = classifyFailure("Soubor se nepodařilo stáhnout: Object not found");
    expect(gone.transient).toBe(false);
    expect(gone.text).toBe("Originál souboru v úložišti chybí — nahraj ho znovu.");
  });
  it("dřívější nepravdivé hlášky se u starých řádků zobrazí poctivě", () => {
    expect(userFacingFailure(LEGACY_PDF_FAILURE_TEXT)).toBe(INTERNAL_RETRY_TEXT);
    expect(userFacingFailure(LEGACY_TECH_FAILURE_TEXT)).toBe(INTERNAL_RETRY_TEXT);
  });
  it("české hlášky jádra projdou beze změny", () => {
    const m = "Písmo se nevykreslilo (chybí fonty pdf.js) — anonymizace selhala.";
    expect(userFacingFailure(m)).toBe(m);
    expect(userFacingFailure("Soubor je větší než 50 MB.")).toBe("Soubor je větší než 50 MB.");
    expect(classifyFailure("Chybí fonty pdf.js v nasazení (standard_fonts) — anonymizace PDF nemůže běžet.").transient).toBe(true);
  });
});

describe("plán opakování po chybě běhu", () => {
  const internal = classifyFailure("Path2D is not defined");
  it("přechodná chyba: 3 pokusy hned, pak odložené (5 / 15 / 45 min), potom failed s radou", () => {
    expect(retryPlan(1, internal)).toEqual({ status: "pending", delayMs: 0, text: INTERNAL_RETRY_TEXT });
    expect(retryPlan(FAST_ATTEMPTS - 1, internal).delayMs).toBe(0);
    expect(retryPlan(FAST_ATTEMPTS, internal)).toMatchObject({ status: "pending", delayMs: 5 * 60_000 });
    expect(retryPlan(FAST_ATTEMPTS + 1, internal).delayMs).toBe(15 * 60_000);
    expect(retryPlan(MAX_ATTEMPTS - 1, internal).delayMs).toBe(45 * 60_000);
    expect(retryPlan(MAX_ATTEMPTS, internal)).toEqual({ status: "failed", delayMs: 0, text: INTERNAL_FINAL_TEXT });
    const storage = retryPlan(MAX_ATTEMPTS, classifyFailure("Soubor se nepodařilo stáhnout: fetch failed"));
    expect(storage.status).toBe("failed");
    expect(storage.text).toMatch(/klikni Anonymizovat znovu\.$/);
    expect(storage.text).not.toMatch(/zkusí se znovu automaticky/);
  });
  it("vada souboru / odmítnutá AI → hned failed (opakování nepomůže)", () => {
    expect(retryPlan(1, classifyFailure("No password given"))).toEqual({ status: "failed", delayMs: 0, text: PDF_PASSWORD_TEXT });
    expect(retryPlan(1, internal, { permanent: true }).status).toBe("failed");
  });
});

describe("samostatný nástroj nahrává originál (master)", () => {
  it("adhoc řádek má vždy master — fotka není „v nízkém rozlišení“", () => {
    const s = subjectOf("drawing_anon_adhoc", { id: "a", user_id: "u", storage_path: "capture/u/anon/x.jpg", filename: "x.jpg", anon_source_path: null } as never);
    expect(s.hasMaster).toBe(true);
    const j = subjectOf("job_files", { id: "b", job_id: "j", storage_path: "zakazky/j/x.jpg", filename: "x.jpg", anon_source_path: null } as never);
    expect(j.hasMaster).toBe(false);
  });
});

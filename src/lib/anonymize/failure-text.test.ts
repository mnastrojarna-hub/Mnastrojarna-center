import { describe, it, expect } from "vitest";
import { userFacingFailure } from "./failure-text";
import { subjectOf } from "./queue";

describe("hláška selhání pro uživatele (žádná surová anglická chyba)", () => {
  it("poškozené PDF → česká věta s radou", () => {
    expect(userFacingFailure("Cannot read properties of undefined (reading 'Pages')", "pdf")).toBe("PDF je poškozené nebo zaheslované — nejde otevřít. Požádej o nový soubor.");
    expect(userFacingFailure("Invalid PDF structure.", "pdf")).toMatch(/poškozené/);
  });
  it("heslo → zaheslované", () => {
    expect(userFacingFailure("No password given", "pdf")).toMatch(/zaheslované/);
  });
  it("jiná technická chyba → obecná věta", () => {
    expect(userFacingFailure("TypeError: x is not a function", "image")).toBe("Anonymizace se nepovedla (technická chyba) — zkus Anonymizovat znovu.");
  });
  it("české hlášky jádra projdou beze změny", () => {
    const m = "Písmo se nevykreslilo (chybí fonty pdf.js) — anonymizace selhala.";
    expect(userFacingFailure(m, "pdf")).toBe(m);
    expect(userFacingFailure("Soubor je větší než 50 MB.", "pdf")).toBe("Soubor je větší než 50 MB.");
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

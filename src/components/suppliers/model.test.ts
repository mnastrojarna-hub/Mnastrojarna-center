import { describe, it, expect } from "vitest";
import {
  EMPTY_SUPPLIER_FORM, addTags, clampRating, filterSuppliers, normalizeTags, parseLeadDays, parseTags, removeTag,
  rowToSupplierView, supplierFormFromView, tagSuggestions, tagTone, validateSupplierForm,
} from "@/components/suppliers/model";

const A = rowToSupplierView({
  id: "s1", name: "Kalírna Brno", technologies: ["Kalení", "kalení ", "Nitridace"], materials: ["1.2343"],
  certifications: ["ISO 9001"], lead_days: "10", rating: "4.6", jobs: [{ status: "ve_vyrobe" }, { status: "dokonceno" }],
});
const B = rowToSupplierView({ id: "s2", name: "Frézárna Žďár", technologies: ["Frézování", "Kalení"], materials: ["AL 7075"], rating: null });

describe("rowToSupplierView", () => {
  it("normalizuje štítky, hodnocení a počty zakázek", () => {
    expect(A.technologies).toEqual(["Kalení", "Nitridace"]);
    expect(A.rating).toBe(5);
    expect(A.leadDays).toBe(10);
    expect(A.activeJobs).toBe(1);
    expect(A.totalJobs).toBe(2);
    expect(B.rating).toBeNull();
    expect(B.country).toBe("CZ");
  });
});

describe("štítky", () => {
  it("parsuje čárky, středníky, řádky a duplicity", () => {
    expect(parseTags("Kalení, frézování; kalení\n5osé ")).toEqual(["Kalení", "frézování", "5osé"]);
    expect(addTags(["A"], "b, a")).toEqual(["A", "b"]);
    expect(removeTag(["A", "B"], "A")).toEqual(["B"]);
    expect(normalizeTags(["", "  x  y "])).toEqual(["x y"]);
  });

  it("návrhy podle četnosti", () => {
    expect(tagSuggestions([A, B], "technologies")).toEqual(["Kalení", "Frézování", "Nitridace"]);
  });

  it("stejná technologie = stejná barva", () => {
    expect(tagTone("Kalení")).toBe(tagTone("kaleni"));
  });

  it("clampRating", () => {
    expect(clampRating(0)).toBeNull();
    expect(clampRating("7")).toBe(5);
    expect(clampRating(2.4)).toBe(2);
    expect(clampRating("x")).toBeNull();
  });
});

describe("formulář dodavatele", () => {
  it("validace", () => {
    expect(validateSupplierForm(EMPTY_SUPPLIER_FORM).name).toBeTruthy();
    const errs = validateSupplierForm({ ...EMPTY_SUPPLIER_FORM, name: "Firma", leadDays: "abc", email: "x", rating: 9 });
    expect(errs.leadDays).toBeTruthy();
    expect(errs.email).toBeTruthy();
    expect(errs.rating).toBeTruthy();
    expect(validateSupplierForm({ ...EMPTY_SUPPLIER_FORM, name: "Firma", leadDays: "14", rating: 4 })).toEqual({});
    expect(parseLeadDays("")).toBeNull();
  });

  it("view → formulář", () => {
    const f = supplierFormFromView(A);
    expect(f.leadDays).toBe("10");
    expect(f.rating).toBe(5);
    expect(f.technologies).toEqual(["Kalení", "Nitridace"]);
  });
});

describe("filtry", () => {
  it("hledá technologii i materiál bez diakritiky", () => {
    expect(filterSuppliers([A, B], { q: "frezovani" }).map((s) => s.id)).toEqual(["s2"]);
    expect(filterSuppliers([A, B], { q: "1.2343" }).map((s) => s.id)).toEqual(["s1"]);
    expect(filterSuppliers([A, B], { technology: "kalení" }).map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(filterSuppliers([A, B], { minRating: 4 }).map((s) => s.id)).toEqual(["s1"]);
  });
});

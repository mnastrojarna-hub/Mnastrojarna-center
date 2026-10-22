import { describe, it, expect } from "vitest";
import { JOB_FIELD_LABELS, formatFieldValue, formatIsoDate, formatTimestamp, fieldLabel } from "./field-labels";

describe("JOB_FIELD_LABELS", () => {
  it("má české popisky termínů", () => {
    expect(JOB_FIELD_LABELS.customer_required_date).toBe("Požadovaný termín zákazníkem");
    expect(JOB_FIELD_LABELS.due_date).toBe("Potvrzený termín zákazníkovi");
    expect(JOB_FIELD_LABELS.supplier_promised_date).toBe("Slíbený termín od dodavatele");
    expect(JOB_FIELD_LABELS.max_tolerated_date).toBe("Maximální tolerovaný termín");
    expect(JOB_FIELD_LABELS.expected_delivery_date).toBe("Předpokládaný termín dodání");
    expect(JOB_FIELD_LABELS.customer_order_number).toBe("Číslo objednávky zákazníka");
  });
  it("neznámý sloupec vrátí název sloupce", () => {
    expect(fieldLabel("xyz")).toBe("xyz");
  });
});

describe("formatFieldValue", () => {
  it("prázdné hodnoty", () => {
    expect(formatFieldValue("note", null)).toBe("—");
    expect(formatFieldValue("note", undefined)).toBe("—");
    expect(formatFieldValue("note", "  ")).toBe("—");
    expect(formatFieldValue("tags", [])).toBe("—");
  });
  it("data, peníze, ano/ne, stav", () => {
    expect(formatFieldValue("due_date", "2026-03-12")).toBe("12. 3. 2026");
    expect(formatFieldValue("value", 12500).replace(/\s/g, " ")).toBe("12 500 Kč");
    expect(formatFieldValue("ai_filled", true)).toBe("ano");
    expect(formatFieldValue("ai_filled", false)).toBe("ne");
    expect(formatFieldValue("status", "nabidka")).toBe("Nabídka odeslaná");
    expect(formatFieldValue("priority", "vysoka")).toBe("Vysoká");
    expect(formatFieldValue("source", "foto")).toBe("Z fotky");
    expect(formatFieldValue("tags", ["a", "b"])).toBe("a, b");
    expect(formatFieldValue("ai_confidence", 0.874)).toBe("87 %");
    expect(formatFieldValue("title", "Hřídel")).toBe("Hřídel");
  });
  it("časová razítka v pražském čase", () => {
    expect(formatTimestamp("2026-03-12T13:05:00Z")).toBe("12. 3. 2026 14:05");
    expect(formatFieldValue("confirmed_at", "2026-07-01T08:00:00Z")).toBe("1. 7. 2026 10:00");
    expect(formatTimestamp("nesmysl")).toBeNull();
  });
  it("formatIsoDate", () => {
    expect(formatIsoDate("2026-01-05")).toBe("5. 1. 2026");
    expect(formatIsoDate("x")).toBeNull();
  });
});

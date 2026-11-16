import { describe, expect, it } from "vitest";
import { mailRowTime, mailTimeGroup } from "./time-groups";

describe("pošta: skupiny podle času (16. 11.)", () => {
  const now = new Date("2026-11-18T10:00:00+01:00"); // středa
  it("Dnes / Včera / Tento týden / Minulý týden / Starší", () => {
    expect(mailTimeGroup("2026-11-18T08:00:00+01:00", now)).toBe("today");
    expect(mailTimeGroup("2026-11-17T23:30:00+01:00", now)).toBe("yesterday");
    expect(mailTimeGroup("2026-11-16T09:00:00+01:00", now)).toBe("thisWeek"); // pondělí
    expect(mailTimeGroup("2026-11-15T09:00:00+01:00", now)).toBe("lastWeek"); // neděle
    expect(mailTimeGroup("2026-11-09T09:00:00+01:00", now)).toBe("lastWeek"); // pondělí minulého týdne
    expect(mailTimeGroup("2026-11-08T09:00:00+01:00", now)).toBe("older");
  });
  it("čas v řádku", () => {
    expect(mailRowTime("2026-11-18T08:05:00+01:00", now)).toBe("08:05");
    expect(mailRowTime("2026-11-17T14:00:00+01:00", now)).toMatch(/^včera 14:00$/);
    expect(mailRowTime("2026-03-02T14:00:00+01:00", now)).toMatch(/^2\. 3\.$/);
    expect(mailRowTime("2025-03-02T14:00:00+01:00", now)).toMatch(/2025/);
  });
});

import { describe, expect, it } from "vitest";
import { dayNumber, deadlineInfo, pragueToday } from "@/lib/jobs/deadlines";

describe("pragueToday", () => {
  it("bere kalendářní den v Praze, ne v UTC", () => {
    // 22. 10. 23:30 UTC = 23. 10. 01:30 v Praze (letní čas)
    expect(dayNumber(pragueToday(new Date("2026-10-22T23:30:00Z")))).toBe(dayNumber("2026-10-23"));
    // 22. 10. 21:30 UTC = 22. 10. 23:30 v Praze
    expect(dayNumber(pragueToday(new Date("2026-10-22T21:30:00Z")))).toBe(dayNumber("2026-10-22"));
    // zimní čas: 31. 12. 23:30 UTC = 1. 1. 00:30
    expect(dayNumber(pragueToday(new Date("2026-12-31T23:30:00Z")))).toBe(dayNumber("2027-01-01"));
  });

  it("termín dnes po půlnoci v Praze je „dnes“, i když v UTC je ještě včera", () => {
    const info = deadlineInfo(
      { stage: "ve_vyrobe", dueDate: "2026-10-23", customerRequiredDate: null, maxToleratedDate: null, supplierPromisedDate: null },
      pragueToday(new Date("2026-10-22T22:30:00Z")),
    );
    expect(info.state).toBe("today");
  });
});

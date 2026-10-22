import { describe, expect, it } from "vitest";
import { bodyPreview, isForeignScriptError, redactUrl } from "@/lib/debug/capture";

describe("debug log — žádná hesla ani tokeny", () => {
  it("přihlašovací formulář: heslo skryté, e-mail zůstane", () => {
    const fd = new FormData();
    fd.set("_1_email", "jan@firma.cz");
    fd.set("_1_password", "TajneHeslo1");
    const out = bodyPreview(fd, true)!;
    expect(out).toContain("jan@firma.cz");
    expect(out).not.toContain("TajneHeslo1");
    expect(out).toContain("_1_password=[skryto]");
  });

  it("server action s argumenty po pozicích se neloguje vůbec", () => {
    const out = bodyPreview(JSON.stringify(["8f1c…", "NoveHeslo123"]), true)!;
    expect(out).not.toContain("NoveHeslo123");
    expect(out).toMatch(/server action/);
  });

  it("JSON tělo: citlivé klíče skryté i do hloubky", () => {
    const out = bodyPreview(JSON.stringify({ email: "a@b.cz", code: "123456", nested: { newPassword: "x1", ok: 1 } }), false)!;
    expect(out).not.toContain("123456");
    expect(out).not.toContain("x1");
    expect(out).toContain("a@b.cz");
  });

  it("URL: token podepsaného odkazu skrytý", () => {
    expect(redactUrl("/storage/v1/object/upload/sign/job-files/a.jpg?token=eyJabc&x=1")).toBe(
      "/storage/v1/object/upload/sign/job-files/a.jpg?token=[skryto]&x=1",
    );
  });

  it("chyby rozšíření prohlížeče nejsou chyby aplikace", () => {
    expect(isForeignScriptError({ message: "Script error.", filename: "" })).toBe(true);
    expect(isForeignScriptError({ message: "TypeError: undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')", filename: "https://x/inquiries" })).toBe(true);
    expect(isForeignScriptError({ message: "TypeError: x is undefined", filename: "https://x/_next/static/chunks/a.js" })).toBe(false);
  });
});

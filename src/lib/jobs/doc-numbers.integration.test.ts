import { describe, it, expect, afterAll } from "vitest";
import { LOCAL_ENABLED, localAdmin, localAnon, localSql } from "@/test/local-supabase";

/**
 * Číselné řady dokladů přeskočí obsazená čísla (import / demo data / ruční zápis před čítačem):
 * nabídka ani doklad pak nenarazí na „Záznam s tímto číslem už existuje".
 * Čítač se jen zvyšuje (test spotřebuje pár čísel NAB, nikdy ho neresetuje).
 *   set -a; . .local-supabase/env; set +a; LOCAL_SUPABASE=1 npx vitest run src/lib/jobs/doc-numbers.integration.test.ts
 */
describe.skipIf(!LOCAL_ENABLED)("next_doc_number přeskočí obsazené číslo", () => {
  const quotes: string[] = [];

  afterAll(() => {
    if (quotes.length) localSql(`delete from quotes where id in (${quotes.map((q) => `'${q}'`).join(",")})`);
  });

  it("NAB: číslo, které už má jiná nabídka, se přeskočí", async () => {
    const svc = localAdmin();
    const year = new Date().getUTCFullYear();
    const counter = Number(localSql(`select coalesce((select counter from doc_counters where doc_type = 'NAB' and year = ${year}), 0)`));
    const pad = (n: number) => String(n).padStart(3, "0");
    // obsadit dvě následující čísla „mimo řadu" (některé může mít obsazené už demo)
    for (const k of [1, 2]) {
      const id = localSql(`insert into quotes (number, status, total, currency, revision, archived)
        values ('NAB-${year}-${pad(counter + k)}', 'ke_schvaleni', 1, 'CZK', 1, true) on conflict (number) do nothing returning id`).split("\n")[0];
      if (id) quotes.push(id);
    }
    let expected = counter + 3;
    while (localSql(`select count(*) from quotes where number = 'NAB-${year}-${pad(expected)}'`) !== "0") expected += 1;
    const { data, error } = await svc.rpc("next_doc_number", { p_prefix: "NAB" });
    expect(error).toBeNull();
    expect(data).toBe(`NAB-${year}-${pad(expected)}`);
  });

  it("bez přihlášení řadu posunout nejde", async () => {
    const { error } = await localAnon().rpc("next_doc_number", { p_prefix: "NAB" });
    expect(error).not.toBeNull();
  });
});

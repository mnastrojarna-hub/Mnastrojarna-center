import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { FlowStateTiles, MoversPanel } from "./flow-overview";
import { groupMovers, startOfPragueDay } from "./flow-overview-model";

const ev = (actor_id: string | null, actor_kind: string, name: string | null, number: string, at: string, actor_name: string | null = null) => ({
  job_id: `j-${number}`, message: `Stav: Objednávka → Potvrzeno (${number})`, created_at: at, actor_id, actor_kind, actor_name,
  actor: name ? { full_name: name, email: null } : null, job: { number },
});

describe("Co kdo dnes posunul", () => {
  it("seskupí podle autora: lidé, ✨ AI za účet, systém; smazaný účet podle uloženého jména; nejaktivnější první", () => {
    const g = groupMovers([
      ev("u1", "user", "Petr Obchodník", "Z-1", "2026-10-23T09:00:00Z"),
      ev("u1", "user", "Petr Obchodník", "Z-2", "2026-10-23T08:00:00Z"),
      ev("u2", "ai", "Super Admin", "Z-3", "2026-10-23T07:00:00Z"),
      ev(null, "system", null, "Z-4", "2026-10-23T06:00:00Z"),
      ev("u9", "user", null, "Z-5", "2026-10-23T05:00:00Z", "Vít Volný"),
    ]);
    expect(g[0]).toMatchObject({ name: "Petr Obchodník", kind: "user", count: 2 });
    expect(g.slice(1).map((x) => [x.name, x.kind, x.count])).toEqual(expect.arrayContaining([
      ["Automaticky / systém", "system", 1],
      ["Vít Volný (účet zrušen)", "user", 1],
      ["✨ AI za účet Super Admin", "ai", 1],
    ]));
    expect(g).toHaveLength(4);
    expect(g[0].items.map((i) => i.jobNumber)).toEqual(["Z-1", "Z-2"]);
  });

  it("začátek pražského dne", () => {
    expect(startOfPragueDay("2026-10-23")).toBe("2026-10-22T22:00:00.000Z");
    expect(startOfPragueDay("2026-11-02")).toBe("2026-11-01T23:00:00.000Z");
  });

  it("render: panel s počty a odkazy do historie zakázky; dlaždice jen nenulových stavů s barvou fáze", () => {
    const now = new Date("2026-10-23T10:00:00Z");
    const html = renderToString(<MoversPanel movers={groupMovers([ev("u1", "user", "Petr Obchodník", "Z-1", "2026-10-23T09:00:00Z")])} total={1} now={now} />);
    expect(html).toContain("Co kdo dnes posunul");
    expect(html).toContain("1 změn stavů dnes");
    expect(html).toContain("Petr Obchodník");
    expect(html).toContain("/orders/j-Z-1?tab=historie");
    expect(html).toContain("před 60 min".replace("60 min", "1 h"));
    expect(renderToString(<MoversPanel movers={[]} total={0} />)).toContain("Dnes zatím žádná změna stavu.");

    const tiles = renderToString(<FlowStateTiles
      tiles={[{ key: "inquiry.prijata", label: "Poptávky k převzetí", href: "/inquiries?stav=prijata" }, { key: "order.rozpor", label: "Rozpor s nabídkou", href: "/confirmations?stav=rozpor" }]}
      counts={{ "inquiry.prijata": 3, "order.rozpor": 0 }}
    />);
    expect(tiles).toContain("Poptávky k převzetí");
    expect(tiles).toContain("/inquiries?stav=prijata");
    expect(tiles).not.toContain("Rozpor s nabídkou");
    expect(tiles).toContain("ring-sky-400");
    expect(tiles).toContain("overflow-x-auto");
    expect(renderToString(<FlowStateTiles tiles={[]} counts={{}} />)).toBe("");
  });
});

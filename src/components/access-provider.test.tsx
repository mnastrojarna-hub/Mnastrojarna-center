import { describe, it, expect } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { AccessBridge, AccessProvider, useAccess } from "./access-provider";

function Probe() {
  const a = useAccess();
  return <span>{`${a.role ?? "-"}|${a.userId ?? "-"}|orders=${a.can("orders")}|margins=${a.can("margins")}`}</span>;
}

describe("AccessBridge — oprávnění už při vykreslení na serveru (žádná změna kontextu po hydrataci)", () => {
  it("obsah aplikace pod AccessBridge vidí oprávnění hned v prvním vykreslení", () => {
    const html = renderToString(
      <AccessProvider>
        <AccessBridge features={["orders"]} role="obchodnik" userId="u1" quoteNeedsApproval>
          <Probe />
        </AccessBridge>
      </AccessProvider>,
    );
    expect(html).toContain("obchodnik|u1|orders=true|margins=false");
  });

  it("mimo AccessBridge (⌘K v kořeni před připojením) zůstává prázdné", () => {
    const html = renderToString(
      <AccessProvider>
        <Probe />
      </AccessProvider>,
    );
    expect(html).toContain("-|-|orders=false|margins=false");
  });

  it("bez provideru (izolované testy komponent) prázdné oprávnění, bez chyby", () => {
    expect(renderToString(<Probe />)).toContain("-|-|orders=false");
  });
});

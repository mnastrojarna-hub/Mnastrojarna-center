import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/viewer3d/model-viewer", () => ({ ModelViewer: () => null }));

import { restorableViewer, VIEWER_RESTORE_MS, type SavedViewer } from "./file-viewer-provider";
import { isFileViewerOpen, runWhenFileViewerClosed, setFileViewerOpen } from "./viewer-bus";

const URL_ = "https://app.test/orders/abc?tab=dokumenty";
const saved = (over: Partial<SavedViewer> = {}): string =>
  JSON.stringify({ url: URL_, href: "/api/jobs/files/f1", filename: "H-20.pdf", info: null, hiddenAt: 1_000_000, ...over } satisfies SavedViewer);

describe("prohlížeč přežije načtení stránky znovu (majitel 10. 11.)", () => {
  it("stejná adresa a rychlý návrat → otevře se znovu tentýž dokument", () => {
    expect(restorableViewer(saved(), URL_, 1_000_000 + 2_000)).toEqual({ href: "/api/jobs/files/f1", filename: "H-20.pdf", info: null });
  });

  it("jiná adresa, pozdní návrat, otevřený (neodešlý) záznam, cizí odkaz nebo poškozený záznam → nic", () => {
    expect(restorableViewer(saved(), "https://app.test/orders/jina", 1_000_500)).toBeNull();
    expect(restorableViewer(saved(), URL_, 1_000_000 + VIEWER_RESTORE_MS + 1)).toBeNull();
    expect(restorableViewer(saved({ hiddenAt: null }), URL_, 1_000_500)).toBeNull();
    expect(restorableViewer(saved({ href: "https://zlo.test/x.pdf" }), URL_, 1_000_500)).toBeNull();
    expect(restorableViewer("{nesmysl", URL_, 1_000_500)).toBeNull();
    expect(restorableViewer(null, URL_, 1_000_500)).toBeNull();
  });
});

describe("obnovení stránky na pozadí počká na zavření prohlížeče", () => {
  it("zavřený prohlížeč → hned; otevřený → jednou po zavření (bez zdvojení)", () => {
    const fn = vi.fn();
    setFileViewerOpen(false);
    runWhenFileViewerClosed(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    setFileViewerOpen(true);
    expect(isFileViewerOpen()).toBe(true);
    runWhenFileViewerClosed(fn);
    runWhenFileViewerClosed(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    setFileViewerOpen(false);
    expect(fn).toHaveBeenCalledTimes(2);
    setFileViewerOpen(false);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

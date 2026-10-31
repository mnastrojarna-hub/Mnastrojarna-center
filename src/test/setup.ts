import { beforeAll } from "vitest";
import { dynamicReady } from "./next-dynamic-stub";

// komponenty načítané přes next/dynamic (alias na next-dynamic-stub) musí být načtené před vykreslením
beforeAll(async () => {
  await dynamicReady();
});

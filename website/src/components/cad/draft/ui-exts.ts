/** Seznam rozšíření GUI 2D výkresu (pořadí = pořadí skupin na pásu). Balíky upravují jen své soubory ui-*.tsx. */
import { annotUi } from "./ui-annot";
import { editUi } from "./ui-edit";
import { ioUi } from "./ui-io";
import { layoutUi } from "./ui-layout";
import type { DraftUiExt } from "./ui-ext";

export const UI_EXTS: DraftUiExt[] = [editUi, annotUi, layoutUi, ioUi];

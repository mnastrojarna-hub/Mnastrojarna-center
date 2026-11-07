// fontkit (závislost @react-pdf, písma pro pdf-lib) nemá vlastní deklarace — stačí create() pro registerFontkit.
declare module "fontkit" {
  export function create(buffer: Uint8Array, postscriptName?: string): unknown;
}

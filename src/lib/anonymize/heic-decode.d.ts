// heic-decode (libheif-js, WebAssembly) nemá vlastní deklarace — dekódování fotek HEIC z iPhonu na serveru.
declare module "heic-decode" {
  interface HeicImage {
    width: number;
    height: number;
    /** RGBA, 4 bajty na pixel. */
    data: Uint8ClampedArray;
  }
  function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<HeicImage>;
  export default decode;
}

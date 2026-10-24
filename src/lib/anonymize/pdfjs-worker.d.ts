// Worker pdf.js (legacy build) nemá vlastní deklarace — načítá se jen kvůli WorkerMessageHandler.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}

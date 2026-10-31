/** Předání souborů z 3D prohlížeče do poptávky při klientské navigaci (bez nahrávání na server). */
let pending: File[] = [];
export function handoffFiles(files: File[]) {
  pending = files;
}
export function takeHandoffFiles(): File[] {
  const f = pending;
  pending = [];
  return f;
}

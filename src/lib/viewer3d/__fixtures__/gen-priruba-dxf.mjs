// Generátor testovacího výkresu priruba-cp1250.dxf: node src/lib/viewer3d/__fixtures__/gen-priruba-dxf.mjs src/lib/viewer3d/__fixtures__/priruba-cp1250.dxf
// Vygeneruje testovací výkres příruby (DXF R2000, kódová stránka 1250).
import fs from "node:fs";
const CP = { "á": 0xe1, "č": 0xe8, "ď": 0xef, "é": 0xe9, "ě": 0xec, "í": 0xed, "ň": 0xf2, "ó": 0xf3, "ř": 0xf8, "š": 0x9a, "ť": 0x9d, "ú": 0xfa, "ů": 0xf9, "ý": 0xfd, "ž": 0x9e, "Ř": 0xd8, "Č": 0xc8, "Ž": 0x8e, "Š": 0x8a, "Í": 0xcd, "Á": 0xc1, "É": 0xc9, "Ú": 0xda, "—": 0x97, "×": 0xd7, "°": 0xb0 };
const out = [];
const g = (...p) => { for (let i = 0; i < p.length; i += 2) out.push(String(p[i]), String(p[i + 1])); };
g(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1015", 9, "$DWGCODEPAGE", 3, "ANSI_1250", 9, "$INSUNITS", 70, 4, 0, "ENDSEC");
g(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, 4);
for (const [n, c] of [["KONTURA", 7], ["OSY", 1], ["KOTY", 3], ["POPIS", 5]]) g(0, "LAYER", 2, n, 70, 0, 62, c, 6, "CONTINUOUS");
g(0, "ENDTAB", 0, "ENDSEC");
g(0, "SECTION", 2, "BLOCKS", 0, "BLOCK", 8, "0", 2, "OTVOR", 70, 0, 10, 0, 20, 0, 30, 0, 3, "OTVOR",
  0, "CIRCLE", 8, "0", 10, 0, 20, 0, 30, 0, 40, 6, 0, "ENDBLK", 8, "0", 0, "ENDSEC");
g(0, "SECTION", 2, "ENTITIES");
// obrys 200 × 120 se zaoblenými rohy R10 (LWPOLYLINE s bulge)
const b = Math.tan(Math.PI / 8);
const pts = [[10, 0, 0], [190, 0, b], [200, 10, 0], [200, 110, b], [190, 120, 0], [10, 120, b], [0, 110, 0], [0, 10, b]];
g(0, "LWPOLYLINE", 8, "KONTURA", 90, pts.length, 70, 1);
for (const [x, y, bb] of pts) g(10, x, 20, y, 42, bb);
// středový otvor ⌀50 a 4 otvory ⌀12 (blok)
g(0, "CIRCLE", 8, "KONTURA", 10, 100, 20, 60, 30, 0, 40, 25);
for (const [x, y] of [[25, 25], [175, 25], [175, 95], [25, 95]]) g(0, "INSERT", 8, "KONTURA", 2, "OTVOR", 10, x, 20, y, 30, 0);
// osy
g(0, "LINE", 8, "OSY", 10, 70, 20, 60, 30, 0, 11, 130, 21, 60, 31, 0);
g(0, "LINE", 8, "OSY", 10, 100, 20, 30, 30, 0, 11, 100, 21, 90, 31, 0);
// kóty (texty)
g(0, "LINE", 8, "KOTY", 10, 0, 20, -12, 30, 0, 11, 200, 21, -12, 31, 0);
g(0, "TEXT", 8, "KOTY", 10, 100, 20, -10, 30, 0, 40, 3.5, 1, "200", 72, 1, 11, 100, 21, -10, 31, 0);
g(0, "TEXT", 8, "KOTY", 10, 112, 20, 80, 30, 0, 40, 3.5, 1, "%%c50 H7");
g(0, "TEXT", 8, "POPIS", 10, 0, 20, 135, 30, 0, 40, 5, 1, "PŘÍRUBA — materiál 1.4301, tloušťka 10 mm");
g(0, "MTEXT", 8, "POPIS", 10, 0, 20, 160, 30, 0, 40, 3, 41, 150, 71, 1, 1, "Nekótované rozměry ISO 2768-mK\\PSrazit hrany 0,5×45°");
g(0, "ENDSEC", 0, "EOF");
const txt = out.join("\r\n") + "\r\n";
fs.writeFileSync(process.argv[2], Uint8Array.from([...txt].map((ch) => CP[ch] ?? (ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 0x3f))));

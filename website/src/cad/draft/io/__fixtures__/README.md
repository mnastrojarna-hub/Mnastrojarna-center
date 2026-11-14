Testovací soubory balíku 4 (io) – DWG / DXF.

- `full-model.ts` – 2D model se všemi druhy entit (jádro + smluvní druhy balíků 2 a 3), tabulkami, bloky,
  rozvržením a XDATA pro testy tam a zpět (`io.test.ts`).
- `librecad-r2000.dxf` – DXF R2000 ve stylu LibreCAD / libdxfrw (komentář 999, kódová stránka ANSI_1252 v cp1252,
  vypnutá hladina = záporná barva, LWPOLYLINE s vydutím, handle a značky podtříd).
- `draftsight-r2013.dxf` – týž obsah jako DXF R2013 (AC1027): text vždy v UTF-8, i když hlavička uvádí ANSI_1252.
- `r12-cam.dxf` – DXF R12 jen se sekcí ENTITIES a bez handle (typický výstup CAM / CNC programů): POLYLINE s vydutím.
- `mirrored-ocs.dxf` – oblouk a kružnice s normálou −Z (zrcadlené OCS) – převod do WCS.
- `ezdxf-r2018.dxf`, `ezdxf-r2018-bin.dxf.b64` (binární DXF v base64, aby šel do textového patche) – výkres z ezdxf 1.4.5 (ASCII a binární DXF R2018): vypnutá hladina OFF
  (barva −6), SPLINE jen z bodů proložení (`add_spline`, bez řídicích bodů), blok RAZITKO s ATTDEF a vložení s ATTRIB;
  `ezdxf-spline-samples.json` = 65 bodů křivky, kterou z těch bodů proložení staví ezdxf (porovnání tvaru).
- `ezdxf-r12-names.dxf` – DXF R12 z ezdxf: hladina a blok se stejným názvem BOLT (+ blok PLAIN za ním).

Soubory ezdxf vznikly skriptem (Python, ezdxf 1.4.5): `ezdxf.new("R2018")`, `layers.add("OFF", color=6).off()`,
`msp.add_spline([(0, 0), (10, 20), (30, -10), (50, 10)])`, blok s `add_attdef("NAZEV", …)` + `add_auto_attribs`,
`saveas(…)` a `saveas(…, fmt="bin")`; R12: `layers.add("BOLT")`, `blocks.new("BOLT")` s kružnicí, `add_blockref("BOLT", …)`.

Reálné výkresy z AutoCADu se berou z existujících testovacích dat repozitáře (`src/lib/viewer3d/formats/__fixtures__`,
LibreDWG test-data R2000–R2018, a `src/lib/viewer3d/__fixtures__/priruba-cp1250.dxf`), aby se binární soubory
nezdvojovaly.

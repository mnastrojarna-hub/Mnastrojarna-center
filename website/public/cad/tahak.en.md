# Cheat sheet for AI agents – Mnástrojárna CAD

Full guide: https://www.mnastrojarna.cz/cad/schema-pro-ai.md · search: `help search tabs` · feature fields: `feature help hole`
Without a browser: `mncad run script.txt --out out` (`--strict`, `--formats step,pdf`, `--json`; Node 22, /cad/cli/) · in a browser `await window.mncad.run(text)`
Log MNCAD/1: ✗ error · ⚠ warning · ℹ note · = listing · D document · F file · O link. mm and °, Z up, `#` comment, lines and JSON can be mixed.

## Documents and tabs
`new part "Plate"` · `new assembly "Tool"` · `tabs` · `tab "Plate"` · `close tab` – every part is a tab; an assembly inserts open tabs only (inserting again = another instance).
Large assembly: every part as a block `new part "…"` → `new assembly "…"` → `insert "Plate" at 100 0 0` for each instance → `assembly` (component list, count) → `bom` (quantities by source).

## Part
`box 100 60 12` · `cylinder 20 30 at 50 30 12` · `sketch XY: rect 60 40; circle 20 at 10 5` → `extrude 10 cut` · `revolve 360 axis Y`
`fillet 2 edges vertical` · `chamfer 1 edges top` · `pattern 4 spacing 25 direction X` · `pattern circular 6 axis Z` · `mirror YZ` · `material steel` · `library M8x30`
Sketch: `constraint horizontal e1; perpendicular e1 e2` · `dim length e1 50` · edits: `edit "Box 1" size=120;60;12` · `suppress "Fillet 1"` · `delete last` · `variable t = 12` · `undo`

## Holes and threads
`hole 8.5 through at 20 30` · `hole thread M8 depth 20 at 50 30` · `hole 6.8 through at 10 10 counterbore 11 6.5` · `hole 10 depth 12 flat bottom at 40 20` · `thread M18x1.5 length 20 at 0 0 12 internal`

## Assembly
`insert "Plate" at 0 0 0 fix as "D1"` · `insert "Pin" at 20 30 12 as "K48"` · `assembly faces "K48"` · `assembly mate concentric "K48" Ø10 "D1" Ø10` · `assembly mate contact "K48" -Z "D1" top` · `assembly mates` · `assembly component "K48" alias "Pin A"` · `clash` · `bom`

## Springs
`spring compression d 2 De 20 L0 50 n 8` (part from the table) · `assembly spring new d 2 De 20 L0 35 n 6 between "D1" Ø21 "K48" bottom` (“all holes” at the end = into every hole of the pattern) · `assembly springs` · `assembly bolt "D1" Ø9`

## Motion
`motion motor linear mate 2 0..40 step 2 collisions` · `motion motor rotary "K48" 0..360 step 5` · `motion dynamics time 0.5 gravity -Z` · `motion mass "K48" 2.5` · `motion status`

## Drawing
`drawing A3 scale 1:2 views front,top,iso` · `drawing section XZ` · `dimension smart functional 26.5` · `drawing tolerance 26.5 h7` · `drawing titleblock template=iso7200 number="MN-1"` · `drawing general ISO 2768-mK` · `drawing bom yes` · `drawing detail front at 45 10 radius 5` · `drawing status` · `drawing export pdf all`

## 2D drawing
`2d new "Profile"` · `2d line 0,0 100,0 @0,50` · `2d circle 50,25 20` · `2d export dwg`

## Outputs and links
`save` · `export step` · `export step link` · `export script` · `share days 30` · `link` (address again) · CLI `--formats step,pdf,dxf` and `--share`

## Checks
`status` · `measure body` · `measure holes` · `check assembly` · `compare "ref.step" tolerance 0.05` · `reference "customer.dwg"` · `reference check dimensions`

## Strict mode and help
`strict` (every ⚠ stops the run; CLI `--strict`) · `strict off` · `help search spring between parts` · `help cheatsheet` · `feature help hole` · `undo`

# Cheat sheet for AI agents – Mnástrojárna CAD

Full guide: https://www.mnastrojarna.cz/cad/schema-pro-ai.md · search: `help search tabs` · feature fields: `feature help hole`
Without a browser: `mncad run script.txt --out out` (`--strict`, `--formats step,pdf`, `--json`, `--timeout 300`, `--max-mem 2048`; Node 22, /cad/cli/) · in a browser `await window.mncad.run(text)`
Log MNCAD/1: ✗ error · ⚠ warning · ℹ note · = listing · D document · F file · O link. mm and °, Z up, `#` comment, lines and JSON can be mixed.
The commands of this sheet run one after another as one script (plate → pin → assembly → drawing); after “Elsewhere:” come independent samples.

## Documents and tabs
`new part "Plate"` · `new assembly "Tool"` · `tabs` · `tab "Plate"` (the next lines belong to it) – every part is a tab; an assembly inserts open tabs only (inserting again = another instance). Elsewhere: `close tab`
Large assembly: every part as a block `new part "…"`, then in the assembly tab `insert "…" at 100 0 0` for each instance; the assembly command lists the component count, bom the quantities.

## Part (tab “Plate”)
`box 100 60 12` · `sketch XY: rect 30 18 corner 60 36` · `constraint fixed e1.c0` · `dim length e1.s0 30` → `extrude 4 cut`
`fillet 2 edges vertical` · `chamfer 1 edges top` · `material 1.2379` · `variable t = 12` · edits: `edit "Fillet 1" radius=3` · `suppress "Chamfer 1"` · `delete last`
Elsewhere: `cylinder 20 30 at 50 30 12` · `sketch XZ: rect 10 30 corner 0 0` → `revolve 360 axis Z` · `pattern circular 6 axis Z at 50 30 0` · `mirror YZ` · `library M8x30` · `spring compression d 2 De 20 L0 50 n 8` (part from the table) · `undo` (between runs only – undoes a whole run, not a line)

## Holes and threads
`hole 21 depth 8 flat bottom at 25 30` · `hole 9 through at 50 10` · `hole thread M8 depth 10 at 50 50` · `hole 6.8 through at 10 10 counterbore 11 6.5` · `pattern 2 spacing 80 direction X` · `hole 16.5 through at 75 20` · `thread M18x1.5 length 12 at 75 20 12 internal`
Part check: `status` · `measure body` · `measure holes` · `check`

## Assembly (tab “Tool”)
`new part "Pin"` · `cylinder 20 30` · `material 1.0503` · `tab "Tool"` · `insert "Plate" at 0 0 0 fixed as "D1"` · `insert "Pin" at 25 30 40` · `assembly component #2 alias "K48" number "MN-2"` · `assembly component "D1" number "MN-1"` · `assembly` (components, count) · `assembly faces "K48"`
`assembly mate concentric "K48" Ø20 "D1" Ø21` · `assembly mate distance "K48" -Z "D1" top value 20` · `assembly mates` · `clash` · `bom` · `check assembly`. Elsewhere: `assembly mate contact "K48" -Z "D1" top`

## Springs and motion
`assembly spring new d 2 De 20 L0 35 n 6 between "D1" Ø21 "K48" bottom` (“all holes” at the end = into every hole of the pattern) · `assembly springs`
`motion motor linear mate 2 12..20 step 4 collisions` (mate 2 = Distance; no motor on a Contact mate) · `motion status` · `motion dynamics time 0.1 gravity -Z` · `motion mass "K48" 2.5` · `motion kinematics`
Bolt into a hole only after the dynamics (a free part would fall under gravity): `assembly bolt "D1" Ø9`. Elsewhere: `motion motor rotary "K48" 0..360 step 5`

## Drawing (part tab)
`tab "Plate"` · `drawing A3 scale 1:1 views front,top,iso` · `drawing section XZ offset -30` (plane Y = 30; without the offset it lies on the face) · `dimension smart functional 100` · `drawing tolerance 100 ±0.05` · `drawing tolerance Ø21 H7`
`drawing titleblock template=iso7200` · `drawing general ISO 2768-mK` · `drawing sheet new "Detail"` · `dimension none` · `drawing detail front at 25 8 radius 6` · `drawing status all` · `drawing export pdf all`. Elsewhere (assembly drawing): `drawing bom yes`

## Outputs and links
`save` · `export step` · `export script` · `share` · `link` (address again) · CLI `--formats step,pdf,dxf` and `--share`. Elsewhere (storage): `share days 30` · `export step link`

## 2D drawing
`2d new "Profile"` · `2d line 0,0 100,0 @0,50` · `2d circle 50,25 20` · `2d export dwg`

## Check against a reference
Elsewhere (input files, CLI --files): `compare "ref.step" tolerance 0.05` · `reference "customer.dwg"` · `reference check dimensions`

## Strict mode and help
`strict` (every ⚠ stops the run; CLI `--strict`) · `strict off` · `help search spring between parts` · `help cheatsheet` · `feature help hole`

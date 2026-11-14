/** Micro-guides – package "draft-io" (2D drawing, Output tab, DWG / DXF group), English. */

/** same shape as MicroTip in help/tips.ts (the integration replaces it with the import) */
type MicroTip = { what: string; when: string; select?: string; steps: string[]; cmd?: string; note?: string };

export default {
  "draft/io-open": {
    what: "Opens a DWG (R2000–R2018) or DXF (R12–R2018) drawing as a new 2D drawing in a new tab.",
    when: "A drawing from a customer or supplier made in AutoCAD, DraftSight, LibreCAD or a CAM program.",
    steps: ["Click Open DXF / DWG and choose the file.", "For a large file watch the progress; Cancel stops reading.", "What was converted differently is in the message and in DWG / DXF options."],
    cmd: "import",
    note: "Ctrl+O and dropping a file onto the window work the same way; XREFs are not loaded.",
  },
  "draft/io-insert": {
    what: "Inserts the content of another DWG / DXF into the open drawing – entities, missing layers, styles and blocks.",
    when: "Company frame and title block, a standard detail or a colleague's part into your own drawing.",
    steps: ["Click Insert drawing and choose the file.", "The inserted entities stay selected – move them with MOVE.", "Ctrl+Z undoes the whole insert in one step."],
    cmd: "import merge",
    note: "Layers and blocks with the same name follow the open drawing; other units are converted by scaling.",
  },
  "draft/io-export": {
    what: "Saves the drawing as DWG (R2000–R2018) or DXF (R12–R2018, also binary) with all layers, blocks and dimensions.",
    when: "Handing the drawing to a supplier, to AutoCAD, a laser or CNC; R12 for old CAM programs.",
    steps: ["Click Save as… (DWG / DXF group) and choose the format and version.", "The file is downloaded; the log shows the version and size."],
    cmd: "export dwg version R2013",
    note: "DXF R12 has no MTEXT, hatches or layouts – they are written simplified (warning in the log).",
  },
  "menu:io-export/*": {
    what: "Quick export in the chosen DXF or DWG version with a default name from the drawing.",
    when: "When the recipient needs a specific version, e.g. AutoCAD 2013 or an old program with R12 only.",
    steps: ["Pick the version in the menu – the file is downloaded at once."],
    cmd: "export dxf version R2000",
  },
  "draft/io-panel": {
    what: "Opens the DWG / DXF panel: format, version, binary DXF, file name, drawing units and the import report.",
    when: "When you want to fine-tune the export or see what was or was not converted when opening a file.",
    steps: ["Click DWG / DXF options.", "Choose format, version and name and confirm Export.", "Set the units (INSUNITS) before you pass the drawing on."],
    cmd: "export dxf version R2018 binary",
    note: "Changing the units does not rescale the geometry – it only states what the numbers mean.",
  },
} satisfies Record<string, MicroTip>;

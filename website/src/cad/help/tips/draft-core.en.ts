/** Mikronávody – jádro 2D výkresu (karty Kreslení, Úpravy, Hladiny, Poznámky, Výstup – tlačítka jádra), angličtina. Klíč = „draft/<id tlačítka pásu>“. */
// same shape as MicroTip in help/tips.ts (integrace přepne na import typu a zaregistruje balík)
type MicroTip = { what: string; when: string; select?: string; steps: string[]; cmd?: string; note?: string };

export default {
  // ── Draw ──
  "draft/line": {
    what: "Draws connected line segments – each segment is a separate entity.",
    when: "Part outlines, center lines and construction lines with exact points.",
    steps: ["Click or type the first point (x,y).", "Next points: @dx,dy relative, @length<angle polar.", "Undo removes a segment, Close joins to the start, Enter ends."],
    cmd: "2d line 0,0 100,0 100,50",
    note: "ORTHO (F8) and object snap (F3) make mouse drawing exact.",
  },
  "draft/pline": {
    what: "Draws a polyline of line and arc segments as one entity, optionally with width.",
    when: "Closed outlines for hatching, offsetting and filleting all corners at once.",
    steps: ["Specify the first point and further vertices.", "Arc switches to arcs, Line back; Width sets the thickness.", "Close joins the outline, Enter ends."],
    cmd: "2d pline 0,0 100,0 100,50 0,50 close",
  },
  "draft/circle": {
    what: "Draws a circle from center and radius or diameter, 2 or 3 points, or tangent to two objects.",
    when: "Holes, pins and bolt circles; TTR for a circle tangent to two edges.",
    steps: ["Click the center (snap to the intersection of center lines).", "Type the radius, or Diameter and the value.", "The arrow at the button offers 2 points, 3 points and TTR."],
    cmd: "2d circle 50,25 diameter 20",
  },
  "draft/arc": {
    what: "Draws a circular arc through three points or from center, start and end (counterclockwise).",
    when: "Rounded transitions, slot ends and arc segments of an outline.",
    steps: ["Specify the start, a point on the arc and the end.", "Or Center: center, start and end (counterclockwise angle)."],
    cmd: "2d arc center 60,0 75,0 45,0",
  },
  "draft/rect": {
    what: "Draws a rectangle as a closed polyline from two corners or from dimensions.",
    when: "Plates, frames and slots; with filleted or chamfered corners.",
    steps: ["Click the first corner.", "Second corner: click, @width,height or Dimensions.", "Set Fillet / Chamfer before the first corner."],
    cmd: "2d rectang 0,0 @100,50",
  },
  "draft/polygon": {
    what: "Draws a regular polygon inscribed in or circumscribed about a circle, or by edge length.",
    when: "Hexagon of a nut or bolt head, square, regular slots.",
    steps: ["Type the number of sides.", "Specify the center (or Edge and two points).", "Choose Inscribed / Circumscribed and the radius."],
    cmd: "2d polygon 6 0,0 circumscribed 6.5",
    note: "Circumscribed = radius to the middle of a side, i.e. half the wrench size.",
  },
  "draft/ellipse": {
    what: "Draws an ellipse or elliptical arc from an axis and the other half-axis, or from the center.",
    when: "Oblique views of holes, oval openings and elliptical slots.",
    steps: ["Specify both ends of the first axis.", "Specify the length of the other half-axis.", "The arrow at the button offers Center and Elliptical arc."],
    cmd: "2d ellipse -50,0 50,0 20",
  },
  "draft/spline": {
    what: "Draws a smooth NURBS curve through fit points or by control vertices.",
    when: "Free-form shapes, cams and profiles – transferred exactly to DWG / DXF.",
    steps: ["Click the points the curve passes through.", "Enter ends, Close creates a closed curve.", "The arrow switches the method: fit points / control vertices."],
    cmd: "2d spline 0,0 10,10 20,0 30,10",
  },
  "draft/xline": {
    what: "Draws an infinite construction line through a point and a direction (horizontal, vertical, angle, bisector).",
    when: "Projection lines between views and helper axes during construction.",
    steps: ["Choose the direction (Hor, Ver, Angle, Bisect) or click two points.", "Click the points the lines pass through; Enter ends."],
    cmd: "2d xline hor 0,50",
    note: "Put construction lines on their own layer – you can then turn them off with one click.",
  },
  "draft/ray": {
    what: "Draws a ray from a point in a given direction to infinity.",
    when: "Helper lines that must start at a specific point (projections, angles).",
    steps: ["Click the start point.", "Click direction points – each creates a ray; Enter ends."],
    cmd: "2d ray 0,0 100,100",
  },
  "draft/point": {
    what: "Inserts a point (node) that can be snapped with the Node snap.",
    when: "Coordinate marks, hole centers for CNC, points after dividing a curve.",
    steps: ["Click or type points; Enter ends."],
    cmd: "2d point 10,10 20,20",
    note: "The point style is set by PDMODE, e.g. 2d setvar pdmode 3.",
  },
  "draft/text": {
    what: "Inserts single-line text with height and rotation; each line is a separate entity.",
    when: "Short labels, item numbers and section markers.",
    steps: ["Click the start point (Justify changes the anchor).", "Specify the height and rotation.", "Type the text and press Enter."],
    cmd: '2d text 10,10 3.5 0 "Plate"',
    note: "Multiline formatted text: Annotate tab ▸ Multiline text.",
  },
  "draft/text2": {
    what: "Inserts single-line text with height and rotation; each line is a separate entity.",
    when: "Short labels, item numbers and section markers directly from the Annotate tab.",
    steps: ["Click the start point.", "Specify the height and rotation.", "Type the text and press Enter."],
    cmd: '2d text 10,10 3.5 0 "Section A-A"',
  },
  // ── Inquiry ──
  "draft/dist": {
    what: "Measures the distance between two points, the ΔX, ΔY increments and the angle; result in the log.",
    when: "Checking a size, a hole pitch or an edge distance without drawing a dimension.",
    steps: ["Click the first point (exact with object snap).", "Click the second point.", "Read the values in the command line."],
    cmd: "2d dist 0,0 100,50",
  },
  "draft/area": {
    what: "Calculates the area and perimeter of a region from points or a closed object.",
    when: "Part area for weight, cutting length, checking a burn-out part.",
    steps: ["Click the vertices of the region, Enter calculates.", "Or Object and click a circle, closed polyline or hatch."],
    cmd: "2d area 0,0 100,0 100,50",
  },
  "draft/id": {
    what: "Lists the X and Y coordinates of a point – exact with object snap.",
    when: "Reading the position of a hole center or an endpoint for a CNC program.",
    steps: ["Click the point (snap: endpoint, center, intersection…).", "The coordinates appear in the command line."],
    cmd: "2d id 25,40",
  },
  "draft/list": {
    what: "Lists object properties: type, layer, geometry, length and area.",
    when: "Quickly checking which layer an object is on and its exact values.",
    select: "Select objects beforehand or after starting.",
    steps: ["Select objects and press Enter.", "The listing is in the command line (F2 expands it)."],
    cmd: "2d list e1",
  },
  // ── Selection and core modify ──
  "draft/all": {
    what: "Selects all objects of the displayed space except on frozen and turned-off layers.",
    when: "Before moving, changing the layer of or erasing the whole content.",
    steps: ["Click Select all (Ctrl+A).", "Then start a command – the selection is used."],
    cmd: "2d select all",
  },
  "draft/none": {
    what: "Clears the current selection.",
    when: "When you want to start a command with a new selection.",
    steps: ["Click Clear selection or press Esc."],
    cmd: "2d select none",
  },
  "draft/erase": {
    what: "Erases the selected objects; objects on locked layers are skipped.",
    when: "Removing construction lines, old dimensions or wrongly drawn objects.",
    select: "Select objects beforehand (click, window, crossing) or after starting.",
    steps: ["Select the objects.", "Press Enter – erasing is one undo step."],
    cmd: "2d erase e3",
    note: "The Delete key erases the selected objects the same way.",
  },
  "draft/props": {
    what: "Opens the Properties panel: layer, color, linetype, lineweight and geometry of the selected objects.",
    when: "Moving objects to another layer, changing color or editing exact coordinates.",
    select: "Select one or more objects.",
    steps: ["Select the objects.", "Change a value in the panel – it is applied immediately."],
    cmd: "2d properties e1 layer OSY color 1",
  },
  // ── Layers ──
  "draft/lm": {
    what: "Opens the layer manager: new, rename, color, linetype, lineweight, on, freeze, lock, plot.",
    when: "Setting up the drawing layers (outline, center lines, dimensions, hatches) and their look.",
    steps: ["Click Layer manager.", "New layer, type the name and set color, linetype and lineweight.", "Click a row to make it current."],
    cmd: "2d layer new DRILLING color 1 linetype CENTER",
  },
  "draft/cur": {
    what: "Sets the current layer from the list – new objects are drawn on it.",
    when: "Before drawing center lines, dimensions or hatches on the right layer.",
    steps: ["Click the button and choose a layer from the list."],
    cmd: "2d layer current OSY",
    note: "A frozen layer cannot be current.",
  },
  "draft/mcur": {
    what: "Makes the layer of the selected object current.",
    when: "Continuing to draw on the same layer as an existing line.",
    select: "Select an object (or click it after starting).",
    steps: ["Select the object and click Current from object."],
    cmd: "2d laymcur e1",
  },
  "draft/loff": {
    what: "Turns off the layer of the selected objects – the objects disappear and do not plot.",
    when: "Temporarily hiding center lines, dimensions or construction lines.",
    select: "Select an object on the layer you want to turn off.",
    steps: ["Select the object.", "Click Turn off object's layer; turn it on in the layer manager."],
    cmd: "2d layer OSY off",
  },
  "draft/lfrz": {
    what: "Freezes the layer of the selected objects – not drawn, selected or included in extents.",
    when: "Large drawings: freezing speeds up work more than turning off.",
    select: "Select an object on the layer you want to freeze.",
    steps: ["Select the object.", "Click Freeze object's layer."],
    cmd: "2d layer OSY freeze",
    note: "The current layer cannot be frozen.",
  },
  "draft/llck": {
    what: "Locks the layer of the selected objects – they stay visible but cannot be edited or erased.",
    when: "Protecting a frame, an underlay or a finished outline from accidental changes.",
    select: "Select an object on the layer you want to lock.",
    steps: ["Select the object.", "Click Lock object's layer."],
    cmd: "2d layer OSY lock",
  },
  "draft/lall": {
    what: "Turns on and thaws all layers of the drawing.",
    when: "After checking with hidden layers – everything is visible again.",
    steps: ["Click Turn on and thaw all."],
    cmd: "2d layer * on",
  },
  "draft/lunl": {
    what: "Unlocks all layers of the drawing.",
    when: "Before editing objects that are on locked layers.",
    steps: ["Click Unlock all."],
    cmd: "2d layer * unlock",
  },
  // ── Linetypes ──
  "draft/ltload": {
    what: "Loads a linetype from the acadiso library (CENTER, HIDDEN, DASHED, PHANTOM…).",
    when: "Center lines (CENTER), hidden edges (HIDDEN) and adjacent parts (PHANTOM).",
    steps: ["Click Load linetype and choose a type.", "Assign it to a layer in the layer manager."],
    cmd: "2d linetype load CENTER HIDDEN",
  },
  "draft/lts": {
    what: "Sets the global linetype scale LTSCALE – the length of dashes and gaps.",
    when: "Dashed and center lines look solid (scale too small) or too sparse.",
    steps: ["Click the button and type the scale (e.g. 0.5).", "Press Enter."],
    cmd: "2d ltscale 0.5",
    note: "In layout viewports PSLTSCALE applies (2d setvar psltscale 1).",
  },
  "draft/lwt": {
    what: "Turns the on-screen display of lineweights (LWDISPLAY) on or off.",
    when: "Checking thick and thin lines before plotting.",
    steps: ["Click Show lineweights (also LINEWEIGHTS in the status bar)."],
    cmd: "2d lwdisplay on",
    note: "Plotting and PDF always use lineweights, regardless of this switch.",
  },
  // ── Output ──
  "draft/save": {
    what: "Saves the drawing as .mncad with all layers, blocks and layouts (Ctrl+S).",
    when: "Regularly saving your own work.",
    steps: ["Click Save .mncad or press Ctrl+S."],
    note: "For AutoCAD use the DWG / DXF group ▸ Save as….",
  },
  "draft/share": {
    what: "Creates a share link to the drawing – it opens in a browser without installation.",
    when: "Quickly passing a drawing to a colleague, customer or supplier for viewing.",
    steps: ["Click Share by link.", "Copy the link and send it."],
  },
} satisfies Record<string, MicroTip>;

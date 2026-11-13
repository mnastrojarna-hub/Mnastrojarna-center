/** Micro-guides – package "edit" (Tools, View, Data tabs, quick selection bar, Assembly tab – Insert, Standard parts, Move, Moulds), English. Keys and their list: src/cad/help/tips-manifest.ts. */
import type { MicroTip } from "../tips";

export default {
  // ── Tools › Analysis ──
  "tools/measure": {
    what: "Measures distance, angle, length or radius between points, edges, faces and bodies.",
    when: "Checking a dimension, hole pitch, wall thickness or face angle without a drawing.",
    select: "Nothing beforehand – you click the entities once measuring is on (filter in the Measurement panel).",
    steps: ["Switch on Measure, pick a filter in the panel (All, Point, Edge, Face, Body / shape).", "Click the first entity – it shows length, Ø or area.", "Click the second – distance and angle; New measurement starts over."],
    cmd: "measure F3 F7",
    note: "Hovering over an edge offers its end points, midpoint and circle centre.",
  },
  inspect: {
    what: "Turns the panel with data on the selected entity on and off: type, length, Ø, area, normal, coordinates.",
    when: "Quickly reading a hole Ø, edge length, face normal or component position.",
    select: "One entity clicked in the model (face, edge, point, body or component).",
    steps: ["Click an entity – a panel with its data appears at the bottom right.", "The Properties button turns the panel off; another click turns it back on."],
    cmd: "measure F3",
    note: "The panel is on from the start – the first click on the button turns it off.",
  },
  filter: {
    what: "Sets what a click in the 3D window selects: anything, face, edge, point, body, in an assembly a component.",
    when: "When a click picks a different entity than you want – e.g. an edge instead of a face.",
    steps: ["Open the Filter menu and choose the entity type.", "Click in the model; Ctrl+click adds or removes another entity."],
    note: "The same filter is in the status bar at the bottom and in the right-click menu on empty space.",
  },
  "menu:filter/all": {
    what: "Unrestricted selection: a point wins, then an edge, otherwise the face under the cursor.",
    when: "Everyday work – you get exactly what you point at.",
    steps: ["Choose All and click an entity in the model."],
  },
  "menu:filter/feature": {
    what: "Feature filter: a click in the 3D window selects the whole body, just like Body / shape.",
    when: "History features (hole, extrude…) are selected in the history tree on the left.",
    steps: ["Choose Feature.", "Open a feature by clicking it in the history tree on the left."],
    note: "Clicking in the model does not select an individual feature.",
  },
  "menu:filter/face": {
    what: "A click selects faces of the model only.",
    when: "Before Push / Pull, Draft, Shell, a sketch on a face or a face colour.",
    steps: ["Choose Face.", "Click a face; Ctrl+click adds more."],
  },
  "menu:filter/edge": {
    what: "A click selects edges of the model only.",
    when: "Before Fillet and Chamfer, when measuring an edge length.",
    steps: ["Choose Edge.", "Click an edge; Ctrl+click adds more."],
  },
  "menu:filter/vertex": {
    what: "A click selects only vertices (corners) of the body.",
    when: "Plane through three points, measuring from a corner, reading vertex coordinates.",
    steps: ["Choose Point.", "Click a corner of the body; Ctrl+click adds more."],
  },
  "menu:filter/body": {
    what: "A click selects the whole body (in an assembly, the component's body).",
    when: "Moving, hiding or making a body transparent, measuring the whole body.",
    steps: ["Choose Body / shape.", "Click anywhere on the body – in a part the body quick bar appears."],
  },
  "menu:filter/component": {
    what: "In an assembly a click selects a single part (component).",
    when: "Moving, mating, inspecting or removing one part of the assembly.",
    steps: ["Choose Component.", "Click a part – the component panel opens on the right; Ctrl+click adds more."],
    note: "Assembly only.",
  },
  "menu:filter/subasm": {
    what: "In an assembly a click selects the whole sub-assembly (top-level component).",
    when: "Moving, opening or dissolving a whole group of parts at once.",
    steps: ["Choose Sub-assembly.", "Click any part of the sub-assembly – the whole one is selected."],
    note: "Assembly only; a part outside a sub-assembly is selected on its own.",
  },
  mass: {
    what: "Shows mass, volume, surface area, bounding box and the number of faces and edges of the part.",
    when: "Mass for a quote or BOM, checking the volume, choosing the material.",
    steps: ["Click Mass.", "In the Material field choose the material (density), optionally the Material designation (title block).", "Read Mass, Volume, Surface and Dimensions (X × Y × Z)."],
    cmd: "measure body",
    note: "In an assembly the window does not open – the assembly mass is in the chip at the bottom and in the BOM.",
  },
  section: {
    what: "Cuts the model display with a plane – view only, the geometry does not change.",
    when: "Checking inner shapes: holes, pockets, wall thickness, how parts sit in an assembly.",
    steps: ["Switch on Section – the plane goes through the model centre, normal to Y.", "In the Section view panel choose X / Y / Z, Face or Vector.", "Set Position (mm) and Flip side; switch off with the Section button again."],
    cmd: "section Z 10",
    note: "Permanently cutting material off is done by Split on the Create tab.",
  },
  compare: {
    what: "Compares the part with a reference model: volume difference, missing and extra regions, deviation map.",
    when: "Checking a redrawn or modified part against the customer's STEP.",
    steps: ["Click Choose reference… and pick a STEP, BREP, IGES or mesh (STL…).", "Reference position: As is, Centres or Automatic; set Tolerance mm.", "Click Compare and go through the Difference regions."],
    note: "Part only. A mesh reference (STL, OBJ) has limited accuracy.",
  },

  // ── Tools › Parametrisation, Moulds ──
  vars: {
    what: "Shows where the part variables are – named dimensions that form fields can refer to.",
    when: "Parametric part: changing one dimension (d, t, L) recomputes the whole model.",
    steps: ["Click Variables and open the Variables tab in the left panel.", "+ Add variable: fill in the name and Expression (e.g. d*2).", "In a feature field type =d or an expression (e.g. =d/2+3)."],
    cmd: "variable d = 20",
    note: "The button does not switch the tab itself, it only shows a message. An assembly has no Variables tab.",
  },
  cfg: {
    what: "Shows where the part configurations are – variants with other variable values and suppressed features.",
    when: "One part in several versions: M8 / M10, with and without holes, different lengths.",
    steps: ["Click Part configurations and open the Configurations tab in the left panel.", "+ New configuration from current values, expand it, edit values and Suppressed features.", "Activate a configuration with its radio button; Default restores the original values."],
    cmd: 'config "Short" t=10',
    note: "Configurations change variables – create those first. An assembly has no Configurations tab.",
  },
  moldtools: {
    what: "Opens the mould design panel: drafts and undercuts, face analysis, shrinkage, ejector pins, cooling.",
    when: "Preparing a plastic or cast part for a mould – checking demouldability and designing the mould.",
    steps: ["Drafts: switch on Draft colour map, set Ejection direction and Min. draft.", "Shrinkage: choose a material or value and click Apply shrinkage.", "Ejector pins: Holes into the part / Ejector pins into the assembly; Cooling: Drill into the part."],
    cmd: "analyze draft dir +Z min 1 show",
    note: "Only in a part with a body. Shrinkage is added to the history as a scale.",
  },

  // ── View › Views ──
  iso: {
    what: "Turns the view to isometric (obliquely from above) and fits the model to the window.",
    when: "Overview of the model, a picture for a quote, returning after working in another view.",
    steps: ["Click Isometric – the camera turns and the model fits the window."],
    cmd: "view iso",
  },
  front: {
    what: "View from the front (from −Y) onto the XZ plane – front elevation; the model fits the window.",
    when: "Checking the profile, heights and shoulders as in a drawing's front view.",
    steps: ["Click Front."],
    cmd: "view front",
    note: "Without perspective distortion: switch to Camera › Orthographic.",
  },
  top: {
    what: "View from above (from +Z) onto the XY plane – plan view; the model fits the window.",
    when: "Layout of holes, pockets and the plate outline as in a plan view.",
    steps: ["Click Top."],
    cmd: "view top",
    note: "Without perspective distortion: switch to Camera › Orthographic.",
  },
  right: {
    what: "View from the right (from +X) onto the YZ plane – side view; the model fits the window.",
    when: "Checking the side of the part, cross holes and grooves.",
    steps: ["Click Right."],
    cmd: "view right",
    note: "Without perspective distortion: switch to Camera › Orthographic.",
  },
  back: {
    what: "View from the back (from +Y), opposite to the Front view.",
    when: "Checking the back of the part that you cannot see from the front.",
    steps: ["Click Back."],
    cmd: "view back",
  },
  bottom: {
    what: "View from below (from −Z), opposite to the Top view.",
    when: "Checking the bottom face: holes from below, chamfers, seating faces.",
    steps: ["Click Bottom."],
    cmd: "view bottom",
  },
  left: {
    what: "View from the left (from −X), opposite to the Right view.",
    when: "Checking the left side of the part.",
    steps: ["Click Left."],
    cmd: "view left",
  },

  // ── View › Display style ──
  shadedEdges: {
    what: "Shaded faces with drawn edges – the default style for modelling.",
    when: "Everyday work: you see the shape and the edges to select.",
    steps: ["Click Shaded with edges – the style switches at once."],
    cmd: "view edges",
    note: "The chosen style is remembered even after closing the program.",
  },
  shaded: {
    what: "Shaded faces only, without edge lines.",
    when: "Presentations, screenshots, judging the shape and smoothness of faces.",
    steps: ["Click Shaded."],
    cmd: "view shaded",
  },
  wireframe: {
    what: "Model edges only, no faces – you also see the edges on the far side.",
    when: "Finding inner holes and channels, orientation in a complex shape.",
    steps: ["Click Wireframe; go back e.g. with Shaded with edges."],
    cmd: "view wireframe",
  },
  hiddenLine: {
    what: "White faces with edges, hidden edges are not drawn – looks like a drawing.",
    when: "Checking outlines as in a drawing, a clean picture for printing.",
    steps: ["Click Hidden edges."],
    cmd: "view hidden",
  },
  xray: {
    what: "Transparent faces with edges – you see inside the body and the assembly.",
    when: "Inner channels, holes and inserts; parts hidden inside an assembly.",
    steps: ["Click Transparent; go back with Shaded with edges."],
    cmd: "view xray",
  },

  // ── View › Camera ──
  fit: {
    what: "Zooms and centres the whole model in the window; the viewing direction stays.",
    when: "The model ran off the screen or is too small or too large after an import.",
    steps: ["Click Fit."],
    cmd: "view fit",
  },
  persp: {
    what: "Perspective projection – distant parts get smaller, as in reality.",
    when: "Natural look of the model, presentations, walking through an assembly.",
    steps: ["Click Perspective – the choice is saved in the settings."],
    note: "Parallel edges converge – use Orthographic to check the shape.",
  },
  ortho: {
    what: "Orthographic (parallel) projection without distortion – parallel edges stay parallel.",
    when: "Checking in Front, Top, Right views as in a drawing; aligning edges.",
    steps: ["Click Orthographic; the keyboard shortcut toggles between both projections."],
    note: "The choice is saved and applies after the next start too.",
  },
  "view/grid": {
    what: "Shows or hides the grid and coordinate axes in the 3D window.",
    when: "Orientation in space, checking the part position relative to the origin.",
    steps: ["Click Grid and axes; another click hides them."],
    note: "Valid only until the program is closed – after start-up the grid is off.",
  },

  // ── View › Appearance ──
  color: {
    what: "Sets the body colour of the part – steel, aluminium, brass, cast iron or signal colours.",
    when: "Telling parts apart on screen and in pictures; the colour is saved with the part.",
    steps: ["Open the Body colour menu.", "Click a colour – the body is recoloured at once (Ctrl+Z undoes)."],
    cmd: "color #b9c2cc",
    note: "The colour changes neither material nor mass. In an assembly each component has its own colour (component panel).",
  },
  "menu:color/*": {
    what: "Colours the body of the part with this colour.",
    when: "Quickly telling a part or material apart on screen.",
    steps: ["Click the colour – the change is saved in the part, Ctrl+Z undoes it."],
    cmd: "color #b9c2cc",
    note: "Appearance only – the material for the mass is chosen separately (Mass, left panel).",
  },
  bg: {
    what: "Changes the 3D window background: blue-grey gradient, light, graphite or white.",
    when: "Better contrast while working, white background for pictures and printing.",
    steps: ["Open the Background menu and click a variant."],
    note: "The choice is saved in the program settings (Settings › View).",
  },
  "menu:bg/*": {
    what: "Sets this background of the 3D window.",
    when: "Graphite for a dark environment, White (print) for pictures in documentation.",
    steps: ["Click the variant – the background changes at once and is remembered."],
  },
  mouse: {
    what: "Switches mouse view control to the CAD you are used to – ZW3D, SolidWorks or touchpad.",
    when: "Right at the start, so that rotating and panning work as in your CAD.",
    steps: ["Open the Mouse controls menu and choose a scheme."],
    note: "The wheel always zooms; more options are in Settings › Mouse & controls.",
  },
  "menu:mouse/zw3d": {
    what: "ZW3D scheme: right button rotates, middle button pans, wheel zooms.",
    when: "You are used to ZW3D; a right click without dragging opens the menu.",
    steps: ["Choose ZW3D – it applies at once and stays saved."],
  },
  "menu:mouse/solidworks": {
    what: "SolidWorks / Inventor scheme: middle button rotates, Ctrl+middle pans.",
    when: "You are used to SolidWorks or Inventor.",
    steps: ["Choose SolidWorks – it applies at once and stays saved."],
  },
  "menu:mouse/simple": {
    what: "Touchpad scheme: left button rotates, right button pans, wheel zooms.",
    when: "A laptop without a mouse with a middle button.",
    steps: ["Choose Touchpad – it applies at once and stays saved."],
  },

  // ── Data › Program ──
  settings: {
    what: "Opens the program settings: language, units, view, mouse, sketch, drawing, files, shortcuts.",
    when: "Adapting the program – default material, display style, shortcuts, saving without a dialog.",
    steps: ["Pick an area on the left (General, View, Mouse & controls…).", "Change options; Restore defaults resets all, Export / Import saves the settings as JSON.", "Confirm OK."],
    note: "These micro-guides are switched off under General (Micro-guides on icons).",
  },
  palette: {
    what: "Opens a search over all commands – type part of the name and run it with Enter.",
    when: "When you do not know which tab a command is on, or want to work without the mouse.",
    steps: ["Type e.g. hole, drawing or fillet.", "Pick the command with the arrow keys and press Enter; Esc closes the palette."],
  },
  start: {
    what: "Shows the start screen: new part, assembly, drawing, opening a file, samples.",
    when: "Starting new work or quickly opening a sample model.",
    steps: ["Choose an action under Start or a model under Sample models.", "Continue working closes the screen."],
    note: "Showing it at launch is switched off in Settings › General.",
  },

  // ── Data › File ──
  open: {
    what: "Opens a .mncad project or imports STEP, IGES, BREP, STL, OBJ, 3MF, glTF, PLY or DXF.",
    when: "A model from a customer, a project in progress, a DXF drawing as a sketch underlay.",
    steps: ["Click Open / Import and choose one or more files.", "Each model opens in its own tab; a DXF is loaded as a sketch."],
    note: "In an assembly a part or model is inserted as a component. Files can also be dragged into the window.",
  },
  save: {
    what: "Saves the whole project (.mncad) including the feature history, sketches and import data.",
    when: "Saving work regularly; later open the file via Open / Import.",
    steps: ["The first time choose the location and file name.", "Further saves write to the same file without asking."],
    note: "Without a dialog (straight to Downloads): Settings › Files, switch off asking for location and name.",
  },
  saveAs: {
    what: "Saves the project under a new name or in another location (.mncad).",
    when: "A part variant, a backup before a big change, a copy for the customer.",
    steps: ["Choose the location and file name and confirm.", "From then on Save project writes to this new file."],
  },

  // ── Data › Export 3D ──
  export: {
    what: "Exports the model to STEP, BREP, STL, 3MF, OBJ, glTF or VRML.",
    when: "Passing the model to another CAD, to CAM, to 3D printing or for visualisation.",
    steps: ["Open the Export menu and choose the format.", "Choose the location and file name – only then is the export computed."],
    note: "Use STEP for other CAD and CAM. Features with a warning in the history slow the export down or spoil it.",
  },
  "menu:export/step": {
    what: "Saves the exact geometry as STEP AP214 – the standard for exchange between CAD systems.",
    when: "Passing to ZW3D, SolidWorks, Inventor, CATIA, Creo or CAM for machining.",
    steps: ["Click STEP AP214, choose location and name; wait for the Export finished message."],
    note: "Invalid geometry (a feature with a warning in the history) can slow down or spoil the STEP export.",
  },
  "menu:export/brep": {
    what: "Saves the exact geometry in the native format of the OpenCascade kernel (.brep).",
    when: "Exchange with programs built on OpenCascade (e.g. FreeCAD), archiving the exact shape.",
    steps: ["Click OpenCascade BREP, choose the location and file name."],
  },
  "menu:export/stl": {
    what: "Saves the model as an STL triangle mesh (no units, no colours).",
    when: "3D printing, a quick preview in mesh viewers.",
    steps: ["Click STL, choose the location and file name."],
    note: "A mesh can no longer be edited exactly – send STEP to other CAD systems.",
  },
  "menu:export/3mf": {
    what: "Saves the mesh in 3MF format – with units (mm), suited to 3D printing.",
    when: "Modern 3D printing slicers (PrusaSlicer, Cura, Bambu Studio).",
    steps: ["Click 3MF, choose the location and file name."],
  },
  "menu:export/obj": {
    what: "Saves the mesh as Wavefront OBJ.",
    when: "Visualisation and rendering programs.",
    steps: ["Click Wavefront OBJ, choose the location and file name."],
  },
  "menu:export/glb": {
    what: "Saves the model as binary glTF (.glb) – a light format for the web, AR and presentations.",
    when: "Previewing the model on the web, on a phone or in a presentation.",
    steps: ["Click glTF binary, choose the location and file name."],
  },
  "menu:export/wrl": {
    what: "Saves the mesh in VRML format (.wrl).",
    when: "Older viewers and programs that cannot read newer formats.",
    steps: ["Click VRML, choose the location and file name."],
  },

  // ── Data › Assembly, Samples ──
  asm: {
    what: "Creates an assembly: empty, from the current part, or an injection mould base.",
    when: "When you build a whole from parts – a fixture, a mould, a tool.",
    steps: ["Open the Assembly menu and choose a variant."],
    cmd: "new assembly",
  },
  "menu:asm/na": {
    what: "Opens a new empty assembly in a new tab.",
    when: "Starting an assembly into which you insert parts, standard parts and mates.",
    steps: ["Click New empty assembly.", "On the Assembly tab insert parts (Insert part / model, Standard parts library)."],
    cmd: "new assembly Mould",
  },
  "menu:asm/nc": {
    what: "Opens a new assembly in a new tab with the current part as a fixed component.",
    when: "A part to which you want to add screws, a mating part or a fixture.",
    steps: ["Click Assembly from the current part.", "On the Assembly tab add further parts and mates."],
    note: "The part is inserted as a copy – keep editing it in the assembly via Edit part (in context).",
  },
  "menu:asm/mold": {
    what: "Opens the injection mould base wizard: plates, spacers, ejector set, pillars with bushes.",
    when: "Quickly designing a mould base around a cavity insert.",
    steps: ["Enter Width X, Length Y, plate thicknesses and Ø guide pillars.", "Optionally Cavity in plate A and Plate material.", "Click Create mould base."],
    cmd: "moldbase 246 296",
    note: "The base replaces the content of the current tab (Ctrl+Z undoes) – open an empty one first.",
  },
  ex: {
    what: "Opens a sample part in a new tab – flange, shaft, bracket, handle, pin, transition piece.",
    when: "Getting to know the program, an example workflow (sweep, thread, configurations, loft).",
    steps: ["Open the Sample parts menu and click a sample.", "Look through the history on the left – features can be opened and changed."],
  },
  "menu:ex/*": {
    what: "Opens this sample part in a new tab, with its whole feature history.",
    when: "An example of how the part is built; a starting point for your own changes.",
    steps: ["Click the sample – it opens in a new tab.", "Click a feature in the history on the left to open its parameters."],
    note: "Your document in progress stays in its original tab.",
  },

  // ── Quick selection bar (part) ──
  "quick/sk": {
    what: "Starts a new sketch directly on the clicked planar face.",
    when: "A pocket, boss or holes on a face of a finished body.",
    select: "A planar face – the bar appears after clicking a face in a part.",
    steps: ["Click a planar face.", "In the bar choose New sketch on face, draw the outline and Finish sketch."],
    cmd: "sketch face top: circle 20",
    note: "A sketch cannot be started on a curved face.",
  },
  "quick/pp": {
    what: "Opens Push / Pull with the clicked face – moves it along its normal.",
    when: "Quick size change without history: lengthen, thin, level a wall.",
    select: "A planar face – the bar appears after clicking it; add more in the form.",
    steps: ["Click the face and choose Push / Pull in the bar.", "End condition: Blind (+ out, − in), Up to vertex or Up to face.", "Confirm OK."],
    cmd: "feature pushPull distance=5 faces=top",
  },
  "quick/of": {
    what: "Opens Offset face with the clicked face – also a curved or cylindrical one.",
    when: "Machining allowance, enlarging or reducing a hole, adjusting a fit.",
    select: "A face – the bar appears after clicking it; add more in the form.",
    steps: ["Click the face and choose Offset face in the bar.", "Enter the Offset (+ out, − in).", "Confirm OK."],
    cmd: "feature offsetFace distance=0.5 faces=cylindrical",
    note: "Offsetting a hole wall by +0.5 mm makes the hole smaller.",
  },
  "quick/df": {
    what: "Opens Delete face with the clicked face – the body is healed.",
    when: "Removing a hole, fillet or pin from an imported model without history.",
    select: "A face – the bar appears after clicking it; add more in the form.",
    steps: ["Click the face (e.g. a hole wall) and choose Delete face.", "Check the face list and confirm OK."],
    cmd: "feature deleteFace faces=cylindrical",
    note: "Only what the surrounding faces can close is healed – otherwise the feature reports an error.",
  },
  "quick/fi": {
    what: "Opens Fillet with the clicked edge.",
    when: "Quickly filleting an edge without looking for the ribbon button.",
    select: "A body edge – the bar appears after clicking an edge in a part.",
    steps: ["Click the edge and choose Fillet edge in the bar.", "Enter the Radius; add more edges by clicking them in the model.", "Confirm OK."],
    cmd: "fillet 2 edges vertical",
  },
  "quick/ch": {
    what: "Opens Chamfer with the clicked edge.",
    when: "Quickly chamfering an edge for assembly or deburring.",
    select: "A body edge – the bar appears after clicking an edge in a part.",
    steps: ["Click the edge and choose Chamfer edge in the bar.", "Choose the Chamfer type and enter the size; add more edges by clicking.", "Confirm OK."],
    cmd: "chamfer 1 edges top",
  },
  "quick/meas": {
    what: "Starts measuring with the clicked entity as the first one – just click the second.",
    when: "Edge length, distance from a vertex, body dimensions with one click.",
    select: "An edge, vertex or body – the bar appears after clicking in a part.",
    steps: ["Click the entity and choose Measure in the bar.", "Click the second entity – the Measurement panel shows distance and angle."],
    cmd: "measure E5 F3",
    note: "End measuring with the Esc key or the panel's cross.",
  },
  "quick/props": {
    what: "Opens the Properties panel with data on the clicked entity.",
    when: "Type and length of an edge, Ø of an arc, coordinates of a vertex.",
    select: "An edge or vertex (for a face or body the option is under ⋯).",
    steps: ["Click an edge or vertex and choose Properties in the bar."],
    cmd: "measure E5",
  },
  "quick/co": {
    what: "Shows the X ; Y ; Z coordinates of the clicked vertex right on the button.",
    when: "Quickly reading a corner position for a hole, sketch or dimension.",
    select: "A vertex (filter All or Point) – the bar appears after clicking it.",
    steps: ["Click the vertex and read the coordinates on the button.", "Clicking the button refreshes the data in the Properties panel."],
    cmd: "measure V2",
    note: "The values on the button are rounded to 2 decimal places.",
  },
  "quick/mv": {
    what: "Adds a Move / rotate feature and shows a gizmo to move and rotate the whole body.",
    when: "Aligning an imported model, turning the part into its machining position.",
    select: "The body (filter Body / shape) – the bar appears after clicking it.",
    steps: ["Click the body and choose Move / rotate (gizmo) in the bar.", "Drag the arrows (1 mm steps) or arcs (15°); R toggles move/rotate.", "Click Done."],
    cmd: "feature transform translate=10;0;0",
    note: "If the last history feature is already Move / rotate, that one is edited.",
  },
  "quick/hd": {
    what: "Hides the whole body of the part, or shows it again – display only, the model does not change.",
    when: "Looking at sketches, datum planes and axes hidden inside the body.",
    select: "The body (filter Body / shape).",
    steps: ["Click the body and choose Hide body in the bar."],
    note: "A hidden body cannot be clicked, so this bar cannot show it again.",
  },
  "quick/tr": {
    what: "Switches the body to semi-transparent and back to opaque – display only.",
    when: "Looking at inner holes and channels without changing the display style.",
    select: "The body (filter Body / shape).",
    steps: ["Click the body and choose Transparent in the bar; back with Opaque."],
    note: "For the whole model at once use the Transparent style on the View tab.",
  },

  // ── Assembly › Insert ──
  ins: {
    what: "Inserts a .mncad part or a STEP, IGES, STL… model from a file into the assembly as a component.",
    when: "Assembling from finished parts, bought-in parts from a supplier in STEP.",
    steps: ["Click Insert part / model and choose a file.", "Place the component with Move / rotate or with mates."],
    cmd: 'insert "Plate" at 100 0 0',
    note: "An assembly file (.mncad) is not inserted but opened in a new tab.",
  },
  "asm/library": {
    what: "Opens the standard parts library – screws, nuts, bearings, pins, gears, profiles, mould standard parts.",
    when: "Standard parts into the assembly without drawing them.",
    steps: ["Type the designation (e.g. M8x30, bearing 6205, ejector pin 6x160) or pick a category.", "Check the dimensions and click Insert into assembly."],
    cmd: "library M8x30",
    note: "Open as a new part opens it in a new tab instead of inserting it.",
  },
  newpart: {
    what: "Adds a new empty part to the assembly and opens it right away for modelling in the assembly context.",
    when: "A part designed to fit the surrounding parts – a plate, an insert, a fixture.",
    steps: ["Click New part – the Create tab opens with the Editing part bar.", "Model the part (sketch, extrude…).", "Click ← Back to assembly."],
  },

  // ── Assembly › Standard parts ──
  screw: {
    what: "Inserts an ISO 4762 socket head cap screw M6–M16, 20, 40 or 60 mm long, into the assembly.",
    when: "Screw joints of mould plates, fixtures or tools.",
    steps: ["Open the ISO 4762 screw menu and choose the size.", "Place the screw with Move / rotate or with a Centre mate into the hole."],
    cmd: "library M8x40",
    note: "The screw is simplified, without a thread. Other sizes are in the Standard parts library.",
  },
  "menu:screw/*": {
    what: "Inserts an ISO 4762 screw of this size (thread × length in mm) as a component.",
    when: "Quickly inserting a common screw without opening the library.",
    steps: ["Click the size – the screw is inserted next to the model (into an empty assembly at the origin)."],
    cmd: "library M8x40",
    note: "The head lies on the XY plane, the shank points to −Z.",
  },
  pillar: {
    what: "Inserts a collared guide pillar Ø16–Ø40, length 5 × Ø.",
    when: "Guiding the plates of a mould or a blanking tool.",
    steps: ["Open the Guide pillar menu and choose Ø × length.", "Place it with Move / rotate or with a Centre mate into the hole."],
    cmd: "library guide pillar 20x100",
    note: "It goes into the group Guides; its counterpart is the Guide bush of the same Ø.",
  },
  "menu:pillar/*": {
    what: "Inserts a guide pillar of this size (Ø × length) into the group Guides.",
    when: "Quickly inserting a pillar without opening the library.",
    steps: ["Click the size – the pillar is inserted as a component."],
    cmd: "library guide pillar 20x100",
  },
  bush: {
    what: "Inserts a collared guide bush for a pillar Ø16–Ø40, length 2 × Ø.",
    when: "Counterpart of the guide pillar in the other mould plate.",
    steps: ["Open the Guide bush menu and choose Ø × length.", "Place it coaxial with the pillar (Move / rotate or a Centre mate)."],
    cmd: "library guide bush 20x40",
    note: "It goes into the group Guides.",
  },
  "menu:bush/*": {
    what: "Inserts a guide bush of this size (Ø × length) into the group Guides.",
    when: "Quickly inserting a bush without opening the library.",
    steps: ["Click the size – the bush is inserted as a component."],
    cmd: "library guide bush 20x40",
  },
  pin: {
    what: "Inserts an ejector pin with a cylindrical head Ø3–Ø10, shank length 150 mm.",
    when: "Ejecting the moulding; positions are suggested by Mould tools in the part.",
    steps: ["Open the Ejector pin menu and choose the diameter.", "Place it with Move / rotate or with a Centre mate."],
    cmd: "library ejector pin 6x150",
    note: "It goes into the group Ejection.",
  },
  "menu:pin/*": {
    what: "Inserts an ejector pin of this diameter, shank length 150 mm, into the group Ejection.",
    when: "Quickly inserting an ejector pin without opening the library.",
    steps: ["Click the size – the ejector pin is inserted as a component."],
    cmd: "library ejector pin 6x150",
  },
  ring: {
    what: "Inserts a locating ring Ø100 × 10 mm (inner Ø36) as a component.",
    when: "Centring the mould on the clamping plate of the injection moulding machine.",
    steps: ["Click Locating ring – it is inserted as a component.", "Seat it on the clamping plate (Move / rotate or a Contact mate)."],
    cmd: "library locating ring 100",
    note: "Other diameters (90–160 mm) are in the Standard parts library.",
  },

  // ── Assembly › Move ──
  gz: {
    what: "Moves or rotates the selected component with a gizmo; mates are recomputed after the move.",
    when: "Rough placement of a part before mating, moving a part out of a collision.",
    select: "A component in the assembly tree or in the model.",
    steps: ["Select the component and click Move / rotate.", "Drag the arrows (1 mm steps) or arcs (15°); R toggles move/rotate.", "Click Done."],
    cmd: 'assembly component "Pin" move 10 0 0',
    note: "A fixed component has to be released first.",
  },
  "asm/delete": {
    what: "Removes the selected components from the assembly.",
    when: "Tidying up the assembly, replacing a part with another variant.",
    select: "Components in the model (filter Component, Ctrl+click) or a component in the tree.",
    steps: ["Select the components.", "Click Remove and confirm the question."],
    cmd: 'assembly remove "Pin"',
    note: "Ctrl+Z undoes the removal; the confirmation is switched off in Settings › General.",
  },
  sub: {
    what: "Groups components into a sub-assembly, dissolves it or opens it for editing.",
    when: "A unit that moves or repeats as a whole – guiding, ejector set.",
    steps: ["Open the Sub-assembly menu.", "Choose Create from selected, Dissolve selected or Open selected."],
    cmd: 'assembly subassembly "A" "B" as "Guide"',
  },
  "menu:sub/mk": {
    what: "Creates a new sub-assembly (Sub-assembly 1, 2…) from the components selected in the model.",
    when: "Grouping the parts of a unit so they move as a whole.",
    select: "Components clicked in the model (filter Component, Ctrl+click).",
    steps: ["Ctrl+click the components in the 3D window.", "Choose Create from selected (Ctrl+click)."],
    cmd: 'assembly subassembly "A" "B"',
    note: "Only the selection in the 3D window counts – a component selected only in the tree does not.",
  },
  "menu:sub/dis": {
    what: "Dissolves the selected sub-assembly – its components go back directly into the assembly.",
    when: "Cancelling a grouping, moving a part out of a sub-assembly.",
    select: "A sub-assembly (filter Sub-assembly or in the tree).",
    steps: ["Select the sub-assembly.", "Choose Dissolve selected."],
    cmd: 'assembly dissolve "Guide"',
  },
  "menu:sub/open": {
    what: "Opens the selected sub-assembly for editing in the same tab (Editing sub-assembly bar).",
    when: "Adding, moving or mating parts inside a sub-assembly.",
    select: "A sub-assembly (filter Sub-assembly or in the tree).",
    steps: ["Select the sub-assembly and choose Open selected.", "Edit the components and click ← Back to assembly."],
    cmd: 'assembly edit "Guide"',
  },

  // ── Assembly › Moulds ──
  mold: {
    what: "Opens the injection mould base wizard: clamping and cavity plates, spacers, ejector set, pillars.",
    when: "Designing a two-plate mould around a cavity insert.",
    steps: ["Enter Width X, Length Y, plate thicknesses and Ø guide pillars.", "Optionally Cavity in plate A and Plate material.", "Click Create mould base."],
    cmd: "moldbase 246 296",
    note: "The base replaces the content of the current tab (Ctrl+Z undoes) – add inserts afterwards.",
  },
} satisfies Record<string, MicroTip>;

/** Micro-guides – package "create" (Create tab), English. Keys and their list: src/cad/help/tips-manifest.ts. */
import type { MicroTip } from "../tips";

export default {
  // ── Sketch ──
  sketch: {
    what: "Starts a 2D sketch on a plane or planar face – the base for extrude, revolve, sweep and rib.",
    when: "At the start of every shape: part outline, pocket, sweep path, rib line.",
    steps: ["Click Sketch and choose a plane or face in the menu.", "On the Sketch tab draw the outline, add constraints and dimensions.", "Confirm Finish sketch – Extrude opens straight away."],
    cmd: "sketch XY: rect 60 40",
    note: "For an extrusion draw a closed outline without overlaps or gaps.",
  },
  "menu:sketch/xy": {
    what: "Starts a sketch on the base plane XY (top view).",
    when: "Part plan: plate, flange, pocket outline extruded along Z.",
    steps: ["Choose Plane XY (top).", "Draw the outline and confirm Finish sketch."],
    cmd: "sketch XY: circle 50",
  },
  "menu:sketch/xz": {
    what: "Starts a sketch on the base plane XZ (front view).",
    when: "Profile seen from the front – e.g. half a shaft for a revolve, a rail profile.",
    steps: ["Choose Plane XZ (front).", "Draw the profile and confirm Finish sketch."],
    cmd: "sketch XZ: circle 50",
  },
  "menu:sketch/yz": {
    what: "Starts a sketch on the base plane YZ (side view).",
    when: "Profile seen from the side – side cut-out, rib along X.",
    steps: ["Choose Plane YZ (side).", "Draw the profile and confirm Finish sketch."],
    cmd: "sketch YZ: circle 50",
  },
  "menu:sketch/face": {
    what: "Starts a sketch directly on a planar face of the model (origin and X direction taken from the face).",
    when: "Pocket, boss or holes on the top or side face of an existing body.",
    select: "After choosing, click a planar face of the model.",
    steps: ["Choose On a planar face of the model….", "Click a planar face, draw the outline, Finish sketch."],
    cmd: "sketch face top: circle 20",
    note: "A curved face defines no plane – pick a planar one or use Plane (Reference).",
  },
  "menu:sketch/xyo": {
    what: "Starts a sketch on a plane parallel to XY, offset by a given distance along Z.",
    when: "Outline at a height: top pocket, second loft profile, boss above a plate.",
    steps: ["Choose XY with offset….", "Enter the offset in mm (an expression such as 25/2 works) and confirm.", "Draw the outline and confirm Finish sketch."],
    cmd: "sketch XY offset 20: circle 30",
  },
  "menu:sketch/xzo": {
    what: "Starts a sketch on a plane parallel to XZ, offset by a given distance along Y.",
    when: "Profile in front of or behind the base plane – second loft profile, front pocket.",
    steps: ["Choose XZ with offset….", "Enter the offset in mm and confirm.", "Draw the outline and confirm Finish sketch."],
    cmd: "sketch XZ offset 20: circle 30",
  },
  "menu:sketch/yzo": {
    what: "Starts a sketch on a plane parallel to YZ, offset by a given distance along X.",
    when: "Side profile away from the part centre, a cut at a given X position.",
    steps: ["Choose YZ with offset….", "Enter the offset in mm and confirm.", "Draw the outline and confirm Finish sketch."],
    cmd: "sketch YZ offset 20: circle 30",
  },
  "menu:sketch/faceOff": {
    what: "Starts a sketch on a plane parallel to the selected planar face, at a given distance.",
    when: "Outline slightly above or below a face – shoulder, step, second profile.",
    select: "Exactly 1 planar face (selection filter Face).",
    steps: ["Select a planar face.", "Choose Parallel to the selected face… and enter the distance.", "Draw the outline and confirm Finish sketch."],
  },
  "menu:sketch/mid": {
    what: "Starts a sketch on the mid-plane between two selected faces.",
    when: "Symmetric features: rib in the middle of a wall, slot in the part centre.",
    select: "Exactly 2 faces (selection filter Face, Ctrl+click).",
    steps: ["Select 2 faces.", "Choose Mid-plane between 2 faces and draw."],
  },
  "menu:sketch/pts": {
    what: "Starts a sketch on the plane through three selected vertices.",
    when: "Inclined plane defined by model corners – bevel, inclined cut-out.",
    select: "Exactly 3 vertices (selection filter Point, Ctrl+click).",
    steps: ["Switch the selection filter to Point and select 3 vertices.", "Choose Through three points and draw."],
    note: "The vertices must not lie on one straight line.",
  },
  "menu:sketch/*": {
    what: "Starts a sketch on this datum plane from the history.",
    when: "Plane in a general position – inclined, rotated or offset from another feature.",
    steps: ["Choose the datum plane by name.", "Draw the outline and confirm Finish sketch."],
    note: "Create a datum plane with the Plane button in the Reference group.",
  },

  // ── Shape ──
  extrude: {
    what: "Extrudes a closed sketch profile into 3D – adds or removes material.",
    when: "Basic part shape from a 2D profile, pocket, boss, through cut-out.",
    select: "A sketch with a closed profile (the last one is preset; change it in Profile (sketch)).",
    steps: ["Check the profile in Profile (sketch).", "End condition (direction 1): Blind, Through all, Up to face… and length.", "Operation: Add / Remove / Intersect, confirm OK."],
    cmd: "extrude 10",
    note: "Needs a sketch. An open outline extrudes only with the Thin wall option.",
  },
  revolve: {
    what: "Revolves a sketch profile about an axis – turned parts such as shafts, flanges, pins.",
    when: "Turned shapes: stepped shaft, disc, ring; with Remove a groove or recess.",
    select: "A sketch with half the profile on one side of the axis (default axis = sketch Y axis).",
    steps: ["Choose the sketch in Profile (sketch) and the axis in Revolve axis.", "Enter the Angle (360° = full turn) and the Direction.", "Operation: Add or Remove, confirm OK."],
    cmd: "revolve 360",
    note: "The profile must not cross the revolve axis.",
  },
  sweep: {
    what: "Sweeps a profile along a path – bent tube, handle, rail along a curve.",
    when: "Constant cross-section along a curved path: tube, wire, sealing groove.",
    select: "Two sketches: profile and path; a round profile also works without a sketch (Circle).",
    steps: ["Choose Profile (closed sketch) and Path (curve).", "Set Profile orientation along the path, optionally Twist.", "Choose the Operation and confirm OK."],
    cmd: 'feature sweep profileId="Sketch 1" pathId=$last',
    note: "Sharp path corners are handled by Transition at path corners.",
  },
  loft: {
    what: "Creates a smooth transition between two or more profiles on different planes.",
    when: "Transition piece (square to round), hopper, blade, shaped lead-in.",
    select: "At least 2 closed sketches on different planes (a profile and a point also work).",
    steps: ["In Profiles (in order) add the sketches from first to last.", "Optionally Closure, boundary conditions or a guide curve.", "Choose the Operation and confirm OK."],
    note: "Profiles with the same number of segments give the cleanest faces.",
  },
  text: {
    what: "Engraves or raises lettering on a plane – marking, part number, arrow.",
    when: "Mould number, part marking, label text on a plate or fixture.",
    steps: ["Type the lettering in Text, enter Text height and Depth.", "Method: Engrave or Raise; choose the Text plane.", "Set the Text centre and Rotation, confirm OK."],
    cmd: 'text "ABC" height 10 depth 1 at 0 0',
    note: "Lettering on a cylindrical face is done by Text on cylinder (also on the Create tab).",
  },

  // ── Primitives ──
  box: {
    what: "Inserts a box given by its X × Y × Z dimensions – stock, plate, block.",
    when: "Quick stock, clamping plate, block for removing material.",
    steps: ["Enter Dimensions (X × Y × Z) in mm.", "Set the Position (corner) or tick Position = box centre.", "Choose the Operation and confirm OK."],
    cmd: "box 100 60 20",
    note: "The box orientation is set by Box Z axis.",
  },
  cylinder: {
    what: "Inserts a cylinder given by diameter and height – pin, shaft, round plate.",
    when: "Pin, spacer post, round stock; with Remove a cylindrical cut-out.",
    steps: ["Enter Diameter and Height.", "Choose the axis (X / Y / Z or a direction) and the Base position.", "Choose the Operation and confirm OK."],
    cmd: "cylinder 40 60",
    note: "For a threaded or counterbored hole use Hole – it also annotates the drawing.",
  },
  tube: {
    what: "Inserts a tube given by outer and inner diameter and length.",
    when: "Bushing, spacer ring, tube stock.",
    steps: ["Enter Outer Ø, Ø inner and Length.", "Choose the axis and the Base position.", "Choose the Operation and confirm OK."],
    cmd: "tube 40 30 100",
    note: "Ø inner must be smaller than Outer Ø; 0 gives a solid cylinder.",
  },
  cone: {
    what: "Inserts a cone or truncated cone given by Ø bottom, Ø top and height.",
    when: "Point, tapered pin, centring cone, transition between two diameters.",
    steps: ["Enter Ø bottom, Ø top and Height (Ø 0 = point).", "Choose the axis and the Base position.", "Choose the Operation and confirm OK."],
    cmd: "cone 40 20 30",
    note: "A countersink for a screw is made directly by Hole (Countersink).",
  },
  sphere: {
    what: "Inserts a sphere given by diameter and centre.",
    when: "Ball head, ball pin; with Remove a spherical joint seat.",
    steps: ["Enter the Diameter.", "In Centre enter coordinates or a point by reference.", "Choose the Operation and confirm OK."],
    cmd: "sphere 30",
  },

  // ── Design features ──
  hole: {
    what: "Drills a hole: drilled, counterbored, countersunk or threaded, also several at once.",
    when: "Holes for screws and dowel pins, tapped holes; blind or through.",
    select: "With the form open click the face to drill into (sets Point on the surface and the axis).",
    steps: ["Hole type: Drilled, Counterbore, Countersink or Thread; enter the Diameter.", "Click the face (Point on the surface) or fill in Hole positions.", "Set the End condition (depth, through) and confirm OK."],
    cmd: "hole 8.5 through at 20 30",
    note: "For a screw (clearance hole ISO 273) works out the diameter from the screw.",
  },
  thread: {
    what: "Adds an ISO metric thread on a cylinder or in a hole – cosmetic or modelled.",
    when: "Screw, threaded pin, tapped hole that the drawing must call out (M8, M18×1.5).",
    select: "A cylinder or hole – start and axis are set in the form by referencing an edge.",
    steps: ["In Thread pick a size, or type the Designation (text).", "For a hole tick Internal thread (in a hole), enter Thread length.", "Set the axis and Thread start (on the axis), confirm OK."],
    cmd: "thread M8 length 20",
    note: "A cosmetic thread leaves the geometry unchanged; it is only called out in the drawing.",
  },
  split: {
    what: "Cuts the body with a plane and removes one side.",
    when: "Cutting off part of a model, shortening an imported model, half a part.",
    steps: ["In Cutting plane choose a plane, or the Base plane and Plane position.", "In Keep choose the side that remains.", "Confirm OK."],
    cmd: "feature split plane=XY offset=10",
    note: "To keep both halves as separate bodies use Split into bodies.",
  },
  rib: {
    what: "Turns an open sketch line into a stiffening rib of a given thickness up to the body.",
    when: "Stiffener between the walls of a casting or moulding, gusset of a bracket.",
    select: "An open sketch with the rib line.",
    steps: ["In Rib line (open sketch) choose the sketch.", "Enter Thickness and Thickness direction (Normal to the sketch / In the sketch plane).", "Optionally Flip side, confirm OK."],
    cmd: "feature rib thickness=3",
    note: "The rib extends up to the material – the line need not touch the body exactly.",
  },
  spring: {
    what: "Creates a helical spring from round wire.",
    when: "Compression spring for an assembly, fixture or mould.",
    steps: ["Enter Spring diameter, Wire diameter, Pitch and Number of turns.", "Choose the axis and Position (axis start).", "Check the Free length and confirm OK."],
    cmd: "feature spring radius=10 wire=2 pitch=5 turns=8",
    note: "The pitch must exceed the wire diameter, otherwise the coils intersect.",
  },

  // ── Modify ──
  fillet: {
    what: "Rounds the selected edges – with a constant, variable or elliptical radius.",
    when: "Breaking sharp edges, radii of castings and mouldings, wall transitions.",
    select: "Body edges (filter Edge, Ctrl+click for more) – or click them later in the form.",
    steps: ["Select the edges and click Fillet.", "Choose the type (Constant, R1 → R2…) and enter the Radius.", "Confirm OK."],
    cmd: "fillet 2 edges vertical",
    note: "A radius larger than the adjacent wall fails – try a smaller one or fewer edges.",
  },
  chamfer: {
    what: "Chamfers the selected edges – equal distance, two distances, or distance and angle.",
    when: "Assembly chamfers, deburring, lead-in for a pin or screw.",
    select: "Body edges (filter Edge, Ctrl+click for more).",
    steps: ["Select the edges and click Chamfer.", "Chamfer type: Equal, D1 × D2 or D × angle; enter the size.", "Confirm OK."],
    cmd: "chamfer 1 edges top",
  },
  draft: {
    what: "Tilts side faces by the draft angle relative to the neutral plane – for release from the mould.",
    when: "Drafts on castings, pressings and plastic parts in the mould opening direction.",
    select: "Faces to draft (filter Face) – or click them in the form.",
    steps: ["Select the side faces and click Draft.", "Enter Draft angle, Neutral plane and Pull direction (mould opening).", "Confirm OK."],
    cmd: "draft 3 faces side",
    note: "Draft analysis of the whole part is in Mould tools (Tools).",
  },
  shell: {
    what: "Hollows the body into a wall of given thickness; the selected faces stay open.",
    when: "Box, cover, container, thin-walled moulding.",
    select: "Faces to be left open (filter Face).",
    steps: ["Select the faces to open and click Shell.", "Enter Wall thickness, optionally Thicken outward.", "Confirm OK."],
    cmd: "shell 2 open top",
    note: "The thickness must be smaller than the smallest inner fillet radius.",
  },
  filletSetback: {
    what: "Rounds edges and closes the corner where 3 or more edges meet with a smooth patch.",
    when: "Corners of boxes and castings where three rounded edges meet.",
    select: "The edges running into the corner (filter Edge).",
    steps: ["Select the edges and click Setback fillet.", "Enter the Radius and Setback (from the vertex along the edges).", "Optionally a different setback for chosen Vertices, confirm OK."],
    cmd: "fillet 3 edges vertical setback 6",
    note: "The setback must be at least equal to the radius, otherwise the corner fails.",
  },
  filletConic: {
    what: "Rounds edges with an elliptical cross-section – two distances D1 × D2 or a conic (rho).",
    when: "Styling transitions, asymmetric rounds between walls of different height.",
    select: "Body edges (filter Edge).",
    steps: ["Select the edges and click Elliptical fillet.", "Enter D1 (first face) and D2 (second face); Cross-section Ellipse or Conic.", "Confirm OK."],
    cmd: "fillet elliptical 4 2 edges top",
  },
  draftParting: {
    what: "Drafts faces away from a parting curve to both sides – upper and lower mould half.",
    when: "Parts with the mould parting line in the middle, draft above and below it.",
    select: "A sketch with the parting curve and the faces to draft.",
    steps: ["In Parting curve (sketch) choose the sketch.", "Select the faces to draft, enter Draft angle and Pull direction.", "Optionally Step draft, confirm OK."],
    cmd: 'draft 3 faces side parting "Sketch 1"',
  },

  // ── Direct edits ──
  pushPull: {
    what: "Moves the selected planar face along its normal – adds or removes material.",
    when: "Quick size change without history: lengthen, thin down, align a wall.",
    select: "Planar faces (filter Face) – or click them in the form.",
    steps: ["Select a face and click Push / Pull.", "End condition: Blind (+ out, − in), Up to vertex or Up to face.", "Confirm OK."],
    cmd: "feature pushPull distance=5 faces=top",
    note: "Also works on an imported model (STEP) that has no history.",
  },
  offsetFace: {
    what: "Offsets the selected faces by a distance – also curved and cylindrical ones.",
    when: "Machining allowance, enlarging or reducing a hole, adjusting a fit.",
    select: "Faces to offset (filter Face).",
    steps: ["Select the faces and click Offset face.", "Enter the Offset (+ out, − in).", "Confirm OK."],
    cmd: "feature offsetFace distance=0.5 faces=cylindrical",
    note: "Offsetting a hole wall by +0.5 mm makes the hole smaller.",
  },
  deleteFace: {
    what: "Removes the selected faces and heals the body – a hole, fillet or pin disappears.",
    when: "Simplifying an imported model, removing a fillet or hole without history.",
    select: "Faces to remove (filter Face).",
    steps: ["Select the faces (e.g. a hole wall) and click Delete face.", "Check the face list and confirm OK."],
    cmd: "feature deleteFace faces=cylindrical",
    note: "Only what the surrounding faces can close is healed – otherwise the feature reports an error.",
  },
  thicken: {
    what: "Thickens the selected faces into a body of a given thickness.",
    when: "Sheet or shell from a face, a wall from an imported surface.",
    select: "Faces to thicken (filter Face).",
    steps: ["Select the faces and click Thicken.", "Enter the Thickness (+ out, − in).", "Choose the Operation and confirm OK."],
    cmd: "feature thicken thickness=2 faces=top",
  },
  faceColor: {
    what: "Colours the selected model faces with the chosen colour.",
    when: "Highlighting functional faces: seating, ground, threaded, faces to machine.",
    select: "Faces (filter Face, Ctrl+click for more).",
    steps: ["Select the faces.", "Click Face colour and choose a colour."],
    cmd: "color face top #e03930",
  },
  "menu:faceColor/*": {
    what: "Gives the selected faces this colour.",
    when: "Distinguishing functional faces (seating, machined, inspection).",
    select: "Faces (filter Face).",
    steps: ["Click the colour – the faces are recoloured at once."],
    cmd: "color face top #e03930",
  },
  "menu:faceColor/reset": {
    what: "Returns the selected faces to the body colour.",
    when: "Removing a face highlight.",
    select: "Coloured faces (filter Face).",
    steps: ["Click Default colour."],
    cmd: "color face top default",
  },

  // ── Basic editing ──
  pattern: {
    what: "Repeats a feature (hole, boss…) – linear, circular, along a curve, by sketch points or as a fill.",
    when: "Row or grid of holes, holes on a pitch circle, ribs around the circumference.",
    select: "The feature to repeat – the last hole or extrusion is preset (field Repeated features).",
    steps: ["Check the feature in Repeated features.", "Pattern type: Linear, Circular…; enter Number of instances and Spacing or angle.", "Set Direction 1 (axis for circular) and confirm OK."],
    cmd: "pattern 4 spacing 25 direction X",
    note: "Single instances can be skipped by clicking them in the instance list.",
  },
  mirror: {
    what: "Mirrors the whole body or selected features about a plane.",
    when: "Symmetric parts: model one half and mirror it.",
    steps: ["In Mirror plane choose a plane (or the Base plane).", "Mirror: Whole body, or Selected features and tick them.", "For a body leave Keep the original (merge), confirm OK."],
    cmd: "mirror YZ",
  },
  transform: {
    what: "Moves, rotates or scales the body – by dragging the gizmo or numerically.",
    when: "Aligning an imported model, turning a part into its machining position.",
    steps: ["Click Move / rotate – the gizmo appears.", "Drag the arrows (1 mm steps) or arcs (15° steps); R toggles move/rotate.", "Exact values: Translation, Rotation, Scale; confirm OK."],
    cmd: "feature transform translate=10;0;0",
  },

  // ── Bodies ──
  splitBodies: {
    what: "Splits the body with a plane into two separate bodies; nothing is removed.",
    when: "Splitting a mould into two halves, a part made of several pieces, assembly preparation.",
    steps: ["In Parting plane choose a plane, or the Base plane and position.", "Enter the Name of the new body (negative side of the plane).", "Confirm OK."],
    cmd: "splitbodies XY offset 10",
  },
  copyBody: {
    what: "Creates another body as an offset copy of an existing body.",
    when: "A second identical piece next to the first, a variant to modify, a tool for combining.",
    steps: ["In Body to copy choose the body.", "Enter the Offset of the copy (X, Y, Z) and the Name of the copy.", "Confirm OK."],
    cmd: "copybody offset 50 0 0",
  },
  combine: {
    what: "Combines two bodies of the part: unites them, subtracts one from the other, or keeps the intersection.",
    when: "Joining two pieces, milling the shape of another body, intersection of two shapes.",
    select: "A part with at least two bodies.",
    steps: ["Choose the Target body (result) and the Tool body.", "Operation: Unite, Remove or Intersect.", "Optionally Keep the tool body, confirm OK."],
    cmd: "combine 1 2",
  },

  // ── Delete ──
  delete: {
    what: "Deletes the edited or selected feature, the selected face (like Delete face) or the whole body.",
    when: "Cleaning up the history, cancelling a wrong feature, removing a face of an imported model.",
    select: "A feature in the manager, a face or a body in the model.",
    steps: ["Select what is to be deleted.", "Click Delete (or the Del key)."],
    cmd: "delete last",
    note: "Features that depend on the deleted one report an error – Ctrl+Z undoes it.",
  },

  // ── Reference ──
  datum: {
    what: "Creates a datum plane – offset, through three points, at an angle to a face, normal to a curve and more.",
    when: "Sketch or section in a general position, mirror or split plane off the base planes.",
    steps: ["In Plane definition choose the method and pick references in the model.", "Or enter Origin and Normal manually.", "Confirm OK; start a sketch on it from the Sketch menu."],
    cmd: "feature datum",
    note: "A datum plane creates no geometry and updates when the model changes.",
  },
  datumAxis: {
    what: "Creates a datum axis – from an edge, a cylinder axis, two points or two intersecting planes.",
    when: "Axis for revolve, rotation or a circular pattern off the X, Y, Z axes.",
    steps: ["In Axis definition choose the method and pick references.", "Set the Display length and confirm OK."],
    cmd: "feature datumAxis",
    note: "In forms pick it with the Datum axis option of an axis or direction field.",
  },
  datumPoint: {
    what: "Creates a datum point – vertex, edge or circle centre, projection, intersection, coordinates.",
    when: "Position of a hole, primitive or rotation centre at a place that is not a vertex.",
    steps: ["In Point choose the method (right button / ⋯ = more options).", "Pick the references in the model and confirm OK."],
    cmd: "feature datumPoint",
  },
  csys: {
    what: "Creates a coordinate system from an origin and the Z and X axis directions.",
    when: "Measuring and sketching relative to the machining zero, a rotated part in an assembly.",
    steps: ["Enter the Origin (point by reference).", "Set the Z axis and X axis (orthogonalised against Z).", "Confirm OK."],
    cmd: "feature csys",
    note: "Its origin serves as a datum point, the Z axis as an axis, the XY plane as a sketch plane.",
  },

  // ── Library ──
  library: {
    what: "Opens the standard parts library – screws, nuts, bearings, pins, gears, profiles.",
    when: "Standard parts for a design or assembly without drawing them.",
    steps: ["Type the designation (e.g. M8x30, bearing 6204) or pick a category.", "Check the dimensions and insert the part."],
    cmd: "library M8x30",
    note: "In a part the standard part opens in a new tab; in an assembly it is inserted as a component.",
  },
} satisfies Record<string, MicroTip>;

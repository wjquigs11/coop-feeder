# Hanging load-cell case with slide-in electronics

The load cell and 18650 holder stand vertically beside one another. Three paired L-shaped PCB channels are rotated 90 degrees onto the left side wall. The board planes are perpendicular to the back and lid, with populated faces toward the left wall. They grip PCB edges without mounting holes. The upper two M4 holes fix the sensor; the lower end remains free, with an M4 screw eye and a wire running over the fixed plastic guide to the bottom exit.

## Size and references

Housing: **79 mm wide × 180 mm high × 51 mm deep**, excluding screw heads and hanging loop. Overall height with loop: **205 mm**. The hanging loop is centered on the upper end of the box, at X=-7.5 and Z=24 mm (midway between back and lid). Its hole remains 10 mm diameter. The housing and lid have an oblong oval outline with 39.5 mm-radius semicircular ends; the four lid screws sit in the rounded ends. The electrical-lead slot in the side wall has been removed.

| Component | Envelope used (mm) | Source |
|---|---|---|
| Load cell | 75 × 12.7 × 12.7 | Original drawing and load-cell.png |
| Installed 18650 + holder | 78 × 21 × 21 | Assumed per user instruction, allowing holder/contact space around nominal 18 × 65 cell |
| HX711 | 33 × 20 × 6 | hx711.png footprint; assumed height |
| XIAO | 21 × 17.8 × 6 | https://wiki.seeedstudio.com/Seeeduino-XIAO/ footprint; assumed height |
| Charger | 18.2 × 12.3 × 6 | charger.png footprint including USB projection; assumed height |

PCB references assume 1.6 mm substrate thickness, 6 mm total populated height, no pin headers, and a 1.2 mm clear strip along the two retained edges. These edge/component clearances are not dimensioned in the photos: verify them on actual boards, especially soldered wires and the charger's connector. PCB envelopes depict a substrate plus an inset populated region; they are not detailed component models.

Converted AVIF copies are saved as `battery-holder.png`, `hx711.png`, `charger.png`, and `load-cell.png`. Originals remain in the folder. The holder photo has no dimension labels. Unusually long/protected cells may require a larger holder envelope.

## Printed files

- `load_cell_case.scad`: self-contained main source.
- `electronics_fit.scad`: final open-case component preview.
- `print_parts/base.stl`: case with channels, battery cradle, hanging loop, and wire guide.
- `print_parts/lid.stl`: removable lid.
The lid now has three integral board-retention stops. Separate retainers and M2 screws are no longer required.

Set `part` to `"open"` to inspect the layout. Other selections are `"assembly"`, `"exploded"`, `"base"`, `"lid"`, `"print_layout"`, `"mechanism"`, and `"cutaway"`. Assembly displays rotate upright; individual print parts are bed-oriented. Green = HX711, blue = XIAO, orange board = charger, purple = battery/holder.

## Slide channels

Each board has paired L-ledges, retaining lips, and a closed end near the back. Remove the lid and slide each board **from the lid opening toward the back**, along -Z in the part coordinates. The boards are ordered bottom to top: HX711, XIAO, charger. Their long dimensions now extend into the case depth.

- Slot height: 2.0 mm for a 1.6 mm board, with 0.2 mm clearance on either face.
- Edge fit: 0.3 mm per retained edge.
- Lip overlap: 0.8 mm onto each edge.
- Integral lid stops allow approximately 0.8 mm withdrawal before retaining the boards.
- Change `pcb_thickness` and `slot_clearance` to match actual board thickness/printer fit.

The channels attach directly to the side wall with ribs outside the PCB envelopes. No screws or adhesive touch the boards. Closing the lid installs all three retention stops; removing it releases the boards for withdrawal.

Flexible direct-soldered leads need enough slack to slide boards out. Route wires clear of the rails and lid stops. Access USB with the lid off and a board withdrawn if necessary; external USB openings are not yet defined from measured connectors and plugs. The former open side slot is closed.

## Other hardware and assembly

- Two M4×10 socket-head screws for the fixed upper sensor end, nominally 6.2 mm engagement. Verify thread depth.
- One purchased M4 eye for the upper hole of the lower pair. Reference: 8 mm outside eye diameter, 5 mm opening, 2.5 mm eye thickness, 4 mm nominal thread engagement.
- Four M3×50 socket-head screws and four M3 nuts for the lid.
- Two small cable ties for the battery holder through the rear slots at Y=12 and Y=60.

The raised battery bed and side rails locate the holder. The load cell mounts at X=-12, with inferred hole positions Y=5.5, 15.5, 59.5, and 69.5. Part axes: X across, Y upward when hanging, Z outward from the back. Confirm the inferred 5.5 mm end margin on the sensor.

Print the case back-down with supports under the curved wire guide and the relocated hanging loop, which now starts 21 mm above the print bed. Inspect the side-channel overhangs in the slicer and keep support material out of the 2 mm grooves. Print the lid exterior-down with its three retention stops pointing upward. PETG and 4–5 walls are prototype starting settings. Clear grooves and smooth the wire-contact surface before assembly.

## Validation and limits

OpenSCAD MCP mesh checks found single watertight, manifold solids for the case and lid. All 21 assembly-pair checks for the revised oval base, lid, battery, sensor, and three boards passed, with 0.8 mm between each board and its lid stop. Earlier sampled sliding-motion checks passed for all three PCBs with the lid removed, against the case, sensor, and battery; that motion sweep has not been repeated for the oval revision. Minimum modeled groove clearance was 0.2 mm. Printed fit still needs checking.

The battery envelope clears the sensor by 9.65 mm. The components retain free space above and around the sensor; the guide remains 6 mm from the sensor. Loaded deflection, actual wires, knots/crimps, plugs, solder joints and printed strength are not validated by these envelope checks.

The fixed guide takes some of the external load; friction and wire bending can cause hysteresis. Calibrate the complete hanging assembly with its actual wire. No overload stop, environmental seal, or load rating is claimed.

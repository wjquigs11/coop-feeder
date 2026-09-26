// Final enlarged case, with vertical battery alongside the sensor.
// Component envelopes are defined in load_cell_case.scad.
// Purple: assumed 78 x 21 x 21 holder/battery; green: HX711;
// blue: XIAO; orange: charger. All PCB heights assumed 6 mm.
use <load_cell_case.scad>
rotate([90,0,0]) open_case();

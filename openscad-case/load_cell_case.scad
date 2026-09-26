// Vertical hanging case, revised from case.jpg. Units mm.
// Print coordinates: X across case, Y up when hanging, Z out from back.
// Sensor upper end is fixed. Hole axes are Z; sketch is a side view.
part="assembly"; // assembly, open, exploded, base, lid, print_layout, mechanism, cutaway
show_reference=true;
show_electronics=true;
$fn=64;
cell_l=75; cell_w=12.7; cell_h=12.7;
cell_z=8; holes_y=[69.5,59.5,15.5,5.5];
case_left=-47; case_right=32; case_w=case_right-case_left;
case_mid=(case_left+case_right)/2;
cell_x=case_mid; // load-cell holes and wire diverter centered left/right in case
bottom_y=-45; top_y=135; case_depth=38; // thinned 10mm in Z (was 48)
wall=3; floor_h=4; lid_h=3;
// Sealing rim: thicken the perimeter wall to rim_wall over the top rim_h of depth,
// and cut a gasket groove into the top mating face.
rim_wall=8; rim_h=8;              // thickened wall and its depth band below the top face
groove_off=3; groove_w=3; groove_d=3; // groove: 3mm from outer edge, 3mm wide, 3mm deep
wire_d=1.6; wire_hole_d=4;
guide_r=7.2; guide_y=7.5; guide_z=24; // strut thinned 10mm in Z with the case (was 34)
wire_r=guide_r+wire_d/2;
guide_w=10; // guide body width along X
guide_flange_t=1.5; // side flange thickness (X)
guide_flange_h=wire_d+1.5; // flange rise above wire crown (Z)
eye_od=8; eye_id=5; eye_z=27; eye_y=15.5;
// Screw posts pulled inward so the M3 holes clear the gasket groove by ~2mm.
screw_dx=20.15; screw_iy=17.58; // X half-spread from center; Y inset from each end
screws=[for(y=[bottom_y+screw_iy,top_y-screw_iy],x=[case_mid-screw_dx,case_mid+screw_dx]) [x,y]];
battery_l=78; battery_w=21; battery_h=21; // Assumed holder + installed cell.
battery_pos=[7.8,-3,6]; // centered in pocket: left rail inner face x=7.6, case inner wall x=29, 0.4mm clearance
pcb_h=6; // Total populated height; direct solder, no pin headers.
pcb_z=32; pcb_thickness=1.6; slot_clearance=0.4;
hx_pos=[-42,27,pcb_z]; hx_size=[25,16,pcb_h]; // board 24mm deep + 1mm clearance
xiao_pos=[-42,55,pcb_z]; xiao_size=[21,17.8,pcb_h];
charger_pos=[-42,81,pcb_z]; charger_size=[18.2,12.3,pcb_h];
boards=[[hx_pos,hx_size],[xiao_pos,xiao_size],[charger_pos,charger_size]];
rail_seat=pcb_z-slot_clearance/2; rail_bottom=rail_seat-2;
rail_lip=pcb_z+pcb_thickness+slot_clearance/2; rail_top=rail_lip+1.6;
eps=0.02;
assert(wire_d<wire_hole_d,"Wire must clear exit");
assert(guide_z+wire_r+wire_d/2<case_depth,"Wire must clear lid");
module rounded_box(w,h,d,r=3) {
 linear_extrude(d) hull() for(x=[r,w-r],y=[r,h-r]) translate([x,y]) circle(r=r);
}
module case_outline(inset=0) {
 // Oblong oval: semicircular ends and straight sides preserve the electronics bay.
 translate([case_mid,0]) hull()
  for(y=[bottom_y+case_w/2,top_y-case_w/2])
   translate([0,y]) circle(r=case_w/2-inset);
}
module yz_extrude(w) {
 // child 2D coordinates [Y,Z], extruded along X
 multmatrix([[0,0,1,-w/2],[1,0,0,0],[0,1,0,0],[0,0,0,1]]) linear_extrude(w) children();
}
module guide_local() {
 // Integral fixed shoe: quarter-circle crown, vertical stem, and back attachment.
 yz_extrude(guide_w) union() {
  translate([-10,floor_h-eps]) square([4,guide_z+guide_r-floor_h+eps]);
  translate([-9,guide_z]) square([guide_y+9,guide_r]);
  translate([guide_y,guide_z]) intersection() {
   circle(r=guide_r);
   square([guide_r,guide_r]);
  }
 }
 // Side flanges: raised walls on both X faces to keep the wire from slipping off
 // the crown sideways. Span the crown in Y and rise in Z past the wire.
 for(sx=[-1,1])
  translate([sx*(guide_w/2)+(sx<0?-guide_flange_t:0),-9,guide_z])
   cube([guide_flange_t,guide_y+9+guide_r,wire_r+guide_flange_h]);
}
module guide() { translate([cell_x,0,0]) guide_local(); }
module hanger() {
 // Centered across the box and halfway between back and lid on upper end.
 translate([0,0,case_depth/2-3]) linear_extrude(6) difference() {
  union() {
   polygon([[case_mid-12,top_y-5],[case_mid+12,top_y-5],[case_mid+7,top_y+17],[case_mid-7,top_y+17]]);
   translate([case_mid,top_y+15]) circle(d=20);
  }
  translate([case_mid,top_y+15]) circle(d=10);
 }
}
module base() {
 difference() {
  union() {
   difference() {
    linear_extrude(case_depth) case_outline();
    translate([0,0,floor_h])
     linear_extrude(case_depth+eps) case_outline(wall);
   }
   // Sealing rim: thicken the perimeter wall from wall to rim_wall over the top rim_h,
   // added inward (outer footprint unchanged) to carry the gasket groove.
   translate([0,0,case_depth-rim_h]) linear_extrude(rim_h+eps) difference() {
    case_outline(wall);
    case_outline(rim_wall);
   }
   // Pedestal touches only upper 21 mm of beam.
   translate([cell_x-cell_w/2,54,floor_h-eps]) cube([cell_w,21,cell_z-floor_h+eps]);
   // Battery bed and low side rail.
   // L-shape: only the left rail; the case wall is the right side.
   // Battery (battery_w=21) fits between left rail inner face (x=7.6) and case inner wall
   // (x=case_right-wall=29): 21.4mm pocket = 0.4mm total clearance for print tolerance.
   translate([6.1,-4.2,floor_h-eps]) cube([22.9,80.2,2+eps]);
   for(x=[6.1]) translate([x,-3,floor_h-eps]) cube([1.5,78,6+eps]);
   for(p=screws) translate([p[0],p[1],0]) cylinder(h=case_depth,r=4);
   hanger(); guide();
   for(b=boards) {
    board_frame() pcb_channel(b[0],b[1]);
    // Join both channel sides to the left wall, outside the board envelope.
    for(y=[b[0][1]-1.9,b[0][1]+b[1][1]+0.3])
     translate([case_left+wall-eps,y,floor_h-eps])
      cube([6.8+eps,1.6,b[0][0]+b[1][0]+47.3-floor_h+eps]);
   }
  }
  for(y=[holes_y[0],holes_y[1]]) {
   translate([cell_x,y,-eps]) cylinder(h=cell_z+2*eps,d=4.5);
   translate([cell_x,y,-eps]) cylinder(h=4.2+eps,d=8);
  }
  // M3 lid screws into captive nuts accessible from the back.
  for(p=screws) {
   translate([p[0],p[1],-eps]) cylinder(h=case_depth+2*eps,d=3.4);
   translate([p[0],p[1],-eps]) rotate([0,0,30]) cylinder(h=2.7+eps,d=5.8/cos(30),$fn=6);
  }
  // Load wire exits through bottom, tangent to guide.
  translate([cell_x,bottom_y-eps,guide_z+wire_r]) rotate([-90,0,0]) cylinder(h=wall+3,d=wire_hole_d);
  // Gasket groove in the top mating face: 3mm from outer edge, 3mm wide, 3mm deep.
  translate([0,0,case_depth-groove_d]) linear_extrude(groove_d+eps) difference() {
   case_outline(groove_off);
   case_outline(groove_off+groove_w);
  }
 }
}
module lid() {
 // Print exterior face down.
 difference() {
  union(){
   linear_extrude(lid_h) case_outline();
   // Lid-mounted stops retain the side-loading boards with 0.8 mm end play.
   // Disabled per request; retained for reference.
   // for(b=boards)
   //  translate([-38,b[0][1]+2,lid_h-eps])
   //   cube([5,5,case_depth-(b[0][0]+b[1][0]+47+0.8)+eps]);
  }
  for(p=screws) {
   translate([p[0],p[1],-eps]) cylinder(h=lid_h+2*eps,d=3.4);
   // 1 mm head recess gives a 50 mm grip to underside nuts.
   translate([p[0],p[1],-eps]) cylinder(h=1+eps,d=6.4);
  }
 }
}
module sensor_local() {
 difference() {
  union() {
   translate([-cell_w/2,0,cell_z]) cube([cell_w,cell_l,cell_h]);
   // Undimensioned coating: provisional 0.5 mm allowance.
   translate([-cell_w/2-0.5,26,cell_z-0.5]) cube([cell_w+1,22,cell_h+1]);
  }
  for(y=holes_y) translate([0,y,cell_z-eps]) cylinder(h=cell_h+2*eps,d=4);
 }
}
module sensor(){translate([cell_x,0,0]) sensor_local();}
module screw_eye_local() {
 // Illustrative purchased M4 eye: replace dimensions with actual hardware.
 translate([0,eye_y,cell_z+cell_h-4]) cylinder(h=eye_z-eye_od/2-(cell_z+cell_h-4)+0.5,d=4);
 translate([0,eye_y,eye_z]) rotate([0,90,0]) difference() {
  cylinder(h=2.5,d=eye_od,center=true);
  cylinder(h=3,d=eye_id,center=true);
 }
}
module screw_eye(){translate([cell_x,0,0]) screw_eye_local();}
module wire_segment(a,b) { hull() { translate(a) sphere(d=wire_d); translate(b) sphere(d=wire_d); } }
module wire_local() {
 // Schematic attachment at outer eye; knot/crimp not represented.
 wire_segment([0,eye_y,eye_z+eye_od/2],[0,guide_y+wire_r,guide_z]);
 for(a=[0:5:85]) wire_segment(
  [0,guide_y+wire_r*cos(a),guide_z+wire_r*sin(a)],
  [0,guide_y+wire_r*cos(a+5),guide_z+wire_r*sin(a+5)]);
 wire_segment([0,guide_y,guide_z+wire_r],[0,bottom_y-15,guide_z+wire_r]);
}
module wire(){translate([cell_x,0,0]) wire_local();}
module battery(){translate(battery_pos) cube([battery_w,battery_l,battery_h]);}
module pcb_reference(p,s){
 // Substrate plus inset populated envelope: assumes 1.2mm clear long edges.
 translate(p) {
  cube([s[0],s[1],pcb_thickness]);
  translate([0,1.2,pcb_thickness]) cube([s[0],s[1]-2.4,s[2]-pcb_thickness]);
 }
}
// Rotate board planes 90 degrees onto the left side; insertion is along -Z.
// Old X maps to depth; populated faces point toward the left wall.
module board_frame(){translate([-2,0,47]) rotate([0,-90,0]) children();}
module hx711(){board_frame() pcb_reference(hx_pos,hx_size);}
module xiao(){board_frame() pcb_reference(xiao_pos,xiao_size);}
module charger(){board_frame() pcb_reference(charger_pos,charger_size);}
module pcb_channel(p,s){
 start=case_left+wall-1; end=p[0]+s[0]+0.3;
 difference(){
  union(){
   // Paired L ledges and overhanging lips capture the substrate edges.
   for(side=[0,1]){
    edge=p[1]+side*s[1];
    y0=side==0 ? edge-1.9 : edge-0.8;
    translate([start,y0,rail_bottom]) cube([end-start,2.7,2]);
    translate([start,side==0 ? edge-1.9 : edge+0.3,rail_bottom])
      cube([end-start,1.6,rail_top-rail_bottom]);
    translate([start,y0,rail_lip]) cube([end-start,2.7,1.6]);
   }
   // Closed left end; insertion is from +X with lid removed.
   translate([start,p[1]-1.9,rail_bottom]) cube([p[0]-0.3-start,s[1]+3.8,rail_top-rail_bottom]);
  }
 }
}
module electronics(){
 color([0.45,0.25,0.65]) battery();
 color("green") hx711(); color("royalblue") xiao(); color("orange") charger();
}
// Helpers for clearance verification of the gasket groove vs. screw holes.
module groove_ring(){
 translate([0,0,case_depth-groove_d]) linear_extrude(groove_d) difference(){
  case_outline(groove_off);
  case_outline(groove_off+groove_w);
 }
}
module screw_holes_top(){
 for(p=screws) translate([p[0],p[1],case_depth-groove_d]) cylinder(h=groove_d,d=3.4);
}
module installed_lid(){translate([0,0,case_depth+lid_h]) mirror([0,0,1]) lid();}
module open_case(){color([0.18,0.35,0.43]) base(); references(); electronics();}
module references() {
 color("silver") sensor(); color("gold") screw_eye(); color("crimson") wire();
}
module case_cutaway() {
 difference() {
  base();
  translate([0,-30,-1]) cube([30,160,80]);
 }
}
module assembly(explode=0) {
 color([0.18,0.35,0.43]) base();
 color([0.7,0.8,0.85,0.3]) translate([0,0,case_depth+lid_h+explode]) mirror([0,0,1]) lid();
 if(show_reference) references();
 if(show_electronics) electronics();
}
if(part=="base") base();
else if(part=="lid") lid();
else if(part=="assembly") rotate([90,0,0]) assembly();
else if(part=="exploded") rotate([90,0,0]) assembly(25);
else if(part=="mechanism") rotate([90,0,0]) { color([0.18,0.35,0.43]) guide(); references(); }
else if(part=="cutaway") rotate([90,0,0]) { color([0.18,0.35,0.43]) case_cutaway(); references(); }
else if(part=="open") rotate([90,0,0]) open_case();
else if(part=="print_layout") {
 base(); translate([case_w+8,0,0]) lid();
}
else assert(false,"Unknown part selector");

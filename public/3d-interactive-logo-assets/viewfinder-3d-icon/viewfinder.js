import * as THREE from 'three';

const M = {
  graphite: new THREE.MeshStandardMaterial({ name: 'graphite', color: 0x2c333d, roughness: 0.44, metalness: 0.45 }),
  gunmetal: new THREE.MeshStandardMaterial({ name: 'gunmetal', color: 0x5b6672, roughness: 0.3, metalness: 0.6 }),
  titanium: new THREE.MeshStandardMaterial({ name: 'titanium', color: 0xd2dae1, roughness: 0.17, metalness: 0.75 }),
  glass: new THREE.MeshStandardMaterial({
    name: 'optical_glass', color: 0x0a1a26, roughness: 0.04, metalness: 0.35,
    transparent: true, opacity: 0.26,
  }),
  cyan: new THREE.MeshStandardMaterial({
    name: 'cyan_light', color: 0x00131c, emissive: 0x00d4ff, emissiveIntensity: 1.0,
    roughness: 0.35, metalness: 0.0,
  }),
  cyanHot: new THREE.MeshStandardMaterial({
    name: 'cyan_core', color: 0x00151f, emissive: 0x00d8ff, emissiveIntensity: 1.25,
    roughness: 0.3, metalness: 0.0,
  }),
  amber: new THREE.MeshStandardMaterial({
    name: 'amber_light', color: 0x3a2410, emissive: 0xd27a2c, emissiveIntensity: 1.1,
    roughness: 0.35, metalness: 0.0,
  }),
};

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = w / 2, y = h / 2;
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y);
  s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r);
  s.quadraticCurveTo(x, y, x - r, y);
  s.lineTo(-x + r, y);
  s.quadraticCurveTo(-x, y, -x, y - r);
  s.lineTo(-x, -y + r);
  s.quadraticCurveTo(-x, -y, -x + r, -y);
  return s;
}

/** Sculpted body outline: slightly narrower at the top, rounded corners. */
function roundedTrapezoid(topW, botW, h, r) {
  const s = new THREE.Shape();
  const y = h / 2, bx = botW / 2, tx = topW / 2;
  s.moveTo(-bx + r, -y);
  s.lineTo(bx - r, -y);
  s.quadraticCurveTo(bx, -y, bx, -y + r);
  s.lineTo(tx, y - r);
  s.quadraticCurveTo(tx, y, tx - r, y);
  s.lineTo(-tx + r, y);
  s.quadraticCurveTo(-tx, y, -tx, y - r);
  s.lineTo(-bx, -y + r);
  s.quadraticCurveTo(-bx, -y, -bx + r, -y);
  return s;
}

function roundedRectPath(w, h, r) {
  const p = new THREE.Path();
  const x = w / 2, y = h / 2;
  p.moveTo(-x + r, -y);
  p.lineTo(x - r, -y);
  p.quadraticCurveTo(x, -y, x, -y + r);
  p.lineTo(x, y - r);
  p.quadraticCurveTo(x, y, x - r, y);
  p.lineTo(-x + r, y);
  p.quadraticCurveTo(-x, y, -x, y - r);
  p.lineTo(-x, -y + r);
  p.quadraticCurveTo(-x, -y, -x + r, -y);
  return p;
}

/** Extrude a shape along +z, front face landing at zFront. */
function slab(shape, depth, zFront, material, name, bevel = 0.006) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    curveSegments: 16,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = name;
  mesh.position.z = zFront - depth - (bevel > 0 ? bevel : 0);
  return mesh;
}

function frameShape(ow, oh, or_, iw, ih, ir) {
  const s = roundedRect(ow, oh, or_);
  s.holes.push(roundedRectPath(iw, ih, ir));
  return s;
}

export function buildViewfinder() {
  const g = new THREE.Group();
  g.name = 'channelwright_viewfinder';

  // --- window opening ---
  const WW = 0.575, WH = 0.335, WR = 0.028;

  // --- layered body, back to front ---
  const back = slab(roundedRect(0.585, 0.425, 0.10), 0.075, -0.165, M.gunmetal, 'rear_module', 0.012);
  const mid = slab(roundedRect(0.72, 0.50, 0.075), 0.115, -0.05, M.graphite, 'body_core', 0.008);
  const bezelOuter = roundedTrapezoid(0.885, 0.945, 0.645, 0.075);
  bezelOuter.holes.push(roundedRectPath(WW, WH, WR));
  const bezel = slab(bezelOuter, 0.055, 0.018, M.graphite, 'front_bezel', 0.009);
  const edgeOuter = roundedTrapezoid(0.889, 0.949, 0.649, 0.077);
  edgeOuter.holes.push(roundedRectPath(0.845, 0.585, 0.06));
  const bezelEdge = slab(edgeOuter, 0.008, 0.026, M.titanium, 'bezel_edge', 0.002);
  const windowLip = slab(frameShape(WW + 0.058, WH + 0.058, WR + 0.016, WW, WH, WR), 0.012, 0.020, M.titanium, 'window_lip', 0.003);
  g.add(back, mid, bezel, bezelEdge, windowLip);

  // illuminated hairline around the viewing area
  const glowRing = slab(frameShape(WW - 0.002, WH - 0.002, WR, WW - 0.016, WH - 0.016, WR - 0.004), 0.055, 0.017, M.cyan, 'aperture_light', 0);
  g.add(glowRing);

  // --- optical glass over a dark chamber ---
  const chamber = new THREE.Mesh(new THREE.BoxGeometry(WW + 0.02, WH + 0.02, 0.005), M.graphite);
  chamber.name = 'chamber_back';
  chamber.position.z = -0.085;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(WW - 0.004, WH - 0.004, 0.014), M.glass);
  glass.name = 'optical_pane';
  glass.position.z = -0.006;
  g.add(chamber, glass);

  // --- play triangle embedded in the chamber ---
  const t = new THREE.Shape();
  const th = 0.155, tw = th * 0.86;
  t.moveTo(-tw / 2, th / 2);
  t.lineTo(tw / 2, 0);
  t.lineTo(-tw / 2, -th / 2);
  t.closePath();
  const tri = new THREE.Mesh(
    new THREE.ExtrudeGeometry(t, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 }),
    M.cyanHot
  );
  tri.name = 'play_prism';
  tri.position.set(-0.005, 0, -0.075);
  const triHalo = new THREE.Mesh(
    new THREE.ExtrudeGeometry(t, { depth: 0.004, bevelEnabled: false }),
    M.titanium
  );
  triHalo.name = 'play_prism_mount';
  triHalo.scale.set(1.22, 1.22, 1);
  triHalo.position.set(-0.005, 0, -0.082);
  g.add(tri, triHalo);

  // --- focus reticle: corner alignment marks inside the window ---
  const reticle = new THREE.Group();
  reticle.name = 'reticle';
  const tick = (w, h, x, y, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.004), M.cyan);
    m.name = 'reticle_tick_' + i;
    m.position.set(x, y, -0.03);
    return m;
  };
  const cx = WW / 2 - 0.05, cy = WH / 2 - 0.036;
  let i = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      reticle.add(tick(0.042, 0.005, sx * (cx - 0.019), sy * cy, i++));
      reticle.add(tick(0.005, 0.034, sx * cx, sy * (cy - 0.015), i++));
    }
  }
  // centre focus marks
  for (const sx of [-1, 1]) reticle.add(tick(0.026, 0.004, sx * 0.15, 0, i++));
  g.add(reticle);

  // --- mechanical details ---
  // top adjustment barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.30, 40), M.gunmetal);
  barrel.name = 'adjust_barrel';
  barrel.rotation.z = Math.PI / 2;
  barrel.position.set(0.09, 0.338, -0.075);
  g.add(barrel);
  for (let k = 0; k < 9; k++) {
    const knurl = new THREE.Mesh(new THREE.TorusGeometry(0.0272, 0.0022, 6, 32), M.titanium);
    knurl.name = 'knurl_' + k;
    knurl.rotation.y = Math.PI / 2;
    knurl.position.set(0.005 + k * 0.019, 0.338, -0.075);
    g.add(knurl);
  }

  // machined side ribs
  for (let s = 0; s < 2; s++) {
    for (let k = 0; k < 3; k++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.055), M.titanium);
      rib.name = 'rib_' + s + '_' + k;
      rib.position.set((s ? 1 : -1) * (0.369 - k * 0.002), -0.005, -0.088 + k * 0.03);
      g.add(rib);
    }
  }

  // rear turret: tapered housing + optic ring — the silhouette cue that
  // this is a sighting instrument, not a screen
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.215, 0.17, 56), M.graphite);
  turret.name = 'rear_turret';
  turret.rotation.x = Math.PI / 2;
  turret.position.z = -0.245;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.152, 0.028, 56), M.gunmetal);
  collar.name = 'turret_collar';
  collar.rotation.x = Math.PI / 2;
  collar.position.z = -0.325;
  const optic = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.017, 20, 64), M.titanium);
  optic.name = 'rear_optic_ring';
  optic.position.z = -0.338;
  const opticGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.012, 56), M.glass);
  opticGlass.name = 'rear_optic_glass';
  opticGlass.rotation.x = Math.PI / 2;
  opticGlass.position.z = -0.338;
  const opticGlow = new THREE.Mesh(new THREE.TorusGeometry(0.094, 0.006, 12, 48), M.cyan);
  opticGlow.name = 'rear_optic_light';
  opticGlow.position.z = -0.331;
  g.add(turret, collar, optic, opticGlass, opticGlow);

  // status indicators on the bezel face
  const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 28), M.amber);
  dot.name = 'status_amber';
  dot.rotation.x = Math.PI / 2;
  dot.position.set(-0.402, 0.258, 0.022);
  g.add(dot);
  for (let k = 0; k < 3; k++) {
    const pip = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 24), M.cyan);
    pip.name = 'align_pip_' + k;
    pip.rotation.x = Math.PI / 2;
    pip.position.set(0.402 - k * 0.032, -0.262, 0.022);
    g.add(pip);
  }

  // bottom keel — flat seat so the mark stands
  const keel = slab(roundedRect(0.42, 0.10, 0.028), 0.16, -0.045, M.gunmetal, 'base_keel', 0.008);
  keel.position.y = -0.34;
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.14, 0.135), M.graphite);
  neck.name = 'keel_neck';
  neck.position.set(0, -0.285, -0.115);
  g.add(neck);
  g.add(keel);

  g.position.y = 0.40;
  return g;
}

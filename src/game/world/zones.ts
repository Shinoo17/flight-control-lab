import * as THREE from 'three';
import { ColliderSet } from './Colliders';
import { StaticBatch } from './StaticBatch';
import { LabelSet, facing, flatOnGround } from './LabelBatch';
import { Terrain } from './Terrain';
import type { ZoneTint } from './Ground';
import { rng } from './noise';
import { WORLD } from '../config';

/**
 * Layout of the flight test range (north = -Z, east = +X):
 *
 *              OBSTACLE COURSE (north)
 *   BRIDGE /   FREE FLIGHT + RUNWAY      MOUNTAINS
 *   TUNNEL     (centre, altitude poles)  (east, canyon)
 *   (west)     SPEED TEST STRIP (south)
 */
export const ZONES = {
  runway: { length: 3000, width: 60 },
  free: { radius: 2400 },
  obstacle: { minX: -1400, maxX: 1400, minZ: -10500, maxZ: -3200 },
  mountain: { minX: 3800, maxX: 13000, minZ: -9500, maxZ: 6500 },
  bridge: { minX: -13000, maxX: -4200, minZ: -7000, maxZ: 7000 },
  river: { x0: -7800, x1: -6600, z0: -13500, z1: 13500 },
  speed: { minX: -500, maxX: 500, minZ: 3600, maxZ: 13200 },
};

export const ZONE_TINTS: ZoneTint[] = [
  { ...ZONES.obstacle, color: '#7a6340' },
  { ...ZONES.bridge, color: '#5a5470' },
  { ...ZONES.speed, color: '#3d6178', stripes: 1 },
  { minX: -ZONES.runway.width * 2.5, maxX: ZONES.runway.width * 2.5, minZ: -1700, maxZ: 1700, color: '#4a5048' },
];

export interface Ring {
  center: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
  passed: boolean;
}

export interface Zones {
  batch: THREE.Mesh;
  labels: THREE.Group;
  signs: THREE.Group;
  runway: THREE.Mesh;
  rings: { mesh: THREE.InstancedMesh; list: Ring[] };
  terrain: Terrain;
  colliders: ColliderSet;
  trees: THREE.InstancedMesh;
  lights: THREE.InstancedMesh;
}

const C = {
  white: '#f1f1ec',
  red: '#d6422f',
  orange: '#f08a24',
  yellow: '#f2c230',
  cyan: '#34c6d9',
  blue: '#3a6fd8',
  grey: '#8b8f94',
  dark: '#3c3f44',
  concrete: '#a7a59d',
  purple: '#8a5cd6',
  green: '#53b85a',
};

export function buildZones(): Zones {
  const batch = new StaticBatch();
  const colliders = new ColliderSet();
  const labels = new LabelSet(false);
  const signs = new LabelSet(true);

  const runway = buildRunway(batch, colliders, signs);
  buildGridLabels(labels);
  buildAltitudePoles(batch, colliders, signs);
  const rings = buildObstacleCourse(batch, colliders, signs);
  const terrain = buildMountains(signs);
  buildBridgeZone(batch, colliders, signs);
  buildSpeedZone(batch, colliders, signs, labels);
  buildZoneTitles(labels);
  const trees = scatterTrees(terrain);
  const lights = runwayLights();

  return {
    batch: batch.build('Props', { castShadow: false, flat: true }),
    labels: labels.build(),
    signs: signs.build(),
    runway,
    rings,
    terrain,
    colliders,
    trees,
    lights,
  };
}

// --- runway ----------------------------------------------------------------

function runwayTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 4096;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#34373a';
  g.fillRect(0, 0, cv.width, cv.height);
  // Edge lines.
  g.fillStyle = '#e8e8e0';
  g.fillRect(8, 0, 6, cv.height);
  g.fillRect(cv.width - 14, 0, 6, cv.height);
  // Centreline dashes.
  for (let y = 300; y < cv.height - 300; y += 90) g.fillRect(cv.width / 2 - 3, y, 6, 50);
  // Threshold piano keys and numbers at both ends.
  for (const end of [0, 1]) {
    const y0 = end === 0 ? 20 : cv.height - 20 - 60;
    for (let i = 0; i < 8; i++) {
      const x = 24 + i * 27;
      g.fillRect(x, y0, 16, 60);
    }
    g.save();
    g.translate(cv.width / 2, end === 0 ? 150 : cv.height - 150);
    if (end === 0) g.rotate(Math.PI);
    g.font = '800 72px "Arial Narrow", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(end === 0 ? '18' : '36', 0, 0);
    g.restore();
    // Touchdown zone bars.
    for (let k = 0; k < 3; k++) {
      const yy = end === 0 ? 260 + k * 70 : cv.height - 260 - k * 70 - 30;
      g.fillRect(50, yy, 40, 30);
      g.fillRect(cv.width - 90, yy, 40, 30);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

function buildRunway(batch: StaticBatch, col: ColliderSet, signs: LabelSet) {
  const { length, width } = ZONES.runway;
  const geo = new THREE.PlaneGeometry(width, length);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({
    map: runwayTexture(),
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const runway = new THREE.Mesh(geo, mat);
  runway.position.y = 0.05;
  runway.receiveShadow = true;
  runway.name = 'Runway';

  // Control tower + hangars on the east side as landmarks.
  const tx = 260;
  batch.box(new THREE.Vector3(14, 46, 14), C.concrete, new THREE.Vector3(tx, 23, 200));
  batch.box(new THREE.Vector3(22, 8, 22), '#5b7c99', new THREE.Vector3(tx, 50, 200));
  col.box(new THREE.Vector3(tx, 27, 200), new THREE.Vector3(22, 54, 22), 0, 'control tower');
  for (let i = 0; i < 4; i++) {
    const z = -500 + i * 140;
    batch.box(new THREE.Vector3(70, 22, 90), i % 2 ? C.grey : '#9aa0a6', new THREE.Vector3(tx + 40, 11, z));
    col.box(new THREE.Vector3(tx + 40, 11, z), new THREE.Vector3(70, 22, 90), 0, 'hangar');
  }
  signs.add('TWR', new THREE.Vector3(tx - 11.5, 40, 200), { height: 6, quaternion: facing(-Math.PI / 2), color: C.yellow });
  return runway;
}

function runwayLights() {
  const { length, width } = ZONES.runway;
  const per = Math.floor(length / 60) + 1;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.2, 0.8, 1.2),
    new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    per * 2,
  );
  const m = new THREE.Matrix4();
  let k = 0;
  for (let i = 0; i < per; i++) {
    const z = -length / 2 + i * 60;
    for (const x of [-width / 2 - 3, width / 2 + 3]) mesh.setMatrixAt(k++, m.makeTranslation(x, 0.4, z));
  }
  mesh.name = 'RunwayLights';
  return mesh;
}

// --- coordinates on the ground ---------------------------------------------

function buildGridLabels(labels: LabelSet) {
  const step = 2000;
  const half = WORLD.boundsHalf - 1000;
  for (let x = -half + ((half % step) || 0); x <= half; x += step) {
    for (let z = -half; z <= half; z += step) {
      const ns = z === 0 ? '0' : z < 0 ? `N${-z / 1000}` : `S${z / 1000}`;
      const ew = x === 0 ? '0' : x > 0 ? `E${x / 1000}` : `W${-x / 1000}`;
      labels.add(`${ns} · ${ew}`, new THREE.Vector3(x + 60, 0.3, z - 60), {
        height: 70,
        quaternion: flatOnGround(0),
        color: 'rgba(255,255,255,0.85)',
      });
    }
  }
}

function buildZoneTitles(labels: LabelSet) {
  const t = (text: string, x: number, z: number, h: number, color: string) =>
    labels.add(text, new THREE.Vector3(x, 0.4, z), { height: h, quaternion: flatOnGround(0), color });
  t('FREE FLIGHT ZONE', -900, 1900, 110, '#d8ffe0');
  t('OBSTACLE COURSE', 0, -3000, 160, C.orange);
  t('BRIDGE / TUNNEL', -7200, 7500, 160, '#cdb8ff');
  t('SPEED TEST', 0, 3500, 140, C.cyan);
  t('MOUNTAINS', 3200, -1000, 160, '#e8dcc0');
}

// --- altitude poles ----------------------------------------------------------

function buildAltitudePoles(batch: StaticBatch, col: ColliderSet, signs: LabelSet) {
  const R = ZONES.free.radius;
  const seg = new THREE.CylinderGeometry(5, 5, 50, 10, 1);
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) * (Math.PI / 4);
    const x = Math.sin(a) * R;
    const z = -Math.cos(a) * R * 0.8;
    for (let i = 0; i < 20; i++) {
      batch.add(seg, i % 2 ? C.white : C.red, new THREE.Vector3(x, 25 + i * 50, z));
    }
    // Cap beacon.
    batch.add(new THREE.OctahedronGeometry(12), C.yellow, new THREE.Vector3(x, 1012, z));
    col.cylinder(x, z, 7, 0, 1020, 'altitude pole');
    for (let h = 100; h <= 1000; h += 100) {
      for (let s = 0; s < 4; s++) {
        const yaw = (s * Math.PI) / 2;
        const off = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(5.6);
        signs.add(`${h}`, new THREE.Vector3(x, h - 12, z).add(off), {
          height: 14,
          quaternion: facing(yaw),
          color: '#111',
          background: 'rgba(255,255,255,0.92)',
        });
      }
    }
  }
}

// --- obstacle course ---------------------------------------------------------

function buildObstacleCourse(batch: StaticBatch, col: ColliderSet, signs: LabelSet) {
  const Z = ZONES.obstacle;
  const path = (z: number) => Math.sin((z + 3000) / 900) * 420; // slalom x
  const alt = (z: number) => 160 + Math.sin((z + 3000) / 1300) * 90;
  const list: Ring[] = [];
  const RINGS = 16;
  const ringR = 42;
  const tube = 3.2;
  for (let i = 0; i < RINGS; i++) {
    const z = Z.maxZ - 300 - i * 420;
    const p = new THREE.Vector3(path(z), alt(z), z);
    const ahead = new THREE.Vector3(path(z - 20), alt(z - 20), z - 20);
    const n = ahead.sub(p).normalize();
    list.push({ center: p, normal: n, radius: ringR, passed: false });
    col.torus(p, n, ringR, tube + 1, `ring ${i + 1}`);
    signs.add(`${i + 1}`, p.clone().add(new THREE.Vector3(0, ringR + 12, 0)), {
      height: 14,
      quaternion: facing(Math.PI),
      color: C.yellow,
    });
    // Support mast under each ring.
    batch.add(
      new THREE.CylinderGeometry(1.6, 2.5, p.y - ringR, 6),
      C.dark,
      new THREE.Vector3(p.x, (p.y - ringR) / 2, p.z),
    );
    col.cylinder(p.x, p.z, 2.8, 0, p.y - ringR - tube, 'ring mast');
  }
  const ringMesh = new THREE.InstancedMesh(
    new THREE.TorusGeometry(ringR, tube, 10, 48),
    new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x221100 }),
    RINGS,
  );
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < RINGS; i++) {
    const r = list[i];
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), r.normal);
    m.compose(r.center, q, new THREE.Vector3(1, 1, 1));
    ringMesh.setMatrixAt(i, m);
    ringMesh.setColorAt(i, new THREE.Color(C.orange));
  }
  ringMesh.name = 'Rings';

  // Pylon slalom east of the rings: low-level gates.
  for (let i = 0; i < 12; i++) {
    const z = Z.maxZ - 400 - i * 550;
    const x = 900 + (i % 2 ? 120 : -120);
    batch.add(new THREE.CylinderGeometry(14, 18, 420, 8), i % 2 ? C.orange : C.white, new THREE.Vector3(x, 210, z));
    col.cylinder(x, z, 18, 0, 420, 'slalom pylon');
  }

  // Walls with windows on the west side.
  for (let i = 0; i < 6; i++) {
    const z = Z.maxZ - 700 - i * 1100;
    const cx = -850;
    const holeX = cx + (i % 3 - 1) * 90;
    const holeY = 120 + (i % 2) * 70;
    const W = 500;
    const H = 320;
    const hw = 90;
    const hh = 70;
    const thick = 10;
    const color = i % 2 ? C.purple : C.cyan;
    const leftW = holeX - hw / 2 - (cx - W / 2);
    const rightW = cx + W / 2 - (holeX + hw / 2);
    const parts: [number, number, number, number][] = [
      // [centerX, centerY, sizeX, sizeY]
      [cx - W / 2 + leftW / 2, H / 2, leftW, H],
      [holeX + hw / 2 + rightW / 2, H / 2, rightW, H],
      [holeX, (holeY - hh / 2) / 2, hw, holeY - hh / 2],
      [holeX, (holeY + hh / 2 + H) / 2, hw, H - (holeY + hh / 2)],
    ];
    for (const [px, py, sx, sy] of parts) {
      const c = new THREE.Vector3(px, py, z);
      const s = new THREE.Vector3(sx, sy, thick);
      batch.box(s, color, c);
      col.box(c, s, 0, 'wall');
    }
    // Frame the window so it reads from far away.
    batch.box(new THREE.Vector3(hw + 8, 4, thick + 2), C.yellow, new THREE.Vector3(holeX, holeY + hh / 2 + 2, z));
    batch.box(new THREE.Vector3(hw + 8, 4, thick + 2), C.yellow, new THREE.Vector3(holeX, holeY - hh / 2 - 2, z));
  }
  signs.add('RINGS ▸ FOLLOW 1–16', new THREE.Vector3(0, 60, Z.maxZ + 50), {
    height: 28,
    quaternion: facing(0),
    color: C.orange,
    background: 'rgba(20,20,24,0.75)',
  });
  return { mesh: ringMesh, list };
}

// --- mountains --------------------------------------------------------------

function buildMountains(signs: LabelSet) {
  const Z = ZONES.mountain;
  const terrain = new Terrain({ ...Z, cell: 70, peak: 1250 });
  const zEntry = Z.maxZ - 900;
  const x = terrain.canyonX(zEntry);
  signs.add('CANYON ▲', new THREE.Vector3(x, 140, zEntry), {
    height: 30,
    quaternion: facing(0),
    color: '#ffe7b0',
    background: 'rgba(30,20,10,0.7)',
  });
  return terrain;
}

// --- bridges / tunnel --------------------------------------------------------

function buildBridgeZone(batch: StaticBatch, col: ColliderSet, signs: LabelSet) {
  const R = ZONES.river;
  const rx = (R.x0 + R.x1) / 2;
  const span = R.x1 - R.x0 + 500;
  const bridges = [
    { z: -5000, h: 60, color: C.red },
    { z: -2400, h: 110, color: C.yellow },
    { z: 400, h: 45, color: C.cyan },
    { z: 3200, h: 150, color: C.orange },
    { z: 5800, h: 80, color: C.purple },
  ];
  for (const b of bridges) {
    const deck = new THREE.Vector3(span, 7, 26);
    const c = new THREE.Vector3(rx, b.h + 3.5, b.z);
    batch.box(deck, b.color, c);
    col.box(c, deck, 0, 'bridge deck');
    // Towers at both banks.
    for (const tx of [R.x0 - 60, R.x1 + 60]) {
      for (const dz of [-16, 16]) {
        const th = b.h + 140;
        batch.box(new THREE.Vector3(9, th, 9), C.concrete, new THREE.Vector3(tx, th / 2, b.z + dz));
        col.box(new THREE.Vector3(tx, th / 2, b.z + dz), new THREE.Vector3(9, th, 9), 0, 'bridge tower');
      }
      batch.box(new THREE.Vector3(9, 8, 40), C.concrete, new THREE.Vector3(tx, b.h + 136, b.z));
    }
    // Piers in the river with gaps you can thread.
    for (let px = R.x0 + 300; px < R.x1 - 100; px += 300) {
      const s = new THREE.Vector3(10, b.h, 14);
      const pc = new THREE.Vector3(px, b.h / 2, b.z);
      batch.box(s, C.grey, pc);
      col.box(pc, s, 0, 'bridge pier');
    }
    // Suspension cables as thin slanted bars (visual only).
    for (const sgn of [-1, 1]) {
      const tx0 = R.x0 - 60;
      const tx1 = R.x1 + 60;
      const mid = (tx0 + tx1) / 2;
      const len = (tx1 - tx0) / 2;
      const top = b.h + 136;
      const sag = b.h + 20;
      for (const half of [-1, 1]) {
        const x0 = half < 0 ? tx0 : tx1;
        const cx = (x0 + mid) / 2;
        const cy = (top + sag) / 2;
        const ang = Math.atan2(top - sag, len) * (half < 0 ? -1 : 1);
        batch.add(
          new THREE.BoxGeometry(len / Math.cos(ang), 1.4, 1.4),
          C.white,
          new THREE.Vector3(cx, cy, b.z + sgn * 13),
          new THREE.Euler(0, 0, ang),
        );
      }
    }
    signs.add(`CLEARANCE ${b.h} m`, new THREE.Vector3(rx, b.h + 18, b.z + 14), {
      height: 9,
      quaternion: facing(0),
      color: '#fff',
      background: 'rgba(0,0,0,0.55)',
    });
  }

  // Tunnel west of the river, running north–south.
  const tx = -10600;
  const z0 = -1800;
  const z1 = 600;
  const L = z1 - z0;
  const W = 120;
  const H = 70;
  const T = 12;
  const zc = (z0 + z1) / 2;
  const parts: [THREE.Vector3, THREE.Vector3, string][] = [
    [new THREE.Vector3(tx - W / 2 - T / 2, H / 2, zc), new THREE.Vector3(T, H, L), C.concrete],
    [new THREE.Vector3(tx + W / 2 + T / 2, H / 2, zc), new THREE.Vector3(T, H, L), C.concrete],
    [new THREE.Vector3(tx, H + T / 2, zc), new THREE.Vector3(W + T * 2, T, L), C.grey],
  ];
  for (const [c, s, color] of parts) {
    batch.box(s, color, c);
    col.box(c, s, 0, 'tunnel');
  }
  // Hazard-striped portals.
  for (const z of [z0, z1]) {
    for (let i = 0; i < 10; i++) {
      batch.box(
        new THREE.Vector3((W + T * 2) / 10, 6, 2),
        i % 2 ? C.yellow : C.dark,
        new THREE.Vector3(tx - (W + T * 2) / 2 + ((i + 0.5) * (W + T * 2)) / 10, H + T + 3, z),
      );
    }
  }
  // Inner light strips for depth.
  for (let z = z0 + 60; z < z1; z += 120) {
    batch.box(new THREE.Vector3(2, 3, 30), '#fff4b0', new THREE.Vector3(tx - W / 2 + 1, H * 0.7, z));
    batch.box(new THREE.Vector3(2, 3, 30), '#fff4b0', new THREE.Vector3(tx + W / 2 - 1, H * 0.7, z));
  }
  signs.add('TUNNEL 120 × 70', new THREE.Vector3(tx, H + T + 18, z1 + 2), {
    height: 14,
    quaternion: facing(0),
    color: C.yellow,
    background: 'rgba(0,0,0,0.6)',
  });
  // Arch gates leading into the tunnel from the south.
  for (let i = 1; i <= 5; i++) {
    const z = z1 + i * 400;
    const gw = 160 - i * 6;
    const gh = 90 + i * 10;
    for (const sx of [-1, 1]) {
      const c = new THREE.Vector3(tx + (sx * gw) / 2, gh / 2, z);
      const s = new THREE.Vector3(10, gh, 10);
      batch.box(s, i % 2 ? C.purple : C.white, c);
      col.box(c, s, 0, 'arch');
    }
    const top = new THREE.Vector3(tx, gh + 5, z);
    batch.box(new THREE.Vector3(gw + 10, 10, 10), C.purple, top);
    col.box(top, new THREE.Vector3(gw + 10, 10, 10), 0, 'arch');
  }
}

// --- speed strip ------------------------------------------------------------

function buildSpeedZone(batch: StaticBatch, col: ColliderSet, signs: LabelSet, labels: LabelSet) {
  const Z = ZONES.speed;
  const tall = new THREE.CylinderGeometry(3, 4, 140, 8);
  const short = new THREE.CylinderGeometry(3, 4, 70, 8);
  let k = 0;
  for (let z = Z.minZ; z <= Z.maxZ; z += 200, k++) {
    const km = (z - Z.minZ) % 1000 === 0;
    const h = km ? 140 : 70;
    for (const x of [-110, 110]) {
      batch.add(km ? tall : short, km ? C.yellow : k % 2 ? C.cyan : C.white, new THREE.Vector3(x, h / 2, z));
      col.cylinder(x, z, 4.5, 0, h, 'speed pylon');
    }
    if (km) {
      const bar = new THREE.Vector3(0, h - 4, z);
      batch.box(new THREE.Vector3(220, 8, 4), C.yellow, bar);
      col.box(bar, new THREE.Vector3(220, 8, 4), 0, 'speed gate');
      const d = (z - Z.minZ) / 1000;
      signs.add(`${d} KM`, new THREE.Vector3(0, h + 14, z), {
        height: 16,
        quaternion: facing(Math.PI),
        color: '#0d1a22',
        background: 'rgba(255,224,90,0.95)',
      });
      labels.add(`${d}`, new THREE.Vector3(0, 0.4, z + 60), { height: 80, quaternion: flatOnGround(Math.PI), color: C.yellow });
    }
  }
  // Entry sign at the north end, read when flying south from the runway.
  signs.add('SPEED TEST · 200 m GATES', new THREE.Vector3(0, 40, Z.minZ - 40), {
    height: 18,
    quaternion: facing(Math.PI),
    color: C.cyan,
    background: 'rgba(0,0,0,0.6)',
  });
}

// --- scatter -----------------------------------------------------------------

/** Small low-poly trees around the range: pure speed/altitude cue, no collision. */
function scatterTrees(terrain: Terrain) {
  const N = 2600;
  const geo = new THREE.ConeGeometry(7, 22, 5);
  geo.translate(0, 11, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), N);
  const r = rng(42);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const half = WORLD.boundsHalf;
  const blocked = (x: number, z: number) => {
    if (Math.abs(x) < 450 && Math.abs(z) < 2000) return true; // runway
    const inR = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, pad: number) =>
      x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;
    if (inR(ZONES.speed, 200) || inR(ZONES.obstacle, 0)) return true;
    if (x > ZONES.river.x0 - 80 && x < ZONES.river.x1 + 80) return true;
    return false;
  };
  let i = 0;
  while (i < N) {
    const x = (r() * 2 - 1) * half;
    const z = (r() * 2 - 1) * half;
    if (blocked(x, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y > 650) continue;
    // Clumps: most trees near a few forest centres.
    const sc = 0.6 + r() * 1.1;
    p.set(x, y, z);
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * Math.PI);
    m.compose(p, q, s.set(sc, sc * (0.8 + r() * 0.5), sc));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHSL(0.27 + r() * 0.08, 0.35 + r() * 0.2, 0.22 + r() * 0.1));
    i++;
  }
  mesh.name = 'Trees';
  mesh.computeBoundingSphere();
  return mesh;
}

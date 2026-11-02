import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createFlameRig } from '../../vendor/su57-flame.js';
import type { AircraftDef, AircraftRig, RigInput } from './types';
import { smoothTo } from './rigUtil';
import { createNozzleGlow } from './nozzleGlow';

/**
 * F-22 rig. Facts used here come from F22_ThreeJS_Guide.en.md:
 *   - native axes: nose +X, up +Y, right wing +Z
 *   - control surfaces hinge on their bone's local Y, nozzle flaps on local X
 *   - bones are found as `mesh.parent` (bone names are mangled by GLTFLoader)
 *   - the glTF rest pose has gear down and canopy open, so both are driven
 *     closed through their clips at load.
 */

const SPAR = new THREE.Vector3(0, 1, 0);
const NOZZLE = new THREE.Vector3(1, 0, 0);
const STARBOARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const PORT = new THREE.Vector3(0, 0, -1);

type Hinge = (deg: number) => void;

function makeHinge(root: THREE.Object3D, meshName: string, hingeAxis: THREE.Vector3, reference: THREE.Vector3): Hinge {
  const mesh = root.getObjectByName(meshName);
  if (!mesh?.parent) {
    console.warn(`[f22] hinge part not found: ${meshName}`);
    return () => {};
  }
  const bone = mesh.parent;
  const rest = bone.quaternion.clone();
  const q = new THREE.Quaternion();
  const axis = hingeAxis.clone();
  const world = axis.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
  if (world.dot(reference) < 0) axis.negate();
  return (deg) => bone.quaternion.copy(rest).multiply(q.setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg)));
}

function setupClips(gltf: GLTF) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const pin = (name: string, open: boolean) => {
    const clip = gltf.animations.find((c) => c.name === name);
    if (!clip) return;
    const a = mixer.clipAction(clip);
    a.loop = THREE.LoopOnce;
    a.clampWhenFinished = true;
    a.enabled = true;
    a.paused = true;
    a.play();
    a.time = open ? clip.duration - 1e-4 : 0;
  };
  // In flight: gear up, canopy shut, every door closed. Aero_Demo is never
  // touched so the control surfaces stay ours.
  pin('LandingGear_Deploy', false);
  pin('Canopy_Open', false);
  pin('Tailhook_Deploy', false);
  for (const n of [
    'WeaponBay_Main_L_Open',
    'WeaponBay_Main_R_Open',
    'WeaponBay_Side_L_Open',
    'WeaponBay_Side_R_Open',
    'FlareDispenser_L_Open',
    'FlareDispenser_R_Open',
  ])
    pin(n, false);
  mixer.update(0);
  return mixer;
}

/**
 * Parts that can never be seen from a chase camera with gear up and bays
 * closed: tiny cockpit controls, the stowed missiles and bay internals.
 * Hiding them roughly halves the F-22's draw calls.
 */
const HIDDEN = /^(Cockpit_(Button|Knob|Switch)|Seat_Detail|Wpn_|Bay_Center_(Bulkhead|Fitting|HydraulicLine|Rod|Ceiling|Well)|Bay_Side_(Well|LauncherArm|LauncherRail)|Bay_DoorHinge|MLG_.*(Detail|Link|Brace|Actuator|Fitting|Pin|Collar|Torque|Trunnion|Strut|Wheel|Brake|Axle)|NLG_.*(Strut|Wheel|Link|Brace|Actuator|Pivot|Torque)|MLG_Well|NLG_Well)/;
const NO_SHADOW = /^(Cockpit_|Seat_|Canopy_)/;

function fixMaterials(root: THREE.Object3D) {
  root.traverse((o) => {
    if (HIDDEN.test(o.name)) o.visible = false;
  });
  const glass = new THREE.MeshPhysicalMaterial({
    name: 'Glass_Canopy',
    color: 0xb98a3f,
    metalness: 1.0,
    roughness: 0.05,
    transparent: true,
    opacity: 0.35,
    envMapIntensity: 2.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = !NO_SHADOW.test(m.name) && !NO_SHADOW.test(m.parent?.name ?? '');
    // Bone-driven parts move outside their baked bounds.
    m.frustumCulled = false;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat?.name === 'Glass_Canopy') {
      m.material = glass;
      m.renderOrder = 10;
      m.castShadow = false;
    }
  });
}

/** Exit of a nozzle in model space: aft-most point of its flaps, centred on them. */
function nozzleExit(root: THREE.Object3D, side: 'L' | 'R') {
  const box = new THREE.Box3();
  for (const p of ['Flap_Upper', 'Flap_Lower']) {
    const o = root.getObjectByName(`Engine_Nozzle_${side}_${p}`);
    if (o) box.expandByObject(o);
  }
  if (box.isEmpty()) return new THREE.Vector3(-1.75, 0.42, side === 'L' ? -0.15 : 0.15);
  const c = box.getCenter(new THREE.Vector3());
  return new THREE.Vector3(box.min.x, c.y, c.z);
}

/**
 * The F-22 has no iris rig, so the Su-57 plume module is fed a stand-in: a
 * group at each exit, oriented so its +Z points aft and scaled from Su-57
 * model units to F-22 model units (with a flattened section for the 2-D nozzle).
 */
function makePlume(root: THREE.Object3D) {
  const SU57_UNIT = 0.4224; // m per Su-57 unit
  const F22_UNIT = 18.92 / 4.29; // m per F-22 unit
  const k = (SU57_UNIT / F22_UNIT) * 0.95;
  const EXIT_Z = 2.76;
  const influences = { L: [0, 0], R: [0, 0] };
  const anchors: THREE.Object3D[] = [];
  const sides = {} as Record<'L' | 'R', { gimbal: THREE.Object3D; mesh: { morphTargetInfluences: number[] }; close: number; open: number }>;
  for (const s of ['L', 'R'] as const) {
    const g = new THREE.Group();
    g.name = `F22_Plume_${s}`;
    const exit = nozzleExit(root, s);
    g.rotation.y = -Math.PI / 2; // local +Z -> model -X (aft)
    g.scale.set(k * 1.35, k * 0.7, k);
    g.position.copy(exit).add(new THREE.Vector3(EXIT_Z * k, 0, 0));
    root.add(g);
    sides[s] = { gimbal: g, mesh: { morphTargetInfluences: influences[s] }, close: 0, open: 1 };
    const anchor = new THREE.Group();
    anchor.position.copy(exit).add(new THREE.Vector3(-0.03, 0, 0));
    root.add(anchor);
    anchors.push(anchor);
  }
  const flames = createFlameRig({ sides, MIL_THROTTLE: 0.6 }, { light: false });
  // ~2.4 m glow in F-22 model units, anchored at each exit (uniform scale).
  const glow = createNozzleGlow(anchors, new THREE.Vector3(), 2.4 / F22_UNIT);
  return { flames, influences, glow };
}

export const F22: AircraftDef = {
  id: 'f22',
  name: 'F-22 Raptor',
  tagline: 'Stealth air-superiority · 2D thrust vectoring',
  url: '/models/F22_compact.glb',
  lengthMeters: 18.92,
  noseAxis: 'x',
  noseNode: 'Sensor_PitotTube_Nose',
  rightNode: 'Wing_Aileron_R',
  setup(gltf: GLTF): AircraftRig {
    const root = gltf.scene;
    setupClips(gltf);
    fixMaterials(root);
    root.updateMatrixWorld(true);

    const surf = {
      stabL: makeHinge(root, 'Tail_Stabilator_L', SPAR, STARBOARD),
      stabR: makeHinge(root, 'Tail_Stabilator_R', SPAR, STARBOARD),
      flapL: makeHinge(root, 'Wing_Flaperon_L', SPAR, STARBOARD),
      flapR: makeHinge(root, 'Wing_Flaperon_R', SPAR, STARBOARD),
      ailL: makeHinge(root, 'Wing_Aileron_L', SPAR, STARBOARD),
      ailR: makeHinge(root, 'Wing_Aileron_R', SPAR, STARBOARD),
      rudL: makeHinge(root, 'Tail_VerticalFin_L', SPAR, UP),
      rudR: makeHinge(root, 'Tail_VerticalFin_R', SPAR, UP),
    };
    const nz = {
      LU: makeHinge(root, 'Engine_Nozzle_L_Flap_Upper', NOZZLE, PORT),
      LD: makeHinge(root, 'Engine_Nozzle_L_Flap_Lower', NOZZLE, PORT),
      RU: makeHinge(root, 'Engine_Nozzle_R_Flap_Upper', NOZZLE, PORT),
      RD: makeHinge(root, 'Engine_Nozzle_R_Flap_Lower', NOZZLE, PORT),
    };
    const plume = makePlume(root);
    const s = { pitch: 0, roll: 0, yaw: 0, brake: 0 };
    const clamp = THREE.MathUtils.clamp;

    return {
      update({ controls: c, engine }: RigInput, dt: number) {
        // Actuators lag the stick slightly.
        s.pitch = smoothTo(s.pitch, c.pitch, 12, dt);
        s.roll = smoothTo(s.roll, c.roll, 12, dt);
        s.yaw = smoothTo(s.yaw, c.yaw, 10, dt);
        s.brake = smoothTo(s.brake, c.airbrake, 6, dt);
        const { pitch, roll, yaw, brake } = s;

        // F-22 airbrake = ailerons up + flaperons down + rudders splayed.
        surf.stabL(clamp(-pitch * 20 + roll * 8, -20, 20));
        surf.stabR(clamp(-pitch * 20 - roll * 8, -20, 20));
        surf.ailL(clamp(roll * 25 - brake * 25, -25, 25));
        surf.ailR(clamp(-roll * 25 - brake * 25, -25, 25));
        surf.flapL(clamp(-pitch * 10 + roll * 15 + brake * 22, -22.6, 22.6));
        surf.flapR(clamp(-pitch * 10 - roll * 15 + brake * 22, -22.6, 22.6));
        surf.rudL(clamp(yaw * 22 - brake * 20, -22.6, 22.6));
        surf.rudR(clamp(yaw * 22 + brake * 20, -22.6, 22.6));

        // Pitch vectoring plus roll differential; flaps open a little under AB.
        const ab = Math.max(0, (engine - 0.6) / 0.4);
        const open = ab * 6;
        const vec = (v: number, up: Hinge, down: Hinge) => {
          const u = Math.max(v, 0);
          const d = Math.max(-v, 0);
          up(u * 20 - d * 8 + open);
          down(u * 8 - d * 20 - open);
        };
        vec(clamp(pitch - roll * 0.4, -1, 1), nz.LU, nz.LD);
        vec(clamp(pitch + roll * 0.4, -1, 1), nz.RU, nz.RD);

        plume.influences.L[1] = plume.influences.R[1] = ab;
        plume.flames.update(dt, engine);
        plume.glow.update(ab, Math.min(1, engine / 0.6), dt);
      },
      dispose() {
        plume.flames.dispose();
        plume.glow.dispose();
      },
    };
  },
};

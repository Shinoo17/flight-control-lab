import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createNozzleRig } from '../../vendor/su57-nozzle.js';
import { createFlameRig } from '../../vendor/su57-flame.js';
import type { AircraftDef, AircraftRig, RigInput } from './types';
import { pivotHinge, smoothTo } from './rigUtil';
import { createNozzleGlow } from './nozzleGlow';

/**
 * Su-57 rig. From SU57_MODEL_GUIDE.md:
 *   - native axes: nose +Z, up +Y, port (left) +X, starboard -X
 *   - nozzles have a real gimbal + iris rig (su57-nozzle.js / su57-flame.js)
 *   - control surfaces are NOT rigged; their origins are not on the hinge,
 *     so each one gets a pivot group placed from its own bounding box.
 *
 * The compact GLB also carries `Nozzles_ORIG_backup` (far off-model) which
 * the guide says is not exported; it is hidden here before anything measures
 * the model.
 */

const X = new THREE.Vector3(1, 0, 0);
const CANT = THREE.MathUtils.degToRad(26);

function show(root: THREE.Object3D, name: string, visible: boolean) {
  const o = root.getObjectByName(name);
  if (o) o.visible = visible;
}

/** Bounding box of a part in gltf.scene space (scene is at identity). */
function boxOf(o: THREE.Object3D) {
  return new THREE.Box3().setFromObject(o);
}

type Hinge = (deg: number) => void;

/** Trailing-edge surface hinged on its leading edge. Positive = trailing edge down. */
function trailingEdge(root: THREE.Object3D, name: string): Hinge {
  const part = root.getObjectByName(name);
  if (!part) return () => {};
  const b = boxOf(part);
  const c = b.getCenter(new THREE.Vector3());
  // Nose is +Z, so the leading edge is max.z. Rotating about +X by +θ lifts
  // a point aft of the pivot, so TE down is a negative rotation.
  const set = pivotHinge(part, new THREE.Vector3(c.x, c.y, b.max.z), X);
  return (deg) => set(-deg);
}

/** All-moving surface pivoting near its centre. */
function allMoving(root: THREE.Object3D, name: string, axis: THREE.Vector3, sign: number): Hinge {
  const part = root.getObjectByName(name);
  if (!part) return () => {};
  const b = boxOf(part);
  const c = b.getCenter(new THREE.Vector3());
  const size = b.getSize(new THREE.Vector3());
  // Spigot sits a little forward of the planform centre.
  c.z += size.z * 0.12;
  const set = pivotHinge(part, c, axis);
  return (deg) => set(sign * deg);
}

function fixMaterials(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      if (mat.name === 'Glass') {
        const g = mat as THREE.MeshPhysicalMaterial;
        g.transparent = true;
        g.opacity = Math.min(g.opacity, 0.45);
        g.depthWrite = false;
        m.renderOrder = 10;
      }
    }
  });
}

export const SU57: AircraftDef = {
  id: 'su57',
  name: 'Su-57 Felon',
  tagline: 'Supermaneuverable · 3D thrust-vectoring nozzles',
  url: '/models/SU57_compact.glb',
  lengthMeters: 20.1,
  noseAxis: 'z',
  noseNode: 'Prototype_su57_antenna_ng',
  rightNode: 'Aileron_r',
  setup(gltf: GLTF): AircraftRig {
    const root = gltf.scene;
    show(root, 'Nozzles_ORIG_backup', false);
    show(root, 'Gear_down', false);
    show(root, 'Gear_up', true);
    show(root, 'Probe_on', false);
    show(root, 'Probe_off', true);
    fixMaterials(root);
    root.updateMatrixWorld(true);

    // Elevators and fins are all-moving. TE down for elevators is a negative
    // rotation about +X; positive about an up-ish axis swings the TE starboard.
    const elevAxis = X;
    const finAxisL = new THREE.Vector3(Math.sin(CANT), Math.cos(CANT), 0); // port fin leans out to +X
    const finAxisR = new THREE.Vector3(-Math.sin(CANT), Math.cos(CANT), 0);
    const surf = {
      ailL: trailingEdge(root, 'Aileron_l'),
      ailR: trailingEdge(root, 'Aileron_r'),
      flapL: trailingEdge(root, 'Flap_l'),
      flapR: trailingEdge(root, 'Flap_r'),
      elevL: allMoving(root, 'Elevator_l', elevAxis, -1),
      elevR: allMoving(root, 'Elevator_r', elevAxis, -1),
      rudL: allMoving(root, 'Rudder_l', finAxisL, 1),
      rudR: allMoving(root, 'Rudder_r', finAxisR, 1),
    };

    const nozzles = createNozzleRig(root);
    const flames = createFlameRig(nozzles, { light: false });
    // Exit plane is z = 2.76 in Gimbal_* space (SU57_MODEL_GUIDE §5); 1 unit ≈ 0.42 m.
    const glow = createNozzleGlow(
      [nozzles.sides.L.gimbal, nozzles.sides.R.gimbal],
      new THREE.Vector3(0, 0, 2.7),
      2.4 / 0.4224,
    );
    const s = { pitch: 0, roll: 0, yaw: 0, brake: 0 };
    const clamp = THREE.MathUtils.clamp;

    return {
      update({ controls: c, engine }: RigInput, dt: number) {
        s.pitch = smoothTo(s.pitch, c.pitch, 12, dt);
        s.roll = smoothTo(s.roll, c.roll, 12, dt);
        s.yaw = smoothTo(s.yaw, c.yaw, 10, dt);
        s.brake = smoothTo(s.brake, c.airbrake, 6, dt);
        const { pitch, roll, yaw, brake } = s;

        // Nose up: stabilators TE up. Roll right: left TE down.
        surf.elevL(clamp(-pitch * 20 + roll * 8, -22, 22));
        surf.elevR(clamp(-pitch * 20 - roll * 8, -22, 22));
        surf.ailL(clamp(roll * 22 - brake * 20, -25, 25));
        surf.ailR(clamp(-roll * 22 - brake * 20, -25, 25));
        surf.flapL(clamp(-pitch * 6 + roll * 10 + brake * 20, -22, 22));
        surf.flapR(clamp(-pitch * 6 - roll * 10 + brake * 20, -22, 22));
        // Airbrake on the Su-57 splays the all-moving fins in opposite directions.
        surf.rudL(clamp(yaw * 20 - brake * 25, -30, 30));
        surf.rudR(clamp(yaw * 20 + brake * 25, -30, 30));

        nozzles.setVectorWithRoll(pitch * 15, yaw * 15, roll * 6);
        nozzles.setThrottle(engine);
        flames.update(dt, engine);
        glow.update(Math.max(0, (engine - 0.6) / 0.4), Math.min(1, engine / 0.6), dt);
      },
      dispose() {
        flames.dispose();
        glow.dispose();
      },
    };
  },
};

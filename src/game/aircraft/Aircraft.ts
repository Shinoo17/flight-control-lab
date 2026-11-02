import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { AircraftDef, AircraftId, AircraftRig, RigInput } from './types';
import { F22 } from './f22';
import { SU57 } from './su57';

export const AIRCRAFT: Record<AircraftId, AircraftDef> = { f22: F22, su57: SU57 };
export const AIRCRAFT_LIST: AircraftDef[] = [F22, SU57];

/** One GLTFLoader with every decoder both models need (meshopt, KTX2/basis, webp is native). */
export function createModelLoader(renderer: THREE.WebGLRenderer): GLTFLoader {
  const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
  return new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
}

/**
 * A loaded, normalised aircraft.
 *
 * `root` is what the flight model moves. Inside it the model is rotated so
 * its nose is +Z (left wing +X, up +Y), scaled to real metres and centred on
 * its bounding-box centre, so every aircraft shares one body frame.
 */
export class Aircraft {
  readonly root = new THREE.Group();
  readonly def: AircraftDef;
  /** Body-frame bounding box in metres. */
  readonly bounds = new THREE.Box3();
  /** Body-frame points tested against terrain and obstacles. */
  readonly probes: THREE.Vector3[] = [];
  private readonly rig: AircraftRig;

  private constructor(def: AircraftDef, model: THREE.Object3D, rig: AircraftRig) {
    this.def = def;
    this.rig = rig;
    this.root.name = `Aircraft_${def.id}`;

    model.updateMatrixWorld(true);
    const box = visibleBounds(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const nativeLength = def.noseAxis === 'x' ? size.x : size.z;
    const scale = def.lengthMeters / nativeLength;

    const orient = new THREE.Group();
    orient.name = 'Orient';
    // Native +X nose -> +Z: rotate -90° about Y (also takes right wing +Z -> -X).
    if (def.noseAxis === 'x') orient.rotation.y = -Math.PI / 2;
    orient.scale.setScalar(scale);
    model.position.sub(center);
    orient.add(model);
    this.root.add(orient);

    this.root.updateMatrixWorld(true);
    this.bounds.copy(visibleBounds(orient));
    this.verifyOrientation(model);

    const b = this.bounds;
    const c = b.getCenter(new THREE.Vector3());
    this.probes.push(
      new THREE.Vector3(c.x, c.y, b.max.z), // nose
      new THREE.Vector3(c.x, c.y, b.min.z), // tail
      new THREE.Vector3(b.max.x * 0.95, c.y, c.z - (b.max.z - b.min.z) * 0.15), // left tip
      new THREE.Vector3(b.min.x * 0.95, c.y, c.z - (b.max.z - b.min.z) * 0.15), // right tip
      new THREE.Vector3(c.x, b.min.y, c.z), // belly
      new THREE.Vector3(c.x, b.max.y, b.min.z + (b.max.z - b.min.z) * 0.15), // fin tops
    );
  }

  static async load(def: AircraftDef, loader: GLTFLoader): Promise<Aircraft> {
    const gltf = await loader.loadAsync(def.url);
    const rig = def.setup(gltf);
    return new Aircraft(def, gltf.scene, rig);
  }

  get length() {
    return this.bounds.max.z - this.bounds.min.z;
  }

  update(input: RigInput, dt: number) {
    this.rig.update(input, dt);
  }

  dispose() {
    this.rig.dispose();
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
  }

  /** Load-time sanity check that the nose is +Z and the right wing is -X. */
  private verifyOrientation(model: THREE.Object3D) {
    const p = new THREE.Vector3();
    const inv = this.root.matrixWorld.clone().invert();
    const nose = model.getObjectByName(this.def.noseNode);
    const right = model.getObjectByName(this.def.rightNode);
    const ok: string[] = [];
    if (nose) {
      nose.getWorldPosition(p).applyMatrix4(inv);
      ok.push(p.z > this.bounds.max.z * 0.6 ? 'nose +Z ok' : `NOSE WRONG z=${p.z.toFixed(2)}`);
    }
    if (right) {
      new THREE.Box3().setFromObject(right).getCenter(p).applyMatrix4(inv);
      ok.push(p.x < -1 ? 'right wing -X ok' : `RIGHT WING WRONG x=${p.x.toFixed(2)}`);
    }
    const size = this.bounds.getSize(new THREE.Vector3());
    console.info(
      `[aircraft] ${this.def.name}: ${ok.join(', ')}; size ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)} m`,
    );
  }
}

/**
 * Bounds of the visible airframe only. `Box3.setFromObject` would also count
 * hidden parts (the Su-57 backup nozzles sit ~50 units off-model) and the
 * additive plume cones, which would wreck scaling and centring.
 */
function visibleBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  root.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.material instanceof THREE.ShaderMaterial) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    part.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
    box.union(part);
  });
  return box;
}

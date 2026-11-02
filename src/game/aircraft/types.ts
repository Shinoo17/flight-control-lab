import type * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { ControlState } from '../input/ControlAxes';

export type AircraftId = 'f22' | 'su57';

/** Per-frame values the visual rig animates from. */
export interface RigInput {
  controls: ControlState;
  /** 0..1 engine output used for nozzles and plume (0.6 = military power). */
  engine: number;
  speed: number;
}

/** Animates moving parts of one loaded model (control surfaces, nozzles, plume). */
export interface AircraftRig {
  update(input: RigInput, dt: number): void;
  dispose(): void;
}

export interface AircraftDef {
  id: AircraftId;
  name: string;
  tagline: string;
  url: string;
  /** Real length in metres; the model is scaled to it. */
  lengthMeters: number;
  /**
   * Native nose axis of the GLB in its own space. The loader rotates the
   * model so this axis becomes body +Z.
   */
  noseAxis: 'x' | 'z';
  /** A node that sits at the nose and one on the right wing, for a load-time orientation check. */
  noseNode: string;
  rightNode: string;
  /**
   * Prepare the raw glTF scene (visibility, gear/canopy state, hinges) and
   * return its rig. Called while `gltf.scene` is still at the identity
   * transform, before any normalisation.
   */
  setup(gltf: GLTF): AircraftRig;
}

export type Object3D = THREE.Object3D;

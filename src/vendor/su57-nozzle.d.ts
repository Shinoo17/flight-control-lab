import type * as THREE from 'three';

export interface NozzleSide {
  gimbal: THREE.Object3D;
  mesh: { morphTargetInfluences: number[] };
  close: number;
  open: number;
}

export interface NozzleRig {
  sides: { L: NozzleSide; R: NozzleSide };
  MAX_DEFLECTION_DEG: number;
  MIL_THROTTLE: number;
  setVector(pitchDeg: number, yawDeg: number): void;
  setVectorWithRoll(pitchDeg: number, yawDeg: number, rollDeg: number): void;
  setVectorSide(which: 'L' | 'R', pitchDeg: number, yawDeg: number): void;
  setThrottle(t: number): void;
  setThrottleSide(which: 'L' | 'R', t: number): void;
  setExitArea(a: number): void;
  reset(): void;
}

export function createNozzleRig(gltfScene: THREE.Object3D): NozzleRig;

import type { NozzleRig } from './su57-nozzle';

export interface FlameRigOptions {
  light?: boolean;
  lightColor?: number;
  lightIntensity?: number;
  radialSeg?: number;
  heightSeg?: number;
  colors?: { hot: number; mid: number; tip: number };
  coreColors?: { hot: number; mid: number; tip: number };
}

export interface FlameRig {
  update(dt: number, throttleL: number, throttleR?: number): void;
  setDepthTexture(
    depthTexture: unknown,
    near: number,
    far: number,
    width: number,
    height: number,
    softness?: number,
  ): void;
  dispose(): void;
}

/** Only `sides.{L,R}.gimbal/mesh/close/open` and `MIL_THROTTLE` are read. */
export function createFlameRig(
  rig: Pick<NozzleRig, 'sides' | 'MIL_THROTTLE'>,
  opts?: FlameRigOptions,
): FlameRig;

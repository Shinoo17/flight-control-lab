import { INPUT } from '../config';

/**
 * Progressive keyboard input.
 *
 * A key does not snap its axis to ±1. While held, the axis climbs at a rate
 * that itself grows with hold time, so a tap gives a small nudge and a long
 * hold ramps smoothly to full deflection. On release the axis decays back to
 * zero instead of stopping dead. A response curve is applied afterwards for
 * fine control around centre.
 */
export class ProgressiveAxis {
  /** Smoothed axis, -1..1 (before the response curve). */
  raw = 0;
  private holdTime = 0;
  private readonly curve: number;

  constructor(curve: number) {
    this.curve = curve;
  }

  /** `dir` is -1, 0 or +1 from the keys currently held. */
  update(dir: -1 | 0 | 1, dt: number): void {
    const v = this.raw;
    if (dir !== 0) {
      if (v !== 0 && Math.sign(v) !== dir) {
        // Reversing: unwind quickly through zero, then build normally.
        this.raw = approach(v, 0, INPUT.reverseRate * dt);
        this.holdTime = 0;
      } else {
        const rate = INPUT.riseRate + INPUT.riseAccel * this.holdTime;
        this.raw = clamp(v + dir * rate * dt, -1, 1);
        this.holdTime += dt;
      }
    } else {
      this.holdTime = 0;
      // Decay eases out: faster when far from centre, gentle at the end.
      const rate = INPUT.fallRate * (0.4 + 0.6 * Math.abs(v));
      this.raw = approach(v, 0, Math.max(rate, 0.6) * dt);
    }
  }

  /** True while the key is held or the axis has not yet decayed back to 0. */
  get active(): boolean {
    return this.raw !== 0;
  }

  /** Axis value after the response curve, -1..1. */
  get value(): number {
    const v = this.raw;
    return Math.sign(v) * Math.pow(Math.abs(v), this.curve);
  }

  reset(): void {
    this.raw = 0;
    this.holdTime = 0;
  }
}

/** Abstract key state the flight controls are built from. */
export interface ControlKeys {
  pitchUp: boolean;
  pitchDown: boolean;
  rollLeft: boolean;
  rollRight: boolean;
  yawLeft: boolean;
  yawRight: boolean;
  throttleUp: boolean;
  throttleDown: boolean;
  airbrake: boolean;
  afterburner: boolean;
}

export interface ControlState {
  /** -1..1, positive = nose up. */
  pitch: number;
  /** -1..1, positive = roll right (right wing down). */
  roll: number;
  /** -1..1, positive = nose right. */
  yaw: number;
  /**
   * Thrust command, -1..1: +1 = W (accelerate), -1 = S (decelerate),
   * 0 = released (hold current speed).
   */
  thrust: number;
  /** 0..1 smoothed afterburner engagement. */
  afterburner: number;
  /** 0..1 smoothed airbrake deployment. */
  airbrake: number;
}

export class FlightControls implements ControlState {
  readonly pitchAxis = new ProgressiveAxis(INPUT.curve.pitch);
  readonly rollAxis = new ProgressiveAxis(INPUT.curve.roll);
  readonly yawAxis = new ProgressiveAxis(INPUT.curve.yaw);
  thrust = 0;
  afterburner = 0;
  airbrake = 0;

  get pitch() {
    return this.pitchAxis.value;
  }
  get roll() {
    return this.rollAxis.value;
  }
  get yaw() {
    return this.yawAxis.value;
  }

  update(k: ControlKeys, dt: number): void {
    this.pitchAxis.update(dir(k.pitchUp, k.pitchDown), dt);
    this.rollAxis.update(dir(k.rollRight, k.rollLeft), dt);
    this.yawAxis.update(dir(k.yawRight, k.yawLeft), dt);

    // Released keys ease back to 0, which means "hold this speed".
    const t = dir(k.throttleUp, k.throttleDown);
    const rate = t !== 0 ? INPUT.thrustRate : INPUT.thrustReleaseRate;
    this.thrust = approach(this.thrust, t, rate * dt);

    this.afterburner = expApproach(
      this.afterburner,
      k.afterburner ? 1 : 0,
      INPUT.afterburnerRate,
      dt,
    );
    this.airbrake = expApproach(this.airbrake, k.airbrake ? 1 : 0, INPUT.airbrakeRate, dt);
  }

  reset(): void {
    this.pitchAxis.reset();
    this.rollAxis.reset();
    this.yawAxis.reset();
    this.thrust = 0;
    this.afterburner = 0;
    this.airbrake = 0;
  }
}

/** Positive key wins; both or neither held gives 0 (no fighting). */
function dir(pos: boolean, neg: boolean): -1 | 0 | 1 {
  if (pos === neg) return 0;
  return pos ? 1 : -1;
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function approach(v: number, target: number, step: number) {
  if (v < target) return Math.min(v + step, target);
  return Math.max(v - step, target);
}

function expApproach(v: number, target: number, rate: number, dt: number) {
  const r = v + (target - v) * (1 - Math.exp(-rate * dt));
  return Math.abs(r - target) < 1e-4 ? target : r;
}

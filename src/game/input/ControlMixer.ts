import { MathUtils, Vector3 } from 'three';
import { DEG2RAD, MOUSE } from '../config';
import { AimController } from '../flight/AimController';
import type { FlightModel } from '../flight/FlightModel';
import type { ControlState, FlightControls } from './ControlAxes';
import { MouseAim } from './MouseAim';

export type InputMode = 'mouse' | 'keyboard';
export type AimLimit = typeof MOUSE.aimLimit;

/**
 * The `ControlState` the aircraft actually flies: keyboard axes and the aim
 * controller arbitrated per axis.
 *
 *   - An axis with keyboard input (held, or still decaying) is 100 % manual.
 *   - Once it is released the aim controller takes it back over
 *     `MOUSE.handbackTime`, so nothing snaps.
 *   - Roll input keeps the aim where it is (a barrel roll ends on the same
 *     heading). Pitch / yaw input drags the aim along with the nose until that
 *     body rate has settled, so the nose never springs back afterwards.
 *   - Roll the controller adds on its own (bank-and-yank) is unwound once the
 *     mouse rests; roll from A / D or from a pure pitch loop is left alone
 *     (see `MOUSE.rollOut`).
 *
 * In keyboard mode it is a pass-through of `FlightControls`.
 */
export class ControlMixer implements ControlState {
  readonly aim = new MouseAim();
  readonly autopilot = new AimController();
  mode: InputMode = 'mouse';
  /** `limited` keeps the aim within `MOUSE.coneDeg` of the nose; `free` lets it go anywhere. */
  aimLimit: AimLimit = MOUSE.aimLimit;

  pitch = 0;
  roll = 0;
  yaw = 0;

  /** Manual share per axis, 1 = keyboard only. */
  private readonly manualShare = { pitch: 1, roll: 1, yaw: 1 };
  private pitchSync = false;
  private yawSync = false;
  /** `autoRoll`: body roll (rad) the controller has made since the last manual roll. */
  private readonly rollOut = { weight: 0, autoRoll: 0 };
  private readonly manual: FlightControls;
  private readonly _nose = new Vector3();

  constructor(manual: FlightControls) {
    this.manual = manual;
  }

  get thrust() {
    return this.manual.thrust;
  }
  get afterburner() {
    return this.manual.afterburner;
  }
  get airbrake() {
    return this.manual.airbrake;
  }

  /** Call once per fixed step, after the keyboard axes have been updated. */
  step(fm: FlightModel, dt: number): void {
    const m = this.manual;
    const nose = fm.forward(this._nose);

    if (this.mode === 'keyboard') {
      this.aim.syncTo(nose);
      this.autopilot.reset();
      this.manualShare.pitch = this.manualShare.roll = this.manualShare.yaw = 1;
      this.pitch = m.pitch;
      this.roll = m.roll;
      this.yaw = m.yaw;
      return;
    }

    const settle = MOUSE.syncRateDeg * DEG2RAD;
    this.pitchSync = m.pitchAxis.active || (this.pitchSync && Math.abs(fm.rates.x) > settle);
    this.yawSync = m.yawAxis.active || (this.yawSync && Math.abs(fm.rates.y) > settle);
    this.aim.idle += dt;
    if (this.pitchSync || this.yawSync) this.aim.syncTo(nose);
    if (this.aimLimit === 'limited') this.aim.clampToCone(nose);

    // Roll made by hand is the player's; only the controller's own roll is unwound.
    const ro = this.rollOut;
    ro.autoRoll = m.rollAxis.active ? 0 : wrapPi(ro.autoRoll + fm.rates.z * dt);
    const R = MOUSE.rollOut;
    ro.weight =
      R.enabled && !m.rollAxis.active ? MathUtils.smoothstep(this.aim.idle, R.idleTime, R.idleTime + 0.3) : 0;

    const ap = this.autopilot;
    ap.update(fm, this.aim.dir, ro);

    const fade = dt / MOUSE.handbackTime;
    const s = this.manualShare;
    s.pitch = m.pitchAxis.active ? 1 : Math.max(0, s.pitch - fade);
    s.roll = m.rollAxis.active ? 1 : Math.max(0, s.roll - fade);
    s.yaw = m.yawAxis.active ? 1 : Math.max(0, s.yaw - fade);
    this.pitch = s.pitch * m.pitch + (1 - s.pitch) * ap.pitch;
    this.roll = s.roll * m.roll + (1 - s.roll) * ap.roll;
    this.yaw = s.yaw * m.yaw + (1 - s.yaw) * ap.yaw;
  }

  /** Aim on the nose, no pending hand-back. Call on spawn and on mode switches. */
  reset(fm: FlightModel): void {
    this.aim.syncTo(fm.forward(this._nose));
    this.autopilot.reset();
    this.manualShare.pitch = this.manualShare.roll = this.manualShare.yaw = this.mode === 'keyboard' ? 1 : 0;
    this.pitchSync = this.yawSync = false;
    this.rollOut.weight = 0;
    this.rollOut.autoRoll = 0;
    this.pitch = this.roll = this.yaw = 0;
  }
}

function wrapPi(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

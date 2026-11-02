import { MathUtils, Quaternion, Vector3 } from 'three';
import { DEG2RAD, FLIGHT, MOUSE } from '../config';
import type { FlightModel } from './FlightModel';

/**
 * Turns the nose toward a world-space aim direction by producing stick
 * values (-1..1) for pitch / roll / yaw, the same signals the keyboard
 * makes, so the flight model is untouched.
 *
 * The aim is expressed in the body frame (forward +Z, up +Y, right -X) and
 * each axis runs a rate controller: commanded rate = gain × error − damping ×
 * current rate, divided by the rate the aircraft can deliver right now. That
 * division makes the gains speed-independent (authority fade and G-limit are
 * already inside `FlightModel.rateLimits`).
 *
 * Turn strategy blends on the total error angle:
 *   small  → direct: pitch + yaw only, roll holds its current bank
 *   large  → bank-and-yank: roll the lift vector onto the aim, pull with the
 *            part of the error that already lies along the lift vector
 * The blend is continuous, and nothing ever levels the wings by itself.
 * The aim may be anywhere on the sphere, including behind the aircraft
 * (free aim mode): the jet then rolls its lift vector toward it and pulls
 * around as fast as its rates and G-limit allow.
 */
export class AimController {
  pitch = 0;
  roll = 0;
  yaw = 0;
  /** Angle between nose and aim, degrees. */
  errorDeg = 0;
  /** Far from the aim with the pitch stick already at its limit. */
  saturated = false;
  /** Saturated, and the limit is the G-limit rather than low-speed authority. */
  gLimited = false;
  /** Roll direction committed to while the aim sits near 180° of roll error. */
  private rollDir = 0;

  private readonly _q = new Quaternion();
  private readonly _a = new Vector3();
  private readonly _lim = new Vector3();

  reset(): void {
    this.pitch = this.roll = this.yaw = 0;
    this.errorDeg = 0;
    this.saturated = this.gLimited = false;
    this.rollDir = 0;
  }

  /**
   * `rollOut` (0..1 weight, plus the roll angle in radians the controller
   * itself has added since the player last rolled by hand) unwinds that roll
   * while the controller is in its direct regime; see `MOUSE.rollOut`.
   */
  update(fm: FlightModel, aim: Vector3, rollOut?: { weight: number; autoRoll: number }): void {
    const a = this._a.copy(aim).applyQuaternion(this._q.copy(fm.quaternion).invert());
    const fwd = a.z;
    const up = a.y;
    const right = -a.x;
    const err = Math.acos(MathUtils.clamp(fwd, -1, 1));
    this.errorDeg = err / DEG2RAD;

    // Roll that would put the aim straight above the canopy (lift vector on target).
    let rollErr = Math.atan2(right, up);

    const b = MathUtils.smoothstep(this.errorDeg, MOUSE.directDeg, MOUSE.bankDeg);
    // Pitch / yaw error: small errors use the angles in each plane; large ones
    // the total error split along the lift and right axes. Both agree near the
    // nose, but only the split stays continuous when the aim is behind the
    // aircraft (free aim), where atan2(·, fwd < 0) would jump by 2π.
    const pitchErr = MathUtils.lerp(Math.atan2(up, fwd), err * Math.cos(rollErr), b);
    const yawErr = MathUtils.lerp(Math.atan2(right, fwd), err * Math.sin(rollErr), b);
    if (b > 0) {
      // Aim almost below the lift vector: either roll direction is ~180°, so
      // keep the committed one instead of flipping each time the sign does.
      const flip = Math.PI - MOUSE.rollHysteresisDeg * DEG2RAD;
      if (Math.abs(rollErr) > flip && this.rollDir !== 0 && Math.sign(rollErr) !== this.rollDir) {
        rollErr += this.rollDir * 2 * Math.PI;
      }
      this.rollDir = Math.sign(rollErr);
    } else {
      this.rollDir = 0;
    }

    const lim = fm.rateLimits(this._lim);
    const r = fm.rates;
    const G = MOUSE.gain;
    const D = MOUSE.damping;
    const pitchStick = stick(G.pitch * pitchErr - D.pitch * r.x, lim.x);
    const yawStick = stick(G.yaw * yawErr - D.yaw * r.y, lim.y);
    const rollStick = stick(G.roll * rollErr - D.roll * r.z, lim.z);

    // Direct: push is fine, roll rate is commanded to zero (holds the bank).
    // Bank-and-yank: limited push while rolling, most yaw left to the roll.
    this.pitch = MathUtils.lerp(pitchStick, Math.max(pitchStick, -MOUSE.bankPushLimit), b);
    this.yaw = yawStick * MathUtils.lerp(1, MOUSE.bankYawShare, b);
    this.roll = rollStick * b;

    if (rollOut && rollOut.weight > 0 && b < 1) {
      const w = rollOut.weight * (1 - b);
      const R = MOUSE.rollOut;
      const rate = MathUtils.clamp(-R.gain * wrapPi(rollOut.autoRoll), -R.maxRateDeg * DEG2RAD, R.maxRateDeg * DEG2RAD);
      this.roll += w * stick(rate - D.roll * r.z, lim.z);
    }

    this.saturated = this.errorDeg > MOUSE.saturationErrorDeg && Math.abs(this.pitch) > 0.98;
    const authorityRate = FLIGHT.maxRateDeg.pitch * DEG2RAD * fm.effectiveness();
    this.gLimited = this.saturated && fm.gLimitRate() < authorityRate;
  }
}

function wrapPi(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

/** Commanded rate → stick, given the rate full stick delivers. */
function stick(rate: number, limit: number): number {
  if (limit < 1e-6) return 0;
  return MathUtils.clamp(rate / limit, -1, 1);
}

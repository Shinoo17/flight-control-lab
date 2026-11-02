import { Quaternion, Vector3 } from 'three';
import { FLIGHT, SIM, DEG2RAD } from '../config';
import type { ControlState } from '../input/ControlAxes';

/**
 * Arcade flight model.
 *
 * Body frame (shared by every aircraft after normalisation):
 *   forward = +Z, up = +Y, right = -X  (left wing on +X)
 * World frame: +Y up, north = -Z, east = +X.
 *
 * The model keeps two directions apart on purpose:
 *   - the nose (orientation quaternion), driven by the player's body rates
 *   - the flight path (velocity direction), which swings toward the nose at
 *     a finite rate ("lift") and sags under gravity.
 * The gap between them is the angle of attack / sideslip that the HUD shows
 * as the Flight Path Marker separating from the boresight.
 *
 * Speed is a scalar along the path with no target: W / S / afterburner add
 * or remove energy, gravity trades it against climb/dive, and load factor
 * and airbrake bleed it. With no thrust input the speed simply holds, so
 * energy lost in a turn stays lost until the player accelerates again.
 *
 * Hooks for later (stall, high AoA, post-stall): `effectiveness()` and the
 * alpha clamp are the two places such behaviour would plug in.
 */

const FWD = new Vector3(0, 0, 1);
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(-1, 0, 0);
const WORLD_UP = new Vector3(0, 1, 0);

export interface FlightTelemetry {
  speed: number;
  altitude: number;
  /** 0..360, 0 = north. */
  headingDeg: number;
  /** Nose pitch above horizon, degrees. */
  pitchDeg: number;
  /** Bank, degrees, positive = right wing down. */
  rollDeg: number;
  /** Angle between nose and flight path, degrees. */
  alphaDeg: number;
  /** Load factor. */
  g: number;
  /** Vertical speed, m/s. */
  climbRate: number;
}

export class FlightModel {
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  /** Unit velocity direction. */
  readonly pathDir = new Vector3(0, 0, 1);
  speed: number = FLIGHT.cruiseSpeed;
  /** Body rates in rad/s: x = pitch (nose up +), y = yaw (nose right +), z = roll (right +). */
  readonly rates = new Vector3();
  /** Load factor from the last step. */
  g = 1;

  // scratch
  private readonly _f = new Vector3();
  private readonly _u = new Vector3();
  private readonly _r = new Vector3();
  private readonly _v = new Vector3();
  private readonly _w = new Vector3();
  private readonly _q = new Quaternion();

  reset(position: Vector3, headingDeg: number, speed = FLIGHT.cruiseSpeed): void {
    this.position.copy(position);
    // Model nose is +Z; heading 0 (north) is world -Z, so heading h is a yaw of 180° - h.
    this.quaternion.setFromAxisAngle(WORLD_UP, Math.PI - headingDeg * DEG2RAD);
    this.pathDir.copy(FWD).applyQuaternion(this.quaternion);
    this.speed = speed;
    this.rates.set(0, 0, 0);
    this.g = 1;
  }

  /** Velocity vector in world space (m/s). */
  velocity(out = new Vector3()): Vector3 {
    return out.copy(this.pathDir).multiplyScalar(this.speed);
  }

  forward(out = new Vector3()) {
    return out.copy(FWD).applyQuaternion(this.quaternion);
  }
  up(out = new Vector3()) {
    return out.copy(UP).applyQuaternion(this.quaternion);
  }
  right(out = new Vector3()) {
    return out.copy(RIGHT).applyQuaternion(this.quaternion);
  }

  /** Control authority 0..1 from airspeed (low-speed mush, high-speed q-limit). */
  effectiveness(speed = this.speed): number {
    const low = smoothstep(FLIGHT.minSpeed, FLIGHT.fullAuthSpeed, speed);
    let e = FLIGHT.minAuthority + (1 - FLIGHT.minAuthority) * low;
    if (speed > FLIGHT.qLimitSpeed) {
      const t = smoothstep(FLIGHT.qLimitSpeed, FLIGHT.maxSpeed, speed);
      e *= 1 + (FLIGHT.qLimitAuthority - 1) * t;
    }
    return e;
  }

  /**
   * Engine power 0..1 for visuals and the HUD (0.6 = military power): the
   * power needed to hold the current speed, plus the player's thrust
   * command, blended up to 1 by the afterburner.
   */
  enginePower(c: ControlState): number {
    const hold = clamp((this.speed / FLIGHT.milSpeed) ** 2, 0.12, 1);
    const dry = clamp(hold + 0.7 * c.thrust, 0, 1);
    return dry * 0.6 + (1 - dry * 0.6) * c.afterburner;
  }

  step(c: ControlState, dt: number): void {
    const eff = this.effectiveness();
    const f = this.forward(this._f);
    const u = this.up(this._u);
    const r = this.right(this._r);

    // --- angular rates: commanded rate approached with inertia -------------
    const max = FLIGHT.maxRateDeg;
    const resp = FLIGHT.rateResponse;
    // G-limit: at high speed the same stick gives a lower pitch rate.
    const gLimitRate = ((FLIGHT.gLimit - 1) * SIM.gravity) / (FLIGHT.gScale * Math.max(this.speed, 1));
    const tgtPitch = c.pitch * Math.min(max.pitch * DEG2RAD * eff, gLimitRate);
    const tgtRoll = c.roll * max.roll * DEG2RAD * eff;
    const tgtYaw = c.yaw * max.yaw * DEG2RAD * eff;
    this.rates.x += (tgtPitch - this.rates.x) * (1 - Math.exp(-resp.pitch * dt));
    this.rates.z += (tgtRoll - this.rates.z) * (1 - Math.exp(-resp.roll * dt));
    this.rates.y += (tgtYaw - this.rates.y) * (1 - Math.exp(-resp.yaw * dt));

    // Body angular velocity in local axes: pitch about right, roll about
    // forward, yaw about up (nose right = negative about +Y).
    const w = this._w.set(-this.rates.x, -this.rates.y, this.rates.z);
    const angle = w.length() * dt;
    if (angle > 1e-9) {
      this._q.setFromAxisAngle(w.normalize(), angle);
      this.quaternion.multiply(this._q);
    }

    // Bank-to-turn: horizontal lift component swings heading toward the low wing.
    const sinBank = -r.y; // right wing down => right.y < 0 => positive
    const horiz = Math.sqrt(Math.max(0, 1 - f.y * f.y));
    const turn = (FLIGHT.bankTurn * SIM.gravity * sinBank * horiz) / Math.max(this.speed, 1);
    if (Math.abs(turn) > 1e-9) {
      this._q.setFromAxisAngle(WORLD_UP, -turn * dt);
      this.quaternion.premultiply(this._q);
      this.pathDir.applyQuaternion(this._q);
    }
    this.quaternion.normalize();

    // Refresh axes after rotation.
    this.forward(f);
    this.up(u);
    this.right(r);

    // --- flight path: lift pulls it to the nose, gravity sags it -----------
    const d = this.pathDir;
    const dev = this._v.copy(f).sub(d);
    const kA = 1 - Math.exp(-FLIGHT.pathAlign * eff * dt);
    const kS = 1 - Math.exp(-FLIGHT.slipAlign * eff * dt);
    d.addScaledVector(u, dev.dot(u) * kA).addScaledVector(r, dev.dot(r) * kS);

    // Gravity component perpendicular to the path bends it downward.
    const gy = -SIM.gravity * FLIGHT.gravitySag;
    const along = gy * d.y;
    d.y += ((gy - along * d.y) / Math.max(this.speed, 1)) * dt;
    d.x += ((-along * d.x) / Math.max(this.speed, 1)) * dt;
    d.z += ((-along * d.z) / Math.max(this.speed, 1)) * dt;
    d.normalize();

    // Keep alpha bounded so the FPM never runs off the HUD.
    const maxAlpha = FLIGHT.maxAlphaDeg * DEG2RAD;
    const cosA = d.dot(f);
    if (cosA < Math.cos(maxAlpha)) {
      // Rotate d toward f until the angle equals maxAlpha.
      const a = Math.acos(clamp(cosA, -1, 1));
      const t = 1 - maxAlpha / a;
      d.lerp(f, t).normalize();
    }

    // --- speed ---------------------------------------------------------------
    // No speed target: released keys hold whatever energy the aircraft has.
    const v = this.speed;
    const n = FLIGHT.thrustTaperExp;
    let accel = 0;
    if (c.thrust > 0) {
      accel += c.thrust * FLIGHT.dryAccel * Math.max(0, 1 - (v / FLIGHT.milSpeed) ** n);
    } else if (c.thrust < 0) {
      accel += c.thrust * FLIGHT.idleDecel * (0.35 + 0.65 * Math.min(1, v / FLIGHT.milSpeed));
    }
    accel += c.afterburner * FLIGHT.afterburnerAccel * Math.max(0, 1 - (v / FLIGHT.afterburnerSpeed) ** n);
    if (v > FLIGHT.milSpeed) accel -= FLIGHT.overspeedDrag * (v - FLIGHT.milSpeed) * (1 - c.afterburner);
    accel -= SIM.gravity * d.y;
    this.g = 1 + (FLIGHT.gScale * Math.abs(this.rates.x) * v) / SIM.gravity;
    accel -= FLIGHT.turnBleed * (this.g - 1);
    accel -= FLIGHT.airbrakeDecel * c.airbrake * (v / FLIGHT.cruiseSpeed);
    this.speed = clamp(v + accel * dt, FLIGHT.minSpeed, FLIGHT.maxSpeed);

    this.position.addScaledVector(d, this.speed * dt);
  }

  telemetry(out: Partial<FlightTelemetry> = {}): FlightTelemetry {
    const f = this.forward(this._f);
    const r = this.right(this._r);
    const u = this.up(this._u);
    const t = out as FlightTelemetry;
    t.speed = this.speed;
    t.altitude = this.position.y;
    t.headingDeg = headingOf(f);
    t.pitchDeg = Math.asin(clamp(f.y, -1, 1)) / DEG2RAD;
    // Bank from the right vector's drop and whether the aircraft is inverted.
    t.rollDeg = Math.atan2(-r.y, u.y) / DEG2RAD;
    t.alphaDeg = Math.acos(clamp(f.dot(this.pathDir), -1, 1)) / DEG2RAD;
    t.g = this.g;
    t.climbRate = this.pathDir.y * this.speed;
    return t;
  }
}

/** Heading of a world direction: 0 = north (-Z), 90 = east (+X). */
export function headingOf(dir: Vector3): number {
  const h = Math.atan2(dir.x, -dir.z) / DEG2RAD;
  return (h + 360) % 360;
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}
function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

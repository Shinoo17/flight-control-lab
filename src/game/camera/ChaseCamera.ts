import * as THREE from 'three';
import { CAMERA, FLIGHT } from '../config';

export type CameraMode = 'aircraft' | 'horizon' | 'aim';

/** Order the camera key cycles through. */
export const CAMERA_MODES: readonly CameraMode[] = ['aircraft', 'horizon', 'aim'];

export const CAMERA_MODE_LABEL: Record<CameraMode, string> = {
  aircraft: 'Aircraft lock',
  horizon: 'Horizon lock',
  aim: 'Aim lock',
};

export interface ChaseTarget {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  speed: number;
  afterburner: number;
  airbrake: number;
  g: number;
  /** Mouse aim direction and flight path (world, unit); used by Aim Lock. */
  aim?: THREE.Vector3;
  pathDir?: THREE.Vector3;
  /** Wreck view: pull far back and look down at the impact point. */
  crashed?: boolean;
}

const BODY_FWD = new THREE.Vector3(0, 0, 1);
const BODY_UP = new THREE.Vector3(0, 1, 0);
const BODY_LEFT = new THREE.Vector3(1, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** Camera looks down its -Z; the rig's forward is +Z, so turn the camera around. */
const ROLL = new THREE.Quaternion();
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

/**
 * Third-person chase camera.
 *
 * A "rig" orientation chases a target orientation with exponential lag:
 *   - Aircraft Lock: target = aircraft attitude (camera pitches, rolls, goes inverted)
 *   - Horizon Lock: target = aircraft heading/pitch rebuilt on world up, plus a
 *     little of the bank, so the horizon stays mostly level.
 *   - Aim Lock: like Horizon Lock, but looking along the mouse aim blended
 *     with the flight path, so the view leads into the turn and shows what
 *     the aircraft is about to fly into.
 * The camera sits behind and above the aircraft in rig space, looking along
 * the rig forward, which keeps the jet in the lower half of the screen with
 * its nose pointing at screen centre. Position lag is applied to the offset
 * only (not the absolute position) so it never falls behind at 400 m/s.
 *
 * Free look orbits the camera around the jet on top of any mode and eases
 * back once released.
 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'aircraft';
  /** While true, `look()` deltas hold; when false the look offset eases back to 0. */
  freeLookActive = false;
  private readonly rig = new THREE.Quaternion();
  private readonly offset = new THREE.Vector3();
  private distance = CAMERA.distance;
  private fov = CAMERA.fovBase;
  private time = 0;
  private needsSnap = true;
  private lookYaw = 0;
  private lookPitch = 0;
  private readonly view = new THREE.Quaternion();
  private readonly _lq = new THREE.Quaternion();
  private readonly _q = new THREE.Quaternion();
  private readonly _v = new THREE.Vector3();
  private readonly _f = new THREE.Vector3();
  private readonly _u = new THREE.Vector3();
  private readonly _x = new THREE.Vector3();
  private readonly _m = new THREE.Matrix4();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovBase, aspect, CAMERA.near, CAMERA.far);
  }

  /** Scale the chase distance to the aircraft (configured for ~19 m jets). */
  sizeScale = 1;

  snap() {
    this.needsSnap = true;
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  /** Next mode in `CAMERA_MODES`. */
  cycle(): CameraMode {
    this.mode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    return this.mode;
  }

  /** Free look: orbit by a mouse delta in pixels. */
  look(dx: number, dy: number) {
    const k = THREE.MathUtils.degToRad(CAMERA.freeLookDegPerPx);
    const maxPitch = THREE.MathUtils.degToRad(CAMERA.freeLookMaxPitchDeg);
    // Rig +Y turns the view left, rig +X tilts it down: mouse right / up = look right / up.
    this.lookYaw = wrapPi(this.lookYaw - dx * k);
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + dy * k, -maxPitch, maxPitch);
  }

  update(t: ChaseTarget, dt: number) {
    this.time += dt;
    let target: THREE.Quaternion;
    let rate: number;
    let limitTurn: boolean;
    switch (this.mode) {
      case 'aircraft':
        target = t.quaternion;
        rate = CAMERA.lockFollowRate;
        limitTurn = false;
        break;
      case 'horizon':
        target = this.horizonTarget(t.quaternion);
        rate = CAMERA.horizonFollowRate;
        limitTurn = true;
        break;
      case 'aim':
        target = this.aimTarget(t);
        rate = CAMERA.aimFollowRate;
        limitTurn = true;
        break;
      default: {
        const never: never = this.mode;
        throw new Error(`unknown camera mode ${never as string}`);
      }
    }
    let wantDist =
      (CAMERA.distance + CAMERA.afterburnerPullback * t.afterburner + CAMERA.airbrakePullback * t.airbrake) *
      this.sizeScale;
    if (t.crashed) {
      target = this.crashTarget(t.quaternion);
      rate = 1.5;
      wantDist *= 4;
    }

    if (this.needsSnap) {
      this.rig.copy(target);
      this.distance = wantDist;
      this.offset.set(0, CAMERA.height * this.sizeScale, -wantDist).applyQuaternion(this.rig);
      this.needsSnap = false;
    } else {
      // Exponential follow, but never faster than maxTurnRate: when horizon
      // lock hands over near vertical, the target can swing ~180° within a
      // few degrees of pitch, and this turns that into a smooth roll-over.
      let k = 1 - Math.exp(-rate * dt);
      const angle = this.rig.angleTo(target);
      const maxStep = THREE.MathUtils.degToRad(CAMERA.maxTurnRateDeg) * dt;
      if (limitTurn && angle * k > maxStep) k = maxStep / angle;
      this.rig.slerp(target, k);
      this.distance += (wantDist - this.distance) * (1 - Math.exp(-(t.crashed ? 1.2 : CAMERA.distanceRate) * dt));
    }

    // Free look orbits on top of the rig; released, it eases home.
    if (!this.freeLookActive || t.crashed) {
      const back = Math.exp(-CAMERA.freeLookReturnRate * dt);
      this.lookYaw = Math.abs(this.lookYaw) < 1e-4 ? 0 : this.lookYaw * back;
      this.lookPitch = Math.abs(this.lookPitch) < 1e-4 ? 0 : this.lookPitch * back;
    }
    const view = this.view.copy(this.rig);
    if (this.lookYaw !== 0 || this.lookPitch !== 0) {
      view.multiply(this._lq.setFromAxisAngle(BODY_UP, this.lookYaw));
      view.multiply(this._lq.setFromAxisAngle(BODY_LEFT, this.lookPitch));
    }

    const desired = this._v.set(0, CAMERA.height * this.sizeScale, -this.distance).applyQuaternion(view);
    this.offset.lerp(desired, 1 - Math.exp(-CAMERA.positionRate * dt));

    const cam = this.camera;
    cam.position.copy(t.position).add(this.offset);
    cam.quaternion.copy(view).multiply(FLIP);

    // Shake: afterburner rumble and high-g buffet, tiny and smooth.
    const amp =
      CAMERA.shakeAfterburner * t.afterburner + CAMERA.shakeG * Math.max(0, t.g - 4) * 0.25;
    if (amp > 1e-4) {
      const s = this.time;
      this._v.set(
        Math.sin(s * 37.1) * 0.6 + Math.sin(s * 23.3),
        Math.sin(s * 41.7) * 0.6 + Math.sin(s * 19.9),
        0,
      );
      cam.position.addScaledVector(this._v.applyQuaternion(cam.quaternion), amp);
    }

    // Dynamic FOV: widen with speed and afterburner.
    const sp = THREE.MathUtils.clamp((t.speed - FLIGHT.cruiseSpeed) / (FLIGHT.maxSpeed - FLIGHT.cruiseSpeed), -0.5, 1);
    const wantFov = CAMERA.fovBase + CAMERA.fovSpeedGain * sp + CAMERA.fovAfterburnerGain * t.afterburner;
    this.fov += (wantFov - this.fov) * (1 - Math.exp(-CAMERA.fovRate * dt));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }

  /** Horizon-stabilised orientation: the aircraft's forward on a level basis. */
  private horizonTarget(q: THREE.Quaternion): THREE.Quaternion {
    this._f.copy(BODY_FWD).applyQuaternion(q);
    return this.levelBasis(q, CAMERA.horizonBankFollowDeg);
  }

  /**
   * Aim lock: look along the aim blended with the flight path (aim alone
   * would swing the view too far from where the jet actually goes), then
   * level it like horizon lock.
   */
  private aimTarget(t: ChaseTarget): THREE.Quaternion {
    const q = t.quaternion;
    const f = this._f.copy(BODY_FWD).applyQuaternion(q);
    if (t.aim && t.pathDir) {
      const w = CAMERA.aimLookWeight;
      f.copy(t.aim).multiplyScalar(w).addScaledVector(t.pathDir, 1 - w);
      if (f.lengthSq() < 1e-6) f.copy(BODY_FWD).applyQuaternion(q);
      f.normalize();
    }
    return this.levelBasis(q, CAMERA.aimBankFollowDeg);
  }

  /**
   * Orientation looking along `this._f` with "up" rebuilt from world up and
   * a little of the aircraft bank (`q` supplies the aircraft's own up). Near
   * vertical, world up is useless (the basis would spin), so it hands over to
   * the aircraft's up vector.
   */
  private levelBasis(q: THREE.Quaternion, bankFollowDeg: number): THREE.Quaternion {
    const f = this._f;
    const au = this._u.copy(BODY_UP).applyQuaternion(q);
    const [b0, b1] = CAMERA.verticalBlend;
    const w = THREE.MathUtils.smoothstep(Math.abs(f.y), b0, b1);
    const ref = this._v.copy(WORLD_UP).multiplyScalar(1 - w).addScaledVector(au, w);
    // Body left (+X) = up × forward.
    const left = this._x.crossVectors(ref, f);
    if (left.lengthSq() < 1e-6) return this._q.copy(q);
    left.normalize();
    const up = ref.crossVectors(f, left).normalize();
    this._m.makeBasis(left, up, f);
    this._q.setFromRotationMatrix(this._m);
    // A little bank-follow keeps it lively without losing the horizon. Signed
    // bank about forward; sin() makes the tilt fade to zero at 180° so it is
    // continuous through inverted (a quaternion slerp would flip sides there).
    const bank = Math.atan2(left.crossVectors(up, au).dot(f), up.dot(au));
    const tilt = THREE.MathUtils.degToRad(bankFollowDeg) * Math.sin(bank);
    return this._q.multiply(ROLL.setFromAxisAngle(BODY_FWD, tilt));
  }

  /** Heading kept, pitched 25° down so the camera rises and looks at the wreck. */
  private crashTarget(q: THREE.Quaternion): THREE.Quaternion {
    const f = this._f.copy(BODY_FWD).applyQuaternion(q);
    const yaw = Math.atan2(f.x, f.z);
    this._q.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(25), yaw, 0, 'YXZ'));
    return this._q;
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}

function wrapPi(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

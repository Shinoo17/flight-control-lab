import * as THREE from 'three';

/**
 * Thrust-vectoring + variable-area nozzle controller for su57.glb
 *
 * Scene graph baked into the GLB:
 *   NozzleMount_R  (base tilt: 2.99 deg outboard, 1.50 deg up -- DO NOT touch)
 *   └─ Gimbal_R    (rotate this: local X and local Y)
 *      └─ Nozzle_R (mesh, morph targets: Iris_Close, Iris_Open)
 *   ...same for _L
 *
 * _L is the port nozzle, _R starboard, matching the rest of the model
 * (Aileron_l, MG in the starboard wing root, refuelling probe to port).
 *
 * Raw gimbal directions, measured on the exit ring at 10 deg:
 *   gimbal.rotation.x > 0  ->  exit swings DOWN       (dZ -0.475)
 *   gimbal.rotation.y > 0  ->  exit swings STARBOARD  (dX -0.476)
 *
 * Deflecting the exhaust down pushes the tail up, which pitches the nose
 * DOWN -- the same inversion an elevator has. This module hides that: the
 * public API takes control-input signs, not gimbal signs.
 *
 *   setVector(pitch > 0)  ->  nose UP
 *   setVector(yaw > 0)    ->  nose RIGHT
 *   roll > 0              ->  rolls RIGHT
 *
 * Deflection is clamped conically at 18 deg: verified against the Body mesh
 * with no new interpenetration up to 20 deg (real Su-57 is +/-16 deg).
 * Iris state does not affect Body clearance -- every moving petal sits aft of
 * the fuselage rim plane, so the two controls are independent.
 */

const MAX_DEFLECTION_DEG = 18;

/** Throttle where the nozzle is tightest -- max dry thrust. */
const MIL_THROTTLE = 0.6;
/** How far open the nozzle sits at ground idle, as a fraction of full open. */
const IDLE_OPEN = 0.6;

function makeSide(gltfScene, suffix) {
  const gimbal = gltfScene.getObjectByName(`Gimbal_${suffix}`);
  const mesh = gltfScene.getObjectByName(`Nozzle_${suffix}`);
  if (!gimbal || !mesh) {
    throw new Error(`su57-nozzle: Gimbal_${suffix} or Nozzle_${suffix} not found in glTF`);
  }

  gimbal.rotation.order = 'YXZ';

  const dict = mesh.morphTargetDictionary;
  return { gimbal, mesh, close: dict.Iris_Close, open: dict.Iris_Open };
}

export function createNozzleRig(gltfScene) {
  const sides = {
    R: makeSide(gltfScene, 'R'),
    L: makeSide(gltfScene, 'L'),
  };

  /**
   * Deflect one nozzle. Angles are control inputs in degrees -- positive pitch
   * commands nose up, positive yaw commands nose right. Clamped conically so a
   * diagonal command cannot exceed the limit on the combined magnitude.
   */
  function vectorSide(side, pitchDeg, yawDeg) {
    const mag = Math.hypot(pitchDeg, yawDeg);
    if (mag > MAX_DEFLECTION_DEG) {
      const s = MAX_DEFLECTION_DEG / mag;
      pitchDeg *= s;
      yawDeg *= s;
    }
    // Nose up needs the exhaust deflected up, which is negative gimbal X.
    side.gimbal.rotation.x = THREE.MathUtils.degToRad(-pitchDeg);
    side.gimbal.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  }

  /**
   * Direct exit-area control, signed:
   *   -1 = fully closed (0.73x area)    0 = modelled rest    +1 = fully open (1.25x area)
   * Exactly one morph target is ever active, so the two never blend into a
   * muddled in-between shape.
   */
  function areaSide(side, a) {
    a = THREE.MathUtils.clamp(a, -1, 1);
    side.mesh.morphTargetInfluences[side.close] = Math.max(0, -a);
    side.mesh.morphTargetInfluences[side.open] = Math.max(0, a);
  }

  /**
   * Set exit area from a throttle lever position, 0 = idle .. 1 = full AB.
   *
   * A real convergent-divergent afterburning nozzle is NOT monotonic in
   * throttle -- it traces a V:
   *   idle -> wide open (low pressure ratio needs a large throat)
   *   mil  -> tightest  (max velocity out of unaugmented exhaust)
   *   AB   -> widest    (augmentor volume expands; a tight throat would
   *                      back-pressure the core into compressor surge)
   * This is why parked fighters sit with their nozzles gaping.
   */
  function throttleSide(side, throttle) {
    const t = THREE.MathUtils.clamp(throttle, 0, 1);
    const a =
      t <= MIL_THROTTLE
        ? THREE.MathUtils.lerp(IDLE_OPEN, -1, t / MIL_THROTTLE)
        : THREE.MathUtils.lerp(-1, 1, (t - MIL_THROTTLE) / (1 - MIL_THROTTLE));
    areaSide(side, a);
  }

  const rig = {
    sides,
    MAX_DEFLECTION_DEG,
    MIL_THROTTLE,

    /** Symmetric deflection: both nozzles together -> pitch / yaw authority. */
    setVector(pitchDeg, yawDeg) {
      vectorSide(sides.R, pitchDeg, yawDeg);
      vectorSide(sides.L, pitchDeg, yawDeg);
    },

    /**
     * Differential pitch adds roll authority. rollDeg > 0 rolls right: the
     * starboard nozzle pushes its side down while the port nozzle lifts.
     *
     * The command set is scaled as a whole rather than per side, so an
     * over-large request loses authority uniformly instead of clamping one
     * side and not the other -- which would destroy the differential that
     * produces the roll in the first place.
     */
    setVectorWithRoll(pitchDeg, yawDeg, rollDeg) {
      const worst = Math.max(
        Math.hypot(pitchDeg + rollDeg, yawDeg),
        Math.hypot(pitchDeg - rollDeg, yawDeg)
      );
      const s = worst > MAX_DEFLECTION_DEG ? MAX_DEFLECTION_DEG / worst : 1;
      vectorSide(sides.R, (pitchDeg + rollDeg) * s, yawDeg * s);
      vectorSide(sides.L, (pitchDeg - rollDeg) * s, yawDeg * s);
    },

    /** Drive one nozzle directly, e.g. for engine-out or post-stall demos. */
    setVectorSide(which, pitchDeg, yawDeg) {
      vectorSide(sides[which], pitchDeg, yawDeg);
    },

    /** Same throttle on both engines. */
    setThrottle(t) {
      throttleSide(sides.R, t);
      throttleSide(sides.L, t);
    },

    /** Independent per-engine throttle. */
    setThrottleSide(which, t) {
      throttleSide(sides[which], t);
    },

    /** Bypass the throttle schedule and drive exit area directly, -1 .. +1. */
    setExitArea(a) {
      areaSide(sides.R, a);
      areaSide(sides.L, a);
    },

    /** Back to neutral: no deflection, modelled rest exit area. */
    reset() {
      this.setVector(0, 0);
      this.setExitArea(0);
    },
  };

  // The glTF nodes carry no default weights, so influences arrive as [0, 0].
  // Apply the neutral state explicitly so the rig looks the same whether or
  // not the caller ever touches setThrottle.
  rig.reset();
  return rig;
}

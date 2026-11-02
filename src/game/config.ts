/**
 * Every tunable number for the playground lives here. Logic modules read
 * from these objects and never hard-code feel values, so tuning is a matter
 * of editing this file only.
 *
 * Units: metres, seconds, radians (unless a name says `Deg`), m/s for speed.
 */

const DEG = Math.PI / 180;

/** Render quality. Pixel count scales with pixelRatio², the biggest GPU cost. */
export const RENDER = {
  /** Upper bound on devicePixelRatio. 1 = CSS pixels, sharper but slower above. */
  maxPixelRatio: 1,
  /** MSAA. Expensive at high pixel ratios. */
  antialias: false,
  /** Sun shadow map resolution (square). */
  shadowMapSize: 1024,
};

export const SIM = {
  /** Fixed physics step. Rendering interpolates between steps. */
  fixedDt: 1 / 120,
  /** Upper bound on simulated time per rendered frame (tab-switch guard). */
  maxFrameDt: 0.1,
  gravity: 9.81,
};

/** Progressive keyboard input: how fast an axis builds up and decays. */
export const INPUT = {
  /** Units/s an axis climbs toward ±1 while its key is held. */
  riseRate: 2.4,
  /** Extra climb rate gained per second of holding (the longer, the faster). */
  riseAccel: 3.0,
  /** Units/s an axis falls back to 0 once released. */
  fallRate: 3.2,
  /** Units/s when the player reverses direction (opposite key pressed). */
  reverseRate: 6.0,
  /**
   * Response curve exponent applied after smoothing. >1 gives fine control
   * near centre: a tap reaches ~0.2 raw → ~0.08 effective.
   */
  curve: { pitch: 1.6, roll: 1.4, yaw: 1.5 },
  /** How fast the W / S thrust command builds up to ±1 (per second). */
  thrustRate: 4.0,
  /** How fast it eases back to 0 (= hold speed) on release (per second). */
  thrustReleaseRate: 6.0,
  /** Afterburner and airbrake ramp time constants (per second). */
  afterburnerRate: 3.5,
  airbrakeRate: 4.0,
};

/**
 * Speed / energy model. Two presets — see docs/FLIGHT_SPEED_GUIDE.md.
 *
 *   arcade    : fast top speeds and strong acceleration all the way up (current)
 *   realistic : roughly F-22-class numbers at low altitude (sea-level air)
 *
 * Switch with SPEED_MODEL below; everything else in FLIGHT is shared.
 */
export type SpeedModel = 'arcade' | 'realistic';
export const SPEED_MODEL: SpeedModel = 'arcade';

export const SPEED_PRESETS = {
  arcade: {
    /** Dry (military power) top speed, m/s. 470 ≈ 1690 km/h ≈ Mach 1.4. */
    milSpeed: 470,
    /** Afterburner top speed, m/s. 640 ≈ 2300 km/h ≈ Mach 1.9. */
    afterburnerSpeed: 640,
    /** Hard clamp (dives). */
    maxSpeed: 700,
    /** Acceleration from W at low speed (m/s²); tapers to 0 at `milSpeed`. */
    dryAccel: 14,
    /** Extra acceleration from afterburner (m/s²); tapers to 0 at `afterburnerSpeed`. */
    afterburnerAccel: 22,
    /**
     * Thrust taper shape: accel × (1 − (v / vmax)^n). High n keeps the
     * acceleration strong until close to top speed; 2 behaves like real drag.
     */
    thrustTaperExp: 8,
    /** Deceleration from S at `milSpeed` (m/s²); weaker when slower. */
    idleDecel: 14,
    /** Above `milSpeed` without AB, speed decays toward it at this rate (1/s × excess). */
    overspeedDrag: 0.06,
    /** Speed lost per second per g above 1 g (m/s per g per s). */
    turnBleed: 1.6,
    /** Pitch rate is limited so load factor stays under this (wider turns when fast). */
    gLimit: 9.5,
    /** Control authority starts dropping above this speed (q-limit). */
    qLimitSpeed: 450,
  },
  realistic: {
    milSpeed: 340, // ≈ 1220 km/h ≈ Mach 1.0 at sea level
    afterburnerSpeed: 410, // ≈ 1480 km/h ≈ Mach 1.2 (dense air limits low-level speed)
    maxSpeed: 450,
    dryAccel: 6, // ≈ 0.6 g with drag at low speed
    afterburnerAccel: 5, // ≈ 1.1 g total with AB
    thrustTaperExp: 2, // drag rises with v², so acceleration fades steadily
    idleDecel: 8,
    overspeedDrag: 0.05,
    turnBleed: 2.2,
    gLimit: 9,
    qLimitSpeed: 300,
  },
} as const;

export const FLIGHT = {
  /** Spawn speed, and the reference speed for airbrake / FOV scaling. */
  cruiseSpeed: 230,
  /**
   * Speed is held, not targeted: with W / S released thrust balances drag at
   * whatever speed you have. W / S / Shift add or remove energy; climbs,
   * turns and the airbrake take it away and it does not come back by itself.
   */
  ...SPEED_PRESETS[SPEED_MODEL],
  /**
   * Arcade body rates would give absurd real g at high speed. Load factor is
   * computed as 1 + gScale * pitchRate * speed / g so a full pull at cruise
   * reads ~8 g, and both the HUD and the turn bleed use that number.
   */
  gScale: 0.26,
  /** Airbrake deceleration at full deployment, scaled by speed/cruise. */
  airbrakeDecel: 42,
  minSpeed: 55,

  /** Max body rates at full stick, deg/s. */
  maxRateDeg: { pitch: 62, roll: 210, yaw: 22 },
  /** How quickly the actual body rate reaches the commanded rate (1/s). */
  rateResponse: { pitch: 6.0, roll: 7.5, yaw: 4.0 },
  /**
   * Control effectiveness vs speed: full authority above `fullAuthSpeed`,
   * fading toward `minAuthority` at `minSpeed`.
   */
  fullAuthSpeed: 160,
  minAuthority: 0.35,
  /** Authority left at `maxSpeed` (q-limit starts at the preset's `qLimitSpeed`). */
  qLimitAuthority: 0.72,

  /**
   * How fast the velocity vector swings toward the nose (1/s). This is the
   * "lift": lower = more drift / slip, higher = on rails. Scaled by
   * effectiveness so slow flight mushes.
   */
  pathAlign: 5.5,
  /** Sideslip decays a bit faster than angle of attack. */
  slipAlign: 6.5,
  /**
   * Fraction of gravity that bends the flight path (the rest is assumed
   * trimmed out). Sets the hands-off sink rate and the level-flight gap
   * between boresight and FPM: ~0.5° at cruise, several degrees when slow.
   */
  gravitySag: 0.6,
  /** Max angle allowed between nose and velocity (keeps FPM on screen). */
  maxAlphaDeg: 22,

  /**
   * Bank-to-turn: a banked aircraft drifts its heading toward the low wing at
   * `bankTurn * g * sin(bank) / speed` rad/s, like the horizontal lift
   * component would, so rolling alone already starts a gentle turn.
   */
  bankTurn: 1.0,

  spawn: {
    altitude: 450,
    /** Spawn point is south of the runway threshold, heading north. */
    position: { x: 0, z: 2600 },
    headingDeg: 0,
  },
};

/**
 * Mouse aim: the mouse steers a world-space aim direction and the aim
 * controller turns the nose toward it. See docs/MOUSE_CONTROL_SPEC.md.
 */
export const MOUSE = {
  /** Aim rotation per pixel of mouse travel at `CAMERA.fovBase` (scales with FOV). */
  sensitivityDegPerPx: 0.07,
  invertY: false,
  /** Per-event deltas larger than this (px) are dropped as pointer-lock glitches. */
  maxEventDelta: 400,
  /**
   * Aim range at start, switchable in game (G key / toolbar):
   *   limited — the aim may lead the nose by at most `coneDeg`
   *   free    — the aim goes anywhere, even behind the jet; the aircraft
   *             still only turns as fast as its rates and G-limit allow
   */
  aimLimit: 'limited' as 'limited' | 'free',
  /** Furthest the aim may lead the nose in limited mode (deg). */
  coneDeg: 65,

  /**
   * Turn strategy blends on aim error: below `directDeg` the nose is moved
   * with pitch + yaw only (no roll), above `bankDeg` it is bank-and-yank.
   */
  directDeg: 6,
  bankDeg: 25,
  /**
   * Rate controller per axis: commanded rate = gain × error − damping × rate,
   * in rad/s per rad of error, then divided by the available rate to give stick.
   */
  gain: { pitch: 7.0, roll: 9.0, yaw: 5.0 },
  damping: { pitch: 0.9, roll: 0.9, yaw: 0.6 },
  /** Strongest push (negative stick) allowed while banking toward the aim. */
  bankPushLimit: 0.25,
  /** Share of yaw kept in bank-and-yank (the rest is left to the roll). */
  bankYawShare: 0.3,
  /**
   * When the aim sits almost straight below the lift vector, the roll keeps
   * its chosen direction until the roll error is this far (deg) past 180°.
   */
  rollHysteresisDeg: 25,

  /**
   * Auto-bank roll-out: once the aim is reached and the mouse has rested for
   * `idleTime`, the roll the controller itself added (bank-and-yank) is
   * unwound. Roll made with A / D resets that count, and a pure pitch loop
   * adds none, so knife-edge or inverted flight set by the player is kept.
   * Off: the jet stays at the bank it ended its last turn with (~110°).
   */
  rollOut: { enabled: true, idleTime: 0.35, gain: 3.0, maxRateDeg: 140 },

  /** Seconds for the aim controller to take an axis back after manual input ends. */
  handbackTime: 0.25,
  /** Aim keeps following the nose after pitch / yaw input until that body rate drops below this (deg/s). */
  syncRateDeg: 4,
  /** Aim error (deg) above which a saturated controller is reported to the HUD. */
  saturationErrorDeg: 8,
};

export const CAMERA = {
  fovBase: 62,
  /** FOV added at max speed / with full afterburner. */
  fovSpeedGain: 12,
  fovAfterburnerGain: 6,
  fovRate: 4,
  near: 0.5,
  far: 26000,
  /** Chase offset in aircraft lengths is not used: these are metres. */
  distance: 24.5,
  height: 5.9,
  /** Camera is pulled back this many extra metres at full afterburner. */
  afterburnerPullback: 5,
  /** Extra distance when braking pushes camera in (negative pulls in). */
  airbrakePullback: -2.5,
  /** Rotation smoothing per second for each mode (higher = stiffer). */
  lockFollowRate: 13,
  horizonFollowRate: 9,
  /** Upper bound on camera rotation speed (deg/s), keeps hand-overs smooth. */
  maxTurnRateDeg: 200,
  /**
   * Horizon lock still banks with the aircraft for life: peak tilt (deg) at
   * 90° bank, easing back to level when inverted so a full roll never flips.
   */
  horizonBankFollowDeg: 14,
  /** |forward.y| range over which horizon lock hands over to the aircraft up vector. */
  verticalBlend: [0.78, 0.97] as [number, number],
  /** Aim lock: rotation smoothing (1/s) — stiff, the view should track the mouse. */
  aimFollowRate: 16,
  /** Aim lock looks along aim × this + flight path × (1 − this). */
  aimLookWeight: 0.65,
  /** Aim lock bank follow (deg at 90° bank), like `horizonBankFollowDeg`. */
  aimBankFollowDeg: 22,
  /** Free look: rotation per pixel (deg), pitch clamp (deg), return rate after release (1/s). */
  freeLookDegPerPx: 0.15,
  freeLookMaxPitchDeg: 75,
  freeLookReturnRate: 6,
  /** Position spring (1/s). The lag makes accelerations readable. */
  positionRate: 24,
  /** How fast the chase distance settles after afterburner / airbrake changes (1/s). */
  distanceRate: 5,
  /** Camera shake amplitude (metres) at full afterburner / high G. */
  shakeAfterburner: 0.012,
  shakeG: 0.04,
};

export const HUD = {
  color: '#7dffb0',
  warnColor: '#ffb84d',
  dangerColor: '#ff5a4d',
  /** Display units. */
  speedUnit: 'km/h' as 'km/h' | 'kt',
  /** Seconds-to-impact that triggers PULL UP. */
  pullUpTime: 4.5,
  lowSpeedWarn: 90,
};

export const WORLD = {
  /** Half-size of the test area; leaving it starts the reset countdown. */
  boundsHalf: 14000,
  ceiling: 12000,
  outOfBoundsGrace: 5,
  /** Seconds the wreck is shown before automatic reset. */
  crashResetDelay: 2.6,
  fogDensity: 0.000055,
  groundSize: 40000,
  gridMinor: 100,
  gridMajor: 1000,
};

export const DEG2RAD = DEG;

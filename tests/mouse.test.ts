import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { FlightModel } from '../src/game/flight/FlightModel';
import { FlightControls, type ControlKeys } from '../src/game/input/ControlAxes';
import { ControlMixer } from '../src/game/input/ControlMixer';
import { MouseAim } from '../src/game/input/MouseAim';
import { MOUSE, SIM } from '../src/game/config';

const NONE: ControlKeys = {
  pitchUp: false,
  pitchDown: false,
  rollLeft: false,
  rollRight: false,
  yawLeft: false,
  yawRight: false,
  throttleUp: false,
  throttleDown: false,
  airbrake: false,
  afterburner: false,
};

/** Unit direction at a compass heading and elevation (degrees). */
function dir(headingDeg: number, elevDeg: number) {
  const h = (headingDeg * Math.PI) / 180;
  const e = (elevDeg * Math.PI) / 180;
  return new Vector3(Math.sin(h) * Math.cos(e), Math.sin(e), -Math.cos(h) * Math.cos(e));
}

function setup(speed = 230) {
  const fm = new FlightModel();
  fm.reset(new Vector3(0, 3000, 0), 0, speed);
  const c = new FlightControls();
  const m = new ControlMixer(c);
  m.reset(fm);
  return { fm, c, m };
}

type Sample = { t: number; err: number; roll: number; pitch: number; heading: number; nose: Vector3 };

/** Fly with the mixer for `seconds`, calling `each` after every step. */
function fly(
  s: ReturnType<typeof setup>,
  keys: Partial<ControlKeys>,
  seconds: number,
  each?: (x: Sample) => void,
) {
  const dt = SIM.fixedDt;
  const k = { ...NONE, ...keys };
  for (let t = 0; t < seconds; t += dt) {
    s.c.update(k, dt);
    s.m.step(s.fm, dt);
    s.fm.step(s.m, dt);
    if (each) {
      const tel = s.fm.telemetry();
      each({
        t,
        err: s.m.autopilot.errorDeg,
        roll: tel.rollDeg,
        pitch: tel.pitchDeg,
        heading: tel.headingDeg,
        nose: s.fm.forward(),
      });
    }
  }
}

describe('aim controller conventions', () => {
  it('aim to the right banks right and turns right, then rolls back out', () => {
    const s = setup();
    s.m.aim.dir.copy(dir(30, 0));
    let maxRoll = 0;
    let reached: number | null = null;
    let worstAfter = 0;
    fly(s, {}, 6, (x) => {
      maxRoll = Math.max(maxRoll, x.roll);
      if (reached === null && x.err < 3) reached = x.t;
      if (reached !== null) worstAfter = Math.max(worstAfter, x.err);
    });
    expect(maxRoll).toBeGreaterThan(45); // bank-and-yank, not a flat yaw turn
    expect(reached).not.toBeNull();
    expect(reached!).toBeLessThan(1.3);
    expect(worstAfter).toBeLessThan(3.5); // no overshoot / oscillation
    const t = s.fm.telemetry();
    expect(t.headingDeg).toBeGreaterThan(25);
    expect(t.headingDeg).toBeLessThan(35);
    expect(Math.abs(t.rollDeg)).toBeLessThan(10); // roll-out unwound the turn bank
  });

  it('aim straight up pitches without rolling', () => {
    const s = setup();
    s.m.aim.dir.copy(dir(0, 40));
    let maxAbsRoll = 0;
    fly(s, {}, 2, (x) => (maxAbsRoll = Math.max(maxAbsRoll, Math.abs(x.roll))));
    expect(maxAbsRoll).toBeLessThan(2);
    expect(s.fm.telemetry().pitchDeg).toBeGreaterThan(35);
    expect(s.m.autopilot.errorDeg).toBeLessThan(2);
  });

  it('a small error is fixed with pitch and yaw only', () => {
    const s = setup();
    s.m.aim.dir.copy(dir(4, -2));
    let maxAbsRoll = 0;
    fly(s, {}, 1.5, (x) => (maxAbsRoll = Math.max(maxAbsRoll, Math.abs(x.roll))));
    expect(maxAbsRoll).toBeLessThan(2);
    expect(s.m.autopilot.errorDeg).toBeLessThan(0.5);
  });

  it('inverted with a small error toward the canopy-down side pushes instead of flipping', () => {
    const s = setup();
    s.fm.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI));
    s.m.reset(s.fm);
    // World-up of the nose is body-down when inverted.
    s.m.aim.dir.copy(dir(0, 4));
    let minAbsRoll = 180;
    fly(s, {}, 1.5, (x) => (minAbsRoll = Math.min(minAbsRoll, Math.abs(x.roll))));
    expect(minAbsRoll).toBeGreaterThan(170);
    expect(s.m.autopilot.errorDeg).toBeLessThan(1);
  });

  it('aim far below rolls over and pulls, holding one roll direction', () => {
    const s = setup();
    s.m.aim.dir.copy(dir(0, -40));
    let rateFlips = 0;
    let lastSign = 0;
    fly(s, {}, 1.2, () => {
      const sgn = Math.sign(s.fm.rates.z);
      if (Math.abs(s.fm.rates.z) > 0.3) {
        if (lastSign !== 0 && sgn !== lastSign) rateFlips++;
        lastSign = sgn;
      }
    });
    expect(rateFlips).toBe(0);
    expect(s.m.autopilot.errorDeg).toBeLessThan(10);
  });

  it('stays finite and keeps tracking through a vertical pull', () => {
    const s = setup();
    // Drag the aim over the top in small steps, like a mouse loop.
    let nan = false;
    for (let i = 0; i < 300; i++) {
      const nose = s.fm.forward();
      const right = s.fm.right();
      s.m.aim.dir.copy(nose).applyAxisAngle(right, 0.35).normalize();
      fly(s, {}, 1 / 60, (x) => (nan ||= !Number.isFinite(x.err) || !Number.isFinite(x.roll)));
    }
    expect(nan).toBe(false);
    expect(Number.isFinite(s.m.pitch + s.m.roll + s.m.yaw)).toBe(true);
  });
});

describe('aim limit', () => {
  it('limited mode pulls an aim behind the jet into the cone; free mode leaves it', () => {
    const limited = setup();
    limited.m.aim.dir.copy(dir(180, 0));
    fly(limited, {}, 1 / 120);
    expect(limited.m.autopilot.errorDeg).toBeLessThanOrEqual(MOUSE.coneDeg + 0.5);

    const free = setup();
    free.m.aimLimit = 'free';
    free.m.aim.dir.copy(dir(180, 0));
    fly(free, {}, 1 / 120);
    expect(free.m.autopilot.errorDeg).toBeGreaterThan(170);
    expect(free.m.aim.dir.angleTo(dir(180, 0))).toBeLessThan(1e-6);
  });

  for (const [name, target] of [
    ['straight behind', dir(180, 0)],
    ['behind and left', dir(-150, 10)],
    ['up and over the top', dir(180, 60)],
    ['below and behind', dir(160, -50)],
  ] as const) {
    it(`free aim ${name}: turns all the way round without flip-flopping`, () => {
      const s = setup();
      s.m.aimLimit = 'free';
      s.m.aim.dir.copy(target);
      let reached: number | null = null;
      let finite = true;
      let maxRise = 0; // largest increase of the error over 0.25 s
      const hist: number[] = [];
      fly(s, {}, 8, (x) => {
        finite &&= Number.isFinite(x.err) && Number.isFinite(x.roll);
        if (reached === null && x.err < 3) reached = x.t;
        hist.push(x.err);
        if (reached === null && hist.length > 30) maxRise = Math.max(maxRise, x.err - hist[hist.length - 31]);
      });
      expect(finite).toBe(true);
      expect(reached).not.toBeNull();
      expect(reached!).toBeLessThan(6);
      expect(maxRise).toBeLessThan(3);
      expect(s.m.autopilot.errorDeg).toBeLessThan(2);
    });
  }
});

describe('roll-out', () => {
  it('stopping the mouse inverted at the top of a loop does not flip the jet upright', () => {
    const s = setup(300);
    // Drag the aim over the top until the jet is inverted and level-ish.
    for (let i = 0; i < 600; i++) {
      const tel = s.fm.telemetry();
      if (Math.abs(tel.rollDeg) > 170 && Math.abs(tel.pitchDeg) < 15) break;
      s.m.aim.dir.copy(s.fm.forward()).applyAxisAngle(s.fm.right(), 0.35).normalize();
      s.m.aim.idle = 0;
      fly(s, {}, 1 / 60);
    }
    const top = s.fm.telemetry();
    expect(Math.abs(top.rollDeg)).toBeGreaterThan(170);
    // Mouse at rest: the aim stays where the drag left it, roll-out may act.
    let minAbsRoll = 180;
    fly(s, {}, 2, (x) => (minAbsRoll = Math.min(minAbsRoll, Math.abs(x.roll))));
    expect(minAbsRoll).toBeGreaterThan(150);
  });

  it('roll the controller made to reach an aim below is unwound', () => {
    const s = setup();
    s.m.aim.dir.copy(dir(0, -40));
    let maxAbsRoll = 0;
    fly(s, {}, 7, (x) => (maxAbsRoll = Math.max(maxAbsRoll, Math.abs(x.roll))));
    expect(maxAbsRoll).toBeGreaterThan(150);
    expect(Math.abs(s.fm.telemetry().rollDeg)).toBeLessThan(15);
  });
});

describe('manual override', () => {
  it('rolling by hand keeps the nose near the aim (barrel roll around it)', () => {
    const s = setup();
    const aim = s.m.aim.dir.clone();
    let worst = 0;
    let rolled = 0;
    let prev = 0;
    fly(s, { rollRight: true }, 2, (x) => {
      worst = Math.max(worst, (x.nose.angleTo(aim) * 180) / Math.PI);
      let d = x.roll - prev;
      if (d < -180) d += 360;
      rolled += d;
      prev = x.roll;
    });
    expect(rolled).toBeGreaterThan(300);
    expect(worst).toBeLessThan(15);
    expect(s.m.aim.dir.angleTo(aim)).toBeLessThan(1e-6); // roll keeps the aim
  });

  it('manual roll owns the axis while held, then the controller takes it back', () => {
    const s = setup();
    fly(s, { rollRight: true }, 0.3);
    expect(s.m.roll).toBe(s.c.roll);
    // Release: the axis decays, then hands back within handbackTime.
    let back: number | null = null;
    fly(s, {}, 2, (x) => {
      if (back === null && !s.c.rollAxis.active) back = x.t;
    });
    expect(back).not.toBeNull();
    expect(s.m.roll).toBeCloseTo(s.m.autopilot.roll, 6);
  });

  it('pitching by hand drags the aim along and the nose does not spring back', () => {
    const s = setup();
    fly(s, { pitchUp: true }, 0.5);
    let maxPitch = -90;
    fly(s, {}, 2.5, (x) => (maxPitch = Math.max(maxPitch, x.pitch)));
    const final = s.fm.telemetry().pitchDeg;
    expect(maxPitch).toBeGreaterThan(15);
    expect(final).toBeGreaterThan(maxPitch - 1.5);
    expect(s.m.autopilot.errorDeg).toBeLessThan(1);
  });

  it('a bank set by hand is kept (roll-out returns to it, not to level)', () => {
    const s = setup();
    fly(s, { rollRight: true }, 0.3);
    let bankAtRelease = 0;
    fly(s, {}, 0.6, () => {
      if (s.c.rollAxis.active) bankAtRelease = s.fm.telemetry().rollDeg;
    });
    fly(s, {}, 3);
    expect(bankAtRelease).toBeGreaterThan(20);
    expect(Math.abs(s.fm.telemetry().rollDeg - bankAtRelease)).toBeLessThan(8);
  });
});

describe('keyboard-only mode', () => {
  it('mixer output equals the keyboard controls exactly', () => {
    const s = setup();
    s.m.mode = 'keyboard';
    s.m.reset(s.fm);
    const script: [Partial<ControlKeys>, number][] = [
      [{ pitchUp: true }, 0.4],
      [{ rollLeft: true, throttleUp: true }, 0.7],
      [{}, 0.3],
      [{ yawRight: true, afterburner: true }, 0.5],
      [{ pitchDown: true, rollRight: true, airbrake: true }, 0.6],
      [{}, 1],
    ];
    const dt = SIM.fixedDt;
    for (const [keys, seconds] of script) {
      const k = { ...NONE, ...keys };
      for (let t = 0; t < seconds; t += dt) {
        s.c.update(k, dt);
        s.m.step(s.fm, dt);
        expect(s.m.pitch).toBe(s.c.pitch);
        expect(s.m.roll).toBe(s.c.roll);
        expect(s.m.yaw).toBe(s.c.yaw);
        expect(s.m.thrust).toBe(s.c.thrust);
        expect(s.m.afterburner).toBe(s.c.afterburner);
        expect(s.m.airbrake).toBe(s.c.airbrake);
        s.fm.step(s.m, dt);
      }
    }
  });
});

describe('mouse aim', () => {
  function camera(q: Quaternion) {
    const cam = new PerspectiveCamera(62, 1.6, 0.5, 1000);
    cam.quaternion.copy(q);
    cam.updateMatrixWorld();
    return cam;
  }

  it('mouse moves follow the camera axes, not world axes', () => {
    // Camera looking north (-Z), rolled so that screen-up is world east (+X).
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);
    const cam = camera(q);
    const camUp = new Vector3(0, 1, 0).applyQuaternion(q);
    const camRight = new Vector3(1, 0, 0).applyQuaternion(q);

    const up = new MouseAim();
    up.dir.set(0, 0, -1);
    up.rotate(0, -100, cam); // mouse up
    expect(up.dir.dot(camUp)).toBeGreaterThan(0.05);
    expect(Math.abs(up.dir.y)).toBeLessThan(1e-6); // world up untouched

    const right = new MouseAim();
    right.dir.set(0, 0, -1);
    right.rotate(100, 0, cam); // mouse right
    expect(right.dir.dot(camRight)).toBeGreaterThan(0.05);
  });

  it('is clamped to the cone around the nose', () => {
    const aim = new MouseAim();
    const nose = new Vector3(0, 0, -1);
    aim.dir.set(1, 0, 0);
    aim.clampToCone(nose);
    expect(aim.errorDeg(nose)).toBeCloseTo(MOUSE.coneDeg, 4);
    expect(aim.dir.x).toBeGreaterThan(0); // pulled back along the same side
  });
});

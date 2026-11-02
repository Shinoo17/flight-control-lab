import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { FlightModel } from '../src/game/flight/FlightModel';
import { FlightControls, type ControlKeys } from '../src/game/input/ControlAxes';
import { FLIGHT, SIM } from '../src/game/config';

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

function setup() {
  const fm = new FlightModel();
  fm.reset(new Vector3(0, 2000, 0), 0);
  const c = new FlightControls();
  return { fm, c };
}

function run(fm: FlightModel, c: FlightControls, keys: Partial<ControlKeys>, seconds: number) {
  const dt = SIM.fixedDt;
  const k = { ...NONE, ...keys };
  for (let t = 0; t < seconds; t += dt) {
    c.update(k, dt);
    fm.step(c, dt);
  }
}

describe('orientation conventions', () => {
  it('spawns heading north with level wings', () => {
    const { fm } = setup();
    const t = fm.telemetry();
    expect(t.headingDeg).toBeCloseTo(0, 3);
    expect(Math.abs(t.rollDeg)).toBeLessThan(1e-6);
    expect(fm.forward().z).toBeLessThan(-0.99);
  });

  it('pitch up raises the nose', () => {
    const { fm, c } = setup();
    run(fm, c, { pitchUp: true }, 0.6);
    expect(fm.forward().y).toBeGreaterThan(0.2);
  });

  it('pitch down lowers the nose', () => {
    const { fm, c } = setup();
    run(fm, c, { pitchDown: true }, 0.6);
    expect(fm.forward().y).toBeLessThan(-0.2);
  });

  it('roll right lowers the right wing', () => {
    const { fm, c } = setup();
    run(fm, c, { rollRight: true }, 0.45);
    expect(fm.right().y).toBeLessThan(-0.2);
    expect(fm.telemetry().rollDeg).toBeGreaterThan(10);
  });

  it('yaw right turns heading toward east', () => {
    const { fm, c } = setup();
    run(fm, c, { yawRight: true }, 1.0);
    const h = fm.telemetry().headingDeg;
    expect(h).toBeGreaterThan(5);
    expect(h).toBeLessThan(90);
  });

  it('banking right drifts heading right', () => {
    const { fm, c } = setup();
    run(fm, c, { rollRight: true }, 0.25);
    run(fm, c, {}, 4);
    const h = fm.telemetry().headingDeg;
    expect(h).toBeGreaterThan(1);
    expect(h).toBeLessThan(180);
  });
});

describe('progressive input', () => {
  it('a tap is gentle, a hold reaches full deflection', () => {
    const c = new FlightControls();
    c.update({ ...NONE, pitchUp: true }, 0.08);
    expect(c.pitch).toBeGreaterThan(0);
    expect(c.pitch).toBeLessThan(0.15);
    for (let i = 0; i < 60; i++) c.update({ ...NONE, pitchUp: true }, 1 / 60);
    expect(c.pitch).toBeCloseTo(1, 5);
  });

  it('decays smoothly instead of snapping on release', () => {
    const c = new FlightControls();
    for (let i = 0; i < 60; i++) c.update({ ...NONE, rollLeft: true }, 1 / 60);
    c.update(NONE, 1 / 60);
    expect(c.roll).toBeLessThan(-0.8);
    for (let i = 0; i < 60; i++) c.update(NONE, 1 / 60);
    expect(c.roll).toBe(0);
  });

  it('opposite keys cancel instead of fighting', () => {
    const c = new FlightControls();
    for (let i = 0; i < 30; i++) c.update({ ...NONE, rollLeft: true, rollRight: true }, 1 / 60);
    expect(c.roll).toBe(0);
  });
});

describe('energy', () => {
  it('climbing loses speed, diving gains it', () => {
    const level = setup();
    run(level.fm, level.c, {}, 10);

    const climb = setup();
    run(climb.fm, climb.c, { pitchUp: true }, 0.75);
    run(climb.fm, climb.c, {}, 10);

    const dive = setup();
    run(dive.fm, dive.c, { pitchDown: true }, 0.75);
    run(dive.fm, dive.c, {}, 8);

    expect(climb.fm.position.y).toBeGreaterThan(level.fm.position.y + 300);
    expect(climb.fm.speed).toBeLessThan(level.fm.speed - 25);
    expect(dive.fm.speed).toBeGreaterThan(level.fm.speed + 25);
  });

  it('a hard sustained pull bleeds more speed than straight flight', () => {
    const straight = setup();
    run(straight.fm, straight.c, {}, 5);
    const pull = setup();
    // Bank 90° first so the pull is a level turn and gravity stays out of it.
    run(pull.fm, pull.c, { rollRight: true }, 0.42);
    run(pull.fm, pull.c, { pitchUp: true }, 5);
    expect(pull.fm.speed).toBeLessThan(straight.fm.speed - 30);
  });

  it('releasing W holds the speed reached instead of returning to cruise', () => {
    const { fm, c } = setup();
    run(fm, c, { throttleUp: true }, 8);
    expect(fm.speed).toBeGreaterThan(FLIGHT.cruiseSpeed + 40);
    run(fm, c, {}, 1); // let the command ease to 0
    const released = fm.speed;
    run(fm, c, {}, 15);
    expect(Math.abs(fm.speed - released) / released).toBeLessThan(0.03);
  });

  it('S decelerates and the lower speed is then held', () => {
    const { fm, c } = setup();
    run(fm, c, { throttleDown: true }, 4);
    expect(fm.speed).toBeLessThan(FLIGHT.cruiseSpeed - 25);
    run(fm, c, {}, 1);
    const released = fm.speed;
    run(fm, c, {}, 10);
    expect(Math.abs(fm.speed - released)).toBeLessThan(5);
  });

  it('speed lost in a turn stays lost after rolling level', () => {
    const { fm, c } = setup();
    run(fm, c, { rollRight: true }, 0.42);
    run(fm, c, { pitchUp: true }, 4);
    run(fm, c, { rollLeft: true }, 0.42);
    run(fm, c, {}, 2);
    const afterTurn = fm.speed;
    expect(afterTurn).toBeLessThan(FLIGHT.cruiseSpeed - 30);
    run(fm, c, {}, 10);
    // The turn left the nose ~8° low, so gravity adds a little back, but
    // nothing pulls it back up to the pre-turn speed.
    expect(fm.speed).toBeLessThan(FLIGHT.cruiseSpeed - 15);
    expect(fm.speed).toBeLessThan(afterTurn + 20);
  });

  it('dry power tops out near milSpeed, afterburner goes well beyond', () => {
    const dry = setup();
    run(dry.fm, dry.c, { throttleUp: true }, 90);
    expect(dry.fm.speed).toBeGreaterThan(FLIGHT.milSpeed * 0.93);
    expect(dry.fm.speed).toBeLessThanOrEqual(FLIGHT.milSpeed + 1);

    const ab = setup();
    run(ab.fm, ab.c, { throttleUp: true, afterburner: true }, 6);
    expect(ab.fm.speed).toBeGreaterThan(FLIGHT.cruiseSpeed + 80);
    run(ab.fm, ab.c, { throttleUp: true, afterburner: true }, 90);
    expect(ab.fm.speed).toBeGreaterThan(FLIGHT.milSpeed + 100);

    // Dropping out of afterburner above milSpeed decays back toward it.
    const fast = ab.fm.speed;
    run(ab.fm, ab.c, {}, 20);
    expect(ab.fm.speed).toBeLessThan(fast - 50);
  });

  it('airbrake decelerates hard', () => {
    const brk = setup();
    run(brk.fm, brk.c, { airbrake: true }, 3);
    expect(brk.fm.speed).toBeLessThan(FLIGHT.cruiseSpeed - 50);
  });

  it('flight path marker separates from the nose during a pull', () => {
    const { fm, c } = setup();
    run(fm, c, { pitchUp: true }, 0.8);
    expect(fm.telemetry().alphaDeg).toBeGreaterThan(2);
  });
});

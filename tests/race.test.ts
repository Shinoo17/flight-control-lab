import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { RingRace } from '../src/game/race/RingRace';
import { RaceRecords, formatRaceTime, type RecordStore } from '../src/game/race/RaceRecords';
import type { Ring } from '../src/game/world/zones';

// Three rings 400 m apart along -Z, flown in that direction.
const RINGS: Ring[] = [0, 1, 2].map((i) => ({
  center: new Vector3(0, 100, -400 * i),
  normal: new Vector3(0, 0, -1),
  radius: 40,
}));

const DT = 0.5;

/** Fly from z0 to z1 at (x, y) in `steps` fixed steps; returns every event. */
function fly(race: RingRace, x: number, y: number, z0: number, z1: number, steps: number) {
  const events = [];
  const prev = new Vector3();
  const pos = new Vector3();
  for (let i = 0; i < steps; i++) {
    prev.set(x, y, z0 + ((z1 - z0) * i) / steps);
    pos.set(x, y, z0 + ((z1 - z0) * (i + 1)) / steps);
    const ev = race.step(prev, pos, DT);
    if (ev) events.push(ev);
  }
  return events;
}

describe('RingRace', () => {
  it('starts on ring 1 and finishes after the last ring with interpolated time', () => {
    const race = new RingRace(RINGS);
    // 100 m per step: ring 1 at z = 0 is crossed exactly at the end of step 1.
    const ev = fly(race, 0, 100, 100, -900, 10);
    expect(ev.map((e) => e.kind)).toEqual(['start', 'ring', 'finish']);
    // 800 m at 200 m/s.
    const finish = ev[2];
    expect(finish.kind === 'finish' && finish.time).toBeCloseTo(4, 6);
    expect(race.running).toBe(false);
    // Ring 1 is the start line again.
    expect(race.states).toEqual(['next', 'passed', 'passed']);
  });

  it('ignores rings 2+ before the start', () => {
    const race = new RingRace(RINGS);
    expect(fly(race, 0, 100, -300, -900, 6)).toEqual([]);
    expect(race.running).toBe(false);
  });

  it('fails when the next ring is missed inside the gate', () => {
    const race = new RingRace(RINGS, 160);
    fly(race, 0, 100, 50, -50, 1);
    const ev = fly(race, 80, 100, -50, -500, 5);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'fail', reason: 'missed ring 2' });
    expect(race.states[1]).toBe('missed');
    expect(race.states[0]).toBe('next');
  });

  it('fails when the next ring is passed far wide', () => {
    const race = new RingRace(RINGS, 160);
    fly(race, 0, 100, 50, -50, 1);
    expect(fly(race, 3000, 100, -50, -500, 5)[0]).toMatchObject({ kind: 'fail', reason: 'missed ring 2' });
  });

  it('fails when the last ring is passed far wide', () => {
    const race = new RingRace(RINGS, 160);
    fly(race, 0, 100, 50, -450, 5);
    expect(fly(race, 0, 3000, -450, -900, 5)[0]).toMatchObject({ kind: 'fail', reason: 'missed ring 3' });
  });

  it('fails when a ring is skipped', () => {
    const race = new RingRace(RINGS, 160);
    fly(race, 0, 100, 50, -50, 1);
    // One long step across ring 3's plane only, as if ring 2 had been bypassed.
    const ev = fly(race, 0, 100, -790, -810, 1);
    expect(ev[0]).toMatchObject({ kind: 'fail', reason: 'skipped ring 2' });
  });

  it('fail() ends a run and is a no-op when idle', () => {
    const race = new RingRace(RINGS);
    expect(race.fail('crashed')).toBeNull();
    fly(race, 0, 100, 50, -50, 1);
    expect(race.fail('crashed')).toMatchObject({ kind: 'fail', reason: 'crashed' });
    expect(race.running).toBe(false);
  });

  it('ring 1 starts a fresh run after a fail', () => {
    const race = new RingRace(RINGS, 160);
    fly(race, 0, 100, 50, -50, 1);
    race.fail('crashed');
    expect(fly(race, 0, 100, 50, -50, 1)[0]).toEqual({ kind: 'start' });
    expect(race.states).toEqual(['passed', 'next', 'idle']);
  });
});

function memoryStore(): RecordStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('RaceRecords', () => {
  it('keeps the fastest runs sorted and trimmed', () => {
    const store = memoryStore();
    const rec = new RaceRecords(store, 3);
    expect(rec.add({ time: 50, aircraft: 'f22', date: 1 })).toBe(1);
    expect(rec.add({ time: 40, aircraft: 'su57', date: 2 })).toBe(1);
    expect(rec.add({ time: 60, aircraft: 'f22', date: 3 })).toBe(3);
    expect(rec.add({ time: 70, aircraft: 'f22', date: 4 })).toBe(0);
    expect(rec.add({ time: 45, aircraft: 'f22', date: 5 })).toBe(2);
    expect(rec.list.map((r) => r.time)).toEqual([40, 45, 50]);
    expect(rec.best).toBe(40);
    // Persisted and reloaded.
    expect(new RaceRecords(store, 3).list).toEqual(rec.list);
  });

  it('survives missing or corrupt storage', () => {
    expect(new RaceRecords(null).list).toEqual([]);
    const store = memoryStore();
    store.data.set('flight-playground.ring-records.v1', '{not json');
    expect(new RaceRecords(store).list).toEqual([]);
  });

  it('formats times as m:ss.cc', () => {
    expect(formatRaceTime(83.456)).toBe('1:23.45');
    expect(formatRaceTime(5.2)).toBe('0:05.20');
  });
});

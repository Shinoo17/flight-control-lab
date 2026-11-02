import * as THREE from 'three';
import { RACE } from '../config';
import type { Ring } from '../world/zones';

export type RingState = 'idle' | 'next' | 'passed' | 'missed';

export type RaceEvent =
  | { kind: 'start' }
  | { kind: 'ring'; index: number }
  | { kind: 'finish'; time: number }
  | { kind: 'fail'; time: number; reason: string };

/**
 * Timed run through the obstacle-course rings, in order.
 *
 * Flying through ring 1 starts the clock. Every later ring must be flown
 * through in sequence: crossing the next ring's plane anywhere outside the
 * ring, or crossing a later ring's plane near that ring first, is a fail. Time is
 * simulation time, so pauses do not count, and the crossing point inside a
 * fixed step is interpolated for sub-step precision.
 */
export class RingRace {
  readonly rings: readonly Ring[];
  readonly states: RingState[];
  running = false;
  /** Index of the ring to fly through next. */
  next = 0;
  /** Seconds since ring 1 (frozen at the last finish / fail). */
  time = 0;
  private readonly gate: number;
  private readonly _a = new THREE.Vector3();
  private readonly _x = new THREE.Vector3();

  constructor(rings: readonly Ring[], gate = RACE.gateRadius) {
    this.rings = rings;
    this.gate = gate;
    this.states = rings.map(() => 'idle');
    this.reset();
  }

  get total() {
    return this.rings.length;
  }

  /** Abort any run and clear the course (nothing is recorded). */
  reset() {
    this.running = false;
    this.next = 0;
    this.time = 0;
    this.states.fill('idle');
    if (this.states.length) this.states[0] = 'next';
  }

  /** Advance one fixed step in which the aircraft moved from `prev` to `pos`. */
  step(prev: THREE.Vector3, pos: THREE.Vector3, dt: number): RaceEvent | null {
    if (this.running) this.time += dt;
    for (let i = 0; i < this.rings.length; i++) {
      // The next ring's plane has no gate: flying past it wide, however far, is a miss.
      const hit = this.cross(this.rings[i], prev, pos, this.running && i === this.next ? Infinity : this.gate);
      if (!hit) continue;
      if (!this.running) {
        if (i !== 0 || !hit.inside) continue;
        this.reset();
        this.running = true;
        this.time = (1 - hit.t) * dt;
        this.advance();
        return { kind: 'start' };
      }
      if (i < this.next) continue;
      // Clock reading at the crossing point rather than the end of the step.
      const at = this.time - (1 - hit.t) * dt;
      if (i > this.next) return this.fail(`skipped ring ${this.next + 1}`, at);
      if (!hit.inside) return this.fail(`missed ring ${i + 1}`, at);
      this.advance();
      if (this.next < this.rings.length) return { kind: 'ring', index: i };
      this.running = false;
      this.time = at;
      this.states[0] = 'next';
      return { kind: 'finish', time: at };
    }
    return null;
  }

  /** End the current run as a fail (e.g. crashed). No-op when not running. */
  fail(reason: string, at = this.time): RaceEvent | null {
    if (!this.running) return null;
    this.running = false;
    this.time = at;
    this.states[this.next] = 'missed';
    // Ring 1 is the start line again for the next run.
    if (this.next !== 0) this.states[0] = 'next';
    return { kind: 'fail', time: at, reason };
  }

  private advance() {
    this.states[this.next] = 'passed';
    this.next++;
    if (this.next < this.states.length) this.states[this.next] = 'next';
  }

  /** Forward crossing of a ring's plane within `gate` of its centre, as step fraction `t`. */
  private cross(r: Ring, prev: THREE.Vector3, pos: THREE.Vector3, gate: number) {
    const a = this._a.copy(prev).sub(r.center).dot(r.normal);
    const b = this._a.copy(pos).sub(r.center).dot(r.normal);
    if (!(a < 0 && b >= 0)) return null;
    const t = a / (a - b);
    const d = this._x.copy(prev).lerp(pos, t).distanceTo(r.center);
    if (d > gate) return null;
    return { t, inside: d < r.radius };
  }
}

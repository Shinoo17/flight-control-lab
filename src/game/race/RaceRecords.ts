import { RACE } from '../config';
import type { AircraftId } from '../aircraft/types';

export interface RaceRecord {
  /** Seconds from ring 1 to the last ring. */
  time: number;
  aircraft: AircraftId;
  /** Epoch ms. */
  date: number;
}

/** The part of `Storage` the records need, so tests can pass a fake. */
export type RecordStore = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'flight-playground.ring-records.v1';

function browserStore(): RecordStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Fastest ring-course runs, persisted to localStorage. */
export class RaceRecords {
  list: RaceRecord[] = [];
  private readonly store: RecordStore | null;
  private readonly max: number;

  constructor(store: RecordStore | null = browserStore(), max = RACE.maxRecords) {
    this.store = store;
    this.max = max;
    this.list = this.load();
  }

  /** Best time so far, or null. */
  get best() {
    return this.list[0]?.time ?? null;
  }

  /** Insert a run; returns its 1-based rank, or 0 if it did not make the table. */
  add(r: RaceRecord): number {
    const i = this.list.findIndex((o) => r.time < o.time);
    const at = i < 0 ? this.list.length : i;
    if (at >= this.max) return 0;
    this.list = [...this.list.slice(0, at), r, ...this.list.slice(at)].slice(0, this.max);
    this.save();
    return at + 1;
  }

  clear() {
    this.list = [];
    this.save();
  }

  private load(): RaceRecord[] {
    try {
      const raw = this.store?.getItem(KEY);
      const data: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(data)) return [];
      return data
        .filter((r): r is RaceRecord => typeof r?.time === 'number' && typeof r?.aircraft === 'string' && typeof r?.date === 'number')
        .sort((a, b) => a.time - b.time)
        .slice(0, this.max);
    } catch {
      return [];
    }
  }

  private save() {
    try {
      this.store?.setItem(KEY, JSON.stringify(this.list));
    } catch {
      // Storage full or blocked: records just live for this session.
    }
  }
}

/** 83.456 → "1:23.45" */
export function formatRaceTime(sec: number) {
  const cs = Math.floor(sec * 100);
  const m = Math.floor(cs / 6000);
  const s = Math.floor(cs / 100) % 60;
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

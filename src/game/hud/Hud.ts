import * as THREE from 'three';
import { HUD as CFG } from '../config';
import type { FlightTelemetry } from '../flight/FlightModel';
import type { ControlState } from '../input/ControlAxes';
import { CAMERA_MODE_LABEL, type CameraMode } from '../camera/ChaseCamera';
import { formatRaceTime } from '../race/RaceRecords';

/** Mouse-aim state for the HUD; null in keyboard-only mode. */
export interface HudMouse {
  /** World aim direction (unit). */
  aim: THREE.Vector3;
  errorDeg: number;
  saturated: boolean;
  gLimited: boolean;
  locked: boolean;
  aimLimit: 'limited' | 'free';
  freeLook: boolean;
}

/** Ring-course timer state. */
export interface HudRace {
  running: boolean;
  /** Seconds since ring 1 (frozen after a finish / fail). */
  time: number;
  /** Rings flown this run. */
  passed: number;
  total: number;
  best: number | null;
  banner: { title: string; detail: string; good: boolean } | null;
}

export interface HudFrame {
  camera: THREE.PerspectiveCamera;
  position: THREE.Vector3;
  forward: THREE.Vector3;
  pathDir: THREE.Vector3;
  t: FlightTelemetry;
  controls: ControlState;
  /** 0..1, 0.6 = military power, 1 = full afterburner. */
  enginePower: number;
  fps: number;
  cameraMode: CameraMode;
  mouse: HudMouse | null;
  aircraftName: string;
  /** Height above whatever is directly below. */
  radarAltitude: number;
  warnings: { pullUp: boolean; outOfBounds: number | null; crashed: string | null; lowSpeed: boolean };
  race: HudRace;
}

const DEG = Math.PI / 180;
const FONT = '"Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';

/**
 * Fighter-style HUD drawn on a 2D canvas over the WebGL view.
 *
 * The boresight and Flight Path Marker are true projections: the boresight
 * is a point far along the nose, the FPM a point far along the velocity
 * vector. They coincide only when the aircraft flies exactly where it points.
 * The pitch ladder is built the same way, so it rolls and scrolls with the
 * real horizon in any camera mode. In mouse mode a third symbol, the aim
 * reticle, marks where the player has asked the nose to go.
 */
export class Hud {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private readonly _v = new THREE.Vector3();
  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-canvas';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  resize(w: number, h: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  dispose() {
    this.canvas.remove();
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** World point → screen px, or null if behind the camera. */
  private project(p: THREE.Vector3, cam: THREE.Camera): { x: number; y: number } | null {
    const v = this._v.copy(p).project(cam);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h };
  }

  draw(f: HudFrame) {
    const ctx = this.ctx;
    this.clear();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const color = CFG.color;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.6;
    // No shadowBlur: a blurred shadow on every stroke/fillText made the 2D
    // raster miss vsync on ~15% of frames at 120 Hz (measured on M3 Pro).
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const scale = Math.min(this.w, this.h) / 900;

    this.drawLadder(f, scale);
    this.drawBoresight(f, scale);
    this.drawFpm(f, scale);
    this.drawAim(f, scale);
    this.drawHeading(f, scale);
    this.drawSpeed(f, scale);
    this.drawAltitude(f, scale);
    this.drawBank(f, scale);
    this.drawEngine(f, scale);
    this.drawStatus(f, scale);
    this.drawRace(f.race, scale);
    this.drawWarnings(f, scale);
  }

  // --- symbology ---------------------------------------------------------

  private drawBoresight(f: HudFrame, s: number) {
    const p = this.project(this._a.copy(f.position).addScaledVector(f.forward, 3000), f.camera);
    if (!p) return;
    const ctx = this.ctx;
    const k = 14 * s;
    // Gun cross / waterline "-W-": shows where the nose points.
    ctx.beginPath();
    ctx.moveTo(p.x - k * 2.2, p.y);
    ctx.lineTo(p.x - k, p.y);
    ctx.lineTo(p.x - k * 0.5, p.y + k * 0.6);
    ctx.lineTo(p.x, p.y);
    ctx.lineTo(p.x + k * 0.5, p.y + k * 0.6);
    ctx.lineTo(p.x + k, p.y);
    ctx.lineTo(p.x + k * 2.2, p.y);
    ctx.stroke();
  }

  private drawFpm(f: HudFrame, s: number) {
    const p = this.project(this._a.copy(f.position).addScaledVector(f.pathDir, 3000), f.camera);
    if (!p) return;
    const ctx = this.ctx;
    const r = 8 * s;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.moveTo(p.x - r, p.y);
    ctx.lineTo(p.x - r * 2.6, p.y);
    ctx.moveTo(p.x + r, p.y);
    ctx.lineTo(p.x + r * 2.6, p.y);
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x, p.y - r * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Aim reticle: a ring with four outside ticks (the FPM has wings, the
   * boresight is a W). A faint line joins it to the boresight while the nose
   * is still catching up. Off screen, it is pinned to the edge as an arrow.
   * It turns amber when the controller is at full stick and still behind,
   * with G-LIM when the G-limit is what holds it back.
   */
  private drawAim(f: HudFrame, s: number) {
    const m = f.mouse;
    if (!m || f.warnings.crashed) return;
    const ctx = this.ctx;
    const cam = f.camera;
    const color = m.saturated ? CFG.warnColor : CFG.color;
    const r = 13 * s;
    const target = this._b.copy(f.position).addScaledVector(m.aim, 3000);
    const p = this.project(target, cam);
    const margin = 28 * s;
    const onScreen = p && p.x > margin && p.x < this.w - margin && p.y > margin && p.y < this.h - margin;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8;
    if (!onScreen) {
      // Direction to the aim in screen space, from the camera-space vector
      // (works even when the aim is behind the camera).
      const v = this._v.copy(target).applyMatrix4(cam.matrixWorldInverse);
      let dx = v.x;
      let dy = -v.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const cx = this.w / 2;
      const cy = this.h / 2;
      const k = Math.min((cx - margin) / Math.max(Math.abs(dx), 1e-6), (cy - margin) / Math.max(Math.abs(dy), 1e-6));
      const x = cx + dx * k;
      const y = cy + dy * k;
      const a = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
      ctx.moveTo(x + Math.cos(a) * r * 1.9, y + Math.sin(a) * r * 1.9);
      ctx.lineTo(x + Math.cos(a + 2.5) * r * 1.2, y + Math.sin(a + 2.5) * r * 1.2);
      ctx.moveTo(x + Math.cos(a) * r * 1.9, y + Math.sin(a) * r * 1.9);
      ctx.lineTo(x + Math.cos(a - 2.5) * r * 1.2, y + Math.sin(a - 2.5) * r * 1.2);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // Lead line from the boresight while the nose is catching up.
    if (m.errorDeg > 6) {
      const b = this.project(this._a.copy(f.position).addScaledVector(f.forward, 3000), cam);
      if (b) {
        const d = Math.hypot(p.x - b.x, p.y - b.y);
        if (d > r * 2.5) {
          const ux = (p.x - b.x) / d;
          const uy = (p.y - b.y) / d;
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.setLineDash([4 * s, 6 * s]);
          ctx.beginPath();
          ctx.moveTo(b.x + ux * r * 1.6, b.y + uy * r * 1.6);
          ctx.lineTo(p.x - ux * r * 1.4, p.y - uy * r * 1.4);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(p.x + ux * r * 1.3, p.y + uy * r * 1.3);
      ctx.lineTo(p.x + ux * r * 1.9, p.y + uy * r * 1.9);
    }
    ctx.stroke();
    if (m.gLimited) {
      ctx.font = `700 ${12 * s + 3}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('G-LIM', p.x, p.y + r * 2.3);
    }
    ctx.restore();
  }

  private drawLadder(f: HudFrame, s: number) {
    const ctx = this.ctx;
    const cam = f.camera;
    const heading = f.t.headingDeg * DEG;
    const pitch = f.t.pitchDeg;
    // Direction at (heading, elevation): north = -Z, east = +X.
    const dir = (hd: number, el: number, out: THREE.Vector3) =>
      out.set(Math.sin(hd) * Math.cos(el), Math.sin(el), -Math.cos(hd) * Math.cos(el));
    const R = 4000;
    ctx.save();
    ctx.font = `${13 * s + 3}px ${FONT}`;
    ctx.textBaseline = 'middle';
    for (let deg = -90; deg <= 90; deg += 5) {
      if (Math.abs(deg - pitch) > 32) continue;
      const el = deg * DEG;
      const c = this.project(this._b.copy(f.position).addScaledVector(dir(heading, el, this._a), R), cam);
      if (!c) continue;
      const side = this.project(this._b.copy(f.position).addScaledVector(dir(heading + 0.02, el, this._a), R), cam);
      if (!side) continue;
      const ang = Math.atan2(side.y - c.y, side.x - c.x);
      const horizon = deg === 0;
      const half = horizon ? 260 * s : 95 * s;
      const gap = horizon ? 40 * s : 34 * s;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(ang);
      ctx.setLineDash(deg < 0 ? [7 * s, 5 * s] : []);
      ctx.globalAlpha = horizon ? 0.9 : deg % 10 === 0 ? 0.85 : 0.45;
      ctx.beginPath();
      ctx.moveTo(-half, 0);
      ctx.lineTo(-gap, 0);
      ctx.moveTo(gap, 0);
      ctx.lineTo(half, 0);
      if (!horizon) {
        // End ticks point toward the horizon.
        const t = (deg > 0 ? 1 : -1) * 8 * s;
        ctx.moveTo(-half, 0);
        ctx.lineTo(-half, t);
        ctx.moveTo(half, 0);
        ctx.lineTo(half, t);
      }
      ctx.stroke();
      if (!horizon && deg % 10 === 0) {
        ctx.setLineDash([]);
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.abs(deg)}`, -half - 6 * s, 0);
        ctx.textAlign = 'left';
        ctx.fillText(`${Math.abs(deg)}`, half + 6 * s, 0);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawHeading(f: HudFrame, s: number) {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const y = 44 * s + 10;
    const width = 360 * s;
    const pxPerDeg = width / 60;
    const hdg = f.t.headingDeg;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - width / 2, y - 30 * s, width, 60 * s);
    ctx.clip();
    ctx.font = `${14 * s + 3}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const start = Math.floor((hdg - 35) / 5) * 5;
    for (let d = start; d <= hdg + 35; d += 5) {
      const x = cx + (d - hdg) * pxPerDeg;
      const n = ((d % 360) + 360) % 360;
      const major = n % 10 === 0;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + (major ? 10 : 5) * s);
      ctx.stroke();
      if (major) {
        const label = n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : `${n / 10}`.padStart(2, '0');
        ctx.fillText(label, x, y - 3 * s);
      }
    }
    ctx.restore();
    // Caret + readout.
    ctx.beginPath();
    ctx.moveTo(cx, y + 12 * s);
    ctx.lineTo(cx - 6 * s, y + 20 * s);
    ctx.lineTo(cx + 6 * s, y + 20 * s);
    ctx.closePath();
    ctx.stroke();
    this.box(cx, y + 38 * s, 54 * s, 22 * s, `${Math.round(hdg) % 360}`.padStart(3, '0'), s, 'center');
  }

  private speedValue(ms: number) {
    return CFG.speedUnit === 'kt' ? ms * 1.94384 : ms * 3.6;
  }

  private drawSpeed(f: HudFrame, s: number) {
    const x = this.w / 2 - 300 * s;
    const y = this.h / 2;
    const v = this.speedValue(f.t.speed);
    this.tape(x, y, v, 20, 100, -1, s);
    this.box(x, y, 78 * s, 26 * s, `${Math.round(v)}`, s, 'right', f.warnings.lowSpeed ? CFG.warnColor : undefined);
    const ctx = this.ctx;
    ctx.font = `${12 * s + 3}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(CFG.speedUnit.toUpperCase(), x, y - 150 * s);
    ctx.fillText(`M ${(f.t.speed / 340).toFixed(2)}`, x, y + 160 * s);
    ctx.fillText(`G ${f.t.g.toFixed(1)}`, x, y + 180 * s);
    ctx.fillText(`α ${f.t.alphaDeg.toFixed(1)}°`, x, y + 200 * s);
  }

  private drawAltitude(f: HudFrame, s: number) {
    const x = this.w / 2 + 300 * s;
    const y = this.h / 2;
    const a = f.t.altitude;
    this.tape(x, y, a, 50, 250, 1, s);
    this.box(x, y, 78 * s, 26 * s, `${Math.round(a)}`, s, 'left');
    const ctx = this.ctx;
    ctx.font = `${12 * s + 3}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('ALT m', x, y - 150 * s);
    const vs = f.t.climbRate;
    ctx.fillText(`VS ${vs >= 0 ? '+' : ''}${Math.round(vs)} m/s`, x, y + 160 * s);
    ctx.fillText(`R ${Math.round(f.radarAltitude)}`, x, y + 180 * s);
  }

  /** Vertical moving tape. side -1 = ticks on the right of x (speed), +1 = left (altitude). */
  private tape(x: number, y: number, value: number, minor: number, major: number, side: number, s: number) {
    const ctx = this.ctx;
    const hgt = 260 * s;
    const pxPer = hgt / (major * 2.2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 90 * s, y - hgt / 2, 180 * s, hgt);
    ctx.clip();
    ctx.font = `${12 * s + 3}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = side < 0 ? 'right' : 'left';
    const lo = Math.floor((value - major * 1.2) / minor) * minor;
    for (let v = lo; v <= value + major * 1.2; v += minor) {
      const yy = y - (v - value) * pxPer;
      const isMajor = Math.abs(v % major) < 1e-6;
      const len = (isMajor ? 12 : 6) * s;
      ctx.beginPath();
      ctx.moveTo(x - side * 4 * s, yy);
      ctx.lineTo(x - side * (4 * s + len), yy);
      ctx.stroke();
      if (isMajor && Math.abs(yy - y) > 18 * s) ctx.fillText(`${v}`, x - side * (22 * s), yy);
    }
    ctx.restore();
  }

  private box(x: number, y: number, w: number, h: number, text: string, s: number, align: CanvasTextAlign, color?: string) {
    const ctx = this.ctx;
    const left = align === 'right' ? x - w : align === 'left' ? x : x - w / 2;
    ctx.save();
    if (color) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
    }
    ctx.fillStyle = 'rgba(0,12,6,0.35)';
    ctx.fillRect(left, y - h / 2, w, h);
    ctx.fillStyle = color ?? CFG.color;
    ctx.strokeRect(left, y - h / 2, w, h);
    ctx.font = `600 ${16 * s + 4}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + w / 2, y + 1);
    ctx.restore();
  }

  /**
   * Bank scale as an arc in the upper HUD (clear of the aircraft, which sits
   * low on screen). The pointer stays on the sky side: it swings opposite to
   * the bank so it always points "up" in the world.
   */
  private drawBank(f: HudFrame, s: number) {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const r = Math.min(230 * s, this.h * 0.32);
    const top = -Math.PI / 2;
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(cx, cy, r, top - 60 * DEG, top + 60 * DEG);
    ctx.stroke();
    for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const a = top + b * DEG;
      const len = (b % 30 === 0 ? 12 : 6) * s;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.lineTo(cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len));
      ctx.stroke();
    }
    const roll = THREE.MathUtils.clamp(f.t.rollDeg, -180, 180);
    const a = top - Math.max(-65, Math.min(65, roll)) * DEG;
    const px = cx + Math.cos(a) * (r - 3 * s);
    const py = cy + Math.sin(a) * (r - 3 * s);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(a + 2.8) * 12 * s, py + Math.sin(a + 2.8) * 12 * s);
    ctx.lineTo(px + Math.cos(a - 2.8) * 12 * s, py + Math.sin(a - 2.8) * 12 * s);
    ctx.closePath();
    ctx.fill();
    ctx.font = `${13 * s + 3}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const pitch = f.t.pitchDeg;
    ctx.fillText(
      `BANK ${Math.round(roll)}°   PITCH ${pitch >= 0 ? '+' : ''}${pitch.toFixed(1)}°`,
      cx,
      cy - r + 18 * s,
    );
    ctx.restore();
  }

  private drawEngine(f: HudFrame, s: number) {
    const ctx = this.ctx;
    const c = f.controls;
    const x = 34 * s + 10;
    const bottom = this.h - 60 * s;
    const H = 170 * s;
    const W = 16 * s;
    ctx.save();
    ctx.strokeRect(x, bottom - H, W, H);
    // Bar shows engine power; MIL line at 60 %, afterburner above it.
    const milFrac = 0.6;
    const fill = f.enginePower;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x + 2, bottom - fill * H + 2, W - 4, Math.max(0, fill * H - 4));
    ctx.globalAlpha = 1;
    const mil = bottom - milFrac * H;
    ctx.beginPath();
    ctx.moveTo(x - 6 * s, mil);
    ctx.lineTo(x + W + 6 * s, mil);
    ctx.stroke();
    ctx.font = `${12 * s + 3}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('MIL', x + W + 10 * s, mil);
    ctx.fillText('AB', x + W + 10 * s, bottom - H + 8 * s);
    // Thrust command: ▲ accelerating, ▼ decelerating, HOLD when released.
    const cmd = c.thrust > 0.05 ? '▲ ACCEL' : c.thrust < -0.05 ? '▼ DECEL' : 'HOLD';
    ctx.fillText(`PWR ${Math.round(Math.min(fill, 0.6) / 0.6 * 100)}%  ${cmd}`, x, bottom + 18 * s);
    ctx.restore();

    // AB / BRK annunciators.
    const ay = bottom - H - 26 * s;
    this.flag(x, ay, 'A/B', c.afterburner > 0.15, '#ffb84d', s);
    this.flag(x + 54 * s, ay, 'BRK', c.airbrake > 0.15, '#7fd4ff', s);
  }

  private flag(x: number, y: number, text: string, on: boolean, color: string, s: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `700 ${13 * s + 3}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const w = 46 * s;
    const h = 20 * s;
    if (on) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y - h / 2, w, h);
      ctx.fillStyle = '#071008';
      ctx.fillText(text, x + w / 2, y + 1);
    } else {
      ctx.globalAlpha = 0.35;
      ctx.strokeRect(x, y - h / 2, w, h);
      ctx.fillText(text, x + w / 2, y + 1);
    }
    ctx.restore();
  }

  private drawStatus(f: HudFrame, s: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `${12 * s + 3}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const fpsColor = f.fps >= 55 ? CFG.color : f.fps >= 30 ? CFG.warnColor : CFG.dangerColor;
    ctx.fillStyle = fpsColor;
    ctx.fillText(`FPS ${Math.round(f.fps)}`, 12, 10);
    ctx.fillStyle = CFG.color;
    ctx.fillText(f.aircraftName.toUpperCase(), 12, 10 + 18 * s);
    ctx.fillText(`CAM ${CAMERA_MODE_LABEL[f.cameraMode].toUpperCase()}${f.mouse?.freeLook ? ' · FREE LOOK' : ''}`, 12, 10 + 36 * s);
    ctx.fillText(`INPUT ${f.mouse ? `MOUSE · AIM ${f.mouse.aimLimit === 'free' ? 'FREE' : 'LIMITED'}` : 'KEYBOARD'}`, 12, 10 + 54 * s);
    ctx.fillText(`RINGS ${f.race.passed}/${f.race.total}`, 12, 10 + 72 * s);
    ctx.restore();

    if (f.mouse && !f.mouse.locked && !f.warnings.crashed) {
      ctx.save();
      ctx.font = `700 ${15 * s + 4}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = CFG.warnColor;
      // Bottom centre: clear of the jet, which sits in the lower half.
      ctx.fillText('CLICK TO CAPTURE MOUSE', this.w / 2, this.h - 28 * s - 10);
      ctx.restore();
    }
  }

  /** Top centre, under the heading tape: run clock, or the FINISH / FAIL banner. */
  private drawRace(r: HudRace, s: number) {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const y = 128 * s + 10;
    const best = r.best === null ? '' : `BEST ${formatRaceTime(r.best)}`;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (r.banner) {
      ctx.fillStyle = r.banner.good ? CFG.color : CFG.dangerColor;
      ctx.font = `800 ${24 * s + 6}px ${FONT}`;
      ctx.fillText(r.banner.title, cx, y);
      ctx.font = `600 ${15 * s + 4}px ${FONT}`;
      ctx.fillText(r.banner.detail, cx, y + 28 * s);
    } else if (r.running) {
      ctx.font = `700 ${24 * s + 6}px ${FONT}`;
      ctx.fillText(formatRaceTime(r.time), cx, y);
      ctx.font = `${12 * s + 3}px ${FONT}`;
      ctx.fillText(`RING ${r.passed + 1}/${r.total}${best ? `  ·  ${best}` : ''}`, cx, y + 24 * s);
    } else {
      ctx.globalAlpha = 0.55;
      ctx.font = `${12 * s + 3}px ${FONT}`;
      ctx.fillText(`RING 1 STARTS THE CLOCK${best ? `  ·  ${best}` : ''}`, cx, y);
    }
    ctx.restore();
  }

  private drawWarnings(f: HudFrame, s: number) {
    const ctx = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2 - 120 * s;
    const blink = Math.floor(performance.now() / 300) % 2 === 0;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${26 * s + 6}px ${FONT}`;
    if (f.warnings.crashed) {
      ctx.fillStyle = CFG.dangerColor;
      ctx.fillText('CRASH', cx, cy);
      ctx.font = `600 ${15 * s + 4}px ${FONT}`;
      ctx.fillText(f.warnings.crashed.toUpperCase(), cx, cy + 30 * s);
    } else if (f.warnings.outOfBounds !== null) {
      ctx.fillStyle = CFG.warnColor;
      if (blink) ctx.fillText(`RETURN TO TEST AREA  ${Math.ceil(f.warnings.outOfBounds)}`, cx, cy);
    } else if (f.warnings.pullUp) {
      ctx.fillStyle = CFG.dangerColor;
      if (blink) {
        ctx.fillText('PULL UP', cx, cy);
        ctx.strokeStyle = CFG.dangerColor;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(cx - 80 * s, cy - 22 * s, 160 * s, 44 * s);
      }
    } else if (f.warnings.lowSpeed) {
      ctx.fillStyle = CFG.warnColor;
      ctx.font = `700 ${18 * s + 4}px ${FONT}`;
      if (blink) ctx.fillText('LOW SPEED', cx, cy);
    }
    ctx.restore();
  }
}

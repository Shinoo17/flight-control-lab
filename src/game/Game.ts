import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FLIGHT, HUD as HUD_CFG, RACE, RENDER, SIM, WORLD } from './config';
import { KeyboardInput } from './input/KeyboardInput';
import { MouseInput } from './input/MouseInput';
import { FlightControls, type ControlKeys } from './input/ControlAxes';
import { ControlMixer, type AimLimit, type InputMode } from './input/ControlMixer';
import { FlightModel, type FlightTelemetry } from './flight/FlightModel';
import { Aircraft, AIRCRAFT, createModelLoader } from './aircraft/Aircraft';
import type { AircraftId } from './aircraft/types';
import { ChaseCamera, type CameraMode } from './camera/ChaseCamera';
import { Hud } from './hud/Hud';
import { World } from './world/World';
import { SpeedLines } from './effects/SpeedLines';
import { Explosion } from './effects/Explosion';
import { RingRace, type RaceEvent } from './race/RingRace';
import { RaceRecords, formatRaceTime, type RaceRecord } from './race/RaceRecords';

export type GameStatus = 'menu' | 'loading' | 'flying' | 'crashed' | 'paused';

export interface GameSnapshot {
  status: GameStatus;
  aircraftId: AircraftId | null;
  cameraMode: CameraMode;
  inputMode: InputMode;
  aimLimit: AimLimit;
  /** Pointer lock held (mouse mode only). */
  mouseLocked: boolean;
  crashReason: string | null;
  error: string | null;
  /** Fastest ring-course runs, best first. */
  records: RaceRecord[];
}

/** Key bindings, by `KeyboardEvent.code`. */
const KEYS = {
  pitchUp: ['ArrowUp'],
  pitchDown: ['ArrowDown'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleUp: ['KeyW'],
  throttleDown: ['KeyS'],
  airbrake: ['KeyX'],
  afterburner: ['ShiftLeft', 'ShiftRight'],
  freeLook: ['KeyC'],
  camera: 'KeyV',
  inputMode: 'KeyM',
  aimLimit: 'KeyG',
  reset: 'KeyR',
  /** P toggles. Esc only pauses: with pointer lock it also releases the mouse,
   *  and a toggle could race the lock-loss pause and resume straight away. */
  pauseToggle: 'KeyP',
  pause: 'Escape',
} as const;

/** Camera each input mode starts in (the player can switch afterwards). */
const DEFAULT_CAMERA: Record<InputMode, CameraMode> = { mouse: 'aim', keyboard: 'horizon' };

/**
 * Owns the renderer and the game loop.
 *
 * Loop order each frame:
 *   0. mouse delta → aim direction (or free look)  (per frame)
 *   1. read keyboard → progressive control axes, arbitrated with the aim
 *      controller by the control mixer             (per fixed step)
 *   2. flight model step + collision + bounds    (fixed 120 Hz, FPS independent)
 *   3. interpolate pose for rendering, animate rig, camera, effects
 *   4. render the 3D view, then draw the 2D HUD on top
 * React only drives menus through the public methods and `onChange`.
 */
export class Game {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly world: World;
  private readonly chase: ChaseCamera;
  private readonly hud: Hud;
  private readonly keys: KeyboardInput;
  private readonly mouse: MouseInput;
  private readonly controls = new FlightControls();
  /** What the aircraft actually flies: keyboard axes + aim controller. */
  private readonly mixer = new ControlMixer(this.controls);
  private readonly fm = new FlightModel();
  private readonly loader: GLTFLoader;
  private readonly cache = new Map<AircraftId, Promise<Aircraft>>();
  private readonly speedLines = new SpeedLines();
  private readonly explosion = new Explosion();
  private readonly resizeObserver: ResizeObserver;
  private aircraft: Aircraft | null = null;
  private readonly race: RingRace;
  private readonly records = new RaceRecords();
  /** FINISH / FAIL message on the HUD, with seconds left to show it. */
  private raceBanner: { title: string; detail: string; good: boolean; timer: number } | null = null;

  private status: GameStatus = 'menu';
  private crashReason: string | null = null;
  private error: string | null = null;
  private crashTimer = 0;
  private oobTimer: number | null = null;

  private raf = 0;
  private lastTime = 0;
  private accumulator = 0;
  private menuTime = 0;
  private fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;
  private disposed = false;

  // Pose interpolation between fixed steps.
  private readonly prevPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly renderPos = new THREE.Vector3();
  private readonly renderQuat = new THREE.Quaternion();
  private readonly telemetry = {} as FlightTelemetry;

  private readonly listeners = new Set<(s: GameSnapshot) => void>();
  private lastSnapshot = '';

  private readonly _v = new THREE.Vector3();
  private readonly _w = new THREE.Vector3();
  private readonly _fwd = new THREE.Vector3();
  private readonly _vel = new THREE.Vector3();

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: RENDER.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.className = 'gl-canvas';
    container.appendChild(this.renderer.domElement);

    this.loader = createModelLoader(this.renderer);
    this.world = new World(this.scene, this.renderer);
    this.race = new RingRace(this.world.zones.rings.list);
    this.world.paintRings(this.race.states);
    this.chase = new ChaseCamera(1);
    this.chase.mode = DEFAULT_CAMERA[this.mixer.mode];
    this.scene.add(this.speedLines.mesh, this.explosion.group);
    this.hud = new Hud(container);
    this.keys = new KeyboardInput(window);
    this.mouse = new MouseInput(container);
    this.mouse.onLockChange = this.onMouseLock;
    container.addEventListener('mousedown', this.onViewportClick);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    (window as unknown as { __game: Game }).__game = this;
  }

  // --- public API (used by React and for debugging) ------------------------

  onChange(fn: (s: GameSnapshot) => void) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  snapshot(): GameSnapshot {
    return {
      status: this.status,
      aircraftId: this.aircraft?.def.id ?? null,
      cameraMode: this.chase.mode,
      inputMode: this.mixer.mode,
      aimLimit: this.mixer.aimLimit,
      mouseLocked: this.mouse.locked,
      crashReason: this.crashReason,
      error: this.error,
      records: this.records.list,
    };
  }

  /** Load (once) and fly the chosen aircraft from the spawn point. */
  async fly(id: AircraftId) {
    this.error = null;
    this.setStatus('loading');
    try {
      let p = this.cache.get(id);
      if (!p) {
        p = Aircraft.load(AIRCRAFT[id], this.loader);
        this.cache.set(id, p);
        p.catch(() => this.cache.delete(id));
      }
      const ac = await p;
      if (this.disposed) return;
      if (this.aircraft && this.aircraft !== ac) this.aircraft.root.removeFromParent();
      this.aircraft = ac;
      this.scene.add(ac.root);
      this.chase.sizeScale = THREE.MathUtils.clamp(ac.length / 19.5, 0.8, 1.4);
      this.resetFlight();
    } catch (e) {
      console.error(e);
      this.error = `Failed to load ${AIRCRAFT[id].name}: ${(e as Error).message}`;
      this.setStatus('menu');
    }
  }

  showMenu() {
    if (this.status === 'flying') this.status = 'paused';
    this.mouse.exitLock();
    this.setStatus('menu');
  }

  /**
   * Resuming in mouse mode also asks for pointer lock, so call it from a
   * user gesture (key press or click) when possible.
   */
  setPaused(paused: boolean) {
    if (paused && this.status === 'flying') {
      this.mouse.exitLock();
      this.setStatus('paused');
    } else if (!paused && this.status === 'paused') {
      this.captureMouse();
      this.lastTime = performance.now();
      this.setStatus('flying');
    }
  }

  resume() {
    if (!this.aircraft) return;
    this.captureMouse();
    this.lastTime = performance.now();
    this.setStatus(this.crashReason ? 'crashed' : 'flying');
  }

  /** Request pointer lock in mouse mode. Must run inside a user gesture. */
  captureMouse() {
    if (this.mixer.mode === 'mouse') this.mouse.requestLock();
  }

  setInputMode(mode: InputMode) {
    if (mode === this.mixer.mode) return;
    this.mixer.mode = mode;
    this.mixer.reset(this.fm);
    this.mouse.discard();
    this.chase.mode = DEFAULT_CAMERA[mode];
    if (mode === 'mouse') {
      if (this.status === 'flying') this.captureMouse();
    } else {
      this.mouse.exitLock();
    }
    this.emit();
  }

  /** Free aim keeps the aim where it is; going back to limited pulls it into the cone next step. */
  setAimLimit(limit: AimLimit) {
    this.mixer.aimLimit = limit;
    this.emit();
  }

  cycleCamera() {
    this.chase.cycle();
    this.emit();
  }

  setCameraMode(mode: CameraMode) {
    this.chase.mode = mode;
    this.emit();
  }

  resetFlight() {
    const s = FLIGHT.spawn;
    this.fm.reset(new THREE.Vector3(s.position.x, s.altitude, s.position.z), s.headingDeg);
    this.controls.reset();
    this.mixer.reset(this.fm);
    this.mouse.discard();
    this.prevPos.copy(this.fm.position);
    this.prevQuat.copy(this.fm.quaternion);
    this.accumulator = 0;
    this.crashReason = null;
    this.oobTimer = null;
    this.explosion.hide();
    this.speedLines.reset();
    // Any reset aborts a run in progress without recording it.
    this.race.reset();
    this.world.paintRings(this.race.states);
    if (this.aircraft) this.aircraft.root.visible = true;
    this.chase.snap();
    this.lastTime = performance.now();
    this.setStatus('flying');
  }

  /** Read-only state for debugging / automated checks (`window.__game.debug()`). */
  debug() {
    return {
      status: this.status,
      fps: Math.round(this.fps),
      ...this.fm.telemetry(),
      position: this.fm.position.toArray().map((v) => Math.round(v)),
      controls: {
        pitch: this.mixer.pitch,
        roll: this.mixer.roll,
        yaw: this.mixer.yaw,
        thrust: this.mixer.thrust,
        enginePower: this.fm.enginePower(this.mixer),
        afterburner: this.mixer.afterburner,
        airbrake: this.mixer.airbrake,
      },
      input: this.mixer.mode,
      mouseLocked: this.mouse.locked,
      aim: {
        dir: this.mixer.aim.dir.toArray().map((v) => +v.toFixed(3)),
        errorDeg: +this.mixer.autopilot.errorDeg.toFixed(2),
        saturated: this.mixer.autopilot.saturated,
        gLimited: this.mixer.autopilot.gLimited,
      },
      camera: this.chase.mode,
      crash: this.crashReason,
      race: { running: this.race.running, next: this.race.next, time: +this.race.time.toFixed(2) },
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.keys.dispose();
    this.container.removeEventListener('mousedown', this.onViewportClick);
    this.mouse.dispose();
    this.hud.dispose();
    for (const p of this.cache.values()) p.then((a) => a.dispose()).catch(() => {});
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.listeners.clear();
    const w = window as unknown as { __game?: Game };
    if (w.__game === this) delete w.__game;
  }

  // --- loop ----------------------------------------------------------------

  private readonly frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.lastTime) / 1000, SIM.maxFrameDt);
    this.lastTime = now;
    this.measureFps(dt);
    this.handleGlobalKeys();
    this.readMouse();

    if (this.status === 'flying' || this.status === 'crashed') this.simulate(dt);
    this.renderFrame(dt);
    this.keys.endFrame();
  };

  private handleGlobalKeys() {
    const k = this.keys;
    if (this.status === 'menu' || this.status === 'loading') return;
    if (k.wasPressed(KEYS.camera)) this.cycleCamera();
    if (k.wasPressed(KEYS.inputMode)) this.setInputMode(this.mixer.mode === 'mouse' ? 'keyboard' : 'mouse');
    if (k.wasPressed(KEYS.aimLimit)) this.setAimLimit(this.mixer.aimLimit === 'limited' ? 'free' : 'limited');
    if (k.wasPressed(KEYS.reset)) this.resetFlight();
    if (k.wasPressed(KEYS.pauseToggle)) this.setPaused(this.status !== 'paused');
    else if (k.wasPressed(KEYS.pause)) this.setPaused(true);
  }

  /** Mouse delta → aim, or → camera orbit while free look is held. */
  private readMouse() {
    const { dx, dy } = this.mouse.consume();
    const flying = this.status === 'flying' && this.mixer.mode === 'mouse';
    const freeLook = flying && this.keys.anyDown(...KEYS.freeLook);
    this.chase.freeLookActive = freeLook;
    if (!flying) return;
    if (freeLook) this.chase.look(dx, dy);
    else this.mixer.aim.rotate(dx, dy, this.chase.camera);
  }

  private readonly onMouseLock = (locked: boolean) => {
    // Esc (or alt-tab) released the mouse mid-flight: pause rather than fly blind.
    if (!locked && this.status === 'flying' && this.mixer.mode === 'mouse') this.setPaused(true);
    // Clicking back in while paused resumes.
    else if (locked && this.status === 'paused') this.setPaused(false);
    this.emit();
  };

  private readonly onViewportClick = () => {
    if (this.mixer.mode !== 'mouse' || this.mouse.locked) return;
    if (this.status === 'flying' || this.status === 'paused' || this.status === 'crashed') this.mouse.requestLock();
  };

  private readKeys(): ControlKeys {
    const k = this.keys;
    return {
      pitchUp: k.anyDown(...KEYS.pitchUp),
      pitchDown: k.anyDown(...KEYS.pitchDown),
      rollLeft: k.anyDown(...KEYS.rollLeft),
      rollRight: k.anyDown(...KEYS.rollRight),
      yawLeft: k.anyDown(...KEYS.yawLeft),
      yawRight: k.anyDown(...KEYS.yawRight),
      throttleUp: k.anyDown(...KEYS.throttleUp),
      throttleDown: k.anyDown(...KEYS.throttleDown),
      airbrake: k.anyDown(...KEYS.airbrake),
      afterburner: k.anyDown(...KEYS.afterburner),
    };
  }

  private simulate(dt: number) {
    if (this.raceBanner && (this.raceBanner.timer -= dt) <= 0) this.raceBanner = null;
    if (this.status === 'crashed') {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) this.resetFlight();
      return;
    }
    const keys = this.readKeys();
    this.accumulator += dt;
    const step = SIM.fixedDt;
    while (this.accumulator >= step) {
      this.accumulator -= step;
      this.prevPos.copy(this.fm.position);
      this.prevQuat.copy(this.fm.quaternion);
      this.controls.update(keys, step);
      this.mixer.step(this.fm, step);
      this.fm.step(this.mixer, step);
      const ev = this.race.step(this.prevPos, this.fm.position, step);
      if (ev) this.onRaceEvent(ev);
      const hit = this.collide();
      if (hit) {
        this.crash(hit);
        return;
      }
    }

    // Out of bounds: warn, count down, then reset.
    if (this.world.outOfBounds(this.fm.position)) {
      this.oobTimer = (this.oobTimer ?? WORLD.outOfBoundsGrace) - dt;
      if (this.oobTimer <= 0) this.resetFlight();
    } else this.oobTimer = null;
  }

  private collide(): string | null {
    const ac = this.aircraft;
    if (!ac) return null;
    for (const probe of ac.probes) {
      const p = this._v.copy(probe).applyQuaternion(this.fm.quaternion).add(this.fm.position);
      const hit = this.world.hitTest(p);
      if (hit) return hit.kind === 'ground' ? 'ground impact' : `hit ${hit.collider.name}`;
    }
    return null;
  }

  private onRaceEvent(ev: RaceEvent) {
    this.world.paintRings(this.race.states);
    const banner = (title: string, detail: string, good: boolean) =>
      (this.raceBanner = { title, detail, good, timer: RACE.bannerTime });
    switch (ev.kind) {
      case 'start':
        this.raceBanner = null;
        break;
      case 'ring':
        break;
      case 'finish': {
        const rank = this.aircraft
          ? this.records.add({ time: ev.time, aircraft: this.aircraft.def.id, date: Date.now() })
          : 0;
        const place = rank === 1 ? 'NEW BEST' : rank ? `#${rank}` : `NOT IN TOP ${RACE.maxRecords}`;
        banner('FINISH', `${formatRaceTime(ev.time)} · ${place}`, true);
        this.emit();
        break;
      }
      case 'fail':
        banner('FAIL', `${ev.reason.toUpperCase()} · ${formatRaceTime(ev.time)}`, false);
        break;
    }
  }

  private crash(reason: string) {
    const ev = this.race.fail('crashed');
    if (ev) this.onRaceEvent(ev);
    this.crashReason = reason;
    this.crashTimer = WORLD.crashResetDelay;
    this.explosion.trigger(this.fm.position, this.fm.velocity(this._vel));
    if (this.aircraft) this.aircraft.root.visible = false;
    this.prevPos.copy(this.fm.position);
    this.prevQuat.copy(this.fm.quaternion);
    this.setStatus('crashed');
  }

  private renderFrame(dt: number) {
    const ac = this.aircraft;
    const showAircraft = ac && this.status !== 'menu' && this.status !== 'loading';
    if (showAircraft) {
      const alpha = this.status === 'flying' ? this.accumulator / SIM.fixedDt : 1;
      this.renderPos.lerpVectors(this.prevPos, this.fm.position, alpha);
      this.renderQuat.slerpQuaternions(this.prevQuat, this.fm.quaternion, alpha);
      ac.root.position.copy(this.renderPos);
      ac.root.quaternion.copy(this.renderQuat);
      ac.root.visible = this.status !== 'crashed';

      const animDt = this.status === 'paused' ? 0 : dt;
      const c = this.mixer;
      const engine = this.fm.enginePower(c);
      ac.update({ controls: c, engine, speed: this.fm.speed }, animDt);

      this.chase.update(
        {
          position: this.renderPos,
          quaternion: this.renderQuat,
          speed: this.fm.speed,
          afterburner: c.afterburner,
          airbrake: c.airbrake,
          g: this.fm.g,
          aim: this.mixer.aim.dir,
          pathDir: this.fm.pathDir,
          crashed: this.status === 'crashed',
        },
        animDt,
      );
      this.explosion.update(animDt);
      if (this.status === 'flying') this.speedLines.update(this.chase.camera, this.fm.velocity(this._vel), c.afterburner);
      this.speedLines.mesh.visible = this.status === 'flying';
      this.world.update(this.chase.camera, this.renderPos);
    } else {
      this.menuCamera(dt);
    }

    this.renderer.render(this.scene, this.chase.camera);

    if (showAircraft && this.status !== 'menu') this.drawHud();
    else this.hud.clear();
  }

  /** Slow orbit over the runway behind the menu. */
  private menuCamera(dt: number) {
    this.menuTime += dt;
    const cam = this.chase.camera;
    const a = this.menuTime * 0.04;
    cam.position.set(Math.sin(a) * 1600, 420, Math.cos(a) * 1600 + 600);
    cam.lookAt(0, 80, -400);
    cam.updateMatrixWorld();
    this.speedLines.mesh.visible = false;
    this.world.update(cam, this._w.set(0, 0, 0));
    if (this.aircraft) this.aircraft.root.visible = false;
  }

  private drawHud() {
    const t = this.fm.telemetry(this.telemetry);
    t.altitude = this.renderPos.y;
    const ground = this.world.groundHeight(this.renderPos.x, this.renderPos.z);
    const radar = this.renderPos.y - ground;
    const tti = t.climbRate < -1 ? radar / -t.climbRate : Infinity;
    this.hud.draw({
      camera: this.chase.camera,
      position: this.renderPos,
      forward: this._fwd.set(0, 0, 1).applyQuaternion(this.renderQuat),
      pathDir: this.fm.pathDir,
      t,
      controls: this.mixer,
      enginePower: this.fm.enginePower(this.mixer),
      fps: this.fps,
      cameraMode: this.chase.mode,
      mouse:
        this.mixer.mode === 'mouse'
          ? {
              aim: this.mixer.aim.dir,
              errorDeg: this.mixer.autopilot.errorDeg,
              saturated: this.mixer.autopilot.saturated,
              gLimited: this.mixer.autopilot.gLimited,
              locked: this.mouse.locked,
              aimLimit: this.mixer.aimLimit,
              freeLook: this.chase.freeLookActive,
            }
          : null,
      aircraftName: this.aircraft?.def.name ?? '',
      radarAltitude: radar,
      warnings: {
        pullUp: this.status === 'flying' && radar < 1500 && tti < HUD_CFG.pullUpTime,
        outOfBounds: this.oobTimer,
        crashed: this.status === 'crashed' ? this.crashReason : null,
        lowSpeed: t.speed < HUD_CFG.lowSpeedWarn,
      },
      race: {
        running: this.race.running,
        time: this.race.time,
        passed: this.race.next,
        total: this.race.total,
        best: this.records.best,
        banner: this.raceBanner,
      },
    });
  }

  private measureFps(dt: number) {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.chase.setAspect(w / h);
    this.hud.resize(w, h);
  }

  private setStatus(s: GameStatus) {
    this.status = s;
    this.emit();
  }

  private emit() {
    const snap = this.snapshot();
    const key = JSON.stringify(snap);
    if (key === this.lastSnapshot) return;
    this.lastSnapshot = key;
    for (const fn of this.listeners) fn(snap);
  }
}

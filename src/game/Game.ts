import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FLIGHT, HUD as HUD_CFG, RENDER, SIM, WORLD } from './config';
import { KeyboardInput } from './input/KeyboardInput';
import { FlightControls, type ControlKeys } from './input/ControlAxes';
import { FlightModel, type FlightTelemetry } from './flight/FlightModel';
import { Aircraft, AIRCRAFT, createModelLoader } from './aircraft/Aircraft';
import type { AircraftId } from './aircraft/types';
import { ChaseCamera, type CameraMode } from './camera/ChaseCamera';
import { Hud } from './hud/Hud';
import { World } from './world/World';
import { SpeedLines } from './effects/SpeedLines';
import { Explosion } from './effects/Explosion';

export type GameStatus = 'menu' | 'loading' | 'flying' | 'crashed' | 'paused';

export interface GameSnapshot {
  status: GameStatus;
  aircraftId: AircraftId | null;
  cameraMode: CameraMode;
  crashReason: string | null;
  error: string | null;
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
  camera: 'KeyC',
  reset: 'KeyR',
  pause: ['KeyP', 'Escape'],
} as const;

/**
 * Owns the renderer and the game loop.
 *
 * Loop order each frame:
 *   1. read keyboard → progressive control axes   (per fixed step)
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
  private readonly controls = new FlightControls();
  private readonly fm = new FlightModel();
  private readonly loader: GLTFLoader;
  private readonly cache = new Map<AircraftId, Promise<Aircraft>>();
  private readonly speedLines = new SpeedLines();
  private readonly explosion = new Explosion();
  private readonly resizeObserver: ResizeObserver;
  private aircraft: Aircraft | null = null;

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
    this.chase = new ChaseCamera(1);
    this.scene.add(this.speedLines.mesh, this.explosion.group);
    this.hud = new Hud(container);
    this.keys = new KeyboardInput(window);

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
      crashReason: this.crashReason,
      error: this.error,
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
    this.setStatus('menu');
  }

  setPaused(paused: boolean) {
    if (paused && this.status === 'flying') this.setStatus('paused');
    else if (!paused && this.status === 'paused') {
      this.lastTime = performance.now();
      this.setStatus('flying');
    }
  }

  resume() {
    if (!this.aircraft) return;
    this.lastTime = performance.now();
    this.setStatus(this.crashReason ? 'crashed' : 'flying');
  }

  toggleCamera() {
    this.chase.toggle();
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
    this.prevPos.copy(this.fm.position);
    this.prevQuat.copy(this.fm.quaternion);
    this.accumulator = 0;
    this.crashReason = null;
    this.oobTimer = null;
    this.explosion.hide();
    this.speedLines.reset();
    this.world.resetRings();
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
        pitch: this.controls.pitch,
        roll: this.controls.roll,
        yaw: this.controls.yaw,
        thrust: this.controls.thrust,
        enginePower: this.fm.enginePower(this.controls),
        afterburner: this.controls.afterburner,
        airbrake: this.controls.airbrake,
      },
      camera: this.chase.mode,
      crash: this.crashReason,
      rings: this.world.ringsPassed,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.keys.dispose();
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

    if (this.status === 'flying' || this.status === 'crashed') this.simulate(dt);
    this.renderFrame(dt);
    this.keys.endFrame();
  };

  private handleGlobalKeys() {
    const k = this.keys;
    if (this.status === 'menu' || this.status === 'loading') return;
    if (k.wasPressed(KEYS.camera)) this.toggleCamera();
    if (k.wasPressed(KEYS.reset)) this.resetFlight();
    if (KEYS.pause.some((c) => k.wasPressed(c))) this.setPaused(this.status !== 'paused');
  }

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
      this.fm.step(this.controls, step);
      this.world.checkRings(this.prevPos, this.fm.position);
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

  private crash(reason: string) {
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
      const c = this.controls;
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
      controls: this.controls,
      enginePower: this.fm.enginePower(this.controls),
      fps: this.fps,
      cameraMode: this.chase.mode,
      aircraftName: this.aircraft?.def.name ?? '',
      radarAltitude: radar,
      warnings: {
        pullUp: this.status === 'flying' && radar < 1500 && tti < HUD_CFG.pullUpTime,
        outOfBounds: this.oobTimer,
        crashed: this.status === 'crashed' ? this.crashReason : null,
        lowSpeed: t.speed < HUD_CFG.lowSpeedWarn,
      },
      rings: { passed: this.world.ringsPassed, total: this.world.zones.rings.list.length },
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

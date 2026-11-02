import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CAMERA, RENDER, WORLD } from '../config';
import { createGround } from './Ground';
import { createSky, SKY } from './Sky';
import { buildZones, ZONE_TINTS, ZONES, type Zones } from './zones';
import type { Collider } from './Colliders';
import { rng } from './noise';

export type HitResult = { kind: 'ground' } | { kind: 'object'; collider: Collider };

/** Everything static in the test range plus the sun that follows the player. */
export class World {
  readonly scene: THREE.Scene;
  readonly zones: Zones;
  private readonly sky: THREE.Mesh;
  private readonly sun: THREE.DirectionalLight;
  private readonly ringColor = new THREE.Color();
  private readonly _p = new THREE.Vector3();
  private readonly _d = new THREE.Vector3();
  ringsPassed = 0;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    scene.background = SKY.horizon.clone();
    scene.fog = new THREE.FogExp2(SKY.horizon.clone(), WORLD.fogDensity);

    // Metal and glass on the jets need an environment map or they render black.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.sky = createSky(CAMERA.far * 0.9);
    scene.add(this.sky);

    scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a40, 1.15));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 10;
    sc.far = 3000;
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);

    scene.add(createGround(ZONE_TINTS, ZONES.river));
    this.zones = buildZones();
    const z = this.zones;
    scene.add(z.batch, z.labels, z.signs, z.runway, z.rings.mesh, z.terrain.mesh, z.trees, z.lights);
    scene.add(createClouds());
  }

  /** Terrain height under a point (flat ground is 0). */
  groundHeight(x: number, z: number) {
    return this.zones.terrain.heightAt(x, z);
  }

  /** Test one world-space point against ground and obstacles. */
  hitTest(p: THREE.Vector3): HitResult | null {
    if (p.y <= this.groundHeight(p.x, p.z)) return { kind: 'ground' };
    const c = this.zones.colliders.hit(p);
    return c ? { kind: 'object', collider: c } : null;
  }

  outOfBounds(p: THREE.Vector3) {
    return Math.abs(p.x) > WORLD.boundsHalf || Math.abs(p.z) > WORLD.boundsHalf || p.y > WORLD.ceiling;
  }

  /** Mark rings the aircraft flew through between two positions. Returns the ring index passed, or -1. */
  checkRings(prev: THREE.Vector3, next: THREE.Vector3): number {
    const rings = this.zones.rings;
    for (let i = 0; i < rings.list.length; i++) {
      const r = rings.list[i];
      const a = this._p.copy(prev).sub(r.center).dot(r.normal);
      const b = this._d.copy(next).sub(r.center).dot(r.normal);
      if (a < 0 && b >= 0) {
        // Crossing point on the ring plane.
        const t = a / (a - b);
        const x = this._p.copy(prev).lerp(next, t);
        if (x.distanceTo(r.center) < r.radius && !r.passed) {
          r.passed = true;
          this.ringsPassed++;
          rings.mesh.setColorAt(i, this.ringColor.set('#4dff88'));
          rings.mesh.instanceColor!.needsUpdate = true;
          return i;
        }
      }
    }
    return -1;
  }

  resetRings() {
    const rings = this.zones.rings;
    rings.list.forEach((r, i) => {
      r.passed = false;
      rings.mesh.setColorAt(i, this.ringColor.set('#f08a24'));
    });
    if (rings.mesh.instanceColor) rings.mesh.instanceColor.needsUpdate = true;
    this.ringsPassed = 0;
  }

  /** Keep sky centred on the camera and the shadow frustum on the aircraft. */
  update(camera: THREE.Camera, focus: THREE.Vector3) {
    this.sky.position.copy(camera.position);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(SKY.sunDir, 1500);
  }
}

/** Flattened low-poly puffs in clusters between 900 and 2600 m. */
function createClouds() {
  const N = 420;
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x3a4250 });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const r = rng(9);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let i = 0;
  const half = WORLD.boundsHalf * 1.2;
  while (i < N) {
    const cx = (r() * 2 - 1) * half;
    const cz = (r() * 2 - 1) * half;
    const cy = 900 + r() * 1700;
    const puffs = 4 + Math.floor(r() * 6);
    for (let k = 0; k < puffs && i < N; k++, i++) {
      const sz = 70 + r() * 160;
      p.set(cx + (r() - 0.5) * sz * 3, cy + (r() - 0.5) * sz * 0.4, cz + (r() - 0.5) * sz * 2);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r() * Math.PI);
      m.compose(p, q, s.set(sz * (1 + r()), sz * (0.45 + r() * 0.25), sz * (1 + r() * 0.6)));
      mesh.setMatrixAt(i, m);
    }
  }
  mesh.name = 'Clouds';
  mesh.computeBoundingSphere();
  return mesh;
}

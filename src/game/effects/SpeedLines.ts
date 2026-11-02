import * as THREE from 'three';
import { FLIGHT } from '../config';

/**
 * Air streaks: short world-fixed particles around the camera, drawn as
 * motion-blur lines along the velocity. Because they stand still in the
 * world, their parallax sells speed even far above the ground.
 */
export class SpeedLines {
  readonly mesh: THREE.LineSegments;
  private readonly points: THREE.Vector3[] = [];
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly N = 160;
  private readonly _f = new THREE.Vector3();
  private readonly _v = new THREE.Vector3();
  private readonly _r = new THREE.Vector3();
  private readonly _u = new THREE.Vector3();
  private readonly _rel = new THREE.Vector3();

  constructor() {
    this.pos = new Float32Array(this.N * 6);
    this.col = new Float32Array(this.N * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'SpeedLines';
    for (let i = 0; i < this.N; i++) this.points.push(new THREE.Vector3(1e9, 0, 0));
  }

  reset() {
    for (const p of this.points) p.set(1e9, 0, 0);
  }

  update(camera: THREE.Camera, velocity: THREE.Vector3, afterburner: number) {
    const speed = velocity.length();
    const fwd = camera.getWorldDirection(this._f);
    const right = this._r.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = this._u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const camPos = camera.position;
    const k = THREE.MathUtils.smoothstep(speed, FLIGHT.cruiseSpeed * 0.7, FLIGHT.maxSpeed * 0.85);
    const strength = 0.03 + 0.4 * k + 0.3 * afterburner;
    const tail = this._v.copy(velocity).multiplyScalar(0.022 + 0.02 * k);

    for (let i = 0; i < this.N; i++) {
      const p = this.points[i];
      const rel = this._rel.copy(p).sub(camPos);
      const ahead = rel.dot(fwd);
      if (ahead < 2 || rel.lengthSq() > 160 * 160) {
        // Respawn ahead in a ring around the view axis (not dead centre).
        const a = Math.random() * Math.PI * 2;
        const r = 10 + Math.random() * 45;
        p.copy(camPos)
          .addScaledVector(fwd, 30 + Math.random() * 120)
          .addScaledVector(right, Math.cos(a) * r)
          .addScaledVector(up, Math.sin(a) * r);
      }
      const o = i * 6;
      this.pos[o] = p.x;
      this.pos[o + 1] = p.y;
      this.pos[o + 2] = p.z;
      this.pos[o + 3] = p.x - tail.x;
      this.pos[o + 4] = p.y - tail.y;
      this.pos[o + 5] = p.z - tail.z;
      const fade = THREE.MathUtils.clamp(ahead / 40, 0, 1) * strength;
      this.col[o] = this.col[o + 1] = this.col[o + 2] = fade * 0.9;
      this.col[o + 3] = this.col[o + 4] = this.col[o + 5] = 0;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }
}

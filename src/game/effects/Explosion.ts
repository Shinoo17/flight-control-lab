import * as THREE from 'three';

/** Fireball + smoke + debris for crashes. One instance, re-triggered each time. */
export class Explosion {
  readonly group = new THREE.Group();
  private readonly fire: THREE.Mesh;
  private readonly smoke: THREE.Mesh;
  private readonly debris: THREE.InstancedMesh;
  private readonly vel: THREE.Vector3[] = [];
  private readonly pos: THREE.Vector3[] = [];
  private readonly light: THREE.PointLight;
  private t = -1;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();

  constructor() {
    this.fire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 2),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    this.smoke = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: 0x2b2b2b, transparent: true, depthWrite: false, flatShading: true }),
    );
    this.debris = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(1.2),
      new THREE.MeshLambertMaterial({ color: 0x3a3d40, flatShading: true }),
      40,
    );
    this.debris.frustumCulled = false;
    this.light = new THREE.PointLight(0xff8a3a, 0, 400, 1.6);
    for (let i = 0; i < 40; i++) {
      this.vel.push(new THREE.Vector3());
      this.pos.push(new THREE.Vector3());
    }
    this.group.add(this.fire, this.smoke, this.debris, this.light);
    this.group.visible = false;
    this.group.name = 'Explosion';
  }

  trigger(at: THREE.Vector3, velocity: THREE.Vector3) {
    this.t = 0;
    this.group.visible = true;
    this.group.position.copy(at);
    for (let i = 0; i < this.vel.length; i++) {
      this.pos[i].set(0, 0, 0);
      this.vel[i]
        .randomDirection()
        .multiplyScalar(20 + Math.random() * 60)
        .addScaledVector(velocity, 0.15);
      this.vel[i].y = Math.abs(this.vel[i].y) + 10;
    }
  }

  hide() {
    this.t = -1;
    this.group.visible = false;
  }

  update(dt: number) {
    if (this.t < 0) return;
    this.t += dt;
    const t = this.t;
    const fs = 4 + 26 * (1 - Math.exp(-t * 5));
    this.fire.scale.setScalar(fs);
    (this.fire.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t / 1.1);
    this.smoke.scale.setScalar(6 + t * 13);
    this.smoke.position.y = t * 14;
    (this.smoke.material as THREE.MeshLambertMaterial).opacity = Math.max(0, 0.55 - t * 0.18);
    this.light.intensity = Math.max(0, 1 - t / 0.9) * 4000;
    for (let i = 0; i < this.vel.length; i++) {
      this.vel[i].y -= 9.81 * dt;
      this.pos[i].addScaledVector(this.vel[i], dt);
      if (this.pos[i].y + this.group.position.y < 0) {
        this.pos[i].y = -this.group.position.y;
        this.vel[i].multiplyScalar(0.3);
      }
      this.q.setFromEuler(new THREE.Euler(t * 7 + i, t * 5, i));
      this.m.compose(this.pos[i], this.q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.6 + (i % 5) * 0.4));
      this.debris.setMatrixAt(i, this.m);
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }
}

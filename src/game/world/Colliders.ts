import * as THREE from 'three';

/**
 * Minimal static collision for the playground. Aircraft are tested as a
 * handful of probe points, so every shape only needs "is this point inside".
 */
export type Collider =
  | { kind: 'box'; center: THREE.Vector3; half: THREE.Vector3; yaw: number; name: string; r: number }
  | { kind: 'cylinder'; x: number; z: number; radius: number; y0: number; y1: number; name: string; r: number; center: THREE.Vector3 }
  | {
      kind: 'torus';
      center: THREE.Vector3;
      /** Unit normal of the ring plane. */
      normal: THREE.Vector3;
      major: number;
      minor: number;
      name: string;
      r: number;
    };

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

export class ColliderSet {
  readonly list: Collider[] = [];

  box(center: THREE.Vector3, size: THREE.Vector3, yaw = 0, name = 'box') {
    const half = size.clone().multiplyScalar(0.5);
    this.list.push({ kind: 'box', center: center.clone(), half, yaw, name, r: half.length() });
  }

  cylinder(x: number, z: number, radius: number, y0: number, y1: number, name = 'pole') {
    const center = new THREE.Vector3(x, (y0 + y1) / 2, z);
    const r = Math.hypot(radius, (y1 - y0) / 2);
    this.list.push({ kind: 'cylinder', x, z, radius, y0, y1, name, r, center });
  }

  torus(center: THREE.Vector3, normal: THREE.Vector3, major: number, minor: number, name = 'ring') {
    this.list.push({
      kind: 'torus',
      center: center.clone(),
      normal: normal.clone().normalize(),
      major,
      minor,
      name,
      r: major + minor,
    });
  }

  /** First collider containing `p`, or null. */
  hit(p: THREE.Vector3): Collider | null {
    for (const c of this.list) {
      if (p.distanceToSquared(c.center) > c.r * c.r) continue;
      if (inside(c, p)) return c;
    }
    return null;
  }
}

function inside(c: Collider, p: THREE.Vector3): boolean {
  switch (c.kind) {
    case 'box': {
      _p.copy(p).sub(c.center);
      if (c.yaw !== 0) _p.applyAxisAngle(THREE.Object3D.DEFAULT_UP, -c.yaw);
      return Math.abs(_p.x) <= c.half.x && Math.abs(_p.y) <= c.half.y && Math.abs(_p.z) <= c.half.z;
    }
    case 'cylinder': {
      if (p.y < c.y0 || p.y > c.y1) return false;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      return dx * dx + dz * dz <= c.radius * c.radius;
    }
    case 'torus': {
      _p.copy(p).sub(c.center);
      const h = _p.dot(c.normal);
      _q.copy(_p).addScaledVector(c.normal, -h);
      const radial = _q.length() - c.major;
      return radial * radial + h * h <= c.minor * c.minor;
    }
  }
}

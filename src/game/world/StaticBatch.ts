import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Collects static, vertex-coloured primitives and merges them into one mesh,
 * so hundreds of map props cost a single draw call.
 */
export class StaticBatch {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  add(
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation,
    position: THREE.Vector3,
    rotation: THREE.Euler | THREE.Quaternion = new THREE.Quaternion(),
    scale = 1,
  ) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    if (rotation instanceof THREE.Euler) this.q.setFromEuler(rotation);
    else this.q.copy(rotation);
    this.m.compose(position, this.q, this.s.setScalar(scale));
    g.applyMatrix4(this.m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
  }

  box(size: THREE.Vector3, color: THREE.ColorRepresentation, center: THREE.Vector3, yaw = 0) {
    this.add(new THREE.BoxGeometry(size.x, size.y, size.z), color, center, new THREE.Euler(0, yaw, 0));
  }

  build(name: string, opts: { castShadow?: boolean; flat?: boolean } = {}): THREE.Mesh {
    const geo = mergeGeometries(this.parts, false)!;
    geo.computeBoundingSphere();
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: opts.flat ?? false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = opts.castShadow ?? false;
    mesh.receiveShadow = true;
    return mesh;
  }
}

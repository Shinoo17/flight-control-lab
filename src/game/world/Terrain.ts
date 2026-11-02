import * as THREE from 'three';
import { ridged, valueNoise } from './noise';

/**
 * Low-poly mountain range on a regular grid. The same height samples feed
 * the mesh and `heightAt`, so collision matches what is drawn.
 */
export interface TerrainSpec {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cell: number;
  peak: number;
}

export class Terrain {
  readonly spec: TerrainSpec;
  readonly mesh: THREE.Mesh;
  private readonly nx: number;
  private readonly nz: number;
  private readonly heights: Float32Array;

  constructor(spec: TerrainSpec) {
    this.spec = spec;
    this.nx = Math.round((spec.maxX - spec.minX) / spec.cell) + 1;
    this.nz = Math.round((spec.maxZ - spec.minZ) / spec.cell) + 1;
    this.heights = new Float32Array(this.nx * this.nz);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = spec.minX + i * spec.cell;
        const z = spec.minZ + j * spec.cell;
        this.heights[j * this.nx + i] = this.shape(x, z);
      }
    }
    this.mesh = this.buildMesh();
  }

  /** Canyon centre line: a meandering valley you can fly through north–south. */
  canyonX(z: number) {
    const s = this.spec;
    const mid = (s.minX + s.maxX) / 2;
    return mid + Math.sin(z / 1400) * 900 + Math.sin(z / 530 + 1.3) * 220;
  }

  private shape(x: number, z: number): number {
    const s = this.spec;
    const edge = 1100;
    const mx = smooth(s.minX, s.minX + edge, x) * smooth(s.maxX, s.maxX - edge, x);
    const mz = smooth(s.minZ, s.minZ + edge, z) * smooth(s.maxZ, s.maxZ - edge, z);
    const mask = mx * mz;
    if (mask <= 0) return 0;
    const r = ridged(x / 2600, z / 2600, 4, 11);
    const lump = valueNoise(x / 4200, z / 4200, 5);
    let h = s.peak * (0.25 + 0.75 * r) * (0.55 + 0.6 * lump);
    // Carve the canyon: ~340 m flat floor at 40 m, walls rising over ~470 m either side.
    const d = Math.abs(x - this.canyonX(z));
    const carve = smooth(170, 640, d);
    h = 40 + (h - 40) * carve;
    return Math.max(0, h * mask - (1 - mask) * 4);
  }

  /** Height at a world XZ, bilinear between grid samples. 0 outside the range. */
  heightAt(x: number, z: number): number {
    const s = this.spec;
    if (x <= s.minX || x >= s.maxX || z <= s.minZ || z >= s.maxZ) return 0;
    const fx = (x - s.minX) / s.cell;
    const fz = (z - s.minZ) / s.cell;
    const i = Math.min(Math.floor(fx), this.nx - 2);
    const j = Math.min(Math.floor(fz), this.nz - 2);
    const tx = fx - i;
    const tz = fz - j;
    const h = this.heights;
    const n = this.nx;
    // Match the mesh triangulation: diagonal from (i+1, j) to (i, j+1).
    const h00 = h[j * n + i];
    const h10 = h[j * n + i + 1];
    const h01 = h[(j + 1) * n + i];
    const h11 = h[(j + 1) * n + i + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  private buildMesh(): THREE.Mesh {
    const { nx, nz, heights, spec } = this;
    const quads = (nx - 1) * (nz - 1);
    const pos = new Float32Array(quads * 6 * 3);
    const col = new Float32Array(quads * 6 * 3);
    const c = new THREE.Color();
    const low = new THREE.Color('#5d7a4a');
    const mid = new THREE.Color('#7b6f5c');
    const high = new THREE.Color('#9a958c');
    const snow = new THREE.Color('#eef2f5');
    let k = 0;
    const put = (i: number, j: number, tint: number) => {
      const x = spec.minX + i * spec.cell;
      const z = spec.minZ + j * spec.cell;
      const y = heights[j * nx + i];
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      const t = y / spec.peak;
      if (t < 0.25) c.copy(low).lerp(mid, t / 0.25);
      else if (t < 0.6) c.copy(mid).lerp(high, (t - 0.25) / 0.35);
      else c.copy(high).lerp(snow, Math.min(1, (t - 0.6) / 0.15));
      c.multiplyScalar(tint);
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
      k += 3;
    };
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const tint = 0.92 + 0.16 * valueNoise(i * 0.7, j * 0.7, 3);
        // Two triangles, counter-clockwise seen from above (+Y).
        put(i, j, tint);
        put(i, j + 1, tint);
        put(i + 1, j, tint);
        put(i + 1, j, tint * 0.97);
        put(i, j + 1, tint * 0.97);
        put(i + 1, j + 1, tint * 0.97);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'Terrain';
    return mesh;
  }
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

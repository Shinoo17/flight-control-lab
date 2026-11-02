import * as THREE from 'three';

/**
 * Many text labels in one draw call: strings are rasterised into a canvas
 * atlas and each label becomes a textured quad in a single merged geometry.
 */
const CELL_W = 512;
const CELL_H = 128;
const COLS = 4;
const ROWS = 32;

export interface LabelOptions {
  color?: string;
  background?: string;
  /** Height of the label in metres. Width follows the text. */
  height: number;
  /** Quad orientation. Default: facing +Z, upright. */
  quaternion?: THREE.Quaternion;
  bold?: boolean;
}

export class LabelBatch {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];
  private count = 0;
  private readonly doubleSided: boolean;

  constructor(doubleSided = false) {
    this.canvas.width = CELL_W * COLS;
    this.canvas.height = CELL_H * ROWS;
    this.ctx = this.canvas.getContext('2d')!;
    this.doubleSided = doubleSided;
  }

  get full() {
    return this.count >= COLS * ROWS;
  }

  add(text: string, position: THREE.Vector3, o: LabelOptions): boolean {
    if (this.full) return false;
    const col = this.count % COLS;
    const row = Math.floor(this.count / COLS);
    const ctx = this.ctx;
    const x0 = col * CELL_W;
    const y0 = row * CELL_H;
    ctx.font = `${o.bold === false ? 600 : 800} ${CELL_H * 0.72}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    const measured = Math.min(CELL_W - 16, ctx.measureText(text).width + 24);
    if (o.background) {
      ctx.fillStyle = o.background;
      ctx.fillRect(x0 + (CELL_W - measured) / 2, y0 + 6, measured, CELL_H - 12);
    }
    ctx.fillStyle = o.color ?? '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x0 + CELL_W / 2, y0 + CELL_H / 2 + 4, CELL_W - 24);

    const aspect = measured / CELL_H;
    const hw = (o.height * aspect) / 2;
    const hh = o.height / 2;
    const q = o.quaternion ?? new THREE.Quaternion();
    const corners = [
      new THREE.Vector3(-hw, -hh, 0),
      new THREE.Vector3(hw, -hh, 0),
      new THREE.Vector3(hw, hh, 0),
      new THREE.Vector3(-hw, hh, 0),
    ];
    const base = this.positions.length / 3;
    for (const c of corners) {
      c.applyQuaternion(q).add(position);
      this.positions.push(c.x, c.y, c.z);
    }
    const W = this.canvas.width;
    const H = this.canvas.height;
    const u0 = (x0 + (CELL_W - measured) / 2) / W;
    const u1 = (x0 + (CELL_W + measured) / 2) / W;
    const v0 = 1 - (y0 + CELL_H) / H;
    const v1 = 1 - y0 / H;
    this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.count++;
    return true;
  }

  build(): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setIndex(this.indices);
    geo.computeBoundingSphere();
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.05,
      depthWrite: false,
      side: this.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    mesh.name = 'Labels';
    return mesh;
  }
}

/** Collects many labels, opening new atlases as each fills. */
export class LabelSet {
  private readonly batches: LabelBatch[] = [];
  private readonly doubleSided: boolean;
  constructor(doubleSided = false) {
    this.doubleSided = doubleSided;
  }
  add(text: string, position: THREE.Vector3, o: LabelOptions) {
    let b = this.batches[this.batches.length - 1];
    if (!b || b.full) {
      b = new LabelBatch(this.doubleSided);
      this.batches.push(b);
    }
    b.add(text, position, o);
  }
  build(): THREE.Group {
    const g = new THREE.Group();
    for (const b of this.batches) g.add(b.build());
    return g;
  }
}

/** Quaternion that lays a label flat on the ground, text reading toward `headingRad` (0 = north). */
export function flatOnGround(headingRad: number) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -headingRad);
  return yaw.multiply(q);
}

/** Upright label facing the given world direction (yaw about +Y, 0 = facing +Z). */
export function facing(yawRad: number) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
}

import * as THREE from 'three';

/** Frame-rate independent exponential approach. */
export function smoothTo(v: number, target: number, rate: number, dt: number): number {
  return v + (target - v) * (1 - Math.exp(-rate * dt));
}

/**
 * Lift a part's rotation point out to an arbitrary pivot without touching
 * the file: a group is placed at `pivot` (in the parent's space) and the part
 * is re-parented under it with `attach`, which keeps its world transform.
 * Returns a setter that rotates the part `deg` degrees about `axis`
 * (also in the parent's space).
 */
export function pivotHinge(part: THREE.Object3D, pivot: THREE.Vector3, axis: THREE.Vector3) {
  const parent = part.parent!;
  const node = new THREE.Group();
  node.name = `${part.name}_Pivot`;
  node.position.copy(pivot);
  parent.add(node);
  node.updateMatrixWorld(true);
  node.attach(part);
  const a = axis.clone().normalize();
  return (deg: number) => node.quaternion.setFromAxisAngle(a, THREE.MathUtils.degToRad(deg));
}

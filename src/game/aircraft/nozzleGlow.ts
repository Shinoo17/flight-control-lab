import * as THREE from 'three';

let glowTexture: THREE.Texture | null = null;

function texture() {
  if (glowTexture) return glowTexture;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,236,190,0.95)');
  grad.addColorStop(0.45, 'rgba(255,150,60,0.45)');
  grad.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(cv);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

/**
 * Hot-exit glow: an additive sprite at each nozzle exit. The plume cones are
 * nearly invisible from straight behind (they point at the camera), so this
 * is what actually reads as "afterburner lit" in the chase view.
 */
export function createNozzleGlow(parents: THREE.Object3D[], localPos: THREE.Vector3, baseSize: number) {
  const sprites = parents.map((p) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture(),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
      }),
    );
    s.position.copy(localPos);
    s.renderOrder = 11;
    p.add(s);
    return s;
  });
  let t = 0;
  return {
    /** `ab` 0..1 afterburner, `dry` 0..1 dry-thrust level. */
    update(ab: number, dry: number, dt: number) {
      t += dt;
      const flicker = 0.92 + 0.08 * Math.sin(t * 53) * Math.sin(t * 31);
      const k = (0.18 * dry + ab) * flicker;
      for (const s of sprites) {
        s.visible = k > 0.02;
        s.scale.setScalar(baseSize * (0.55 + 0.9 * ab) * flicker);
        s.material.opacity = Math.min(1, k);
      }
    },
    dispose() {
      for (const s of sprites) {
        s.removeFromParent();
        s.material.dispose();
      }
    },
  };
}

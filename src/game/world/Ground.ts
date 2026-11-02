import * as THREE from 'three';
import { WORLD } from '../config';

export interface ZoneTint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  color: THREE.ColorRepresentation;
  /** 0 = plain tint, 1 = cross stripes every 50 m (speed zone). */
  stripes?: number;
}

/**
 * Infinite-looking debug floor: a Lambert plane (so it takes the aircraft's
 * shadow) with a world-space grid, zone tints, a river and the area boundary
 * painted in the fragment shader. Lines are anti-aliased with fwidth so the
 * grid stays clean at grazing angles.
 */
export function createGround(zones: ZoneTint[], river: { x0: number; x1: number; z0: number; z1: number }) {
  const MAX = 8;
  const rects = Array.from({ length: MAX }, (_, i) => {
    const z = zones[i];
    return z ? new THREE.Vector4(z.minX, z.maxX, z.minZ, z.maxZ) : new THREE.Vector4(0, -1, 0, -1);
  });
  const colors = Array.from({ length: MAX }, (_, i) => new THREE.Color(zones[i]?.color ?? 0));
  const stripes = Array.from({ length: MAX }, (_, i) => zones[i]?.stripes ?? 0);

  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRects = { value: rects };
    shader.uniforms.uColors = { value: colors };
    shader.uniforms.uStripes = { value: stripes };
    shader.uniforms.uRiver = { value: new THREE.Vector4(river.x0, river.x1, river.z0, river.z1) };
    shader.uniforms.uBounds = { value: WORLD.boundsHalf };
    shader.uniforms.uMinor = { value: WORLD.gridMinor };
    shader.uniforms.uMajor = { value: WORLD.gridMajor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vGroundPos;
        uniform vec4 uRects[${MAX}];
        uniform vec3 uColors[${MAX}];
        uniform float uStripes[${MAX}];
        uniform vec4 uRiver;
        uniform float uBounds;
        uniform float uMinor;
        uniform float uMajor;
        float gridLine(vec2 p, float spacing, float width) {
          vec2 g = abs(fract(p / spacing - 0.5) - 0.5) * spacing;
          vec2 w = fwidth(p) * 1.2 + width;
          vec2 l = 1.0 - smoothstep(vec2(width), w, g);
          return max(l.x, l.y);
        }
        float inRect(vec2 p, vec4 r, float feather) {
          vec2 a = smoothstep(r.xz - feather, r.xz + feather, p);
          vec2 b = 1.0 - smoothstep(r.yw - feather, r.yw + feather, p);
          return a.x * a.y * b.x * b.y;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        {
          vec2 p = vGroundPos.xz;
          vec3 base = vec3(0.105, 0.15, 0.095);
          // Large checker so distance reads even where lines alias away.
          vec2 ck = floor(p / uMajor);
          base *= 0.94 + 0.06 * mod(ck.x + ck.y, 2.0);
          for (int i = 0; i < ${MAX}; i++) {
            float k = inRect(p, uRects[i], 30.0);
            vec3 c = uColors[i];
            if (uStripes[i] > 0.5) {
              float s = step(0.5, fract(p.y / 100.0));
              c *= 0.8 + 0.35 * s;
            }
            base = mix(base, c, k * 0.8);
          }
          float river = inRect(p, uRiver, 25.0);
          base = mix(base, vec3(0.03, 0.11, 0.24), river);

          float minor = gridLine(p, uMinor, 0.6);
          float major = gridLine(p, uMajor, 2.2);
          // Fade minor lines with distance so far ground doesn't shimmer.
          float dist = length(vGroundPos - cameraPosition);
          minor *= 1.0 - smoothstep(1500.0, 5000.0, dist);
          base = mix(base, base * 1.5 + 0.02, minor * 0.6);
          base = mix(base, vec3(0.55, 0.62, 0.55), major * 0.7);

          // Axis lines through the origin.
          vec2 aw = fwidth(p) * 1.2 + 4.0;
          vec2 al = 1.0 - smoothstep(vec2(4.0), aw, abs(p));
          float axis = max(al.x, al.y) * 0.8;
          base = mix(base, vec3(0.8, 0.55, 0.08), axis);

          // Boundary band.
          float edge = max(abs(p.x), abs(p.y));
          float band = smoothstep(uBounds - 60.0, uBounds - 20.0, edge) * (1.0 - smoothstep(uBounds + 20.0, uBounds + 60.0, edge));
          float outside = step(uBounds, edge);
          base = mix(base, base * vec3(1.0, 0.55, 0.5), outside * 0.6);
          base = mix(base, vec3(0.95, 0.15, 0.1), band);
          diffuseColor.rgb = base;
        }`,
      );
  };

  const size = WORLD.groundSize;
  const geo = new THREE.PlaneGeometry(size, size, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'Ground';
  return mesh;
}

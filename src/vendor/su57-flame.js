import * as THREE from 'three';

/**
 * Afterburner plume for su57.glb, driven off the nozzle rig in su57-nozzle.js.
 *
 * Each plume is parented to Gimbal_*, so thrust vectoring carries it for free
 * -- no billboarding, which would fight the deflection the rig exists to show.
 *
 * Geometry is a cone whose base sits at the local origin and whose apex runs
 * aft along +Z, so scaling the length grows the plume backwards and the base
 * stays welded to the exit plane at whatever scale. Base radius is read back
 * from the iris morph influences every frame, so the plume seals the lip
 * through the whole V-shaped throttle schedule instead of leaving a ring of
 * bare bore visible at full AB, where the iris is widest.
 *
 *   import { createFlameRig } from './su57-flame.js';
 *   const flames = createFlameRig(rig, { light: true });
 *   // in the render loop, after rig.setThrottle(...):
 *   flames.update(dt, smooth.throttle);
 *
 * Soft-particle depth fade is opt-in and needs a depth texture; without it the
 * plume cuts a hard line through the runway on takeoff and landing:
 *
 *   const target = new THREE.WebGLRenderTarget(w, h);
 *   target.depthTexture = new THREE.DepthTexture(w, h);
 *   flames.setDepthTexture(target.depthTexture, camera.near, camera.far, w, h);
 */

/** Exit plane in Gimbal_* local space, from MODEL_GUIDE section 4. */
const EXIT_Z = 2.76;
/** Exit radius at each iris extreme, matching the morph targets on the mesh. */
const R_CLOSED = 0.837;
const R_REST = 0.982;
const R_OPEN = 1.099;
/** Plume length in model units at full afterburner (1 unit ~ 0.42 m). */
const LEN_AB = 13;
/** Plume length at military power, where the visible plume is short and faint. */
const LEN_MIL = 3.2;

const VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying float vViewZ;

  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    vViewZ = mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAB;         // 0 at mil, 1 at full afterburner
  uniform float uIntensity;  // overall brightness, 0 kills the draw
  uniform float uSeed;       // decorrelates the two engines
  uniform float uCoreness;   // 0 = outer envelope, 1 = inner core
  uniform vec3 uHot;
  uniform vec3 uMid;
  uniform vec3 uTip;

  #ifdef USE_SOFT
    uniform sampler2D tDepth;
    uniform vec2 uResolution;
    uniform float uNear;
    uniform float uFar;
    uniform float uSoftness;
  #endif

  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  varying float vViewZ;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  void main() {
    // The shell is single-sided, so brightness has to be faked rather than
    // accumulated: face-on fragments read as the hot core, grazing ones fade
    // out into the silhouette. Additive DoubleSide does the opposite and
    // reads as a hollow tube.
    float facing = pow(abs(dot(vNormalV, vViewDir)), mix(1.4, 2.2, uCoreness));

    // Brightest just aft of the exit, tapering to nothing at the tip.
    float along = smoothstep(0.0, 0.06, vUv.y) * pow(1.0 - vUv.y, mix(1.5, 2.4, uCoreness));

    // Turbulence scrolling aft. Two octaves is enough at this size.
    float t = uTime * (2.2 + uAB * 2.6);
    float turb = noise(vec2(vUv.x * 7.0 + uSeed, vUv.y * 3.5 - t)) * 0.65
               + noise(vec2(vUv.x * 15.0 - uSeed, vUv.y * 9.0 - t * 1.7)) * 0.35;
    turb = mix(1.0, 0.55 + turb * 0.9, 0.55 + uCoreness * -0.3);

    // Shock diamonds: standing pattern, only under augmentation, decaying aft.
    float diamonds = pow(max(0.0, sin(vUv.y * 26.0 - uTime * 1.5 + uSeed)), 14.0)
                   * uAB * pow(1.0 - vUv.y, 2.2) * (1.0 - uCoreness * 0.5);

    // Combustion flicker -- irregular enough not to read as a sine.
    float flicker = 0.9 + 0.1 * noise(vec2(uSeed, uTime * 9.0));

    float a = along * facing * turb * flicker * uIntensity;
    a += diamonds * uIntensity * 1.6;
    if (a <= 0.001) discard;

    vec3 col = mix(uHot, uMid, smoothstep(0.0, 0.45, vUv.y));
    col = mix(col, uTip, smoothstep(0.45, 1.0, vUv.y));
    col = mix(col, vec3(1.0), diamonds * 0.8 + uCoreness * 0.25);

    #ifdef USE_SOFT
      vec2 duv = gl_FragCoord.xy / uResolution;
      float dz = texture2D(tDepth, duv).x;
      float sceneViewZ = (uNear * uFar) / ((uFar - uNear) * dz - uFar);
      // Both are negative and grow more negative with distance, so scene
      // geometry behind this fragment gives a positive difference.
      a *= clamp((vViewZ - sceneViewZ) / uSoftness, 0.0, 1.0);
    #endif

    gl_FragColor = vec4(col * a, a);
  }
`;

function makeCone(radialSeg, heightSeg) {
  // ConeGeometry is born pointing +Y with the apex at +h/2. Rotating +90 deg
  // about X maps +Y to +Z, then translating by h/2 puts the base on the local
  // origin -- which is what lets scale.z grow the plume aft without the base
  // sliding off the exit plane.
  const geo = new THREE.ConeGeometry(1, 1, radialSeg, heightSeg, true);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, 0.5);
  return geo;
}

function makeMaterial(coreness, seed, colors) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uAB: { value: 0 },
      uIntensity: { value: 0 },
      uSeed: { value: seed },
      uCoreness: { value: coreness },
      uHot: { value: new THREE.Color(colors.hot) },
      uMid: { value: new THREE.Color(colors.mid) },
      uTip: { value: new THREE.Color(colors.tip) },
      tDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uSoftness: { value: 1.4 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

export function createFlameRig(rig, opts = {}) {
  const {
    light = false,
    lightColor = 0x77bbff,
    lightIntensity = 60,
    radialSeg = 20,
    heightSeg = 1,
    colors = { hot: 0xbfe4ff, mid: 0x5f8cff, tip: 0x2a2f8a },
    coreColors = { hot: 0xffffff, mid: 0xcfe8ff, tip: 0x7fb0ff },
  } = opts;

  const sides = {};
  const materials = [];
  const geometries = [];

  for (const [which, seed] of [['L', 0.0], ['R', 3.7]]) {
    const gimbal = rig.sides[which].gimbal;

    const outerGeo = makeCone(radialSeg, heightSeg);
    const coreGeo = makeCone(radialSeg, heightSeg);
    geometries.push(outerGeo, coreGeo);

    const outerMat = makeMaterial(0, seed, colors);
    const coreMat = makeMaterial(1, seed + 1.3, coreColors);
    materials.push(outerMat, coreMat);

    const outer = new THREE.Mesh(outerGeo, outerMat);
    const core = new THREE.Mesh(coreGeo, coreMat);
    for (const m of [outer, core]) {
      m.position.set(0, 0, EXIT_Z);
      m.renderOrder = 10;
      m.frustumCulled = false; // the mesh is scaled per frame, so the baked
                               // bounding sphere lies about its extent
      gimbal.add(m);
    }

    let pointLight = null;
    if (light) {
      pointLight = new THREE.PointLight(lightColor, 0, 40, 2);
      pointLight.position.set(0, 0, EXIT_Z + 1.5);
      gimbal.add(pointLight);
    }

    sides[which] = { outer, core, outerMat, coreMat, light: pointLight, side: rig.sides[which] };
  }

  /**
   * Current exit radius, read back from the iris morph influences rather than
   * recomputed from throttle, so the plume can never drift out of sync with
   * whatever drove the nozzle -- setThrottle, setExitArea, or a direct poke at
   * the morph weights.
   */
  function exitRadius(s) {
    const closed = s.side.mesh.morphTargetInfluences[s.side.close];
    const open = s.side.mesh.morphTargetInfluences[s.side.open];
    return R_REST + (R_OPEN - R_REST) * open - (R_REST - R_CLOSED) * closed;
  }

  let time = 0;

  const api = {
    sides,

    /**
     * Drive both plumes from one throttle, or pass a second value for
     * asymmetric thrust. Call after the nozzle rig has been updated for this
     * frame, since the base radius is read out of the iris morphs.
     */
    update(dt, throttleL, throttleR = throttleL) {
      time += dt;
      for (const [which, t] of [['L', throttleL], ['R', throttleR]]) {
        const s = sides[which];
        const th = THREE.MathUtils.clamp(t, 0, 1);
        const ab = Math.max(0, (th - rig.MIL_THROTTLE) / (1 - rig.MIL_THROTTLE));

        // Below mil the plume is barely visible; augmentation is what lights it.
        const visible = th > 0.02;
        const dry = THREE.MathUtils.smoothstep(th, 0.05, rig.MIL_THROTTLE);
        const intensity = dry * 0.22 + ab * 0.95;
        const len = THREE.MathUtils.lerp(LEN_MIL, LEN_AB, ab) * (0.35 + dry * 0.65);
        const r = exitRadius(s);

        s.outer.visible = visible;
        s.core.visible = visible && ab > 0.01;
        s.outer.scale.set(r, r, len);
        s.core.scale.set(r * 0.55, r * 0.55, len * 0.4);

        for (const [mat, mul] of [[s.outerMat, 1], [s.coreMat, 1.35]]) {
          mat.uniforms.uTime.value = time;
          mat.uniforms.uAB.value = ab;
          mat.uniforms.uIntensity.value = intensity * mul;
        }

        if (s.light) s.light.intensity = intensity * lightIntensity;
      }
    },

    /**
     * Enable soft-particle fade. Without this the cone cuts a hard line where
     * it intersects the ground, which is unmissable on takeoff and landing.
     * Recall on resize.
     */
    setDepthTexture(depthTexture, near, far, width, height, softness = 1.4) {
      for (const m of materials) {
        m.defines.USE_SOFT = '';
        m.uniforms.tDepth.value = depthTexture;
        m.uniforms.uNear.value = near;
        m.uniforms.uFar.value = far;
        m.uniforms.uResolution.value.set(width, height);
        m.uniforms.uSoftness.value = softness;
        m.needsUpdate = true;
      }
    },

    dispose() {
      for (const which of ['L', 'R']) {
        const s = sides[which];
        for (const m of [s.outer, s.core]) m.removeFromParent();
        if (s.light) s.light.removeFromParent();
      }
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };

  api.update(0, 0);
  return api;
}

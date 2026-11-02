import * as THREE from 'three';

export const SKY = {
  zenith: new THREE.Color('#3f74b8'),
  horizon: new THREE.Color('#bcd3e6'),
  ground: new THREE.Color('#8d9a8f'),
  sunDir: new THREE.Vector3(-0.45, 0.62, 0.38).normalize(),
};

/** Gradient sky dome with a sun disc. Follows the camera so it never clips. */
export function createSky(radius: number) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: SKY.zenith },
      uHorizon: { value: SKY.horizon },
      uGround: { value: SKY.ground },
      uSun: { value: SKY.sunDir },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // pin to far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uGround, uSun;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0
          ? mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.6, h), 0.8))
          : mix(uHorizon, uGround, smoothstep(0.0, 0.08, -h));
        float s = max(dot(d, normalize(uSun)), 0.0);
        c += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.name = 'Sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// A small real-time fluid solver on the GPU (stable fluids: semi-Lagrangian
// advection, pressure projection, vorticity confinement), run in the
// coordinates of a channel: u along the channel, v across it. It carries
// "dye" that the water shader turns into colour and foam.
//
// Channels of the dye texture: r = foam, g = darker water, b = lighter water.
import * as THREE from 'three';

const VERT = `
  varying vec2 vUv, vL, vR, vT, vB;
  uniform vec2 texel;
  void main(){
    vUv = uv;
    vL = uv - vec2(texel.x, 0.0); vR = uv + vec2(texel.x, 0.0);
    vT = uv + vec2(0.0, texel.y); vB = uv - vec2(0.0, texel.y);
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const HEAD = `
  precision highp float;
  varying vec2 vUv, vL, vR, vT, vB;
  uniform vec2 texel;
  uniform float wall;   // half width of the water band in v, around 0.5
  float water(vec2 p){ return step(abs(p.y - 0.5), wall); }
`;

export function createChannelFluid(renderer, { nx = 1024, ny = 48, wall = 0.37, speed = 14, curl = 22 } = {}) {
  const type = THREE.HalfFloatType;
  const opt = { type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false };
  const pair = (w, h) => {
    const p = { read: new THREE.WebGLRenderTarget(w, h, opt), write: new THREE.WebGLRenderTarget(w, h, opt) };
    p.swap = () => { const t = p.read; p.read = p.write; p.write = t; };
    return p;
  };
  const vel = pair(nx, ny), dye = pair(nx * 2, ny * 2), pres = pair(nx, ny);
  const div = new THREE.WebGLRenderTarget(nx, ny, opt), crl = new THREE.WebGLRenderTarget(nx, ny, opt);
  const texel = new THREE.Vector2(1 / nx, 1 / ny), dyeTexel = new THREE.Vector2(0.5 / nx, 0.5 / ny);

  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  const mat = (frag, uniforms) => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: HEAD + frag, depthTest: false, depthWrite: false,
    uniforms: Object.assign({ texel: { value: texel }, wall: { value: wall } }, uniforms)
  });
  const run = (m, target) => { quad.material = m; renderer.setRenderTarget(target); renderer.render(scene, cam); };

  // ---------- passes ----------
  const curlM = mat(`
    uniform sampler2D uVel;
    void main(){
      float L = texture2D(uVel, vL).y, R = texture2D(uVel, vR).y, T = texture2D(uVel, vT).x, B = texture2D(uVel, vB).x;
      gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
    }`, { uVel: { value: null } });

  const vortM = mat(`
    uniform sampler2D uVel, uCurl; uniform float uDt, uCurlK;
    void main(){
      float L = texture2D(uCurl, vL).x, R = texture2D(uCurl, vR).x, T = texture2D(uCurl, vT).x, B = texture2D(uCurl, vB).x, C = texture2D(uCurl, vUv).x;
      vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      f /= length(f) + 1e-4;
      f *= uCurlK * C; f.y *= -1.0;
      vec2 v = texture2D(uVel, vUv).xy + f * uDt;
      gl_FragColor = vec4(clamp(v, -400.0, 400.0), 0.0, 1.0);
    }`, { uVel: { value: null }, uCurl: { value: null }, uDt: { value: 0 }, uCurlK: { value: curl } });

  const divM = mat(`
    uniform sampler2D uVel;
    void main(){
      vec2 C = texture2D(uVel, vUv).xy;
      float L = texture2D(uVel, vL).x, R = texture2D(uVel, vR).x, T = texture2D(uVel, vT).y, B = texture2D(uVel, vB).y;
      if (water(vT) < 0.5) T = -C.y;   // walls: no flow through the banks
      if (water(vB) < 0.5) B = -C.y;
      gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
    }`, { uVel: { value: null } });

  const clearM = mat(`
    uniform sampler2D uSrc; uniform float uK;
    void main(){ gl_FragColor = uK * texture2D(uSrc, vUv); }`, { uSrc: { value: null }, uK: { value: 0.8 } });

  const presM = mat(`
    uniform sampler2D uP, uDiv;
    void main(){
      float L = texture2D(uP, vL).x, R = texture2D(uP, vR).x, T = texture2D(uP, vT).x, B = texture2D(uP, vB).x;
      float C = texture2D(uP, vUv).x;
      if (water(vT) < 0.5) T = C;
      if (water(vB) < 0.5) B = C;
      gl_FragColor = vec4(0.25 * (L + R + B + T - texture2D(uDiv, vUv).x), 0.0, 0.0, 1.0);
    }`, { uP: { value: null }, uDiv: { value: null } });

  const gradM = mat(`
    uniform sampler2D uP, uVel;
    void main(){
      float L = texture2D(uP, vL).x, R = texture2D(uP, vR).x, T = texture2D(uP, vT).x, B = texture2D(uP, vB).x;
      vec2 v = texture2D(uVel, vUv).xy - 0.5 * vec2(R - L, T - B);
      gl_FragColor = vec4(v, 0.0, 1.0);
    }`, { uP: { value: null }, uVel: { value: null } });

  // advection plus the river: a sheared mean flow that the water relaxes
  // towards, no slip on the banks and inflow at the upstream end
  const advVelM = mat(`
    uniform sampler2D uVel; uniform float uDt, uDiss, uSpeed, uRelax;
    void main(){
      vec2 coord = vUv - uDt * texture2D(uVel, vUv).xy * texel;
      vec2 v = texture2D(uVel, coord).xy / (1.0 + uDiss * uDt);
      float n = (vUv.y - 0.5) / wall;
      vec2 target = vec2(uSpeed * (1.0 - 0.7 * n * n), 0.0);
      v += (target - v) * clamp(uRelax * uDt, 0.0, 1.0);
      v *= water(vUv) * smoothstep(1.0, 0.92, abs(n));
      if (vUv.x < 3.0 * texel.x || vUv.x > 1.0 - 3.0 * texel.x) v = target * water(vUv);   // inflow and outflow
      gl_FragColor = vec4(v, 0.0, 1.0);
    }`, { uVel: { value: null }, uDt: { value: 0 }, uDiss: { value: 0.15 }, uSpeed: { value: speed }, uRelax: { value: 0.35 } });

  const advDyeM = mat(`
    uniform sampler2D uVel, uDye; uniform float uDt, uDiss; uniform vec2 uVelTexel;
    void main(){
      vec2 coord = vUv - uDt * texture2D(uVel, vUv).xy * uVelTexel;
      vec4 d = texture2D(uDye, coord) / (1.0 + uDiss * uDt);
      gl_FragColor = d * water(vUv);
    }`, { uVel: { value: null }, uDye: { value: null }, uDt: { value: 0 }, uDiss: { value: 0.12 }, uVelTexel: { value: texel } });

  const splatM = mat(`
    uniform sampler2D uSrc; uniform vec2 uPoint; uniform vec4 uValue; uniform float uRadius, uAspect;
    void main(){
      vec2 p = vUv - uPoint; p.x *= uAspect;
      float g = exp(-dot(p, p) / uRadius);
      gl_FragColor = texture2D(uSrc, vUv) + uValue * g * water(vUv);
    }`, { uSrc: { value: null }, uPoint: { value: new THREE.Vector2() }, uValue: { value: new THREE.Vector4() }, uRadius: { value: 0.001 }, uAspect: { value: 1 } });

  // aspect of one texture unit along the channel against one across it
  let aspect = nx / ny;

  function splat(u, v, du, dv, dyeRGB, radius = 0.0008) {
    const prev = renderer.getRenderTarget();
    splatM.uniforms.uAspect.value = aspect;
    splatM.uniforms.uRadius.value = radius;
    splatM.uniforms.uPoint.value.set(u, v);
    splatM.uniforms.uSrc.value = vel.read.texture;
    splatM.uniforms.uValue.value.set(du, dv, 0, 0);
    run(splatM, vel.write); vel.swap();
    splatM.uniforms.uSrc.value = dye.read.texture;
    splatM.uniforms.uValue.value.set(dyeRGB[0], dyeRGB[1], dyeRGB[2], 0);
    run(splatM, dye.write); dye.swap();
    renderer.setRenderTarget(prev);
  }

  function step(dt) {
    const prev = renderer.getRenderTarget();
    dt = Math.min(dt, 1 / 30);
    curlM.uniforms.uVel.value = vel.read.texture; run(curlM, crl);
    vortM.uniforms.uVel.value = vel.read.texture; vortM.uniforms.uCurl.value = crl.texture; vortM.uniforms.uDt.value = dt;
    run(vortM, vel.write); vel.swap();
    divM.uniforms.uVel.value = vel.read.texture; run(divM, div);
    clearM.uniforms.uSrc.value = pres.read.texture; run(clearM, pres.write); pres.swap();
    presM.uniforms.uDiv.value = div.texture;
    for (let k = 0; k < 18; k++) { presM.uniforms.uP.value = pres.read.texture; run(presM, pres.write); pres.swap(); }
    gradM.uniforms.uP.value = pres.read.texture; gradM.uniforms.uVel.value = vel.read.texture; run(gradM, vel.write); vel.swap();
    advVelM.uniforms.uVel.value = vel.read.texture; advVelM.uniforms.uDt.value = dt; run(advVelM, vel.write); vel.swap();
    advDyeM.uniforms.uVel.value = vel.read.texture; advDyeM.uniforms.uDye.value = dye.read.texture; advDyeM.uniforms.uDt.value = dt;
    run(advDyeM, dye.write); dye.swap();
    renderer.setRenderTarget(prev);
  }

  // start from the mean flow so the river moves from the first frame
  function init() {
    const prev = renderer.getRenderTarget();
    advVelM.uniforms.uVel.value = vel.read.texture; advVelM.uniforms.uDt.value = 10;
    run(advVelM, vel.write); vel.swap();
    renderer.setRenderTarget(prev);
  }
  init();

  // ---------- velocity back to the CPU, so particles can ride the eddies ----------
  // A coarse copy of the velocity field is read back a few times a second.
  const RW = 256, RH = 16;
  let readOK = true, small = null, buf = null, rowMean = null;
  try {
    small = new THREE.WebGLRenderTarget(RW, RH, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
    buf = new Float32Array(RW * RH * 4);
    rowMean = new Float32Array(RH);
  } catch (e) { readOK = false; }
  const copyM = mat(`
    uniform sampler2D uSrc;
    void main(){ gl_FragColor = texture2D(uSrc, vUv); }`, { uSrc: { value: null } });
  function readVelocity() {
    if (!readOK) return false;
    const prev = renderer.getRenderTarget();
    try {
      copyM.uniforms.uSrc.value = vel.read.texture;
      run(copyM, small);
      renderer.readRenderTargetPixels(small, 0, 0, RW, RH, buf);
      // the mean flow at each distance from the bank, so only eddies and stirring remain
      for (let j = 0; j < RH; j++) {
        let m = 0;
        const i0 = Math.floor(RW * 0.1), i1 = Math.floor(RW * 0.9);
        for (let i = i0; i < i1; i++) m += buf[4 * (j * RW + i)];
        rowMean[j] = m / (i1 - i0);
      }
    } catch (e) { readOK = false; }
    renderer.setRenderTarget(prev);
    return readOK;
  }
  // velocity minus the mean river flow at (u, v), in cells per second
  function perturbation(u, v, out) {
    out[0] = 0; out[1] = 0;
    if (!readOK) return out;
    const x = Math.min(RW - 1.001, Math.max(0, u * RW - 0.5)), y = Math.min(RH - 1.001, Math.max(0, v * RH - 0.5));
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const at = (a, b, c) => buf[4 * (b * RW + a) + c];
    for (let c = 0; c < 2; c++) {
      out[c] = (at(i, j, c) * (1 - fx) + at(i + 1, j, c) * fx) * (1 - fy) + (at(i, j + 1, c) * (1 - fx) + at(i + 1, j + 1, c) * fx) * fy;
    }
    out[0] -= rowMean[j] * (1 - fy) + rowMean[j + 1] * fy;
    return out;
  }

  return {
    step, splat, wall, readVelocity, perturbation,
    get dye() { return dye.read.texture; },
    get velocity() { return vel.read.texture; }
  };
}

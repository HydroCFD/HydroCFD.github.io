// Hero scene: a meandering river with helical secondary flow, carrying
// microplastic particles that foul, sink, fragment and settle.
// Illustrative only; the motion is a sketch of the processes in the model.
import * as THREE from 'three';
import { runWhenVisible, fitGL, isSmall, gauss, makeNoise, smooth, lerp } from './loop.js';
import { createChannelFluid } from './fluid.js';

// ---------- river geometry (scene units, vertical scale exaggerated) ----------
const S = 220;          // length of the parameter range covered by particles
const HALF_W = 5;       // half width of the channel
const H = 2.8;          // maximum depth
const A = 14;           // meander amplitude
const K = 2 * Math.PI / 70;
const KMAX = A * K * K; // maximum curvature, used to normalise
const U = 5.0;          // surface velocity on the axis
const WS = 1.4;         // settling velocity per unit of excess density ratio

const C = { x: 0, z: 0, nx: 0, nz: 1, kn: 0, ds: 1 };
function centre(s) {
  const sn = Math.sin(K * s), cs = Math.cos(K * s);
  const dz = A * K * cs;
  const norm = Math.sqrt(1 + dz * dz);
  C.x = s - S / 2;
  C.z = A * sn;
  C.nx = -dz / norm;
  C.nz = 1 / norm;
  C.kn = (-A * K * K * sn) / (norm * norm * norm) / KMAX;
  C.ds = norm;
  return C;
}
// depth below the water surface; the pool shifts to the outer bank of each bend
const depth = (n, kn) => H * (0.12 + 0.88 * (1 - n * n)) * (1 - 0.5 * kn * n);

export function initRiver(canvas, opts = {}) {
  const small = isSmall();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const FOG = 0.0062;
  scene.fog = new THREE.FogExp2(0xf2ede3, FOG);
  const camera = new THREE.PerspectiveCamera(small ? 52 : 38, 1, 0.5, 700);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcabf9f, 1.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.3);
  sun.position.set(-50, 80, 40);
  scene.add(sun);

  // ---------- terrain: a jittered triangular mesh carved by the channel ----------
  const noise = makeNoise(7);
  const GX = small ? 180 : 260, GZ = small ? 100 : 150;
  const terrain = new THREE.PlaneGeometry(330, 190, GX, GZ);
  terrain.rotateX(-Math.PI / 2);
  const pos = terrain.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const dx = 330 / GX;
  const deep = new THREE.Color(0xa99a78), shallow = new THREE.Color(0xd6c9a8),
    bank = new THREE.Color(0xe2d8c2), plain = new THREE.Color(0xf0eadc), moss = new THREE.Color(0xd9d6bd);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i) + (Math.random() - 0.5) * dx * 0.7;
    let z = pos.getZ(i) + (Math.random() - 0.5) * dx * 0.7;
    // nearest point on the centreline: coarse scan, then refine
    let best = 1e9, bs = 0;
    const s0 = x + S / 2;
    for (let s = s0 - 26; s <= s0 + 26; s += 0.8) {
      const cx = s - S / 2, cz = A * Math.sin(K * s);
      const d2 = (x - cx) ** 2 + (z - cz) ** 2;
      if (d2 < best) { best = d2; bs = s; }
    }
    for (let s = bs - 0.8; s <= bs + 0.8; s += 0.08) {
      const cx = s - S / 2, cz = A * Math.sin(K * s);
      const d2 = (x - cx) ** 2 + (z - cz) ** 2;
      if (d2 < best) { best = d2; bs = s; }
    }
    const c = centre(bs);
    const n = ((x - c.x) * c.nx + (z - c.z) * c.nz) / HALF_W;
    const an = Math.abs(n);
    const hills = 0.9 * noise(x * 0.035, z * 0.035, 0.5) + 0.35 * noise(x * 0.12, z * 0.12, 3.1);
    let y;
    if (an <= 1) {
      y = -depth(n, c.kn);
      tmp.copy(shallow).lerp(deep, Math.min(1, -y / H));
    } else {
      const edge = -depth(Math.sign(n), c.kn);
      const t = smooth(1, 1.5, an);
      y = lerp(edge, 0.45, t) + t * (0.4 + hills) * smooth(1.6, 5, an) * 0.9;
      tmp.copy(bank).lerp(plain, smooth(1.3, 3, an)).lerp(moss, Math.max(0, hills) * 0.8);
    }
    const v = 0.94 + 0.08 * Math.random();
    col[3 * i] = tmp.r * v; col[3 * i + 1] = tmp.g * v; col[3 * i + 2] = tmp.b * v;
    pos.setXYZ(i, x, y, z);
  }
  terrain.setAttribute('color', new THREE.BufferAttribute(col, 3));
  terrain.computeVertexNormals();
  const ground = new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }));
  scene.add(ground);
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(terrain),
    new THREE.LineBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.13, depthWrite: false }));
  wire.position.y = 0.02;
  scene.add(wire);

  // ---------- water surface ----------
  // A moving surface: ripples carried downstream (faster on the axis than at
  // the banks), sun glints, a little sky reflection at grazing angles, colour
  // from the depth (deep blue on the axis, clearer water over the shallows),
  // long foam streaks that follow the flow and a soft shoreline.
  const SW0 = -70, SW1 = S + 70, NS = small ? 400 : 640, NNW = small ? 13 : 19;
  const wPos = [], wUv = [], wTan = [], wIdx = [];
  for (let i = 0; i <= NS; i++) {
    const s = SW0 + (SW1 - SW0) * i / NS;
    const c = centre(s);
    for (let j = 0; j < NNW; j++) {
      const n = -1.35 + 2.7 * j / (NNW - 1);
      wPos.push(c.x + n * HALF_W * c.nx, 0, c.z + n * HALF_W * c.nz);
      wUv.push(s, n);
      wTan.push(c.nz, -c.nx);           // unit vector along the channel
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NNW - 1; j++) {
    const a = i * NNW + j, b = a + NNW;
    wIdx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const water = new THREE.BufferGeometry();
  water.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  water.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
  water.setAttribute('aTan', new THREE.Float32BufferAttribute(wTan, 2));
  water.setIndex(wIdx);
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 }, uFog: { value: FOG }, uU: { value: U }, uHalfW: { value: HALF_W },
      uSun: { value: new THREE.Vector3(-50, 80, 40).normalize() },
      uDye: { value: null }, uSpan: { value: new THREE.Vector2(SW0, SW1) }, uDyeOn: { value: 0 }
    },
    vertexShader: `
      attribute vec2 aTan;
      varying vec2 vUv; varying vec2 vTan; varying vec3 vWorld; varying float vFog;
      uniform float uFog;
      void main(){
        vUv = uv; vTan = aTan;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vFog = exp(-uFog * uFog * mv.z * mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vUv; varying vec2 vTan; varying vec3 vWorld; varying float vFog;
      uniform float uTime, uFog, uU, uHalfW, uDyeOn;
      uniform sampler2D uDye; uniform vec2 uSpan;
      uniform vec3 uSun;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for (int k = 0; k < 4; k++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
        return v;
      }
      // surface height in channel coordinates (q.x along, q.y across, scene units)
      float height(vec2 q, float speed){
        vec2 a = vec2(q.x - uTime * uU * speed * 0.85, q.y);
        vec2 b = vec2(q.x - uTime * uU * speed * 1.15 + 31.0, q.y * 1.3 + 7.0);
        return 0.6 * fbm(a * 0.55) + 0.4 * fbm(b * 1.4);
      }
      void main(){
        float s = vUv.x, n = vUv.y, an = abs(n);
        float speed = max(0.15, 1.0 - 0.7 * n * n);
        vec2 q = vec2(s, n * uHalfW);

        // normal from the height field, then turned into the world frame
        float e = 0.12, h = height(q, speed);
        float hs = (height(q + vec2(e, 0.0), speed) - h) / e;
        float hn = (height(q + vec2(0.0, e), speed) - h) / e;
        vec3 T = vec3(vTan.x, 0.0, vTan.y), B = vec3(-vTan.y, 0.0, vTan.x);
        // the fluid simulation: its dye gives eddies of darker and lighter water, foam and relief
        vec2 duv = vec2((s - uSpan.x) / (uSpan.y - uSpan.x), (n + 1.35) / 2.7);
        vec4 dye = texture2D(uDye, duv) * uDyeOn;
        float tone = dye.g - dye.b;
        vec2 o = vec2(0.0015, 0.012);
        float ts = (texture2D(uDye, duv + vec2(o.x, 0.0)).g - texture2D(uDye, duv + vec2(o.x, 0.0)).b - tone) * uDyeOn;
        float tn = (texture2D(uDye, duv + vec2(0.0, o.y)).g - texture2D(uDye, duv + vec2(0.0, o.y)).b - tone) * uDyeOn;
        hs += 3.0 * ts; hn += 3.0 * tn;
        vec3 N = normalize(vec3(0.0, 1.0, 0.0) - 0.9 * (hs * T + hn * B));
        vec3 V = normalize(cameraPosition - vWorld);

        // colour from depth: deep on the axis, shallow and clearer at the banks
        float depth = clamp(1.0 - n * n, 0.0, 1.0);
        vec3 deep = vec3(0.11, 0.27, 0.50), shallow = vec3(0.42, 0.60, 0.74);
        vec3 col = mix(shallow, deep, smoothstep(0.0, 0.9, depth));
        col *= 0.88 + 0.24 * h;                            // ripples darken and lighten the water
        col = mix(col, deep * 0.62, clamp(dye.g, 0.0, 1.0) * 0.7);
        col = mix(col, vec3(0.55, 0.72, 0.85), clamp(dye.b, 0.0, 1.0) * 0.65);

        // sky reflection at grazing angles and sun glints on the ripples
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        col = mix(col, vec3(0.86, 0.90, 0.94), fres * 0.7);
        vec3 R = reflect(-uSun, N);
        float glint = pow(max(dot(R, V), 0.0), 160.0);
        col += vec3(1.0, 0.98, 0.94) * glint * 1.6;

        // foam: long streaks that follow the flow, and a broken line along the banks
        float streak = fbm(vec2((s - uTime * uU * speed) * 0.12, n * uHalfW * 1.6));
        float foam = smoothstep(0.7, 0.82, streak) * 0.25 + clamp(dye.r, 0.0, 1.0) * 0.85;
        float bankFoam = smoothstep(0.82, 1.02, an) * smoothstep(0.45, 0.7, fbm(vec2((s - uTime * 1.2) * 0.9, n * 9.0)));
        col = mix(col, vec3(0.95, 0.96, 0.96), clamp(foam + 0.7 * bankFoam, 0.0, 0.85));

        // soft, slightly irregular shoreline
        float shore = 1.0 - smoothstep(1.0, 1.3, an + 0.12 * (fbm(vec2(s * 0.7, n * 3.0)) - 0.5));
        float alpha = (0.55 + 0.35 * depth + glint * 0.3 + foam * 0.3) * shore;

        col = mix(vec3(0.949, 0.929, 0.890), col, vFog);
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.96));
      }`
  });
  const waterMesh = new THREE.Mesh(water, waterMat);
  waterMesh.renderOrder = 1;
  scene.add(waterMesh);

  // ---------- fluid simulation inside the channel ----------
  let fluid = null;
  try {
    const nx = small ? 640 : 1024, ny = small ? 32 : 48;
    fluid = createChannelFluid(renderer, { nx, ny, wall: 0.5 / 1.35, speed: U / ((SW1 - SW0) / nx), curl: 24 });
    waterMat.uniforms.uDyeOn.value = 1;
  } catch (e) { console.warn('fluid simulation unavailable:', e); }
  const cellU = (SW1 - SW0) / (small ? 640 : 1024), cellV = 2.7 * HALF_W / (small ? 32 : 48);
  const toUV = (s, n) => [(s - SW0) / (SW1 - SW0), (n + 1.35) / 2.7];
  let stirClock = 0;
  function stir(dt) {
    // small random disturbances, as from the bed and the banks, keep eddies forming
    stirClock += dt;
    const spd = U / cellU;
    while (stirClock > 0.09) {
      stirClock -= 0.09;
      const s0 = lerp(-20, S + 20, Math.random()), n0 = (Math.random() * 2 - 1) * 0.92;
      const [u, v] = toUV(s0, n0);
      const kind = Math.random();
      const dye = kind < 0.42 ? [0, 0.55, 0] : kind < 0.84 ? [0, 0, 0.5] : [0.4, 0, 0];
      const bank = Math.abs(n0) > 0.65 ? -Math.sign(n0) : (Math.random() - 0.5) * 2;
      fluid.splat(u, v, (Math.random() - 0.65) * spd * 0.9, bank * spd * (0.5 + Math.random()), dye, 0.0012 + Math.random() * 0.0025);
    }
  }
  // run the river for a while before the first frame, so eddies already fill it
  if (fluid) for (let k = 0; k < 150; k++) { stir(1 / 30); fluid.step(1 / 30); }

  // the pointer stirs the water where it crosses the river
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let lastHit = null;
  window.addEventListener('pointermove', e => {
    if (!fluid) return;
    const r = canvas.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) { lastHit = null; return; }
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(waterMesh)[0];
    if (!hit || !hit.uv || Math.abs(hit.uv.y) > 1) { lastHit = null; return; }
    if (lastHit) {
      const ds = hit.uv.x - lastHit.x, dn = hit.uv.y - lastHit.y;
      const [u, v] = toUV(hit.uv.x, hit.uv.y);
      fluid.splat(u, v, ds / cellU * 25, dn * HALF_W / cellV * 25, [0.35, 0, 0.45], 0.002);
    }
    lastHit = hit.uv.clone();
  }, { passive: true });

  // ---------- particles ----------
  const N = small ? 3200 : 7000;
  const ps = new Float32Array(N), pn = new Float32Array(N), pd = new Float32Array(N);
  const pr = new Float32Array(N), pf = new Float32Array(N), pz = new Float32Array(N);
  const pt = new Float32Array(N), pflash = new Float32Array(N);
  const pstate = new Uint8Array(N);
  const P = new Float32Array(N * 3), PC = new Float32Array(N * 3), PS = new Float32Array(N);

  function spawn(i, anywhere) {
    ps[i] = anywhere ? -40 + Math.random() * (S + 70) : -45 + Math.random() * 8;
    pn[i] = (Math.random() * 2 - 1) * 0.85;
    const heavy = Math.random() < 0.06;
    pr[i] = heavy ? 1.15 + Math.random() * 0.25 : 0.9 + Math.random() * 0.07;
    pf[i] = heavy ? 0 : (Math.random() < 0.65 ? 0.0025 + Math.random() * 0.006 : 0);
    pd[i] = heavy ? Math.random() * 0.5 : Math.random() * 0.35;
    pz[i] = 0.9 + Math.random() * 1.1;
    pt[i] = 0; pflash[i] = 0; pstate[i] = 0;
    if (anywhere) { pr[i] += pf[i] * Math.random() * 40; pd[i] = Math.random() * 0.8; }
  }
  for (let i = 0; i < N; i++) spawn(i, true);

  // raw sRGB colours (the point shader writes them directly)
  const INK = [0.08, 0.08, 0.08], RED = [0.894, 0.341, 0.180], BED = [0.66, 0.545, 0.353], WATER = [0.33, 0.43, 0.78];
  const cc = [0, 0, 0];
  function colourOf(r) {
    const k = smooth(0.99, 1.12, r);
    for (let j = 0; j < 3; j++) cc[j] = INK[j] + (RED[j] - INK[j]) * k;
    return cc;
  }

  function step(dt) {
    const sq = Math.sqrt(dt);
    for (let i = 0; i < N; i++) {
      if (pstate[i] === 1) { // on the bed
        pt[i] += dt;
        if (Math.random() < 0.012 * dt) { pstate[i] = 0; pd[i] = 0.85; }
        else if (pt[i] > 40) spawn(i, false);
        pflash[i] = Math.max(0, pflash[i] - 2.5 * dt);
        continue;
      }
      const c = centre(ps[i]);
      const n = pn[i], d = pd[i];
      const dep = depth(n, c.kn);
      const prof = 0.3 + 0.7 * Math.pow(Math.max(0, 1 - d), 0.22);
      const us = U * (1 - 0.7 * n * n) * prof;
      ps[i] += us * dt / c.ds;
      // helical secondary flow: towards the outer bank at the surface, inner bank at the bed
      const sec = 0.9 * c.kn;
      const a1 = Math.PI * (n + 1) * 0.5, a2 = Math.PI * d;
      let vn = -sec * Math.sin(a1) * Math.cos(a2) * 0.12;
      let vd = sec * Math.cos(a1) * Math.sin(a2) * 0.12;
      // settling or rising, plus turbulent mixing
      vd += (pr[i] - 1) * WS / dep;
      pn[i] += vn * dt + 0.06 * sq * gauss();
      pd[i] += vd * dt + 0.16 * sq * gauss() * (0.25 + Math.sin(Math.PI * Math.min(1, Math.max(0, d))));
      if (pn[i] > 0.95) pn[i] = 1.9 - pn[i];
      if (pn[i] < -0.95) pn[i] = -1.9 - pn[i];
      if (pd[i] < 0) pd[i] = 0;
      if (pd[i] >= 1) {
        if (pr[i] > 1) { pd[i] = 1; pstate[i] = 1; pt[i] = 0; } else pd[i] = 2 - pd[i];
      }
      // biofilm growth and fragmentation
      pr[i] = Math.min(1.4, pr[i] + pf[i] * dt);
      if (Math.random() < 0.018 * dt && pz[i] > 0.6) { pz[i] *= 0.8; pflash[i] = 1; }
      pflash[i] = Math.max(0, pflash[i] - 2.5 * dt);
      pt[i] += dt;
      if (ps[i] > S + 50) spawn(i, false);
    }
  }

  function writeBuffers() {
    for (let i = 0; i < N; i++) {
      const c = centre(ps[i]);
      const n = pn[i];
      const dep = depth(n, c.kn);
      const settled = pstate[i] === 1;
      const d = settled ? 1 : pd[i];
      P[3 * i] = c.x + n * HALF_W * c.nx;
      P[3 * i + 2] = c.z + n * HALF_W * c.nz;
      P[3 * i + 1] = settled ? -dep + 0.1 : (d < 0.002 ? 0.05 : -d * dep);
      colourOf(pr[i]);
      const f = pflash[i], under = settled ? 0 : 0.55 * d;
      for (let j = 0; j < 3; j++) {
        let v = settled ? BED[j] : cc[j] + (WATER[j] - cc[j]) * under;
        v = v * (1 - f) + RED[j] * f;
        PC[3 * i + j] = v;
      }
      PS[i] = pz[i] * (1 + 1.6 * f) * (settled ? 0.85 : 1);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(PC, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(PS, 1).setUsage(THREE.DynamicDrawUsage));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: { value: 300 }, uFog: { value: FOG } },
    vertexShader: `
      attribute vec3 aColor; attribute float aSize;
      varying vec3 vColor; varying float vFog;
      uniform float uScale, uFog;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / -mv.z;
        vColor = aColor;
        vFog = exp(-uFog * uFog * mv.z * mv.z);
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vFog;
      void main(){
        float r = length(gl_PointCoord - 0.5);
        if (r > 0.5) discard;
        float a = 1.0 - smoothstep(0.36, 0.5, r);
        vec3 c = mix(vec3(0.949, 0.929, 0.890), vColor, vFog);
        gl_FragColor = vec4(c, a);
      }`
  });
  const points = new THREE.Points(geo, pMat);
  points.frustumCulled = false;
  points.renderOrder = 2;
  scene.add(points);

  // pre-warm so the first frame already looks lived-in
  for (let k = 0; k < 60; k++) step(0.15);
  writeBuffers();

  // ---------- camera and pointer ----------
  const target = new THREE.Vector3();
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', e => {
    mouse.x = e.clientX / window.innerWidth * 2 - 1;
    mouse.y = e.clientY / window.innerHeight * 2 - 1;
  }, { passive: true });

  function frame(dt, t) {
    if (fitGL(renderer, camera, canvas)) pMat.uniforms.uScale.value = renderer.domElement.height * 0.17;
    if (dt > 0) { step(dt); writeBuffers(); }
    if (fluid && dt > 0) { stir(dt); fluid.step(dt); }
    if (fluid) waterMat.uniforms.uDye.value = fluid.dye;
    waterMat.uniforms.uTime.value = t;
    mouse.sx += (mouse.x - mouse.sx) * 0.04;
    mouse.sy += (mouse.y - mouse.sy) * 0.04;
    const sway = Math.sin(t * 0.06) * 0.22 + mouse.sx * 0.18;
    const R = small ? 100 : 80, elev = 0.56 - mouse.sy * 0.05;
    const cx = small ? 0 : (opts.cx ?? 16);
    target.set(cx + Math.sin(t * 0.05) * 8, -4, -2);
    camera.position.set(
      target.x - Math.sin(sway) * R * Math.cos(elev),
      R * Math.sin(elev),
      Math.cos(sway) * R * Math.cos(elev));
    camera.lookAt(target);
    renderer.render(scene, camera);
  }
  runWhenVisible(canvas, frame);
}

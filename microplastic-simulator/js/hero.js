// Hero scene: a meandering river with helical secondary flow, carrying
// microplastic particles that foul, sink, fragment and settle.
// Illustrative only; the motion is a sketch of the processes in the model.
import * as THREE from 'three';
import { runWhenVisible, fitGL, isSmall, gauss, makeNoise, smooth, lerp } from './loop.js';

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

export function initHero(canvas) {
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
  const SW0 = -70, SW1 = S + 70, NS = small ? 400 : 640, NNW = 9;
  const wPos = [], wUv = [], wIdx = [];
  for (let i = 0; i <= NS; i++) {
    const s = SW0 + (SW1 - SW0) * i / NS;
    const c = centre(s);
    for (let j = 0; j < NNW; j++) {
      const n = -1.35 + 2.7 * j / (NNW - 1);
      wPos.push(c.x + n * HALF_W * c.nx, 0, c.z + n * HALF_W * c.nz);
      wUv.push(s, n);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NNW - 1; j++) {
    const a = i * NNW + j, b = a + NNW;
    wIdx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const water = new THREE.BufferGeometry();
  water.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  water.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
  water.setIndex(wIdx);
  const waterMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uFog: { value: FOG } },
    vertexShader: `
      varying vec2 vUv; varying float vFog;
      uniform float uFog;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFog = exp(-uFog * uFog * mv.z * mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vUv; varying float vFog;
      uniform float uTime;
      void main(){
        float s = vUv.x, n = vUv.y;
        float an = abs(n);
        float speed = 1.0 - 0.7 * n * n;
        float w1 = sin(s * 1.1 - uTime * 5.0 * speed + sin(n * 6.0 + s * 0.21) * 1.8);
        float w2 = sin(s * 0.37 + n * 3.0 - uTime * 2.1 * speed);
        float streak = smoothstep(0.965, 1.0, w1) * (0.55 + 0.45 * w2);
        float edge = 1.0 - smoothstep(0.85, 1.35, an);
        vec3 base = mix(vec3(0.25, 0.42, 0.74), vec3(0.42, 0.58, 0.84), 0.5 + 0.5 * w2);
        vec3 c = mix(base, vec3(0.97, 0.95, 0.91), streak * 0.85);
        c = mix(vec3(0.949, 0.929, 0.890), c, vFog);
        float a = (0.5 + streak * 0.35) * edge;
        gl_FragColor = vec4(c, a);
      }`
  });
  const waterMesh = new THREE.Mesh(water, waterMat);
  waterMesh.renderOrder = 1;
  scene.add(waterMesh);

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
    waterMat.uniforms.uTime.value = t;
    mouse.sx += (mouse.x - mouse.sx) * 0.04;
    mouse.sy += (mouse.y - mouse.sy) * 0.04;
    const sway = Math.sin(t * 0.06) * 0.22 + mouse.sx * 0.18;
    const R = small ? 100 : 80, elev = 0.56 - mouse.sy * 0.05;
    const cx = small ? 0 : 16;
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

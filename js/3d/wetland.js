// Wetland scene: a baffled basin with a floating vegetation patch.
// Tracer pulses enter at the inlet, follow the serpentine path between the
// baffles, slow down in the vegetation, are caught for a while in the dead
// zones behind the baffles and leave at the outlet. Colour shows the time
// since release: red when fresh, ink when old. Illustration only.
import * as THREE from 'three';
import { runWhenVisible, fitGL, isSmall, gauss, smooth, lerp, makeNoise } from './loop.js';

const L = 12, W = 6, D = 0.9;          // basin length, width, depth (scene units)
const HW = 1.2;                        // half width of the flow path in a compartment
const U = 1.5;                         // speed on the path axis
const PULSE = 7;                       // seconds between tracer pulses
const RED = [0.894, 0.341, 0.180], OCHRE = [0.69, 0.49, 0.17], INK = [0.08, 0.08, 0.08];

// dead zones: corners of each compartment that the main flow does not pass
const DEAD = [[-5.3, -2.3], [-3.7, 2.3], [-2.3, 2.3], [-0.7, -2.3], [0.7, -2.3], [2.3, 2.3], [3.7, 2.3], [5.3, -2.3]];
const VEG = { x0: 0.45, x1: 2.55, z0: -1.25, z1: 1.25 };

export function initWetland(canvas, opts = {}) {
  const small = isSmall();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const FOG = 0.02;
  scene.fog = new THREE.FogExp2(0xf2ede3, FOG);
  const camera = new THREE.PerspectiveCamera(small ? 48 : 34, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcdbf9f, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(-8, 14, 6);
  scene.add(sun);

  // ---------- ground carved into a basin ----------
  const noise = makeNoise(5);
  const g = new THREE.PlaneGeometry(64, 44, small ? 110 : 170, small ? 76 : 116);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const bed = new THREE.Color(0xd2c4a2), bank = new THREE.Color(0xe2d8c2), plain = new THREE.Color(0xefe9dc), grass = new THREE.Color(0xdcd9c0), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const dx = Math.max(0, Math.abs(x) - L / 2), dz = Math.max(0, Math.abs(z) - W / 2);
    const d = Math.hypot(dx, dz);
    const n = noise(x * 0.18, z * 0.18, 1);
    let y;
    if (d === 0) { y = -D + 0.03 * n; c.copy(bed); }
    else {
      const t = smooth(0, 1.3, d);
      y = lerp(-D, 0.35, t) + smooth(1.3, 8, d) * (0.6 + 0.9 * n);
      c.copy(bank).lerp(plain, smooth(1, 4, d)).lerp(grass, Math.max(0, n) * 0.7);
    }
    p.setY(i, y);
    const v = 0.95 + 0.07 * Math.random();
    col.set([c.r * v, c.g * v, c.b * v], 3 * i);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })));
  const wire = new THREE.LineSegments(new THREE.WireframeGeometry(g), new THREE.LineBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.1, depthWrite: false }));
  wire.position.y = 0.01;
  scene.add(wire);

  // ---------- water ----------
  const water = new THREE.Mesh(new THREE.PlaneGeometry(L + 1.4, W + 1.4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x6f86c9, transparent: true, opacity: 0.32, depthWrite: false }));
  water.position.y = -0.08;
  water.renderOrder = 1;
  scene.add(water);

  // ---------- baffles: paper walls with ink edges ----------
  const inkLine = new THREE.LineBasicMaterial({ color: 0x141414 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf0eadc, roughness: 1 });
  function block(w, h, d, x, y, z, mat = wallMat) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), inkLine));
    scene.add(m);
    return m;
  }
  const BH = D + 0.4;
  [[-3, 1], [0, -1], [3, 1]].forEach(([x, side]) => block(0.14, BH, 4.4, x, -D + BH / 2, side * 0.8));

  // inlet (red) and outlet (blue) pipes
  const pipe = (x, color) => {
    const geo = new THREE.CylinderGeometry(0.16, 0.16, 1.6, 20).rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    m.position.set(x, -0.32, 2.2);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), inkLine));
    scene.add(m);
  };
  pipe(-L / 2 - 0.55, 0xe4572e);
  pipe(L / 2 + 0.55, 0x2643b8);

  // ---------- floating vegetation patch ----------
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(VEG.x1 - VEG.x0, VEG.z1 - VEG.z0).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x66772a, transparent: true, opacity: 0.22, depthWrite: false }));
  mat.position.set((VEG.x0 + VEG.x1) / 2, -0.06, 0);
  scene.add(mat);
  const outline = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(VEG.x0, -0.05, VEG.z0), new THREE.Vector3(VEG.x1, -0.05, VEG.z0),
    new THREE.Vector3(VEG.x1, -0.05, VEG.z1), new THREE.Vector3(VEG.x0, -0.05, VEG.z1), new THREE.Vector3(VEG.x0, -0.05, VEG.z0)]);
  const dashed = new THREE.Line(outline, new THREE.LineDashedMaterial({ color: 0x141414, dashSize: 0.12, gapSize: 0.08 }));
  dashed.computeLineDistances();
  scene.add(dashed);
  const NSTEM = small ? 140 : 240;
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.018, 1, 5), new THREE.MeshStandardMaterial({ color: 0x5d6d26, roughness: 0.9 }), NSTEM);
  const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: 0x7d8f3a, roughness: 0.9, flatShading: true }), NSTEM);
  {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i < NSTEM; i++) {
      const x = lerp(VEG.x0 + 0.08, VEG.x1 - 0.08, Math.random()), z = lerp(VEG.z0 + 0.08, VEG.z1 - 0.08, Math.random());
      const h = 0.55 + Math.random() * 0.35, lean = (Math.random() - 0.5) * 0.3;
      q.setFromEuler(e.set(lean, 0, (Math.random() - 0.5) * 0.25));
      m4.compose(v.set(x, -0.45 + h / 2, z), q, s.set(1, h, 1));
      stems.setMatrixAt(i, m4);
      const k = 0.45 + Math.random() * 0.5;
      m4.compose(v.set(x + lean * h * 0.5, -0.45 + h, z), q, s.set(k, k * 0.7, k));
      leaves.setMatrixAt(i, m4);
    }
  }
  scene.add(stems, leaves);

  // ---------- the serpentine flow path ----------
  const way = [[-6.6, 2.2], [-4.5, 2.2], [-4.5, -2.2], [-1.5, -2.2], [-1.5, 2.2], [1.5, 2.2], [1.5, -2.2], [4.5, -2.2], [4.5, 2.2], [6.6, 2.2]];
  const curve = new THREE.CatmullRomCurve3(way.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal', 0.5);
  const NS = 900, LEN = curve.getLength();
  const PX = new Float32Array(NS + 1), PZ = new Float32Array(NS + 1), TX = new Float32Array(NS + 1), TZ = new Float32Array(NS + 1);
  for (let k = 0; k <= NS; k++) {
    const u = k / NS, pt = curve.getPointAt(u), tg = curve.getTangentAt(u);
    PX[k] = pt.x; PZ[k] = pt.z; TX[k] = tg.x; TZ[k] = tg.z;
  }
  const at = s => Math.min(NS, Math.max(0, Math.round(s / LEN * NS)));

  // ---------- tracer particles ----------
  const N = small ? 1300 : 2600;
  const ps = new Float32Array(N), pn = new Float32Array(N), py = new Float32Array(N), age = new Float32Array(N);
  const st = new Uint8Array(N); // 0 waiting, 1 on the path, 2 in a dead zone
  const ex = new Float32Array(N), ez = new Float32Array(N), er = new Float32Array(N), ea = new Float32Array(N), ew = new Float32Array(N), et = new Float32Array(N);
  const X = new Float32Array(N), Z = new Float32Array(N);
  const POS = new Float32Array(N * 3), COL = new Float32Array(N * 3), SIZE = new Float32Array(N);
  let next = 0;

  function release(count) {
    for (let k = 0; k < count; k++) {
      const i = next; next = (next + 1) % N;
      ps[i] = Math.random() * 0.6; pn[i] = (Math.random() * 2 - 1) * 0.5; py[i] = Math.random();
      age[i] = 0; st[i] = 1; SIZE[i] = 0.8 + Math.random() * 0.7;
    }
  }

  function step(dt) {
    const sq = Math.sqrt(dt);
    for (let i = 0; i < N; i++) {
      if (st[i] === 0) continue;
      age[i] += dt;
      if (st[i] === 2) { // circling in a dead zone
        ea[i] += ew[i] * dt;
        et[i] -= dt;
        X[i] = ex[i] + Math.cos(ea[i]) * er[i];
        Z[i] = ez[i] + Math.sin(ea[i]) * er[i];
        if (et[i] <= 0) st[i] = 1;
        continue;
      }
      const k = at(ps[i]);
      const x = PX[k] + (-TZ[k]) * pn[i] * HW, z = PZ[k] + TX[k] * pn[i] * HW;
      const inVeg = x > VEG.x0 && x < VEG.x1 && z > VEG.z0 && z < VEG.z1;
      ps[i] += U * (1 - 0.6 * pn[i] * pn[i]) * (inVeg ? 0.4 : 1) * dt + 0.12 * sq * gauss();
      pn[i] += 0.28 * sq * gauss();
      if (pn[i] > 0.98) pn[i] = 1.96 - pn[i];
      if (pn[i] < -0.98) pn[i] = -1.96 - pn[i];
      py[i] = Math.min(1, Math.max(0, py[i] + 0.2 * sq * gauss()));
      // capture by a dead zone
      for (let j = 0; j < DEAD.length; j++) {
        const dx = x - DEAD[j][0], dz = z - DEAD[j][1], r = Math.hypot(dx, dz);
        if (r < 1.4 && Math.random() < 0.45 * dt) {
          st[i] = 2; ex[i] = DEAD[j][0]; ez[i] = DEAD[j][1];
          er[i] = Math.min(0.85, Math.max(0.25, r)); ea[i] = Math.atan2(dz, dx);
          ew[i] = (j % 2 ? 1 : -1) * (0.7 + Math.random() * 0.6); et[i] = 3 + Math.random() * 10;
          break;
        }
      }
      X[i] = x; Z[i] = z;
      if (ps[i] >= LEN) st[i] = 0;
    }
  }

  function write() {
    for (let i = 0; i < N; i++) {
      if (st[i] === 0) { POS[3 * i + 1] = -50; continue; }
      POS[3 * i] = X[i]; POS[3 * i + 2] = Z[i];
      POS[3 * i + 1] = -0.1 - py[i] * (D - 0.2);
      const a = age[i] / 30;
      const t1 = smooth(0, 0.45, a), t2 = smooth(0.4, 1, a);
      for (let j = 0; j < 3; j++) {
        let v = RED[j] + (OCHRE[j] - RED[j]) * t1;
        v = v + (INK[j] - v) * t2;
        COL[3 * i + j] = v;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(POS, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(COL, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(SIZE, 1).setUsage(THREE.DynamicDrawUsage));
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
        gl_FragColor = vec4(mix(vec3(0.949, 0.929, 0.890), vColor, vFog), 1.0 - smoothstep(0.36, 0.5, r));
      }`
  });
  const pts = new THREE.Points(geo, pMat);
  pts.frustumCulled = false;
  pts.renderOrder = 2;
  scene.add(pts);

  // pre-warm: a few pulses already in the basin
  let clock = 0, lastPulse = -PULSE;
  for (let k = 0; k < 220; k++) {
    if (clock - lastPulse >= PULSE) { release(Math.floor(N / 5)); lastPulse = clock; }
    step(0.1); clock += 0.1;
  }
  write();

  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', e => {
    mouse.x = e.clientX / window.innerWidth * 2 - 1;
    mouse.y = e.clientY / window.innerHeight * 2 - 1;
  }, { passive: true });

  const target = new THREE.Vector3();
  const shift = small ? 0 : (opts.shift ?? 5.5);
  function frame(dt, t) {
    if (fitGL(renderer, camera, canvas)) pMat.uniforms.uScale.value = renderer.domElement.height * 0.085;
    if (dt > 0) {
      clock += dt;
      if (clock - lastPulse >= PULSE) { release(Math.floor(N / 5)); lastPulse = clock; }
      step(dt);
      write();
    }
    mouse.sx += (mouse.x - mouse.sx) * 0.04;
    mouse.sy += (mouse.y - mouse.sy) * 0.04;
    const az = 0.42 + Math.sin(t * 0.05) * 0.16 + mouse.sx * 0.14;
    const el = 0.86 - mouse.sy * 0.05, R = small ? 30 : 23;
    // move the basin to the right of the screen, away from the text
    target.set(-Math.cos(az) * shift, -0.6, Math.sin(az) * shift);
    camera.position.set(target.x + Math.sin(az) * R * Math.cos(el), target.y + R * Math.sin(el), target.z + Math.cos(az) * R * Math.cos(el));
    camera.lookAt(target);
    renderer.render(scene, camera);
  }
  runWhenVisible(canvas, frame);
}

// Dense jet scene: a laboratory tank in which an inclined jet of brine rises
// from a nozzle, reaches its terminal height, falls back, hits the bed and
// spreads as a density current. Colour shows dilution: red near the nozzle,
// grey once mixed. Illustration only; the path is a simple ballistic sketch.
import * as THREE from 'three';
import { runWhenVisible, fitGL, isSmall, gauss, smooth, lerp } from './loop.js';

const TANK = { x0: -1.2, x1: 10, y1: 4.2, z0: -2.6, z1: 2.6 };
const RED = [0.894, 0.341, 0.180], GREY = [0.50, 0.47, 0.43];
const NOZ = { x: 0, y: 0.45 };
const ANGLE = 60 * Math.PI / 180;

export function initJet(canvas, opts = {}) {
  const small = isSmall();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const FOG = 0.022;
  scene.fog = new THREE.FogExp2(0xf2ede3, FOG);
  const camera = new THREE.PerspectiveCamera(small ? 50 : 34, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcdbf9f, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(6, 12, 8);
  scene.add(sun);
  const ink = new THREE.LineBasicMaterial({ color: 0x141414 });
  const inkFaint = new THREE.LineBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.12 });

  // ---------- floor, tank and water ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xefe9dc, roughness: 1 }));
  floor.position.y = -0.02;
  scene.add(floor);
  const W = TANK.x1 - TANK.x0, Dz = TANK.z1 - TANK.z0, cx = (TANK.x0 + TANK.x1) / 2;
  // bed of the tank with a measuring grid
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(W, Dz).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xdccfae, roughness: 1 }));
  bed.position.set(cx, 0, 0);
  scene.add(bed);
  const grid = [];
  for (let x = Math.ceil(TANK.x0 * 2) / 2; x <= TANK.x1; x += 0.5) grid.push(x, 0.005, TANK.z0, x, 0.005, TANK.z1);
  for (let z = TANK.z0; z <= TANK.z1 + 1e-6; z += 0.5) grid.push(TANK.x0, 0.005, z, TANK.x1, 0.005, z);
  // graduations on the back wall
  for (let y = 0.5; y < TANK.y1; y += 0.5) grid.push(TANK.x0, y, TANK.z0, TANK.x1, y, TANK.z0);
  for (let x = Math.ceil(TANK.x0); x <= TANK.x1; x += 1) grid.push(x, 0, TANK.z0, x, TANK.y1, TANK.z0);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
  scene.add(new THREE.LineSegments(gg, inkFaint));
  // back wall tinted like water, glass edges in ink
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, TANK.y1), new THREE.MeshBasicMaterial({ color: 0xdfe4ee }));
  back.position.set(cx, TANK.y1 / 2, TANK.z0 - 0.001);
  scene.add(back);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(Dz, TANK.y1).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe6e9f0, side: THREE.DoubleSide }));
  side.position.set(TANK.x0 - 0.001, TANK.y1 / 2, 0);
  scene.add(side);
  const box = new THREE.BoxGeometry(W, TANK.y1 + 0.5, Dz);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), ink);
  edges.position.set(cx, (TANK.y1 + 0.5) / 2, 0);
  scene.add(edges);
  // free surface
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(W, Dz).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6f86c9, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  surf.position.set(cx, TANK.y1, 0);
  scene.add(surf);
  const sl = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(TANK.x0, TANK.y1, TANK.z0), new THREE.Vector3(TANK.x1, TANK.y1, TANK.z0),
    new THREE.Vector3(TANK.x1, TANK.y1, TANK.z1), new THREE.Vector3(TANK.x0, TANK.y1, TANK.z1), new THREE.Vector3(TANK.x0, TANK.y1, TANK.z0)]);
  scene.add(new THREE.Line(sl, new THREE.LineBasicMaterial({ color: 0x2643b8 })));

  // ---------- nozzle ----------
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.5 });
  const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, NOZ.y, 16), pipeMat);
  riser.position.set(NOZ.x - 0.12, NOZ.y / 2, 0);
  scene.add(riser);
  const nozGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.42, 16);
  const nozzle = new THREE.Mesh(nozGeo, pipeMat);
  nozzle.rotation.z = -(Math.PI / 2 - ANGLE);
  nozzle.position.set(NOZ.x - 0.12 + Math.cos(ANGLE) * 0.12, NOZ.y + Math.sin(ANGLE) * 0.08, 0);
  scene.add(nozzle);
  const supply = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 16).rotateZ(Math.PI / 2), pipeMat);
  supply.position.set(TANK.x0 + 0.3, 0.07, 0);
  supply.scale.x = 1;
  scene.add(supply);

  // ---------- centreline: a ballistic path with drag ----------
  const path = [];
  {
    let x = NOZ.x + Math.cos(ANGLE) * 0.3, y = NOZ.y + Math.sin(ANGLE) * 0.3, vx = 3.1 * Math.cos(ANGLE), vy = 3.1 * Math.sin(ANGLE), t = 0, l = 0;
    const gp = 1.75, k = 0.38, dt = 0.004;
    path.push({ x, y, t, l });
    while (y > 0.06 || vy > 0) {
      vx -= k * vx * dt; vy -= (gp + k * vy) * dt;
      const nx = x + vx * dt, ny = y + vy * dt;
      l += Math.hypot(nx - x, ny - y); x = nx; y = ny; t += dt;
      path.push({ x, y, t, l });
      if (t > 10) break;
    }
  }
  const TEND = path[path.length - 1].t, LEND = path[path.length - 1].l;
  const top = path.reduce((a, b) => (b.y > a.y ? b : a));
  const impact = path[path.length - 1];
  const sample = t => {
    const f = Math.min(1, Math.max(0, t / TEND)) * (path.length - 1);
    const i = Math.floor(f), j = Math.min(path.length - 1, i + 1), w = f - i;
    const a = path[i], b = path[j];
    return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, l: a.l + (b.l - a.l) * w, tx: b.x - a.x, ty: b.y - a.y };
  };

  // terminal rise and impact markers, drawn like dimension lines
  const dash = new THREE.LineDashedMaterial({ color: 0xe4572e, dashSize: 0.12, gapSize: 0.08 });
  const riseLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(TANK.x0, top.y + 0.35, TANK.z0 + 0.01), new THREE.Vector3(top.x + 2.5, top.y + 0.35, TANK.z0 + 0.01)]), dash);
  riseLine.computeLineDistances();
  scene.add(riseLine);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.32, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe4572e }));
  ring.position.set(impact.x, 0.012, 0);
  scene.add(ring);

  // ---------- particles ----------
  const N = small ? 1800 : 3600;
  const SPREAD = 7;                       // seconds spent in the bed current
  const CYCLE = TEND / 0.5 + SPREAD;      // the jet is shown at half speed
  const ph = new Float32Array(N), ox = new Float32Array(N), oy = new Float32Array(N), dir = new Float32Array(N), rmax = new Float32Array(N), hgt = new Float32Array(N), wob = new Float32Array(N);
  const POS = new Float32Array(N * 3), COL = new Float32Array(N * 3), SIZE = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    ph[i] = Math.random() * CYCLE;
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
    ox[i] = Math.cos(a) * r; oy[i] = Math.sin(a) * r;
    dir[i] = (Math.random() - 0.5) * 2.2 + (Math.random() < 0.18 ? Math.PI : 0);
    rmax[i] = 2 + Math.random() * 3.2;
    hgt[i] = Math.random();
    wob[i] = Math.random() * 6.28;
    SIZE[i] = 0.7 + Math.random() * 0.7;
  }

  function write(t) {
    for (let i = 0; i < N; i++) {
      const c = (t + ph[i]) % CYCLE;
      const tj = c * 0.5;
      let x, y, z, dil;
      if (tj < TEND) {
        const s = sample(tj);
        const b = 0.05 + 0.17 * s.l;                 // the jet widens as it entrains water
        const len = Math.hypot(s.tx, s.ty) || 1;
        const nx = -s.ty / len, ny = s.tx / len;     // normal in the vertical plane
        const w = 0.35 * Math.sin(t * 3 + wob[i] + s.l * 2);
        x = s.x + nx * (ox[i] + w * 0.3) * b;
        y = s.y + ny * (ox[i] + w * 0.3) * b;
        z = oy[i] * b;
        dil = s.l / LEND;
      } else {
        const ts = (tj - TEND) / 0.5;                // time in the bed current
        const r = rmax[i] * (1 - Math.exp(-ts / 2.2));
        x = impact.x + Math.cos(dir[i]) * r + ox[i] * 0.2;
        z = Math.sin(dir[i]) * r * 0.85 + oy[i] * 0.2;
        y = 0.05 + hgt[i] * (0.12 + 0.35 * Math.exp(-ts / 1.2));
        dil = 1 + ts / SPREAD;
        if (x > TANK.x1 - 0.05) x = TANK.x1 - 0.05;
        if (z > TANK.z1 - 0.05) z = TANK.z1 - 0.05;
        if (z < TANK.z0 + 0.05) z = TANK.z0 + 0.05;
      }
      POS[3 * i] = x; POS[3 * i + 1] = y; POS[3 * i + 2] = z;
      const k = smooth(0, 1.4, dil);
      for (let j = 0; j < 3; j++) COL[3 * i + j] = RED[j] + (GREY[j] - RED[j]) * k;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aColor.needsUpdate = true;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(POS, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(COL, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(SIZE, 1));
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

  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', e => {
    mouse.x = e.clientX / window.innerWidth * 2 - 1;
    mouse.y = e.clientY / window.innerHeight * 2 - 1;
  }, { passive: true });

  const target = new THREE.Vector3();
  const shift = small ? 0 : (opts.shift ?? 4);
  function frame(dt, t) {
    if (fitGL(renderer, camera, canvas)) pMat.uniforms.uScale.value = renderer.domElement.height * 0.055;
    write(t);
    mouse.sx += (mouse.x - mouse.sx) * 0.04;
    mouse.sy += (mouse.y - mouse.sy) * 0.04;
    const az = 0.5 + Math.sin(t * 0.05) * 0.18 + mouse.sx * 0.16;
    const el = 0.3 - mouse.sy * 0.05, R = small ? 21 : 15.5;
    target.set(3.6 - Math.cos(az) * shift, 1.7, Math.sin(az) * shift);
    camera.position.set(target.x + Math.sin(az) * R * Math.cos(el), target.y + R * Math.sin(el), target.z + Math.cos(az) * R * Math.cos(el));
    camera.lookAt(target);
    renderer.render(scene, camera);
  }
  runWhenVisible(canvas, frame);
}

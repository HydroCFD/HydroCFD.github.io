// Ray tracing through a triangular prism mesh: particles move from prism to
// prism, and each face they cross lights up.
import * as THREE from 'three';
import { runWhenVisible, fitGL, isSmall, gauss } from '../../js/3d/loop.js';

export function initMesh(canvas) {
  const small = isSmall();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcdbf9f, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(3, 8, 6); scene.add(sun);

  // ---------- horizontal mesh: jittered nodes, triangles ----------
  const NX = 10, NY = 7, L = 4;
  const nodes = [];
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const edge = i === 0 || j === 0 || i === NX - 1 || j === NY - 1;
    nodes.push([i + (edge ? 0 : (Math.random() - 0.5) * 0.56), j + (edge ? 0 : (Math.random() - 0.5) * 0.56)]);
  }
  const id = (i, j) => j * NX + i;
  const tris = [];
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i, j + 1), d = id(i + 1, j + 1);
    if ((i + j) % 2) tris.push([a, b, d], [a, d, c]); else tris.push([a, b, c], [b, d, c]);
  }
  const zb = (x, y) => -(1.5 + 0.45 * Math.sin(x * 0.7) * Math.cos(y * 0.6) + 0.25 * Math.sin(y * 1.1));
  const level = (n, k) => zb(nodes[n][0], nodes[n][1]) * (1 - k / L);
  const X = x => x - (NX - 1) / 2, Z = y => y - (NY - 1) / 2;
  const world = (n, k, out) => out.set(X(nodes[n][0]), level(n, k), Z(nodes[n][1]));

  // ---------- wireframe: horizontal edges at every level, vertical edges at every node ----------
  const edges = new Map();
  tris.forEach(t => { for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3]; edges.set(a < b ? `${a},${b}` : `${b},${a}`, [Math.min(a, b), Math.max(a, b)]); } });
  // ink lines, weighted by kind: surface, bed, internal levels, verticals
  const v = new THREE.Vector3();
  function lines(pts, opacity) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x141414, transparent: true, opacity, depthWrite: false })));
  }
  for (let k = 0; k <= L; k++) {
    const lp = [];
    edges.forEach(([a, b]) => {
      world(a, k, v); lp.push(v.x, v.y, v.z);
      world(b, k, v); lp.push(v.x, v.y, v.z);
    });
    lines(lp, k === L ? 0.6 : k === 0 ? 0.45 : 0.13);
  }
  const vp = [];
  nodes.forEach((_, n) => {
    world(n, 0, v); vp.push(v.x, v.y, v.z);
    world(n, L, v); vp.push(v.x, v.y, v.z);
  });
  lines(vp, 0.2);

  // bed and surface faces
  function facesAt(k) {
    const p = [];
    tris.forEach(t => t.forEach(n => { world(n, k, v); p.push(v.x, v.y, v.z); }));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    return g;
  }
  scene.add(new THREE.Mesh(facesAt(0), new THREE.MeshStandardMaterial({ color: 0xddd0b2, flatShading: true, roughness: 1, side: THREE.DoubleSide })));
  scene.add(new THREE.Mesh(facesAt(L), new THREE.MeshBasicMaterial({ color: 0x2643b8, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })));

  // ---------- face highlights ----------
  const POOL = 48;
  const glows = [];
  for (let i = 0; i < POOL; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    m.userData.life = 0;
    m.frustumCulled = false;
    scene.add(m);
    glows.push(m);
  }
  let gi = 0;
  const q = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  function light(pts, color) {
    const m = glows[gi++ % POOL];
    const a = m.geometry.attributes.position.array;
    const [p0, p1, p2, p3] = pts;
    const tri = pts.length === 3;
    a.set([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]);
    if (tri) a.set([p0.x, p0.y, p0.z, p0.x, p0.y, p0.z, p0.x, p0.y, p0.z], 9);
    else a.set([p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z], 9);
    m.geometry.attributes.position.needsUpdate = true;
    m.material.color.set(color);
    m.userData.life = 1;
  }

  // ---------- particles ----------
  const COLS = [0xe4572e, 0x2643b8, 0x141414, 0x66772a, 0xb07d2b, 0x7a3e9d];
  const NP = small ? 4 : 6, TR = 70;
  const parts = [];
  // one point cloud holds every trail; the last point of each trail is the particle
  const tPos = new Float32Array(NP * TR * 3), tCol = new Float32Array(NP * TR * 3), tSize = new Float32Array(NP * TR);

  function locate(x, y) {
    for (let t = 0; t < tris.length; t++) {
      const [a, b, c] = tris[t];
      const [ax, ay] = nodes[a], [bx, by] = nodes[b], [cx, cy] = nodes[c];
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
      if (l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0) return t;
    }
    return -1;
  }
  function reset(p, start) {
    p.x = start ? Math.random() * (NX - 1) * 0.9 : 0.02;
    p.y = 0.5 + Math.random() * (NY - 2);
    p.s = 0.15 + Math.random() * 0.7;
    p.tri = locate(p.x, p.y);
    p.layer = Math.min(L - 1, Math.floor(p.s * L));
    p.trail.fill(0);
    p.n = 0;
  }
  for (let i = 0; i < NP; i++) {
    const trail = tPos.subarray(i * TR * 3, (i + 1) * TR * 3);
    const cs = new THREE.Color(COLS[i]).convertLinearToSRGB();
    for (let k = 0; k < TR; k++) {
      const f = Math.pow(k / (TR - 1), 1.3), head = k === TR - 1;
      const m = head ? 1 : 0.15 + 0.6 * f; // raw sRGB, faded towards the paper
      tCol.set([0.949 + (cs.r - 0.949) * m, 0.929 + (cs.g - 0.929) * m, 0.890 + (cs.b - 0.890) * m], 3 * (i * TR + k));
      tSize[i * TR + k] = head ? 1 : 0.16 + 0.3 * f;
    }
    const p = { trail, color: COLS[i], ph: Math.random() * 10, x: 0, y: 0, s: 0, tri: -1, layer: 0, n: 0 };
    reset(p, true);
    parts.push(p);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
  pg.setAttribute('aColor', new THREE.BufferAttribute(tCol, 3));
  pg.setAttribute('aSize', new THREE.BufferAttribute(tSize, 1));
  const pMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: { value: 300 } },
    vertexShader: `attribute vec3 aColor; attribute float aSize; varying vec3 vC; uniform float uScale;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize * uScale / -mv.z; vC = aColor; }`,
    fragmentShader: `varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard;
      gl_FragColor = vec4(vC, 1.0 - smoothstep(0.38, 0.5, r)); }`
  });
  const pts = new THREE.Points(pg, pMat);
  pts.frustumCulled = false;
  scene.add(pts);

  const sharedEdge = (t1, t2) => tris[t1].filter(n => tris[t2].includes(n));
  const wpos = (p, out) => out.set(X(p.x), zb(p.x, p.y) * (1 - p.s), Z(p.y));

  function step(dt, t) {
    for (const p of parts) {
      const u = 0.75 + 0.25 * Math.sin(p.y * 0.9 + t * 0.3 + p.ph);
      const w = 0.35 * Math.sin(p.x * 0.8 + p.ph + t * 0.25);
      p.x += u * dt;
      p.y += w * dt + 0.25 * Math.sqrt(dt) * gauss();
      p.s += 0.14 * Math.sin(t * 0.5 + p.ph) * dt + 0.12 * Math.sqrt(dt) * gauss();
      if (p.y < 0.2) p.y = 0.4 - p.y;
      if (p.y > NY - 1.2) p.y = 2 * (NY - 1.2) - p.y;
      if (p.s < 0.04) p.s = 0.08 - p.s;
      if (p.s > 0.96) p.s = 1.92 - p.s;
      if (p.x > NX - 1.02) { reset(p, false); continue; }

      const tri = locate(p.x, p.y);
      const layer = Math.min(L - 1, Math.floor(p.s * L));
      if (tri >= 0 && tri !== p.tri && p.tri >= 0) {
        const e = sharedEdge(p.tri, tri);
        if (e.length === 2) {
          world(e[0], layer, q[0]); world(e[1], layer, q[1]); world(e[1], layer + 1, q[2]); world(e[0], layer + 1, q[3]);
          light(q, p.color);
        }
      }
      if (tri >= 0 && layer !== p.layer) {
        const k = Math.max(layer, p.layer);
        const [a, b, c] = tris[tri];
        world(a, k, q[0]); world(b, k, q[1]); world(c, k, q[2]);
        light([q[0], q[1], q[2]], p.color);
      }
      if (tri >= 0) p.tri = tri;
      p.layer = layer;
    }
  }

  // ---------- pointer ----------
  const mouse = { x: 0, sx: 0 };
  canvas.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); mouse.x = (e.clientX - r.left) / r.width * 2 - 1; }, { passive: true });
  canvas.addEventListener('pointerleave', () => { mouse.x = 0; });

  const tmp = new THREE.Vector3();
  let acc = 0;
  function frame(dt, t) {
    if (fitGL(renderer, camera, canvas)) pMat.uniforms.uScale.value = renderer.domElement.height * 0.42;
    // fixed sub-steps so face crossings are caught one at a time
    acc += dt;
    while (acc > 1 / 60) { step(1 / 60, t); acc -= 1 / 60; }
    parts.forEach(p => {
      wpos(p, tmp);
      if (p.n === 0) { // new particle: collapse the trail onto it
        for (let k = 0; k < TR; k++) p.trail.set([tmp.x, tmp.y, tmp.z], 3 * k);
        p.n = 1;
      } else if (dt > 0) {
        p.trail.copyWithin(0, 3);
        p.trail.set([tmp.x, tmp.y, tmp.z], (TR - 1) * 3);
      }
    });
    pg.attributes.position.needsUpdate = true;
    glows.forEach(m => {
      if (m.userData.life <= 0) { m.visible = false; return; }
      m.visible = true;
      m.userData.life -= dt * 0.9;
      m.material.opacity = Math.max(0, m.userData.life) * 0.42;
    });
    mouse.sx += (mouse.x - mouse.sx) * 0.05;
    const az = 0.55 + Math.sin(t * 0.07) * 0.45 + mouse.sx * 0.5, el = 0.62, R = small ? 19 : 17;
    camera.position.set(Math.sin(az) * R * Math.cos(el), R * Math.sin(el) - 1, Math.cos(az) * R * Math.cos(el));
    camera.lookAt(0, -1.1, 0);
    renderer.render(scene, camera);
  }
  runWhenVisible(canvas, frame);
}

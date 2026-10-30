// "A particle's life": one microplastic fragment, driven by scroll position.
// Stages (life.P): 0 transport, 1 biofilm, 2 sinking, 3 fragmentation,
// 4 a fragment and its film, 5 bed.
import * as THREE from 'three';
import { runWhenVisible, fitGL, life, smooth, lerp, makeNoise, isSmall } from '../../js/3d/loop.js';

const BREAK = 2.45; // value of P at which the particle breaks
const FILM = 0.2;   // thickness of the mature film, as a share of the radius of the parent

export function initLife(canvas) {
  const small = isSmall();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf7f3eb, 11, 26);
  const camera = new THREE.PerspectiveCamera(small ? 44 : 36, 1, 0.1, 80);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xcdbf9f, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(4, 7, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(-6, 2, -5); scene.add(rim);
  const flash = new THREE.PointLight(0xe4572e, 0, 10, 1.5); scene.add(flash);
  // ink outline: the back faces of a slightly larger copy, drawn in black
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.BackSide });
  function outline(mesh, k, mat = outlineMat) {
    const o = new THREE.Mesh(mesh.geometry, mat);
    o.scale.setScalar(k);
    mesh.add(o);
    return o;
  }

  const noise = makeNoise(11);

  // ---------- the particle ----------
  const particle = new THREE.Group();
  scene.add(particle);
  // a plastic sphere, as in the model
  const coreGeo = new THREE.SphereGeometry(1, 64, 48);
  const core = new THREE.Mesh(coreGeo, new THREE.MeshPhysicalMaterial({
    color: 0xeef2f6, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.2
  }));
  particle.add(core);
  outline(core, 1.035);

  // ---------- biofilm ----------
  // A biofilm starts where algal cells land. Colonies appear at scattered
  // points, spread and thicken, and finally merge into an uneven, glossy
  // film: cells held in a slime of extracellular polymer. Filamentous algae
  // grow out of the older colonies and diatoms settle on the film. The plastic
  // stays visible between the young colonies. b (0..1) drives all of it.
  const shellGeo = new THREE.SphereGeometry(1, 96, 64);
  const SP = shellGeo.attributes.position, NV = SP.count;
  const base = new Float32Array(SP.array);
  const radial = new Float32Array(NV * 3);
  for (let i = 0; i < NV; i++) {
    const x = base[3 * i], y = base[3 * i + 1], z = base[3 * i + 2], r = Math.hypot(x, y, z) || 1;
    radial[3 * i] = x / r; radial[3 * i + 1] = y / r; radial[3 * i + 2] = z / r;
  }
  // colony seeds: random places on the surface, the first ones settle early
  const NC = 34, seeds = [];
  for (let c = 0; c < NC; c++) {
    const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    seeds.push({ d, t0: 0.72 * Math.pow(c / NC, 1.25), R: 0.32 + 0.42 * Math.random() });
  }
  const ang = new Float32Array(NV * NC);
  for (let i = 0; i < NV; i++) for (let c = 0; c < NC; c++) {
    const dot = radial[3 * i] * seeds[c].d.x + radial[3 * i + 1] * seeds[c].d.y + radial[3 * i + 2] * seeds[c].d.z;
    ang[i * NC + c] = Math.acos(Math.max(-1, Math.min(1, dot)));
  }
  const tex = new Float32Array(NV), lump = new Float32Array(NV);
  const FCOL = new Float32Array(NV * 4);
  {
    const slime = [0.36, 0.45, 0.14], olive = [0.30, 0.36, 0.10], brown = [0.46, 0.40, 0.12], dark = [0.17, 0.21, 0.06];
    for (let i = 0; i < NV; i++) {
      const x = base[3 * i], y = base[3 * i + 1], z = base[3 * i + 2];
      tex[i] = 0.5 + 0.5 * noise(x * 7 + 3, y * 7, z * 7);
      lump[i] = 0.5 + 0.5 * noise(x * 3.2, y * 3.2 + 5, z * 3.2);
      // the nearest colony decides the hue, so neighbouring colonies differ a little
      let best = 0;
      for (let c = 1; c < NC; c++) if (ang[i * NC + c] < ang[i * NC + best]) best = c;
      const hue = best % 3 === 0 ? slime : best % 3 === 1 ? olive : brown;
      for (let j = 0; j < 3; j++) FCOL[4 * i + j] = hue[j] + (dark[j] - hue[j]) * 0.45 * tex[i];
      FCOL[4 * i + 3] = 0;
    }
  }
  shellGeo.setAttribute('color', new THREE.BufferAttribute(FCOL, 4));
  // the layer is slightly translucent, so the plastic sphere shows faintly inside it
  const shellMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.35
  });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.renderOrder = 1;
  particle.add(shell);
  const shellLineMat = new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.BackSide, transparent: true, opacity: 0 });
  const shellLine = new THREE.Mesh(shellGeo, shellLineMat);
  shellLine.scale.setScalar(1.025);
  shell.add(shellLine);
  const cover = new Float32Array(NV), lift = new Float32Array(NV);
  let lastB = -1;
  function growFilm(b) {
    if (Math.abs(b - lastB) < 1e-4) return;
    lastB = b;
    const merge = smooth(0.72, 1.0, b);
    for (let i = 0; i < NV; i++) {
      let cv = 0;
      for (let c = 0; c < NC; c++) {
        const g = smooth(seeds[c].t0, seeds[c].t0 + 0.38, b);
        if (g <= 0) continue;
        const R = seeds[c].R * g, a = ang[i * NC + c];
        if (a < R) cv = Math.max(cv, (1 - smooth(R * 0.5, R, a)) * (0.55 + 0.45 * g));
      }
      cv = Math.max(cv, merge * (0.7 + 0.3 * lump[i]));
      cover[i] = cv;
      const h = 0.006 + cv * FILM * (0.25 + 0.75 * b) * (0.85 + 0.3 * (lump[i] - 0.5) + 0.06 * tex[i]);
      lift[i] = h;
      SP.array[3 * i] = base[3 * i] + radial[3 * i] * h;
      SP.array[3 * i + 1] = base[3 * i + 1] + radial[3 * i + 1] * h;
      SP.array[3 * i + 2] = base[3 * i + 2] + radial[3 * i + 2] * h;
      FCOL[4 * i + 3] = cv > 0.02 ? 0.48 + 0.34 * cv : 0;
    }
    SP.needsUpdate = true;
    shellLineMat.opacity = merge;
    shellGeo.attributes.color.needsUpdate = true;
    shellGeo.computeVertexNormals();
  }
  // a vertex close to the centre of colony c, used to place cells, diatoms and filaments
  const near = (c, frac) => {
    for (let k = 0; k < 400; k++) {
      const i = Math.floor(Math.random() * NV);
      if (ang[i * NC + c] < seeds[c].R * frac) return i;
    }
    let best = 0;
    for (let i = 1; i < NV; i++) if (ang[i * NC + c] < ang[best * NC + c]) best = i;
    return best;
  };
  const surf = (i, extra, out) => out.set(
    base[3 * i] + radial[3 * i] * (lift[i] + extra),
    base[3 * i + 1] + radial[3 * i + 1] * (lift[i] + extra),
    base[3 * i + 2] + radial[3 * i + 2] * (lift[i] + extra));

  // diatoms: small golden-brown cells lying flat on the film
  const ND = small ? 110 : 180;
  const diatoms = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6),
    new THREE.MeshStandardMaterial({ color: 0x8a6420, roughness: 0.45 }), ND);
  particle.add(diatoms);
  const dVert = [], dRot = [], dLen = [];
  {
    const up = new THREE.Vector3(), tg = new THREE.Vector3(), bt = new THREE.Vector3(), m = new THREE.Matrix4();
    for (let k = 0; k < ND; k++) {
      const i = near(k % NC, 0.85);
      up.set(radial[3 * i], radial[3 * i + 1], radial[3 * i + 2]);
      tg.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(up).normalize();
      bt.crossVectors(up, tg);
      dVert.push(i);
      dRot.push(new THREE.Quaternion().setFromRotationMatrix(m.makeBasis(tg, bt, up)));
      dLen.push(0.035 + Math.random() * 0.035);
    }
  }

  // filamentous algae: thin strands growing out of the older colonies
  const NFIL = small ? 26 : 40, SEG = 7;
  const filPos = new Float32Array(NFIL * SEG * 6), filCol = new Float32Array(NFIL * SEG * 6);
  const fil = [];
  for (let k = 0; k < NFIL; k++) {
    const c = k % Math.ceil(NC * 0.6), i = near(c, 0.5);
    const up = new THREE.Vector3(radial[3 * i], radial[3 * i + 1], radial[3 * i + 2]);
    const side = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(up).normalize();
    const dir = up.clone().addScaledVector(side, 0.35 + Math.random() * 0.5).normalize();
    fil.push({ i, c, dir, side, L: 0.14 + Math.random() * 0.22, ph: Math.random() * 6.28 });
    for (let s = 0; s < SEG; s++) {
      for (const [o, f] of [[0, s / SEG], [3, (s + 1) / SEG]]) {
        const at = (k * SEG + s) * 6 + o;
        filCol[at] = 0.18 + 0.30 * f; filCol[at + 1] = 0.24 + 0.22 * f; filCol[at + 2] = 0.06 + 0.08 * f;
      }
    }
  }
  const filGeo = new THREE.BufferGeometry();
  filGeo.setAttribute('position', new THREE.BufferAttribute(filPos, 3).setUsage(THREE.DynamicDrawUsage));
  filGeo.setAttribute('color', new THREE.BufferAttribute(filCol, 3));
  const filaments = new THREE.LineSegments(filGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
  filaments.frustumCulled = false;
  particle.add(filaments);

  // algal cells that drift in and land where the colonies will start
  const NA = small ? 60 : 90;
  const algae = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x4f5f20, roughness: 0.6 }), NA);
  particle.add(algae);
  const aVert = [], aStart = [], aTh = [];
  for (let k = 0; k < NA; k++) {
    const c = k % NC, i = near(c, 0.35);
    aVert.push(i);
    const dir = new THREE.Vector3(radial[3 * i], radial[3 * i + 1], radial[3 * i + 2]);
    aStart.push(dir.multiplyScalar(2.8 + Math.random() * 3.5).add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2)));
    aTh.push(Math.max(0, seeds[c].t0 - 0.14 - Math.random() * 0.08));
  }

  const gv = new THREE.Vector3(), gup = new THREE.Vector3(), gm = new THREE.Matrix4(), gsc = new THREE.Vector3();
  function growExtras(b, t) {
    // diatoms appear once their colony is established
    for (let k = 0; k < ND; k++) {
      const i = dVert[k], s = smooth(0.3, 0.7, cover[i]);
      surf(i, 0.006, gv);
      gsc.set(dLen[k] * s, dLen[k] * 0.32 * s, dLen[k] * 0.22 * s);
      gm.compose(gv, dRot[k], gsc);
      diatoms.setMatrixAt(k, gm);
    }
    diatoms.instanceMatrix.needsUpdate = true;
    // filaments lengthen with the age of their colony and sway in the flow
    for (let k = 0; k < NFIL; k++) {
      const f = fil[k], g = smooth(seeds[f.c].t0 + 0.2, seeds[f.c].t0 + 0.7, b) * smooth(0.25, 0.6, cover[f.i]);
      surf(f.i, 0, gup);
      const len = f.L * g;
      for (let s = 0; s < SEG; s++) {
        for (const [o, q] of [[0, s / SEG], [3, (s + 1) / SEG]]) {
          const sway = 0.09 * Math.pow(q, 1.6) * Math.sin(t * 1.8 + f.ph + q * 3) * g;
          const at = (k * SEG + s) * 6 + o;
          filPos[at] = gup.x + f.dir.x * len * q + f.side.x * sway;
          filPos[at + 1] = gup.y + f.dir.y * len * q + f.side.y * sway;
          filPos[at + 2] = gup.z + f.dir.z * len * q + f.side.z * sway;
        }
      }
    }
    filGeo.attributes.position.needsUpdate = true;
  }

  // ---------- fragments ----------
  // Each fragment is a smaller plastic sphere that takes its share of the film.
  // The attached cells are shared by mass, so no cells are created and the film
  // keeps the same share of the volume: it is thinner than on the parent, and
  // the effective density does not change at the break. The fracture face is
  // clean, and new algae colonise it afterwards.
  const NF = 8, RF = 0.42;
  const shards = [];
  const fragCore = new THREE.MeshPhysicalMaterial({ color: 0xeef2f6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 });
  function coatedSphere(seed, faceDir) {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.SphereGeometry(RF, 40, 28), fragCore);
    outline(c, 1.04);
    g.add(c);
    const fg = new THREE.SphereGeometry(1, 48, 32), fp = fg.attributes.position;
    const fc = new Float32Array(fp.count * 4);
    const unit = new Float32Array(fp.array), lumps = new Float32Array(fp.count), toFace = new Float32Array(fp.count);
    const hues = [[0.36, 0.45, 0.14], [0.30, 0.36, 0.10], [0.46, 0.40, 0.12]], dark = [0.17, 0.21, 0.06];
    for (let i = 0; i < fp.count; i++) {
      const x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i);
      const n1 = 0.5 + 0.5 * noise(x * 2.4 + seed, y * 2.4, z * 2.4), n2 = 0.5 + 0.5 * noise(x * 7 + seed, y * 7, z * 7);
      lumps[i] = n1;
      toFace[i] = Math.acos(Math.max(-1, Math.min(1, x * faceDir.x + y * faceDir.y + z * faceDir.z)));
      const h = hues[Math.floor(n1 * 2.99)];
      for (let j = 0; j < 3; j++) fc[4 * i + j] = h[j] + (dark[j] - h[j]) * 0.45 * n2;
    }
    fg.setAttribute('color', new THREE.BufferAttribute(fc, 4));
    // thickness of the film, and the angular size of the part of the fracture face still clean
    g.userData.setFilm = (thick, clean) => {
      for (let i = 0; i < fp.count; i++) {
        const edge = clean > 0.01 ? smooth(clean - 0.18, clean + 0.08, toFace[i]) : 1;
        const r = RF + 0.004 + thick * (0.8 + 0.4 * lumps[i]) * edge;
        fp.setXYZ(i, unit[3 * i] * r, unit[3 * i + 1] * r, unit[3 * i + 2] * r);
        fc[4 * i + 3] = 0.74 * edge;
      }
      fp.needsUpdate = true;
      fg.attributes.color.needsUpdate = true;
      fg.computeVertexNormals();
    };
    const filmMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.5, clearcoat: 0.4, emissive: 0xe4572e, emissiveIntensity: 0 });
    const f = new THREE.Mesh(fg, filmMat);
    f.renderOrder = 1;
    const fl = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.BackSide }));
    fl.scale.setScalar(1.025);
    f.add(fl);
    g.add(f);
    g.userData.filmMat = filmMat;
    return g;
  }
  for (let i = 0; i < NF; i++) {
    // directions spread on a sphere (Fibonacci lattice)
    const y = 1 - (i + 0.5) / NF * 2, r = Math.sqrt(1 - y * y), th = i * 2.39996;
    const dir = new THREE.Vector3(Math.cos(th) * r, y * 0.6, Math.sin(th) * r).normalize();
    // the fragment shown close up turns its fracture face towards the viewer
    const faceDir = i === 0 ? new THREE.Vector3(0.35, 0.25, 0.9).normalize() : new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const m = coatedSphere(i * 3.7, faceDir);
    m.visible = false;
    Object.assign(m.userData, {
      turn: new THREE.Vector3(), dir, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.2),
      bed: new THREE.Vector3(dir.x * 2.4 + (Math.random() - 0.5) * 0.6, 0, dir.z * 1.6 + (Math.random() - 0.5) * 0.6),
      phase: Math.random()
    });
    scene.add(m);
    shards.push(m);
  }

  // ---------- the bed ----------
  const bed = new THREE.Group();
  scene.add(bed);
  const bedGeo = new THREE.PlaneGeometry(44, 30, 110, 75);
  bedGeo.rotateX(-Math.PI / 2);
  {
    const p = bedGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, 0.12 * Math.sin(x * 2.1 + 1.6 * noise(x * 0.3, z * 0.3, 1)) + 0.25 * noise(x * 0.25, z * 0.25, 4));
    }
    bedGeo.computeVertexNormals();
  }
  bed.add(new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({ color: 0xd9cba8, roughness: 1, flatShading: true })));
  const bedWire = new THREE.LineSegments(new THREE.WireframeGeometry(bedGeo), new THREE.LineBasicMaterial({ color: 0x141414, transparent: true, opacity: 0.1 }));
  bedWire.position.y = 0.01;
  bed.add(bedWire);
  const NP = 320;
  const pebbles = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), NP);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
    for (let i = 0; i < NP; i++) {
      const x = (Math.random() - 0.5) * 30, z = (Math.random() - 0.5) * 18;
      const k = 0.3 + Math.random() * 0.9;
      m.compose(new THREE.Vector3(x, 0.12 * Math.sin(x * 2.1 + 1.6 * noise(x * 0.3, z * 0.3, 1)) + 0.25 * noise(x * 0.25, z * 0.25, 4) + 0.05, z),
        q.setFromEuler(e.set(Math.random() * 3, Math.random() * 3, 0)), s.set(k, k * 0.7, k));
      pebbles.setMatrixAt(i, m);
      pebbles.setColorAt(i, c.setHSL(0.09 + Math.random() * 0.04, 0.12, 0.45 + Math.random() * 0.25));
    }
  }
  bed.add(pebbles);
  const bedY = x => 0.12 * Math.sin(x * 2.1 + 1.6 * noise(x * 0.3, 0, 1)) + 0.25 * noise(x * 0.25, 0, 4);

  // ---------- flow streaks and suspended specks ----------
  const NS = small ? 110 : 170;
  const sPos = new Float32Array(NS * 6), sCol = new Float32Array(NS * 6);
  const sP = [];
  for (let i = 0; i < NS; i++) {
    sP.push(new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 10, -7 + Math.random() * 9));
    const b = 0.35 + Math.random() * 0.35;
    sCol.set([b, b, b * 0.97, 0.95, 0.93, 0.89], 6 * i);
  }
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  const streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
  streaks.frustumCulled = false;
  scene.add(streaks);

  const NK = small ? 300 : 600;
  const kPos = new Float32Array(NK * 3);
  for (let i = 0; i < NK; i++) kPos.set([(Math.random() - 0.5) * 22, (Math.random() - 0.5) * 12, -9 + Math.random() * 12], 3 * i);
  const specGeo = new THREE.BufferGeometry();
  specGeo.setAttribute('position', new THREE.BufferAttribute(kPos, 3).setUsage(THREE.DynamicDrawUsage));
  const specks = new THREE.Points(specGeo, new THREE.PointsMaterial({ color: 0x6d675e, size: 0.035, transparent: true, opacity: 0.6, depthWrite: false }));
  specks.frustumCulled = false;
  scene.add(specks);

  // ---------- HUD ----------
  const gaugeMark = document.getElementById('gauge-mark');
  const weightVal = document.getElementById('weight-val');
  let lastW = '', lastG = -1;

  // ---------- pointer ----------
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  canvas.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / r.width * 2 - 1;
    mouse.y = (e.clientY - r.top) / r.height * 2 - 1;
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => { mouse.x = 0; mouse.y = 0; });

  const V = new THREE.Vector3(), Vn = new THREE.Vector3(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(),
    zero = new THREE.Vector3(0, 0, 0), sc = new THREE.Vector3(), tv = new THREE.Vector3(), tw = new THREE.Vector3();
  let prevP = life.P, flashT = 0, lastFilmKey = -2;

  function frame(dt, t) {
    fitGL(renderer, camera, canvas);
    const P = life.P;
    const b = smooth(0.25, 1.15, P);                       // biofilm amount
    const sinkV = smooth(1.3, 1.8, P) * (1 - smooth(4.2, 4.8, P)); // settling, relative to the water
    const broken = P >= BREAK;
    const ex = smooth(BREAK, 3.1, P);                       // spread of the fragments
    const focus = smooth(3.2, 3.8, P) * (1 - smooth(4.15, 4.55, P)); // close look at one fragment
    const colonise = smooth(BREAK, 4.1, P);                 // new algae on the fracture faces
    const settle = smooth(4.1, 4.9, P);                     // arrival at the bed
    const resus = smooth(4.85, 5.3, P);                     // resuspension
    if ((prevP < BREAK) !== (P < BREAK)) flashT = 1;
    prevP = P;
    flashT = Math.max(0, flashT - (dt > 0 ? dt : 0.016) * 1.6);

    // the particle: turbulent wobble, tumbling
    const amp = 1 - settle;
    particle.position.set(
      (0.35 * Math.sin(t * 0.61) + 0.18 * Math.sin(t * 1.33)) * amp,
      (0.3 * Math.sin(t * 0.47 + 1) + 0.14 * Math.sin(t * 1.71)) * amp,
      0.2 * Math.sin(t * 0.37) * amp);
    particle.rotation.set(Math.sin(t * 0.3) * 0.45 + 0.3, t * 0.22, Math.sin(t * 0.21) * 0.25);
    core.visible = shell.visible = algae.visible = diatoms.visible = filaments.visible = !broken;
    if (!broken) { growFilm(b); growExtras(b, t); }

    // cells drift with the water, land on the surface and are overgrown by their colony
    for (let i = 0; i < NA; i++) {
      const k = smooth(aTh[i], aTh[i] + 0.16, b);
      const st = aStart[i];
      tv.set(((st.x + t * 0.9 + 60) % 9) - 4.5, st.y + Math.sin(t * 0.8 + i) * 0.2, st.z);
      tv.lerp(surf(aVert[i], 0.02, tw), k);
      const keep = 1 - 0.8 * smooth(0.4, 0.9, cover[aVert[i]]);
      M.compose(tv, Q, tv.lengthSq() > 40 ? zero : sc.setScalar((0.6 + 0.4 * k) * keep));
      algae.setMatrixAt(i, M);
    }
    algae.instanceMatrix.needsUpdate = true;

    // the fragments
    const floorY = -1.55;
    const filmKey = broken ? Math.round(P * 150) : -1;
    if (broken && filmKey !== lastFilmKey) {
      for (let i = 0; i < NF; i++) shards[i].userData.setFilm(FILM * RF + 0.05 * colonise, 1.25 * (1 - colonise));
    }
    lastFilmKey = filmKey;
    for (let i = 0; i < NF; i++) {
      const s = shards[i], u = s.userData;
      s.visible = broken;
      if (!broken) continue;
      const lead = i === 0;
      tv.copy(u.dir).multiplyScalar(0.3 + 1.6 * ex + (lead ? 0 : 2.2 * focus)).add(particle.position);
      if (lead) tv.lerp(tw.set(0, 0.35, 0.9), focus);
      // drift down to the bed
      const bx = u.bed.x, bz = u.bed.z;
      let hx = 0, hy = 0;
      if (resus > 0) {
        const ph = (t * 0.16 + u.phase) % 1;
        hx = (ph - 0.5) * 3.2 * resus;
        hy = 1.0 * Math.pow(Math.max(0, Math.sin(ph * Math.PI * 2)), 3) * resus;
        s.scale.setScalar(smooth(0, 0.06, ph) * (1 - smooth(0.94, 1, ph)) * resus + (1 - resus));
      } else s.scale.setScalar(lead ? 1 + 0.85 * focus : 1 - 0.55 * focus);
      tv.lerp(tw.set(bx + hx, floorY + bedY(bx + hx) + 0.4 + hy, bz), settle);
      s.position.copy(tv);
      const still = (lead ? 1 - focus : 1) * (1 - settle * 0.8 + hy);
      u.turn.x += u.spin.x * dt * still; u.turn.y += u.spin.y * dt * still; u.turn.z += u.spin.z * dt * still;
      const face = lead ? 1 - focus : 1;
      s.rotation.set(u.turn.x * face, u.turn.y * face, u.turn.z * face);
      u.filmMat.emissiveIntensity = flashT * 0.9;
    }
    flash.intensity = flashT * 25;
    flash.position.copy(particle.position);

    // the bed rises into view as the particle approaches it
    bed.position.y = lerp(-11, floorY, settle);

    // relative flow: downstream, plus upwards while the particle sinks
    const nearBed = 1 - 0.55 * settle;
    V.set(2.2 * nearBed, 1.6 * sinkV, 0);
    Vn.copy(V).normalize();
    const len = 0.5 + 0.25 * V.length();
    for (let i = 0; i < NS; i++) {
      const p = sP[i];
      p.addScaledVector(V, dt * (0.7 + (i % 7) * 0.08));
      if (p.x > 9) p.x -= 18;
      if (p.y > 5) p.y -= 10;
      sPos[6 * i] = p.x; sPos[6 * i + 1] = p.y; sPos[6 * i + 2] = p.z;
      sPos[6 * i + 3] = p.x - Vn.x * len; sPos[6 * i + 4] = p.y - Vn.y * len; sPos[6 * i + 5] = p.z;
    }
    streakGeo.attributes.position.needsUpdate = true;
    for (let i = 0; i < NK; i++) {
      kPos[3 * i] += V.x * 0.55 * dt; kPos[3 * i + 1] += V.y * 0.55 * dt + Math.sin(t + i) * 0.002;
      if (kPos[3 * i] > 11) kPos[3 * i] -= 22;
      if (kPos[3 * i + 1] > 6) kPos[3 * i + 1] -= 12;
    }
    specGeo.attributes.position.needsUpdate = true;

    // camera
    mouse.sx += (mouse.x - mouse.sx) * 0.05;
    mouse.sy += (mouse.y - mouse.sy) * 0.05;
    const dist = small ? 10.5 : 8.4;
    camera.position.set(mouse.sx * 1.2, 0.5 + 2.2 * settle - mouse.sy * 0.6, dist + 2.0 * settle);
    camera.lookAt(0, -1.2 * settle, 0);
    renderer.render(scene, camera);

    // HUD
    // no jump at the break; then the fragment moves to the daily cycle of its new size
    const cycle = smooth(3.2, 4.1, P);
    const r = 0.93 + 0.19 * b - 0.035 * cycle + 0.012 * Math.sin(t * 1.3) * cycle * (1 - settle);
    // water sits in the middle of the gauge; heavier side spans up to 1.25 times water
    const g = Math.round(Math.min(100, Math.max(0, r < 1 ? 50 * (r - 0.85) / 0.15 : 50 + 50 * (r - 1) / 0.25)));
    if (g !== lastG && gaugeMark) { gaugeMark.style.left = g + '%'; lastG = g; }
    const w = broken ? 'w = 8' : 'w = 1';
    if (w !== lastW && weightVal) { weightVal.textContent = w; lastW = w; }
  }
  runWhenVisible(canvas, frame);
}

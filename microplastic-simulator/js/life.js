// "A particle's life": one microplastic fragment, driven by scroll position.
// Stages (life.P): 0 transport, 1 biofilm, 2 sinking, 3 fragmentation, 4 bed.
import * as THREE from 'three';
import { runWhenVisible, fitGL, life, smooth, lerp, makeNoise, isSmall } from '../../js/3d/loop.js';

const BREAK = 2.45; // value of P at which the particle breaks

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

  // irregular flake: a sphere displaced by noise and flattened
  function flake(radius, amp, freq, seed, squash, segs = 64) {
    const g = new THREE.SphereGeometry(radius, segs, Math.round(segs * 0.66));
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const d = 1 + amp * noise(v.x * freq + seed, v.y * freq, v.z * freq)
        + 0.45 * amp * noise(v.x * freq * 2.7, v.y * freq * 2.7 + seed, v.z * freq * 2.7);
      p.setXYZ(i, v.x * radius * d, v.y * radius * d * squash, v.z * radius * d);
    }
    g.computeVertexNormals();
    return g;
  }

  // ---------- the particle ----------
  const particle = new THREE.Group();
  scene.add(particle);
  const coreGeo = flake(1, 0.32, 1.5, 2.3, 0.55);
  const core = new THREE.Mesh(coreGeo, new THREE.MeshPhysicalMaterial({
    color: 0xeef2f6, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.2
  }));
  particle.add(core);
  const coreLine = outline(core, 1.035);

  // biofilm: one continuous coat around the same particle. Every vertex is
  // pushed outwards from the centre by a smooth, nearly even thickness, so
  // the coat has no seams and keeps the outline of the particle.
  const shellGeo = coreGeo.clone();
  {
    const p = shellGeo.attributes.position;
    const colors = new Float32Array(p.count * 3), c = new THREE.Color();
    const g1 = new THREE.Color(0x8a9a44), g2 = new THREE.Color(0x6f7f30), g3 = new THREE.Color(0x9c8f55);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = Math.hypot(x, y, z) || 1;
      const slow = noise(x * 1.6 + 9, y * 1.6, z * 1.6), fine = noise(x * 5, y * 5, z * 5);
      const t = 0.12 + 0.025 * slow + 0.008 * fine;
      const k = 1 + t / r;
      p.setXYZ(i, x * k, y * k, z * k);
      c.copy(g1).lerp(g2, 0.5 + 0.5 * slow).lerp(g3, Math.max(0, fine) * 0.35);
      colors.set([c.r, c.g, c.b], 3 * i);
    }
    shellGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    shellGeo.computeVertexNormals();
  }
  const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, transparent: true, opacity: 0 });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  particle.add(shell);
  const shellLineMat = new THREE.MeshBasicMaterial({ color: 0x141414, side: THREE.BackSide, transparent: true, opacity: 0 });
  outline(shell, 1.03, shellLineMat);

  // algal cells that drift in and attach
  const NA = small ? 70 : 110;
  const algae = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x5d6d26, roughness: 0.7 }), NA);
  particle.add(algae);
  const aTarget = [], aStart = [], aTh = [];
  {
    const p = shellGeo.attributes.position;
    for (let i = 0; i < NA; i++) {
      const j = Math.floor(Math.random() * p.count);
      const tgt = new THREE.Vector3().fromBufferAttribute(p, j);
      aTarget.push(tgt);
      const dir = tgt.clone().normalize();
      aStart.push(dir.multiplyScalar(2.8 + Math.random() * 3.5).add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2)));
      aTh.push(Math.random() * 0.8);
    }
  }

  // ---------- fragments ----------
  const NF = 8;
  const shards = [];
  const shardCols = [0x8a9a44, 0xeef2f6, 0x6f7f30, 0xc9cc98, 0x9aa858, 0xe4e6d6, 0x7d8d3a, 0xb7bd84];
  for (let i = 0; i < NF; i++) {
    // directions spread on a sphere (Fibonacci lattice)
    const y = 1 - (i + 0.5) / NF * 2, r = Math.sqrt(1 - y * y), th = i * 2.39996;
    const dir = new THREE.Vector3(Math.cos(th) * r, y * 0.6, Math.sin(th) * r).normalize();
    const m = new THREE.Mesh(flake(0.42 + Math.random() * 0.12, 0.42, 2.2, i * 3.7, 0.6, 28),
      new THREE.MeshStandardMaterial({ color: shardCols[i], roughness: 0.6, flatShading: true, emissive: 0xe4572e, emissiveIntensity: 0 }));
    outline(m, 1.06);
    m.visible = false;
    m.userData = {
      dir, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.2),
      bed: new THREE.Vector3(dir.x * 2.4 + (Math.random() - 0.5) * 0.6, 0, dir.z * 1.6 + (Math.random() - 0.5) * 0.6),
      phase: Math.random()
    };
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
  let prevP = life.P, flashT = 0;

  function frame(dt, t) {
    fitGL(renderer, camera, canvas);
    const P = life.P;
    const b = smooth(0.25, 1.15, P);                       // biofilm amount
    const sinkV = smooth(1.3, 1.8, P) * (1 - smooth(3.2, 3.8, P)); // settling, relative to the water
    const broken = P >= BREAK;
    const ex = smooth(BREAK, 3.1, P);                       // spread of the fragments
    const settle = smooth(3.1, 3.9, P);                     // arrival at the bed
    const resus = smooth(3.85, 4.3, P);                     // resuspension
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
    core.visible = shell.visible = algae.visible = !broken;
    shellMat.opacity = smooth(0, 0.45, b);
    shellMat.transparent = shellMat.opacity < 1;
    shellLineMat.opacity = smooth(0.25, 0.6, b);
    coreLine.visible = b < 0.3;
    shell.scale.setScalar(lerp(0.94, 1, b));

    for (let i = 0; i < NA; i++) {
      const k = smooth(aTh[i], aTh[i] + 0.16, b);
      const st = aStart[i];
      tv.set(((st.x + t * 0.9 + 60) % 9) - 4.5, st.y + Math.sin(t * 0.8 + i) * 0.2, st.z);
      tv.lerp(tw.copy(aTarget[i]).multiplyScalar(lerp(0.9, 1, b)), k);
      M.compose(tv, Q, tv.lengthSq() > 40 ? zero : sc.setScalar(0.6 + 0.4 * k));
      algae.setMatrixAt(i, M);
    }
    algae.instanceMatrix.needsUpdate = true;

    // the fragments
    const floorY = -1.55;
    for (let i = 0; i < NF; i++) {
      const s = shards[i], u = s.userData;
      s.visible = broken;
      if (!broken) continue;
      tv.copy(u.dir).multiplyScalar(0.3 + 1.6 * ex).add(particle.position);
      // drift down to the bed
      const bx = u.bed.x, bz = u.bed.z;
      let hx = 0, hy = 0;
      if (resus > 0) {
        const ph = (t * 0.16 + u.phase) % 1;
        hx = (ph - 0.5) * 3.2 * resus;
        hy = 1.0 * Math.pow(Math.max(0, Math.sin(ph * Math.PI * 2)), 3) * resus;
        s.scale.setScalar(smooth(0, 0.06, ph) * (1 - smooth(0.94, 1, ph)) * resus + (1 - resus));
      } else s.scale.setScalar(1);
      tv.lerp(tw.set(bx + hx, floorY + bedY(bx + hx) + 0.18 + hy, bz), settle);
      s.position.copy(tv);
      s.rotation.x += u.spin.x * dt * (1 - settle * 0.8 + hy);
      s.rotation.y += u.spin.y * dt * (1 - settle * 0.8 + hy);
      s.rotation.z += u.spin.z * dt * (1 - settle * 0.8 + hy);
      s.material.emissiveIntensity = flashT * 0.9;
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
    const r = 0.93 + 0.19 * b;
    const g = Math.round(Math.min(100, Math.max(0, (r - 0.85) / 0.3 * 100)));
    if (g !== lastG && gaugeMark) { gaugeMark.style.left = g + '%'; lastG = g; }
    const w = broken ? 'w = 8' : 'w = 1';
    if (w !== lastW && weightVal) { weightVal.textContent = w; lastW = w; }
  }
  runWhenVisible(canvas, frame);
}

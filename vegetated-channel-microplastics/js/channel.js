// A laboratory flume with submerged rigid vegetation, drawn in 3D.
// mode 'hero': neutrally buoyant, lighter and denser microplastics travel, rise, settle and deposit.
// mode 'profile': streaks of neutrally buoyant microplastics, the velocity profile and labels.
// Illustrative motion only, not model output.
import * as THREE from 'three';
import { runWhenVisible, fitGL, isSmall, gauss, makeNoise, motion } from '../../js/3d/loop.js';
import { COL, makeRenderer, addLights, inkEdges, makeArrow, makePoints, makeLabels } from './common.js?v=20261106a';

export const H = 3, HV = 1.3;     // water depth and vegetation height
export const U = 3.4;                              // surface velocity (scene units per second)

export const uOf = y => {
  const s = 0.25 + 0.75 / (1 + Math.exp(-(y - HV - 0.12) / 0.22));
  return s * Math.min(1, Math.max(0, y) / 0.12) * (1 + 0.12 * Math.max(0, y - HV) / (H - HV));
};
export const dOf = y => 0.006 + 0.05 * Math.exp(-(((y - HV) / 0.32) ** 2)) + (y > HV ? 0.012 : 0);

// Builds the flume (bed, walls, stems, water) into a scene; shared by the hero, section V and the story.
export function makeFlume(scene, L, W, small, opts = {}) {
  const noise = makeNoise(11);

  // ---------- bed: a sand slab with a grained, slightly uneven surface ----------
  const bedG = new THREE.PlaneGeometry(L, W, small ? 96 : 160, small ? 20 : 34);
  bedG.rotateX(-Math.PI / 2);
  const bp = bedG.attributes.position, bc = new Float32Array(bp.count * 3);
  const sand = new THREE.Color(COL.sand), sandD = new THREE.Color(COL.sandDark), tc = new THREE.Color();
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), z = bp.getZ(i);
    const n = noise(x * 1.7, z * 1.7, 0.3) * 0.6 + noise(x * 6, z * 6, 2.1) * 0.4;
    bp.setY(i, 0.025 * n);
    tc.copy(sand).lerp(sandD, 0.25 + 0.35 * n + 0.25 * Math.random());
    bc[3 * i] = tc.r; bc[3 * i + 1] = tc.g; bc[3 * i + 2] = tc.b;
  }
  bedG.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  bedG.computeVertexNormals();
  scene.add(new THREE.Mesh(bedG, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 })));
  const slabG = new THREE.BoxGeometry(L, 0.45, W);
  const slab = new THREE.Mesh(slabG, new THREE.MeshStandardMaterial({ color: COL.sandDark, roughness: 1 }));
  slab.position.y = -0.235;
  slab.add(inkEdges(slabG));
  scene.add(slab);

  // ---------- flume walls: back wall, glass front, ink frame ----------
  const WH = H + 0.45;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(L, WH), new THREE.MeshStandardMaterial({ color: 0xe6e3dc, roughness: 1 }));
  back.position.set(0, WH / 2, -W / 2);
  scene.add(back);
  // light grid on the back wall, like the scale painted on a laboratory flume
  const gl = [];
  for (let x = -L / 2; x <= L / 2 + 1e-6; x += 1) gl.push(x, 0, -W / 2 + 0.01, x, WH, -W / 2 + 0.01);
  for (let y = 0.5; y < WH; y += 0.5) gl.push(-L / 2, y, -W / 2 + 0.01, L / 2, y, -W / 2 + 0.01);
  const gridG = new THREE.BufferGeometry();
  gridG.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
  scene.add(new THREE.LineSegments(gridG, new THREE.LineBasicMaterial({ color: COL.ink3, transparent: true, opacity: 0.22 })));
  const frameG = new THREE.BoxGeometry(L, WH, W);
  const box = inkEdges(frameG, 10, 0.75);
  box.position.y = WH / 2;
  scene.add(box);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(L, WH), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, depthWrite: false }));
  glass.position.set(0, WH / 2, W / 2);
  glass.renderOrder = 6;
  scene.add(glass);

  // ---------- vegetation: staggered rigid stems ----------
  const stems = [];
  const dx = small ? 0.62 : 0.5, dz = small ? 0.62 : 0.5;
  for (let i = 0, x = -L / 2 + 0.3; x < L / 2 - 0.2; x += dx, i++)
    for (let z = -W / 2 + 0.3 + (i % 2) * dz / 2; z < W / 2 - 0.2; z += dz) stems.push([x, z]);
  const stemG = new THREE.CylinderGeometry(0.045, 0.05, HV, 10);
  stemG.translate(0, HV / 2, 0);
  const stemM = new THREE.InstancedMesh(stemG, new THREE.MeshStandardMaterial({ color: COL.olive, roughness: 0.7 }), stems.length);
  const m4 = new THREE.Matrix4();
  stems.forEach((s, i) => { m4.makeTranslation(s[0], 0, s[1]); stemM.setMatrixAt(i, m4); });
  if (opts.stems !== false) scene.add(stemM);
  // dashed line at the top of the vegetation on the glass
  const topG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-L / 2, HV, W / 2), new THREE.Vector3(L / 2, HV, W / 2)]);
  const topLine = new THREE.Line(topG, new THREE.LineDashedMaterial({ color: COL.ink2, dashSize: 0.18, gapSize: 0.14, transparent: true, opacity: 0.8 }));
  topLine.computeLineDistances();
  scene.add(topLine);

  // ---------- water: faint volume tint and a moving free surface ----------
  const vol = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), new THREE.MeshBasicMaterial({ color: COL.water, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.BackSide }));
  vol.position.y = H / 2;
  scene.add(vol);
  const surfG = new THREE.PlaneGeometry(L, W, small ? 120 : 220, small ? 20 : 36);
  surfG.rotateX(-Math.PI / 2);
  const surfMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uU: { value: U * 1.05 } },
    vertexShader: `
      uniform float uTime, uU; varying vec3 vN; varying vec2 vXZ;
      float h(vec2 p){ float s = p.x - uU * uTime;
        return 0.035*sin(1.3*s + 0.6*p.y) + 0.022*sin(2.7*s - 1.7*p.y + 1.3) + 0.012*sin(5.1*s + 3.1*p.y); }
      void main(){ vec3 p = position; vec2 q = p.xz; p.y += h(q);
        float e = 0.05; vN = normalize(vec3(-(h(q+vec2(e,0.))-h(q-vec2(e,0.)))/(2.*e), 1.0, -(h(q+vec2(0.,e))-h(q-vec2(0.,e)))/(2.*e)));
        vXZ = q; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `
      varying vec3 vN; varying vec2 vXZ;
      void main(){ vec3 sun = normalize(vec3(-0.4, 1.0, 0.5));
        float d = clamp(dot(vN, sun), 0.0, 1.0);
        float glint = pow(d, 220.0);
        vec3 c = mix(vec3(0.72, 0.79, 0.93), vec3(0.97, 0.98, 1.0), glint);
        gl_FragColor = vec4(c, 0.30 + 0.45 * glint); }`
  });
  const surf = new THREE.Mesh(surfG, surfMat);
  surf.position.y = H;
  surf.renderOrder = 5;
  scene.add(surf);
  return { surfMat, stems, stemM, topLine };
}

export function initChannel(canvas, opts = {}) {
  const mode = opts.mode || 'hero';
  const L = mode === 'hero' ? 14 : 13, W = mode === 'hero' ? 4.6 : 4.2;   // flume length and width
  const small = isSmall();
  const renderer = makeRenderer(canvas, small);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(small && mode === 'hero' ? 46 : 32, 1, 0.1, 200);
  addLights(scene);
  const { surfMat } = makeFlume(scene, L, W, small);

  // ---------- microplastics ----------
  const N = mode === 'hero' ? (small ? 700 : 1500) : (small ? 450 : 800);
  const parts = [];
  const spawn = (p, anywhere) => {
    const r = Math.random();
    p.k = mode === 'hero' ? (r < 0.6 ? 0 : (r < 0.8 ? 1 : 2)) : 0;    // 0 neutral, 1 lighter, 2 denser
    p.x = anywhere ? -L / 2 + Math.random() * L : -L / 2 + Math.random() * 0.6;
    p.y = 0.06 + Math.random() * (H - 0.12);
    p.z = (Math.random() - 0.5) * (W - 0.2);
    p.s = 0; p.t = 0; p.vx = 0; p.vy = 0;
    p.r = 0.085 + Math.random() * 0.06;
    return p;
  };
  for (let i = 0; i < N; i++) parts.push(spawn({}, true));

  const pts = makePoints(N, scene);
  const cInk = new THREE.Color(COL.ink), cRed = new THREE.Color(COL.red), cBlue = new THREE.Color(COL.cobalt), cBed = new THREE.Color(0x8d7046);

  function step(dt) {
    for (const p of parts) {
      if (p.s === 1) { p.t += dt; if (p.t > 9) spawn(p, false); continue; }
      if (p.s === 2) { p.vx = uOf(H) * U; p.x += p.vx * dt; p.z += Math.sqrt(2 * 0.01 * dt) * gauss(); }
      else {
        const D = dOf(p.y), grad = (dOf(p.y + 0.01) - dOf(p.y - 0.01)) / 0.02;
        const inC = p.y < HV;
        p.vx = uOf(p.y) * U * (inC ? 1 + 0.25 * Math.sin(p.z * 12.6 + p.x * 3) : 1);
        let wy = grad + (p.k === 1 ? 0.28 : 0) - (p.k === 2 ? 0.32 : 0);
        const dy = wy * dt + Math.sqrt(2 * D * dt) * gauss();
        p.vy = dy / Math.max(dt, 1e-3);
        p.x += p.vx * dt;
        p.y += dy;
        p.z += Math.sqrt(2 * (inC ? 0.004 : 0.012) * dt) * gauss();
        if (p.y > H - 0.04) { if (p.k === 1) { p.y = H - 0.03; p.s = 2; } else p.y = 2 * (H - 0.04) - p.y; }
        if (p.y < p.r * 0.5) { if (p.k === 2) { p.y = p.r * 0.45; p.s = 1; p.t = 0; } else p.y = p.r - p.y; }
      }
      const zl = W / 2 - 0.08;
      if (p.z > zl) p.z = 2 * zl - p.z; else if (p.z < -zl) p.z = -2 * zl - p.z;
      if (p.x > L / 2) spawn(p, false);
    }
  }

  // streaks for the profile mode
  let streak = null;
  if (mode === 'profile') {
    const sp = new Float32Array(N * 6), sc = new Float32Array(N * 6);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3).setUsage(THREE.DynamicDrawUsage));
    const sl = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    sl.frustumCulled = false; sl.renderOrder = 3;
    scene.add(sl);
    streak = { sp, sc, sg };
  }

  const paper = new THREE.Color(COL.paper), tmp = new THREE.Color();
  function write() {
    const { P, C, S } = pts;
    parts.forEach((p, i) => {
      P[3 * i] = p.x; P[3 * i + 1] = p.y; P[3 * i + 2] = p.z;
      const c = p.s === 1 ? cBed : (p.k === 0 ? cInk : (p.k === 1 ? cBlue : cRed));
      C[3 * i] = c.r; C[3 * i + 1] = c.g; C[3 * i + 2] = c.b;
      S[i] = mode === 'profile' ? p.r * 0.75 : p.r;
      if (streak) {
        const k = 0.42, j = 6 * i;
        streak.sp[j] = p.x; streak.sp[j + 1] = p.y; streak.sp[j + 2] = p.z;
        streak.sp[j + 3] = Math.max(-L / 2, p.x - p.vx * k); streak.sp[j + 4] = p.y - p.vy * k * 0.15; streak.sp[j + 5] = p.z;
        const head = p.y > HV ? cRed : cInk;
        tmp.copy(head).lerp(paper, 0.85);
        streak.sc.set([head.r, head.g, head.b, tmp.r, tmp.g, tmp.b], j);
      }
    });
    pts.update();
    if (streak) { streak.sg.attributes.position.needsUpdate = true; streak.sg.attributes.color.needsUpdate = true; }
  }

  // ---------- velocity profile on the glass (profile mode) ----------
  let place = null;
  if (mode === 'profile') {
    const x0 = -L / 2 + 0.9, zf = W / 2 + 0.02, k = 3.0;
    const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, 0, zf), new THREE.Vector3(x0, H, zf)]), new THREE.LineBasicMaterial({ color: COL.ink }));
    scene.add(axis);
    for (let y = 0.25; y < H; y += 0.42) {
      const a = makeArrow(COL.cobalt, 0.03);
      a.userData.setLength(Math.max(0.2, uOf(y) * k));
      a.position.set(x0, y, zf);
      scene.add(a);
    }
    const cp = [];
    for (let y = 0; y <= H + 1e-6; y += 0.03) cp.push(new THREE.Vector3(x0 + uOf(y) * k, y, zf));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cp), new THREE.LineBasicMaterial({ color: COL.red })));
    place = makeLabels(canvas.parentElement, [
      { text: 'velocity profile', at: [x0, H + 0.35, zf], cls: 'lb-ink' },
      { text: 'faster overflow layer', at: [1.2, 2.5, zf], cls: 'lb-red' },
      { text: 'slow layer within the stems', at: [1.2, 0.5, zf], cls: 'lb-ink' },
      { text: 'shear layer at the top of the vegetation', at: [L / 2 - 0.4, HV + 0.28, zf], cls: 'lb-ink', align: 'right' }
    ]);
  }

  for (let k = 0; k < 500; k++) step(0.05);
  write();

  // ---------- camera ----------
  const target = new THREE.Vector3();
  const pointer = { x: 0, sx: 0 };
  canvas.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); pointer.x = (e.clientX - r.left) / r.width * 2 - 1; }, { passive: true });
  // framing: the flume fills a fraction of the canvas, centred at cxFrac of its width
  const view = mode === 'hero' ? { az: -0.62, el: 0.42, ty: 0.9 } : { az: -0.42, el: 0.2, ty: 1.35 };
  function aim(t) {
    const w = canvas.clientWidth, h = canvas.clientHeight, asp = w / Math.max(1, h);
    const wide = !small && mode === 'hero' && asp > 1.2;
    const ww = Math.min(w, 1200);              // the page content column (--wrap)
    const cxFrac = wide ? ((w - ww) / 2 + 0.765 * ww) / w : 0.5, frac = wide ? 0.43 * ww / w : 0.94;
    const Wv = w * 2 * cxFrac;                  // width of the virtual view centred on the flume
    camera.aspect = Wv / Math.max(1, h);
    camera.setViewOffset(Wv, h, 0, 0, w, h);
    const az = view.az + Math.sin(t * 0.07) * 0.05 + pointer.sx * 0.05;
    const half = (L / 2) * Math.cos(az) + (W / 2) * Math.abs(Math.sin(az));
    const tanH = Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
    const tanV = Math.tan(camera.fov * Math.PI / 360);
    const R = Math.max(half / (frac * w / Wv * tanH), (0.5 * (H + 0.5) + 0.5 * W * Math.sin(view.el)) / (0.86 * tanV)) + W / 2;
    target.set(0, view.ty, 0);
    camera.position.set(Math.sin(az) * R * Math.cos(view.el), view.ty + R * Math.sin(view.el), Math.cos(az) * R * Math.cos(view.el));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }

  let tt = 0;
  function frame(dt, t) {
    if (fitGL(renderer, camera, canvas)) pts.mat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
    if (dt > 0) { step(dt); write(); tt += dt; }
    surfMat.uniforms.uTime.value = tt;
    pointer.sx += (pointer.x - pointer.sx) * 0.05;
    aim(t);
    renderer.render(scene, camera);
    if (place) place(camera, canvas);
  }
  runWhenVisible(canvas, frame);
  // draw once even when paused or off screen, so a still picture is always there
  requestAnimationFrame(() => frame(0, 0));
  motion.listeners.push(() => requestAnimationFrame(() => frame(0, tt)));
}

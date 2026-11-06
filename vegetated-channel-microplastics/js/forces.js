// One microplastic in a sheared flow: the water streams around it, the forces act on it,
// and the unresolved turbulence moves it along a random path. Illustration, not model output.
import * as THREE from 'three';
import { runWhenVisible, fitGL, isSmall, motion } from '../../js/3d/loop.js';
import { COL, makeRenderer, addLights, inkEdges, makeArrow, makeLabels } from './common.js?v=20261106a';

const A = 1;                 // particle radius
const XB = 9, YB = -3.2, YT = 3.4, ZB = 2.6;

// potential flow past a sphere, scaled by a shear that grows away from the bed
function vel(x, y, z, cx, cy, out) {
  const rx = x - cx, ry = y - cy, rz = z, r2 = rx * rx + ry * ry + rz * rz, r = Math.sqrt(r2);
  const shear = 0.45 + 0.55 * (y - YB) / (YT - YB);
  if (r < A) { out.set(0, 0, 0); return out; }
  const k = A * A * A / (2 * r2 * r), q = 3 * rx / r2;
  out.set(1 + k * (1 - q * rx), k * (-q * ry), k * (-q * rz)).multiplyScalar(shear);
  return out;
}

export function initForces(canvas) {
  const small = isSmall();
  const renderer = makeRenderer(canvas, small);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  addLights(scene);

  // bed strip
  const bedG = new THREE.BoxGeometry(2 * XB, 0.3, 2 * ZB);
  const bed = new THREE.Mesh(bedG, new THREE.MeshStandardMaterial({ color: COL.sand, roughness: 1 }));
  bed.position.y = YB - 0.15;
  bed.add(inkEdges(bedG));
  scene.add(bed);

  // the microplastic, outlined in ink
  const ball = new THREE.Group();
  const sg = new THREE.SphereGeometry(A, 48, 32);
  ball.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: COL.paper3, roughness: 0.45 })));
  const hull = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: COL.ink, side: THREE.BackSide }));
  hull.scale.setScalar(1.035);
  ball.add(hull);
  // added mass: a shell of surrounding water that moves with the particle
  const shellG = new THREE.SphereGeometry(A * 1.42, 22, 14);
  const shell = new THREE.LineSegments(new THREE.WireframeGeometry(shellG), new THREE.LineBasicMaterial({ color: COL.cobalt, transparent: true, opacity: 0.22 }));
  ball.add(shell);
  scene.add(ball);

  // forces
  const drag = makeArrow(COL.red, 0.075), lift = makeArrow(COL.red, 0.075), grav = makeArrow(COL.red, 0.075);
  lift.rotation.z = Math.PI / 2 + 0.38;
  grav.rotation.z = -Math.PI / 2;
  // the drag acts along the slip velocity u - v: downstream, because the particle lags the flow,
  // and upward, because the settling particle moves down through the water
  const DRAG_ANG = 0.42;
  drag.rotation.z = DRAG_ANG;
  ball.add(drag, lift, grav);

  // shear profile on the left
  const xp = -XB + 2.3;
  for (let y = YB + 0.55; y < YT - 0.5; y += 0.9) {
    const a = makeArrow(COL.cobalt, 0.035);
    a.userData.setLength(0.4 + 1.6 * (0.45 + 0.55 * (y - YB) / (YT - YB)));
    a.position.set(xp, y, ZB);
    scene.add(a);
  }

  // tracers of the water, drawn as streaks
  const N = small ? 320 : 640;
  const tr = [];
  const seed = t => { t.x = -XB + Math.random() * 2 * XB; t.y = YB + 0.15 + Math.random() * (YT - YB - 0.3); t.z = (Math.random() - 0.5) * 2 * ZB; return t; };
  for (let i = 0; i < N; i++) tr.push(seed({}));
  const sp = new Float32Array(N * 6), sc = new Float32Array(N * 6);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage));
  lg.setAttribute('color', new THREE.BufferAttribute(sc, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
  lines.frustumCulled = false;
  scene.add(lines);

  // random path of the particle
  const TRAIL = 220, trail = [];
  const tg = new THREE.BufferGeometry();
  const tp = new Float32Array(TRAIL * 3);
  tg.setAttribute('position', new THREE.BufferAttribute(tp, 3).setUsage(THREE.DynamicDrawUsage));
  const tline = new THREE.Points(tg, new THREE.PointsMaterial({ color: COL.ink2, size: 0.07, sizeAttenuation: true }));
  tline.frustumCulled = false;
  scene.add(tline);

  const v = new THREE.Vector3(), blue = new THREE.Color(COL.cobalt), pale = new THREE.Color(COL.paper);
  const c0 = new THREE.Color().copy(blue).lerp(pale, 0.15), c1 = new THREE.Color().copy(blue).lerp(pale, 0.9);
  let bx = 0.6, by = 0.2, tt = 0, sampleT = 0;

  function step(dt, t) {
    // the particle wanders: a slow random walk held near the centre of the view
    bx += (-0.2 * (bx - 0.8) + 1.0 * (Math.sin(t * 0.43) * 0.6 + Math.sin(t * 1.7 + 1) * 0.4)) * dt;
    by += (-0.3 * (by - 0.1) + 0.6 * (Math.sin(t * 0.61 + 2) * 0.6 + Math.sin(t * 2.3) * 0.4)) * dt;
    for (const p of tr) {
      vel(p.x, p.y, p.z, bx, by, v);
      p.vx = v.x; p.vy = v.y; p.vz = v.z;
      p.x += v.x * 2.4 * dt; p.y += v.y * 2.4 * dt; p.z += v.z * 2.4 * dt;
      if (p.x > XB || p.y < YB + 0.05 || p.y > YT || Math.abs(p.z) > ZB) { seed(p); p.x = -XB; }
    }
    sampleT += dt;
    if (sampleT > 0.06) { sampleT = 0; trail.push(bx, by, 0.3); if (trail.length > TRAIL * 3) trail.splice(0, 3); }
  }
  function write() {
    tr.forEach((p, i) => {
      const j = 6 * i, k = 0.34;
      sp[j] = p.x; sp[j + 1] = p.y; sp[j + 2] = p.z;
      sp[j + 3] = p.x - (p.vx || 1) * k; sp[j + 4] = p.y - (p.vy || 0) * k; sp[j + 5] = p.z - (p.vz || 0) * k;
      sc.set([c0.r, c0.g, c0.b, c1.r, c1.g, c1.b], j);
    });
    lg.attributes.position.needsUpdate = true; lg.attributes.color.needsUpdate = true;
    tp.fill(0); tp.set(trail.slice(-TRAIL * 3));
    const n = Math.min(TRAIL, trail.length / 3);
    for (let i = n; i < TRAIL; i++) { tp[3 * i] = bx; tp[3 * i + 1] = by; }
    tg.attributes.position.needsUpdate = true;
    tg.setDrawRange(0, n);
    ball.position.set(bx, by, 0);
  }
  for (let k = 0; k < 400; k++) { tt += 0.03; step(0.03, tt); }
  write();

  const tip = (arrow, len, extra) => () => {
    const d = new THREE.Vector3(1, 0, 0).applyEuler(arrow.rotation);
    return ball.position.clone().add(d.multiplyScalar(len + extra));
  };
  const place = makeLabels(canvas.parentElement, [
    { text: 'drag, along u − v', at: tip(drag, 3.2, 0.2), cls: 'lb-red' },
    { text: 'shear induced lift', at: tip(lift, 2.65, 0.35), cls: 'lb-red', align: 'center' },
    { text: 'gravity minus buoyancy', at: () => ball.position.clone().add(new THREE.Vector3(0.3, -2.25, 0)), cls: 'lb-red' },
    { text: 'added mass of the surrounding water', at: () => ball.position.clone().add(new THREE.Vector3(-1.45, 1.15, 0)), cls: 'lb-blue', align: 'right' },
    { text: 'random path with drift correction', at: () => ball.position.clone().add(new THREE.Vector3(-1.5, -1.15, 0)), cls: 'lb-ink', align: 'right' },
    { text: 'fluid velocity increases away from the bed', at: [xp, YT - 0.05, ZB], cls: 'lb-blue' }
  ]);

  function frame(dt, t) {
    fitGL(renderer, camera, canvas);
    if (dt > 0) { tt += dt; step(dt, tt); write(); }
    const pulse = 0.08 * Math.sin(tt * 2.1);
    drag.userData.setLength(2.0 + pulse + 0.2 * Math.sin(tt * 0.9));
    lift.userData.setLength(1.45 + pulse);
    grav.userData.setLength(1.35);
    drag.position.set(Math.cos(DRAG_ANG) * A * 1.05, Math.sin(DRAG_ANG) * A * 1.05, 0);
    lift.position.set(Math.cos(Math.PI / 2 + 0.38) * A * 1.05, Math.sin(Math.PI / 2 + 0.38) * A * 1.05, 0);
    grav.position.set(0, -A * 1.05, 0);
    shell.rotation.y = tt * 0.25;
    const asp = canvas.clientWidth / Math.max(1, canvas.clientHeight), tv = Math.tan(camera.fov * Math.PI / 360);
    const R = Math.max(4.0 / tv, (XB - 1.2) / (tv * asp)) + ZB * 0.5;
    const az = -0.1 + Math.sin(t * 0.08) * 0.04, el = 0.07;
    camera.position.set(Math.sin(az) * R * Math.cos(el), 0.1 + R * Math.sin(el), Math.cos(az) * R * Math.cos(el));
    camera.lookAt(0, 0.1, 0);
    renderer.render(scene, camera);
    place(camera, canvas);
  }
  runWhenVisible(canvas, frame);
  requestAnimationFrame(() => frame(0, 0));
  motion.listeners.push(() => requestAnimationFrame(() => frame(0, tt)));
}

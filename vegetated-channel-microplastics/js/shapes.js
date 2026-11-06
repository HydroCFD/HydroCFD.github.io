// Nine particle shapes settling through still water, each with its broadest face
// normal to the direction of motion. The speeds are illustrative, not model output.
import * as THREE from 'three';
import { runWhenVisible, fitGL, isSmall, makeNoise, motion } from '../../js/3d/loop.js';
import { COL, makeRenderer, addLights, inkEdges, makeLabels } from './common.js?v=20261106a';

function irregular() {
  const g = new THREE.IcosahedronGeometry(0.55, 1);
  const n = makeNoise(5), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const s = 1 + 0.32 * n(v.x * 2.2 + 3, v.y * 2.2, v.z * 2.2);
    p.setXYZ(i, v.x * s * 1.15, v.y * s * 0.7, v.z * s);
  }
  g.computeVertexNormals();
  return g;
}
function fibre() {
  const pts = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push(new THREE.Vector3((t - 0.5) * 1.35, 0.08 * Math.sin(t * 9), 0.18 * Math.sin(t * 5 + 1))); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 80, 0.065, 10, false);
}
function prism() {
  const s = new THREE.Shape([new THREE.Vector2(-0.55, -0.32), new THREE.Vector2(0.55, -0.32), new THREE.Vector2(0, 0.42)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.0, bevelEnabled: false });
  g.translate(0, 0, -0.5); g.rotateX(Math.PI / 2);   // triangular faces up and down, broad face normal to settling
  return g;
}

const SHAPES = [
  { name: 'sphere', g: () => new THREE.SphereGeometry(0.5, 40, 26), w: 1.0 },
  { name: 'cylinder', g: () => new THREE.CylinderGeometry(0.28, 0.28, 1.25, 32).rotateZ(Math.PI / 2), w: 0.85 },
  { name: 'fibre', g: fibre, w: 0.45 },
  { name: 'disk', g: () => new THREE.CylinderGeometry(0.6, 0.6, 0.12, 40), w: 0.55 },
  { name: 'square plate', g: () => new THREE.BoxGeometry(1.05, 0.1, 1.05), w: 0.5 },
  { name: 'cube', g: () => new THREE.BoxGeometry(0.8, 0.8, 0.8), w: 0.9 },
  { name: 'prism', g: prism, w: 0.75 },
  { name: 'tetrahedron', g: () => new THREE.TetrahedronGeometry(0.66).rotateX(-Math.atan(Math.SQRT1_2)).rotateY(Math.PI / 4), w: 0.7 },
  { name: 'irregular', g: irregular, w: 0.65 }
];

export function initShapes(canvas) {
  const small = isSmall();
  const renderer = makeRenderer(canvas, small);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  addLights(scene);

  const cols = small ? 3 : 9, rows = small ? 3 : 1;
  const GAP = 2.55, TOP = small ? 2.4 : 2.7, BOT = small ? -2.4 : -2.7, S = 1.2, RT = 1.12;
  const span = (cols - 1) * GAP;
  const RH = (TOP - BOT);            // height of one column
  // glass with darker edges where the view grazes the tube wall
  const glass = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        vec3 c = mix(vec3(0.80, 0.85, 0.94), vec3(0.30, 0.36, 0.52), pow(f, 6.0));
        gl_FragColor = vec4(c, 0.20 + 0.75 * pow(f, 5.0)); }`
  });
  const items = SHAPES.map((s, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const geo = s.g();
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COL.paper3, roughness: 0.5, flatShading: s.name === 'irregular' })));
    grp.add(inkEdges(geo, s.name === 'sphere' || s.name === 'fibre' ? 89 : 25, 0.9));
    if (s.name === 'sphere') { const h = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COL.ink, side: THREE.BackSide })); h.scale.setScalar(1.04); grp.add(h); }
    if (s.name === 'fibre') { const h = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COL.ink, side: THREE.BackSide })); grp.add(h); grp.children[0].scale.setScalar(0.94); }
    const x = -span / 2 + c * GAP;
    const y0 = (rows - 1) * (RH + 1.6) / 2 - r * (RH + 1.6);
    scene.add(grp);
    // glass tube of water around each shape, centred on its path
    const tubeH = RH + 0.6, yc = y0 + (TOP + BOT) / 2;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(RT, RT, tubeH, 64, 1, true),
      glass);
    tube.position.set(x, yc, 0);
    tube.renderOrder = -1;
    scene.add(tube);
    const ring = (yy, op) => {
      const pts = [];
      for (let k = 0; k <= 64; k++) { const a = k / 64 * Math.PI * 2; pts.push(new THREE.Vector3(x + RT * Math.cos(a), yy, RT * Math.sin(a))); }
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COL.ink, transparent: true, opacity: op }));
      scene.add(l);
    };
    ring(yc + tubeH / 2, 0.45); ring(yc - tubeH / 2, 0.7);
    // free surface inside the tube
    const surf = new THREE.Mesh(new THREE.CircleGeometry(RT, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xb9c6e6, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
    surf.position.set(x, yc + tubeH / 2 - 0.15, 0);
    scene.add(surf);
    // settling direction
    const ar = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(x + 0.8, y0 + TOP - 0.1, 0), 0.75, COL.red, 0.2, 0.12);
    scene.add(ar);
    // trail
    const tg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const trail = new THREE.Line(tg, new THREE.LineDashedMaterial({ color: COL.red, dashSize: 0.1, gapSize: 0.08, transparent: true, opacity: 0.8 }));
    trail.frustumCulled = false;
    scene.add(trail);
    return { s, grp, x, y0, ph: Math.random(), trail, tg, spin: (Math.random() < 0.5 ? -1 : 1) * (0.25 + 0.3 * Math.random()) };
  });

  const labels = makeLabels(canvas.parentElement, items.map(it => ({ text: it.s.name, at: [it.x, it.y0 + BOT - 0.75, RT], cls: 'lb-ink', align: 'center' })));

  let tt = 0;
  function pose() {
    items.forEach(it => {
      const f = ((tt * 0.11 * it.s.w + it.ph) % 1);
      const y = it.y0 + TOP - 0.45 - f * (RH - 0.9);
      const wob = Math.sin(tt * 2.2 + it.ph * 9);
      it.grp.position.set(it.x + 0.06 * wob, y, 0);
      it.grp.rotation.set(0.12 * Math.sin(tt * 1.7 + it.ph * 5), tt * it.spin, 0.08 * wob);
      const p = it.tg.attributes.position;
      p.setXYZ(0, it.x, it.y0 + TOP - 0.05, -0.1); p.setXYZ(1, it.grp.position.x, y + 0.6, -0.1);
      p.needsUpdate = true; it.trail.computeLineDistances();
      // fade in at the top and out at the bottom
      const a = Math.min(1, f / 0.06, (1 - f) / 0.06);
      it.grp.scale.setScalar(S * (0.75 + 0.25 * a));
    });
  }
  pose();

  function frame(dt, t) {
    fitGL(renderer, camera, canvas);
    tt += dt;
    pose();
    const w = small ? 3 * GAP + 0.6 : span + 2.6, h = small ? 3 * (RH + 1.6) + 0.6 : RH + 3.3;
    const asp = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const need = Math.max(h, w / asp);
    const R = need / 2 / Math.tan(camera.fov * Math.PI / 360) + 2;
    const az = Math.sin(t * 0.07) * 0.05;
    camera.position.set(Math.sin(az) * R, 0.6, Math.cos(az) * R);
    camera.lookAt(0, -0.3, 0);
    renderer.render(scene, camera);
    labels(camera, canvas);
  }
  runWhenVisible(canvas, frame);
  requestAnimationFrame(() => frame(0, 0));
  motion.listeners.push(() => requestAnimationFrame(() => frame(0, tt)));
}

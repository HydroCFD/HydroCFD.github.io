// Helpers shared by the 3D figures of this page.
import * as THREE from 'three';

export const COL = {
  paper: 0xf2ede3, paper2: 0xe9e2d4, paper3: 0xf7f3eb, ink: 0x141414, ink2: 0x45413b, ink3: 0x7a746a,
  rule: 0xcbc2b2, red: 0xe4572e, cobalt: 0x2643b8, olive: 0x66772a, ochre: 0xb07d2b,
  water: 0xc9d4ee, sand: 0xcdb68f, sandDark: 0xa88b5a
};

// Renderer with the page background, soft print-like lighting.
export function makeRenderer(canvas, small) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  return renderer;
}
export function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcabf9f, 1.75));
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(-6, 12, 8);
  scene.add(sun);
  return sun;
}

// Thin ink outline around a mesh, the way an engraving draws an object.
export function inkEdges(geometry, angle = 25, opacity = 0.85) {
  return new THREE.LineSegments(new THREE.EdgesGeometry(geometry, angle),
    new THREE.LineBasicMaterial({ color: COL.ink, transparent: opacity < 1, opacity }));
}

// A solid arrow (shaft and head) along +x, scaled with setLength.
export function makeArrow(color, radius = 0.06) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 18), mat);
  shaft.rotation.z = -Math.PI / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.6, radius * 7, 22), mat);
  head.rotation.z = -Math.PI / 2;
  g.add(shaft, head);
  g.userData.setLength = L => {
    const hl = radius * 7, sl = Math.max(0.001, L - hl);
    shaft.scale.y = sl; shaft.position.x = sl / 2;
    head.position.x = sl + hl / 2;
  };
  g.userData.setLength(1);
  return g;
}

// Round points rendered with a soft edge, sized in world units.
export function makePoints(n, scene) {
  const P = new Float32Array(n * 3), C = new Float32Array(n * 3), S = new Float32Array(n);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(C, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(S, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uScale: { value: 300 } },
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; varying vec3 vColor; uniform float uScale;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / -mv.z; vColor = aColor; }`,
    fragmentShader: `
      varying vec3 vColor;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
        float shade = 0.82 + 0.18 * clamp(-d.x - d.y + 0.3, 0.0, 1.0);
        float a = 1.0 - smoothstep(0.38, 0.5, r);
        gl_FragColor = vec4(vColor * shade, a); }`
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  scene.add(pts);
  return { pts, geo, mat, P, C, S, update() { geo.attributes.position.needsUpdate = true; geo.attributes.aColor.needsUpdate = true; geo.attributes.aSize.needsUpdate = true; } };
}

// HTML labels pinned to 3D points; the figure element must be position: relative.
export function makeLabels(host, items) {
  const layer = document.createElement('div');
  layer.className = 'scene-labels';
  host.appendChild(layer);
  const list = items.map(it => {
    const el = document.createElement('span');
    el.className = 'scene-label' + (it.cls ? ' ' + it.cls : '');
    el.textContent = it.text;
    layer.appendChild(el);
    const p = typeof it.at === 'function' ? it.at : (it.at.clone ? it.at.clone() : new THREE.Vector3(...it.at));
    return { el, p, align: it.align || 'left' };
  });
  const v = new THREE.Vector3();
  return function place(camera, canvas) {
    const w = canvas.clientWidth, h = canvas.clientHeight, ox = canvas.offsetLeft, oy = canvas.offsetTop;
    list.forEach(L => {
      v.copy(typeof L.p === 'function' ? L.p() : L.p).project(camera);
      const x = ox + (v.x * 0.5 + 0.5) * w, y = oy + (-v.y * 0.5 + 0.5) * h;
      const tx = L.align === 'center' ? '-50%' : (L.align === 'right' ? '-100%' : '0');
      L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(${tx}, -50%)`;
    });
  };
}

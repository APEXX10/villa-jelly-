import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------
// Constants & shared state
// ---------------------------------------------------------------------------
const HALF = 5;            // block spans -5..5 on x/z
const SEABED = -0.6;       // top of the soil layers
const LEVEL = 0.55;        // resting water level
const G = 9.8;
const ISLAND = new THREE.Vector2(-1.6, -1.6);
const WC = new THREE.Vector2(2.5, 2.5); // centre of open water (boat loop, stir vortex)

const FLAVORS = [
  { name: 'Lagoon', color: '#00d9c8', accent: '#5dffd6' },
  { name: 'Cerulean', color: '#2f7bff', accent: '#6fd6ff' },
  { name: 'Raspberry', color: '#ff2d6f', accent: '#ff9ad0' },
  { name: 'Grape', color: '#9b3dff', accent: '#ff7af5' },
  { name: 'Lime', color: '#7dff3a', accent: '#e9ff5c' },
  { name: 'Mango', color: '#ffae1a', accent: '#ff5f7a' },
  { name: 'Bubblegum', color: '#ff7ad9', accent: '#8af0ff' },
  { name: 'Rainbow', color: '#ff4fd8', accent: '#19e3d2', rainbow: true },
];

const SKIES = {
  day:    { top: '#1c8dff', mid: '#9a6bff', bot: '#ff7cc8', sun: '#fff1dc', sunI: 2.8, sunPos: [7, 12, 5], hemiI: 1.15, night: 0, rainbow: 0.55 },
  sunset: { top: '#3b1d8f', mid: '#ff6f91', bot: '#ffc36b', sun: '#ff9a5a', sunI: 2.4, sunPos: [-9, 5, 7], hemiI: 0.9, night: 0.25, rainbow: 0.35 },
  night:  { top: '#05031c', mid: '#251060', bot: '#5d1c8f', sun: '#8fa6ff', sunI: 0.7, sunPos: [-5, 10, -6], hemiI: 0.45, night: 1, rainbow: 0.08 },
};
const WEATHER = {
  clear: { rain: 0, gloom: 0, wind: 0, waves: 0 },
  rain:  { rain: 0.5, gloom: 0.35, wind: 0.25, waves: 0.15 },
  storm: { rain: 1, gloom: 0.75, wind: 0.8, waves: 0.55 },
};

const params = { wobble: 0.6, waves: 0.45, wind: 0.4, sparkle: 0.6, spin: true, boat: true, fish: true, sound: false };
let flavorIndex = 0;
let skyKey = 'day';
let weatherKey = 'clear';
let tool = 'rotate';

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 400);
const CAM_DIR = new THREE.Vector3(1, 0.78, 1).normalize();

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 8;
controls.maxDistance = 70;
controls.maxPolarAngle = Math.PI * 0.62;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.55;
controls.target.set(0, 0.2, 0);

const camDist = () => Math.max(23 / camera.aspect, 19);
camera.position.copy(CAM_DIR).multiplyScalar(camDist()).add(controls.target);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.5, 1.02);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
function smooth(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }
function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
const UP = new THREE.Vector3(0, 1, 0);

function islandShape(x, z) {
  const dx = x - ISLAND.x, dz = z - ISLAND.y;
  const d = Math.hypot(dx, dz);
  const a = Math.atan2(dz, dx);
  const R = 4.1 + 0.35 * Math.sin(a * 3 + 0.5) + 0.2 * Math.sin(a * 5 + 1.3);
  return { d, R, t: smooth(R + 0.8, R - 0.8, d), p: smooth(R - 0.9, R - 2.2, d) };
}

function terrainH(x, z) {
  const { t, p } = islandShape(x, z);
  let h = -0.45 + t * 1.12 + p * 0.78;
  h += 0.05 * Math.sin(x * 3.1) * Math.sin(z * 2.7) * (1 - t);
  h += 0.08 * Math.sin(x * 1.7 + z * 2.3) * p;
  h += 0.04 * Math.sin(x * 4.3 - z * 3.1) * t * (1 - p);
  return h;
}
function terrainNormal(x, z, out) {
  const e = 0.05;
  return out.set(-(terrainH(x + e, z) - terrainH(x - e, z)) / (2 * e), 1, -(terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e)).normalize();
}

function stripeTexture(colors, w = 256, h = 64) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const sw = w / colors.length;
  colors.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * sw, 0, sw + 1, h); });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW = glowTexture();

function shade(mesh, cast = true, receive = true) {
  mesh.traverse(o => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return mesh;
}

// ---------------------------------------------------------------------------
// Sky dome, stars, lights
// ---------------------------------------------------------------------------
const skyUniforms = {
  top: { value: new THREE.Color(SKIES.day.top) },
  mid: { value: new THREE.Color(SKIES.day.mid) },
  bot: { value: new THREE.Color(SKIES.day.bot) },
  time: { value: 0 },
  flash: { value: 0 },
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(180, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyUniforms,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 bot; uniform float time; uniform float flash; varying vec3 vP;
      void main(){
        vec3 d = normalize(vP);
        float swirl = 0.07*sin(d.x*5.0 + time*0.25)*sin(d.z*4.0 - time*0.18) + 0.04*sin(atan(d.z,d.x)*6.0 + time*0.1);
        float k = d.y + swirl;
        vec3 c = k > 0.0 ? mix(mid, top, smoothstep(0.0, 0.65, k)) : mix(mid, bot, smoothstep(0.0, -0.55, k));
        c += vec3(0.75, 0.8, 1.0) * flash;
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
);
scene.add(sky);

const starGeo = new THREE.BufferGeometry();
{
  const n = 1600, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(150);
    v.y = Math.abs(v.y) * 0.9 + 4;
    pos.set([v.x, v.y, v.z], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const starMat = new THREE.PointsMaterial({ size: 1.3, map: GLOW, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: '#fff6d8' });
scene.add(new THREE.Points(starGeo, starMat));

const hemi = new THREE.HemisphereLight('#bfe6ff', '#ffb3de', 1.15);
scene.add(hemi);

const sun = new THREE.DirectionalLight('#fff1dc', 2.8);
sun.position.set(7, 12, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 40;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const rimA = new THREE.DirectionalLight('#ff4fd8', 0.9); rimA.position.set(-10, 3, -6); scene.add(rimA);
const rimB = new THREE.DirectionalLight('#3fe8ff', 0.7); rimB.position.set(9, 2, -10); scene.add(rimB);
const underGlow = new THREE.PointLight('#b05cff', 30, 14, 1.6); underGlow.position.set(0, -5, 0); scene.add(underGlow);

// ---------------------------------------------------------------------------
// Floating block
// ---------------------------------------------------------------------------
const world = new THREE.Group();   // bobbing + tipping
const block = new THREE.Group();   // squash & stretch
world.add(block);
scene.add(world);

const LAYERS = [
  { h: 0.55, c: '#f6e2b0' },
  { h: 0.28, c: '#fff6e8' },
  { h: 0.36, c: '#ff8fbf' },
  { h: 0.26, c: '#b79cff' },
  { h: 0.62, c: '#8a5232' },
  { h: 0.48, c: '#5a321f' },
];
let layerTop = SEABED;
const layerBottoms = [];
LAYERS.forEach((L, i) => {
  const inset = i * 0.02;
  const m = new THREE.Mesh(
    new RoundedBoxGeometry(10 - inset, L.h, 10 - inset, 2, 0.04),
    new THREE.MeshStandardMaterial({ color: L.c, roughness: 0.85 })
  );
  m.position.y = layerTop - L.h / 2;
  shade(m, false, true);
  block.add(m);
  layerBottoms.push([layerTop - L.h, layerTop]);
  layerTop -= L.h;
});
const BLOCK_BOTTOM = layerTop;

{
  const geo = new THREE.IcosahedronGeometry(0.09, 1);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  const n = 340;
  const inst = new THREE.InstancedMesh(geo, mat, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const palette = ['#c58b5c', '#e3b189', '#9d6b4a', '#ffd0e5', '#d9c6ff', '#f2e6d0'];
  for (let i = 0; i < n; i++) {
    const [y0, y1] = layerBottoms[3 + (i % 3)];
    const face = i % 4, u = rand(-4.85, 4.85), y = rand(y0 + 0.08, y1 - 0.06);
    const e = HALF - 0.04;
    if (face === 0) p.set(u, y, e); else if (face === 1) p.set(e, y, u); else if (face === 2) p.set(u, y, -e); else p.set(-e, y, u);
    const sc = rand(0.5, 1.4);
    s.set(sc, sc * rand(0.6, 1), sc);
    q.setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)));
    inst.setMatrixAt(i, m4.compose(p, q, s));
    inst.setColorAt(i, new THREE.Color(palette[i % palette.length]));
  }
  block.add(inst);
}

{
  const colors = ['#ff4fd8', '#7a5cff', '#3fe8ff', '#ffd34f', '#ff7a9c'];
  for (let i = 0; i < 9; i++) {
    const h = rand(1.4, 3.2);
    const g = new THREE.ConeGeometry(rand(0.35, 0.7), h, 6);
    g.rotateX(Math.PI);
    const col = colors[i % colors.length];
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92,
    }));
    const a = rand(0, Math.PI * 2), r = rand(0.5, 3.6);
    m.position.set(Math.cos(a) * r, BLOCK_BOTTOM - h / 2 + 0.2, Math.sin(a) * r);
    m.rotation.set(rand(-0.25, 0.25), rand(0, 3), rand(-0.25, 0.25));
    block.add(m);
  }
}

const crystals = [];
{
  const colors = ['#ff4fd8', '#3fe8ff', '#ffd34f', '#9b7bff', '#7dff9a', '#ff8a5c'];
  for (let i = 0; i < 8; i++) {
    const col = colors[i % colors.length];
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(rand(0.35, 0.6), 0),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.2, roughness: 0.15, flatShading: true })
    );
    m.scale.y = 1.8;
    crystals.push({ m, a: (i / 8) * Math.PI * 2, r: rand(8.5, 11), y: rand(-1.5, 4.5), sp: rand(0.08, 0.16), ph: rand(0, 6) });
    scene.add(m);
  }
}

// ---------------------------------------------------------------------------
// Terrain (sand island + seabed) with animated underwater caustics
// ---------------------------------------------------------------------------
const TN = 120;
const terrainGeo = new THREE.PlaneGeometry(10, 10, TN, TN);
terrainGeo.rotateX(-Math.PI / 2);
{
  const pos = terrainGeo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const sand = new THREE.Color('#f7dfa9'), wet = new THREE.Color('#e2bf86'), deep = new THREE.Color('#f0d6a6');
  const grass = new THREE.Color('#42e06a'), grass2 = new THREE.Color('#1fbf78'), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainH(x, z);
    pos.setY(i, h);
    const { p } = islandShape(x, z);
    if (h < LEVEL - 0.12) tmp.copy(deep).lerp(wet, 0.25);
    else if (h < LEVEL + 0.12) tmp.copy(wet);
    else tmp.copy(sand);
    const g = smooth(0.45, 0.8, p + 0.12 * Math.sin(x * 2.3) * Math.cos(z * 1.9));
    if (g > 0) tmp.lerp(grass.clone().lerp(grass2, 0.5 + 0.5 * Math.sin(x * 3 + z * 2)), g);
    tmp.offsetHSL(0, 0, (Math.random() - 0.5) * 0.03);
    cols.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  terrainGeo.computeVertexNormals();
}
const causticUniforms = { uTime: { value: 0 }, uLevel: { value: LEVEL }, uCaustic: { value: new THREE.Color('#5dffd6') } };
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
terrainMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, causticUniforms);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vLocal; uniform float uTime; uniform float uLevel; uniform vec3 uCaustic;
      float caustic(vec2 uv, float t){
        vec2 p = uv * 6.2831 - 250.0; vec2 i = p; float c = 1.0; float inten = 0.005;
        for (int n = 0; n < 4; n++) {
          float tt = t * (1.0 - (3.5 / float(n + 1)));
          i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
          c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
        }
        c /= 4.0; c = 1.17 - pow(c, 1.4);
        return pow(abs(c), 8.0);
      }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float uw = smoothstep(uLevel + 0.02, uLevel - 0.3, vLocal.y);
      if (uw > 0.0) totalEmissiveRadiance += uCaustic * clamp(caustic(vLocal.xz * 0.22, uTime * 0.6), 0.0, 1.2) * uw * 0.55;`);
};
const terrain = shade(new THREE.Mesh(terrainGeo, terrainMat), true, true);
block.add(terrain);

function edgeStrip(heightAt, bottom, inset, colorTop, colorBot, n = 120) {
  const verts = [], cols = [], norms = [], idx = [];
  const ct = new THREE.Color(colorTop), cb = new THREE.Color(colorBot);
  const e = HALF - inset;
  const sides = [
    (u) => [-HALF + 10 * u, e, [0, 0, 1]],
    (u) => [e, HALF - 10 * u, [1, 0, 0]],
    (u) => [HALF - 10 * u, -e, [0, 0, -1]],
    (u) => [-e, -HALF + 10 * u, [-1, 0, 0]],
  ];
  sides.forEach((fn, s) => {
    for (let i = 0; i <= n; i++) {
      const [x, z, nr] = fn(i / n);
      verts.push(x, heightAt(x, z), z, x, bottom, z);
      cols.push(ct.r, ct.g, ct.b, cb.r, cb.g, cb.b);
      norms.push(...nr, ...nr);
    }
    const base = s * (n + 1) * 2;
    for (let i = 0; i < n; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  g.setIndex(idx);
  return g;
}
block.add(shade(new THREE.Mesh(
  edgeStrip(terrainH, SEABED - 0.02, 0, '#f3d6a0', '#e8c890'),
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide })
), false, true));

// ---------------------------------------------------------------------------
// Jelly sea: a 2D wave-equation heightfield (ripples travel, reflect off the
// shore and the jelly walls, and interfere) plus gentle analytic swell.
// ---------------------------------------------------------------------------
const WN = 110;                 // segments per side
const SN = WN + 1;              // nodes per side
const WE = HALF - 0.006;
const DX = (WE * 2) / WN;
const waterGeo = new THREE.PlaneGeometry(WE * 2, WE * 2, WN, WN);
waterGeo.rotateX(-Math.PI / 2);
const wPos = waterGeo.attributes.position;
const wCount = wPos.count;
const wX = new Float32Array(wCount), wZ = new Float32Array(wCount), wT = new Float32Array(wCount);
const simH = new Float32Array(wCount), simV = new Float32Array(wCount), wetMask = new Uint8Array(wCount);
let wetCells = 0;
for (let i = 0; i < wCount; i++) {
  wX[i] = wPos.getX(i); wZ[i] = wPos.getZ(i); wT[i] = terrainH(wX[i], wZ[i]);
  wetMask[i] = wT[i] < LEVEL - 0.03 ? 1 : 0;
  wetCells += wetMask[i];
}
waterGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(wCount * 3), 3));

function simStep(dt) {
  const c2 = 2.3 * 2.3, inv = 1 / (DX * DX);
  const damp = lerp(1.8, 0.4, params.wobble);
  for (let j = 0; j < SN; j++) {
    for (let i = 0; i < SN; i++) {
      const k = j * SN + i;
      if (!wetMask[k]) continue;
      const h = simH[k];
      // reflective (Neumann) boundary: a dry or missing neighbour mirrors this cell
      const hl = i > 0 && wetMask[k - 1] ? simH[k - 1] : h;
      const hr = i < SN - 1 && wetMask[k + 1] ? simH[k + 1] : h;
      const hd = j > 0 && wetMask[k - SN] ? simH[k - SN] : h;
      const hu = j < SN - 1 && wetMask[k + SN] ? simH[k + SN] : h;
      simV[k] = (simV[k] + c2 * (hl + hr + hd + hu - 4 * h) * inv * dt) * (1 - damp * dt);
    }
  }
  let sum = 0;
  for (let k = 0; k < wCount; k++) {
    if (!wetMask[k]) continue;
    simH[k] = clamp(simH[k] + simV[k] * dt, -0.9, 0.9);
    sum += simH[k];
  }
  // keep the volume constant: pushes and drops shouldn't slowly drain the sea
  const mean = sum / wetCells;
  for (let k = 0; k < wCount; k++) if (wetMask[k]) simH[k] -= mean;
}

function simAt(x, z) {
  const fx = clamp((x + WE) / DX, 0, WN - 0.001), fz = clamp((z + WE) / DX, 0, WN - 0.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const k = j * SN + i;
  return lerp(lerp(simH[k], simH[k + 1], tx), lerp(simH[k + SN], simH[k + SN + 1], tx), tz);
}

// push the surface down (positive amount) inside a soft circle
function disturb(x, z, radius, amount) {
  const i0 = Math.max(0, Math.floor((x - radius + WE) / DX)), i1 = Math.min(WN, Math.ceil((x + radius + WE) / DX));
  const j0 = Math.max(0, Math.floor((z - radius + WE) / DX)), j1 = Math.min(WN, Math.ceil((z + radius + WE) / DX));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * SN + i;
      if (!wetMask[k]) continue;
      const d = Math.hypot(wX[k] - x, wZ[k] - z);
      if (d >= radius) continue;
      const w = 1 - d / radius;
      simH[k] -= amount * w * w;
    }
  }
}

const waterMat = new THREE.MeshPhysicalMaterial({
  vertexColors: true, transparent: true, opacity: 0.82, roughness: 0.06, metalness: 0,
  clearcoat: 1, clearcoatRoughness: 0.04, side: THREE.DoubleSide, depthWrite: false,
  emissive: new THREE.Color(FLAVORS[0].color), emissiveIntensity: 0.14,
});
const waterTop = new THREE.Mesh(waterGeo, waterMat);
waterTop.renderOrder = 2;

const wallGeo = edgeStrip(() => LEVEL, SEABED, 0.006, '#ffffff', '#ffffff', WN);
wallGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(wallGeo.attributes.position.count * 3), 3));
const wallMat = waterMat.clone();
wallMat.opacity = 0.72;
const waterWalls = new THREE.Mesh(wallGeo, wallMat);
waterWalls.renderOrder = 1;

const sea = new THREE.Group();
sea.add(waterWalls, waterTop);
block.add(sea);

const wob = { s: 0, v: 0 };
const tilt = { x: 0, z: 0, vx: 0, vz: 0 };
const slosh = { x: 0, z: 0, vx: 0, vz: 0 };
let stir = 0;
let seaScaleY = 1;
let weatherWaves = 0;

// height of the water above rest level (without jelly squash)
function waveH(x, z, t) {
  const A = (params.waves + weatherWaves) * 1.4 + Math.abs(wob.s) * 0.6;
  let h = A * (0.07 * Math.sin(x * 0.9 + t * 1.5) + 0.055 * Math.sin(z * 1.2 - t * 1.1 + 1.3)
    + 0.03 * Math.sin((x + z) * 2.0 + t * 2.6) + 0.02 * Math.sin((x - z) * 3.3 - t * 3.1));
  h += slosh.x * x + slosh.z * z;
  if (stir > 0.01) {
    const dx = x - WC.x, dz = z - WC.y, d = Math.sqrt(dx * dx + dz * dz);
    h += stir * (0.13 * Math.sin(Math.atan2(dz, dx) * 3 - t * 5 + d * 1.8) - 0.3 * Math.exp(-d * d * 0.35));
  }
  return h + simAt(x, z);
}
// local-space y of the visible jelly surface
const surfaceY = (x, z, t) => SEABED + (LEVEL + waveH(x, z, t) - SEABED) * seaScaleY;
function surfaceGrad(x, z, t) {
  const e = 0.1;
  return [(surfaceY(x + e, z, t) - surfaceY(x - e, z, t)) / (2 * e), (surfaceY(x, z + e, t) - surfaceY(x, z - e, t)) / (2 * e)];
}

const flavorCol = new THREE.Color(FLAVORS[0].color);
const flavorTarget = new THREE.Color(FLAVORS[0].color);
const accentCol = new THREE.Color(FLAVORS[0].accent);
const accentTarget = new THREE.Color(FLAVORS[0].accent);
const foam = new THREE.Color('#ffffff');
const _c = new THREE.Color(), _c2 = new THREE.Color();
let nightGlow = 0;

function seaColor(out, x, z, depth, t) {
  if (FLAVORS[flavorIndex].rainbow) {
    out.setHSL((x - z) * 0.05 + t * 0.08, 1, 0.55);
  } else {
    out.copy(flavorCol);
    _c2.copy(accentCol);
    out.lerp(_c2, clamp(0.55 - depth * 0.8, 0, 0.45));
  }
  out.multiplyScalar(lerp(0.62, 0.3, clamp(depth / 1.1, 0, 1)));
  return out;
}

function updateSea(t) {
  const cols = waterGeo.attributes.color;
  for (let i = 0; i < wCount; i++) {
    const x = wX[i], z = wZ[i];
    const y = surfaceY(x, z, t);
    wPos.setY(i, y);
    const depth = y - wT[i];
    seaColor(_c, x, z, depth, t);
    // foam on the shoreline and on fast-moving crests
    const f = Math.max(clamp(1 - (depth + 0.02) / 0.1, 0, 1), clamp((Math.abs(simV[i]) - 0.5) * 0.6, 0, 0.7));
    if (f > 0) _c.lerp(foam, f * 0.8);
    cols.setXYZ(i, _c.r, _c.g, _c.b);
  }
  wPos.needsUpdate = true;
  cols.needsUpdate = true;
  waterGeo.computeVertexNormals();

  const wp = wallGeo.attributes.position, wc = wallGeo.attributes.color;
  for (let i = 0; i < wp.count; i += 2) {
    const x = wp.getX(i), z = wp.getZ(i);
    wp.setY(i, surfaceY(x, z, t));
    seaColor(_c, x, z, 0.6, t);
    wc.setXYZ(i, _c.r * 1.1, _c.g * 1.1, _c.b * 1.1);
    _c.multiplyScalar(0.45);
    wc.setXYZ(i + 1, _c.r, _c.g, _c.b);
  }
  wp.needsUpdate = true;
  wc.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Villa
// ---------------------------------------------------------------------------
const VILLA_POS = new THREE.Vector2(-2.05, -2.05);
const VILLA_ROT = Math.PI / 4;
const VILLA_HALF = [1.75, 1.45];
const windowMats = [];
let poolMat;
const villa = new THREE.Group();
{
  const white = new THREE.MeshStandardMaterial({ color: '#fbfaf7', roughness: 0.55 });
  const stone = new THREE.MeshStandardMaterial({ color: '#ece4d6', roughness: 0.8 });
  const wood = new THREE.MeshStandardMaterial({ color: '#c58a5a', roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2b2f3a', roughness: 0.4 });
  const glass = () => {
    const m = new THREE.MeshStandardMaterial({ color: '#7fb6c9', roughness: 0.05, metalness: 0.3, emissive: '#ffb45c', emissiveIntensity: 0, transparent: true, opacity: 0.85 });
    windowMats.push(m); return m;
  };
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); villa.add(m); return m; };

  box(3.3, 1.2, 2.7, stone, 0, -0.55, 0);
  box(3.5, 0.08, 2.9, stone, 0, 0.05, 0);
  box(2.0, 0.72, 1.35, white, -0.45, 0.45, -0.45);
  box(1.85, 0.5, 0.02, glass(), -0.45, 0.42, 0.235);
  box(0.02, 0.5, 1.1, glass(), 0.56, 0.42, -0.45);
  box(2.75, 0.56, 1.7, white, 0.15, 1.1, -0.15);
  box(2.55, 0.3, 0.02, glass(), 0.15, 1.12, 0.71);
  box(0.02, 0.3, 1.4, glass(), 1.53, 1.12, -0.15);
  box(2.95, 0.07, 1.9, white, 0.15, 1.42, -0.15);
  box(0.06, 0.62, 0.06, white, 1.45, 0.45, 0.65);
  box(0.06, 0.62, 0.06, white, 1.45, 0.45, -0.95);
  for (let i = 0; i < 9; i++) box(0.04, 0.14, 0.04, dark, -1.45 + i * 0.36, 1.53, 0.72);
  box(2.95, 0.025, 0.025, dark, 0.15, 1.6, 0.72);
  for (let i = 0; i < 6; i++) box(0.05, 0.56, 0.05, wood, -1.25 + i * 0.07, 1.1, 0.72);
  poolMat = new THREE.MeshStandardMaterial({ color: FLAVORS[0].color, emissive: FLAVORS[0].color, emissiveIntensity: 0.35, roughness: 0.05, metalness: 0.1 });
  box(1.1, 0.04, 0.9, stone, 0.95, 0.1, 0.75);
  box(1.0, 0.045, 0.8, poolMat, 0.95, 0.115, 0.75);
  box(0.22, 0.06, 0.55, white, -1.2, 0.13, 0.85);
  box(0.22, 0.06, 0.55, white, -0.85, 0.13, 0.85);
  for (let i = 0; i < 5; i++) box(0.6, 0.06, 0.18, stone, -0.25, -0.05 - i * 0.14, 1.5 + i * 0.18);
  const lamp = new THREE.PointLight('#ffb45c', 0, 5, 2);
  lamp.position.set(-0.3, 0.8, 0.6);
  villa.add(lamp);
  villa.userData.lamp = lamp;

  villa.position.set(VILLA_POS.x, terrainH(VILLA_POS.x, VILLA_POS.y) + 0.02, VILLA_POS.y);
  villa.rotation.y = VILLA_ROT;
  shade(villa);
  block.add(villa);
}
const VILLA_ROOF = villa.position.y + 1.46;

// ---------------------------------------------------------------------------
// Palms, props, flowers
// ---------------------------------------------------------------------------
const palms = [];
function makePalm(height, leanX, leanZ) {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector3(leanX * Math.pow(t, 1.7) * height * 0.38, t * height, leanZ * Math.pow(t, 1.7) * height * 0.38));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const SEG = 14, RAD = 6;
  const trunkGeo = new THREE.TubeGeometry(curve, SEG, 0.085, RAD, false);
  const tp = trunkGeo.attributes.position;
  const tc = new Float32Array(tp.count * 3);
  const c1 = new THREE.Color('#b9875a'), c2 = new THREE.Color('#8a5d3b');
  for (let i = 0; i <= SEG; i++) {
    const center = curve.getPointAt(i / SEG);
    const k = 1 - 0.45 * (i / SEG);
    const col = i % 2 ? c1 : c2;
    for (let j = 0; j <= RAD; j++) {
      const vi = i * (RAD + 1) + j;
      tp.setXYZ(vi, center.x + (tp.getX(vi) - center.x) * k, center.y + (tp.getY(vi) - center.y) * k, center.z + (tp.getZ(vi) - center.z) * k);
      tc.set([col.r, col.g, col.b], vi * 3);
    }
  }
  trunkGeo.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  trunkGeo.computeVertexNormals();
  g.add(new THREE.Mesh(trunkGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })));

  const crown = new THREE.Group();
  crown.position.copy(pts[pts.length - 1]);
  g.add(crown);
  const frondMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
  const nF = 9;
  for (let f = 0; f < nF; f++) {
    const len = rand(1.0, 1.3) * (0.55 + height * 0.2), US = 12;
    const verts = [], cols = [], idx = [];
    const base = new THREE.Color('#0f8a4a'), tip = new THREE.Color(Math.random() < 0.5 ? '#6dff5a' : '#3ef0a0');
    const droop = rand(0.7, 1.1), lift = rand(0.25, 0.45);
    for (let u = 0; u <= US; u++) {
      const s = u / US;
      const w = 0.3 * Math.sin(Math.PI * Math.min(1, s * 1.15)) * (1 - s * 0.35);
      const x = s * len, y = s * lift - s * s * droop;
      verts.push(x, y, -w, x, y + 0.06, 0, x, y, w);
      const c = base.clone().lerp(tip, s);
      for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
      if (u < US) {
        const a = u * 3;
        idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    fg.setIndex(idx);
    fg.computeVertexNormals();
    const frond = new THREE.Mesh(fg, frondMat);
    frond.rotation.y = (f / nF) * Math.PI * 2 + rand(-0.2, 0.2);
    frond.rotation.z = rand(-0.15, 0.2);
    frond.userData.frond = true;
    crown.add(frond);
  }
  const nutMat = new THREE.MeshStandardMaterial({ color: '#6b4426', roughness: 0.6 });
  for (let i = 0; i < 3; i++) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), nutMat);
    n.position.set(Math.cos(i * 2.1) * 0.09, -0.08, Math.sin(i * 2.1) * 0.09);
    crown.add(n);
  }
  shade(g);
  return { g, crown, ph: rand(0, 10), sp: rand(0.8, 1.3), height, leanX, leanZ };
}

function sampleSpots(n, test, minDist, avoid = []) {
  const out = [];
  for (let tries = 0; tries < 6000 && out.length < n; tries++) {
    const x = rand(-4.6, 4.6), z = rand(-4.6, 4.6);
    if (!test(x, z, terrainH(x, z))) continue;
    if ([...out, ...avoid].some(p => Math.hypot(p.x - x, p.z - z) < minDist)) continue;
    out.push({ x, z });
  }
  return out;
}
const nearVilla = (x, z, r) => Math.hypot(x - VILLA_POS.x, z - VILLA_POS.y) < r;

const palmSpots = sampleSpots(10, (x, z, h) => h > LEVEL + 0.18 && !nearVilla(x, z, 1.95), 0.85);
palmSpots.forEach(s => {
  const dx = s.x - ISLAND.x, dz = s.z - ISLAND.y, d = Math.hypot(dx, dz) || 1;
  const p = makePalm(rand(1.35, 2.1), dx / d * rand(0.4, 1), dz / d * rand(0.4, 1));
  p.base = new THREE.Vector3(s.x, terrainH(s.x, s.z) - 0.05, s.z);
  p.g.position.copy(p.base);
  palms.push(p);
  block.add(p.g);
});

const beachSpots = sampleSpots(10, (x, z, h) => h > LEVEL + 0.12 && h < LEVEL + 0.55 && !nearVilla(x, z, 2.1), 0.7, palmSpots);
const UMB = [['#ff4fd8', '#ffffff'], ['#ffd34f', '#ff5f7a'], ['#3fe8ff', '#ffffff'], ['#9b7bff', '#ffe08a']];
beachSpots.slice(0, 4).forEach((s, i) => {
  const g = new THREE.Group();
  const cols = UMB[i % UMB.length];
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.2, 12, 1, true),
    new THREE.MeshStandardMaterial({ map: stripeTexture([cols[0], cols[1], cols[0], cols[1], cols[0], cols[1], cols[0], cols[1]]), side: THREE.DoubleSide, roughness: 0.6 }));
  canopy.position.y = 0.62;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.65, 6), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
  pole.position.y = 0.3;
  const towel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.015, 0.5), new THREE.MeshStandardMaterial({ color: cols[0] }));
  towel.position.set(0.32, 0.01, 0.05);
  g.add(canopy, pole, towel);
  g.rotation.set(rand(-0.12, 0.12), rand(0, 6), rand(-0.12, 0.12));
  g.position.set(s.x, terrainH(s.x, s.z), s.z);
  block.add(shade(g));
});
beachSpots.slice(4).forEach(s => {
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.12, 0.24), 0), new THREE.MeshStandardMaterial({ color: '#d9cfe0', roughness: 0.9, flatShading: true }));
  r.position.set(s.x, terrainH(s.x, s.z) + 0.04, s.z);
  r.scale.y = 0.65;
  block.add(shade(r));
});

const mushCaps = [];
sampleSpots(4, (x, z) => islandShape(x, z).p > 0.55 && !nearVilla(x, z, 1.75), 0.6, palmSpots).forEach((s, i) => {
  const g = new THREE.Group();
  const col = ['#ff3d8b', '#8a5cff', '#ffb02e', '#20e3ff'][i % 4];
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.28, 8), new THREE.MeshStandardMaterial({ color: '#fff4e6' }));
  stem.position.y = 0.14;
  const capMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.2, roughness: 0.4 });
  mushCaps.push(capMat);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  cap.position.y = 0.26;
  g.add(stem, cap);
  for (let k = 0; k < 5; k++) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff', emissiveIntensity: 0.4 }));
    const a = k * 1.3, el = 0.5 + (k % 2) * 0.4;
    dot.position.set(Math.cos(a) * 0.17 * Math.cos(el), 0.26 + 0.17 * Math.sin(el), Math.sin(a) * 0.17 * Math.cos(el));
    g.add(dot);
  }
  g.scale.setScalar(rand(0.9, 1.5));
  g.position.set(s.x, terrainH(s.x, s.z) - 0.02, s.z);
  block.add(shade(g));
});
{
  const spots = sampleSpots(140, (x, z) => islandShape(x, z).p > 0.4 && !nearVilla(x, z, 1.7), 0.12);
  const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.045, 0), new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.08 }), spots.length);
  const m4 = new THREE.Matrix4();
  const fc = ['#ff4fd8', '#ffd34f', '#ffffff', '#ff7a5c', '#b38bff', '#5cf2ff'];
  spots.forEach((s, i) => {
    m4.makeTranslation(s.x, terrainH(s.x, s.z) + 0.04, s.z);
    inst.setMatrixAt(i, m4);
    inst.setColorAt(i, new THREE.Color(fc[i % fc.length]));
  });
  block.add(inst);
}

// ---------------------------------------------------------------------------
// Clouds & rainbow
// ---------------------------------------------------------------------------
const clouds = [];
const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffd6f3', emissiveIntensity: 0.25, roughness: 1 });
for (let i = 0; i < 6; i++) {
  const g = new THREE.Group();
  const n = 5 + Math.floor(Math.random() * 3);
  for (let k = 0; k < n; k++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(rand(0.6, 1.1), 16, 12), cloudMat);
    s.position.set((k - n / 2) * 0.75 + rand(-0.2, 0.2), rand(-0.15, 0.35) + (k > 1 && k < n - 2 ? 0.35 : 0), rand(-0.4, 0.4));
    s.scale.y = 0.75;
    g.add(s);
  }
  g.scale.setScalar(rand(0.7, 1.15));
  clouds.push({ g, a: (i / 6) * Math.PI * 2 + rand(0, 0.6), r: rand(13, 18), y: rand(3, 7.5), sp: rand(0.015, 0.035) });
  scene.add(g);
}
const rainbow = new THREE.Group();
{
  const cols = ['#ff3b5c', '#ff9a3b', '#ffe53b', '#4dff6b', '#3bd8ff', '#5b6bff', '#c45bff'];
  cols.forEach((c, i) => {
    rainbow.add(new THREE.Mesh(new THREE.TorusGeometry(11 - i * 0.32, 0.17, 8, 90, Math.PI),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })));
  });
  rainbow.position.set(-8, -2, -8);
  rainbow.rotation.y = Math.PI / 4;
  scene.add(rainbow);
}

// ---------------------------------------------------------------------------
// Particles: splashes (instanced droplets), magic sparks (points), ambient sparkle
// ---------------------------------------------------------------------------
const SPL = 700;
const splashMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.1, emissive: '#ffffff', emissiveIntensity: 0.15, transparent: true, opacity: 0.9 }), SPL);
splashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
const splash = Array.from({ length: SPL }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), s: 1 }));
let splashHead = 0;
{
  const m4 = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < SPL; i++) { splashMesh.setMatrixAt(i, m4); splashMesh.setColorAt(i, new THREE.Color('#fff')); }
}
splashMesh.frustumCulled = false;
block.add(splashMesh);

function spawnSplash(x, y, z, n, power = 1, dir = null) {
  for (let k = 0; k < n; k++) {
    const idx = splashHead;
    const sp = splash[idx];
    splashHead = (splashHead + 1) % SPL;
    sp.life = rand(0.8, 1.6);
    sp.p.set(x + rand(-0.08, 0.08), y + 0.02, z + rand(-0.08, 0.08));
    const a = rand(0, Math.PI * 2), r = rand(0.4, 1.6) * power;
    sp.v.set(Math.cos(a) * r, rand(2.0, 4.4) * power, Math.sin(a) * r);
    if (dir) sp.v.addScaledVector(dir, rand(0.3, 1));
    sp.s = rand(0.45, 1.1) * clamp(power, 0.6, 1.3);
    seaColor(_c, x, z, 0.3, simTime);
    _c.lerp(foam, rand(0.25, 0.7));
    splashMesh.setColorAt(idx, _c);
  }
  splashMesh.instanceColor.needsUpdate = true;
}

const SPARKS = 2600;
const sparkGeo = new THREE.BufferGeometry();
const sparkPos = new Float32Array(SPARKS * 3).fill(9999);
const sparkCol = new Float32Array(SPARKS * 3);
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
const sparkPoints = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.32, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
sparkPoints.frustumCulled = false;
scene.add(sparkPoints);
const sparks = Array.from({ length: SPARKS }, () => ({ life: 0, max: 1, v: new THREE.Vector3(), c: new THREE.Color(), grav: 2.2 }));
let sparkHead = 0;
function burst(center, n = 160, speed = 3.5, hue = Math.random(), spread = 0.15, light = 0.62, grav = 2.2, life = [1.1, 1.9]) {
  for (let k = 0; k < n; k++) {
    const i = sparkHead; sparkHead = (sparkHead + 1) % SPARKS;
    const s = sparks[i];
    s.max = s.life = rand(life[0], life[1]);
    s.v.randomDirection().multiplyScalar(speed * rand(0.55, 1));
    s.c.setHSL((hue + rand(-spread, spread) + 1) % 1, 1, light);
    s.grav = grav;
    sparkPos.set([center.x, center.y, center.z], i * 3);
  }
}

const AMB = 700;
const ambGeo = new THREE.BufferGeometry();
const ambPos = new Float32Array(AMB * 3), ambCol = new Float32Array(AMB * 3);
const amb = [];
for (let i = 0; i < AMB; i++) {
  const a = rand(0, Math.PI * 2), r = rand(3, 13);
  amb.push({ x: Math.cos(a) * r, y: rand(-5, 9), z: Math.sin(a) * r, sp: rand(0.1, 0.5), ph: rand(0, 10), tw: rand(1.5, 4), c: new THREE.Color().setHSL(rand(0, 1), 0.9, 0.7) });
}
ambGeo.setAttribute('position', new THREE.BufferAttribute(ambPos, 3).setUsage(THREE.DynamicDrawUsage));
ambGeo.setAttribute('color', new THREE.BufferAttribute(ambCol, 3).setUsage(THREE.DynamicDrawUsage));
const ambPoints = new THREE.Points(ambGeo, new THREE.PointsMaterial({ size: 0.22, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
ambPoints.frustumCulled = false;
scene.add(ambPoints);

// ---------------------------------------------------------------------------
// Rain & lightning
// ---------------------------------------------------------------------------
const RAIN = 1400;
const rainPos = new Float32Array(RAIN * 6);
const rainDrops = [];
for (let i = 0; i < RAIN; i++) rainDrops.push({ x: rand(-7, 7), y: rand(0, 14), z: rand(-7, 7), sp: rand(11, 15) });
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
const rainMat = new THREE.LineBasicMaterial({ color: '#d8ecff', transparent: true, opacity: 0, depthWrite: false });
const rainLines = new THREE.LineSegments(rainGeo, rainMat);
rainLines.frustumCulled = false;
scene.add(rainLines);

const boltGeo = new THREE.BufferGeometry();
boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
const boltMat = new THREE.LineBasicMaterial({ color: new THREE.Color(4, 4, 6), transparent: true, opacity: 0 });
const bolt = new THREE.Line(boltGeo, boltMat);
bolt.frustumCulled = false;
scene.add(bolt);
const weatherNow = { rain: 0, gloom: 0, wind: 0, waves: 0 };
let flash = 0, nextLightning = 4;

function lightning() {
  const target = new THREE.Vector3(rand(-6, 6), rand(-1, 1), rand(-6, 6));
  const p = boltGeo.attributes.position;
  let x = target.x + rand(-3, 3), z = target.z + rand(-3, 3);
  for (let i = 0; i < 40; i++) {
    const t = i / 39;
    x = lerp(x, target.x, 0.12) + rand(-0.5, 0.5);
    z = lerp(z, target.z, 0.12) + rand(-0.5, 0.5);
    p.setXYZ(i, x, lerp(22, target.y, t), z);
  }
  p.needsUpdate = true;
  flash = 1;
  boltMat.opacity = 1;
  setTimeout(() => sfx.thunder(), rand(250, 900));
  kick(0.15);
}

// ---------------------------------------------------------------------------
// Rigid bodies: ducks, beach balls, crates, rocks — buoyancy, drag, rolling,
// friction, collisions with the terrain, villa, palm trunks and each other.
// ---------------------------------------------------------------------------
const DUCK_COLORS = ['#ffd21f', '#ffd21f', '#ffd21f', '#ff6fcf', '#5cf2ff', '#b38bff', '#7dff6a'];
const duckBodyGeo = new THREE.SphereGeometry(0.5, 20, 14);
const duckHeadGeo = new THREE.SphereGeometry(0.32, 18, 12);
const duckBeakGeo = new THREE.SphereGeometry(0.2, 12, 8);
const eyeGeo = new THREE.SphereGeometry(0.055, 8, 6);
const eyeMat = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.2 });
const beakMat = new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.4 });
function makeDuck() {
  const col = DUCK_COLORS[Math.floor(Math.random() * DUCK_COLORS.length)];
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, emissive: col, emissiveIntensity: 0.06 });
  const outer = new THREE.Group(), g = new THREE.Group();
  const body = new THREE.Mesh(duckBodyGeo, mat); body.scale.set(1.25, 0.78, 1); body.position.y = 0.22;
  const tail = new THREE.Mesh(duckHeadGeo, mat); tail.scale.set(0.5, 0.5, 0.5); tail.position.set(-0.55, 0.45, 0);
  const head = new THREE.Mesh(duckHeadGeo, mat); head.position.set(0.38, 0.78, 0);
  const beak = new THREE.Mesh(duckBeakGeo, beakMat); beak.scale.set(1.3, 0.38, 0.95); beak.position.set(0.7, 0.72, 0);
  const e1 = new THREE.Mesh(eyeGeo, eyeMat); e1.position.set(0.6, 0.88, 0.16);
  const e2 = e1.clone(); e2.position.z = -0.16;
  g.add(body, tail, head, beak, e1, e2);
  g.scale.setScalar(0.34);
  g.position.y = -0.1;
  outer.add(g);
  return shade(outer, true, false);
}
const ballGeo = new THREE.SphereGeometry(0.26, 24, 16);
function makeBall() {
  const cols = [['#ff3b5c', '#ffffff', '#3bd8ff', '#ffffff', '#ffe53b', '#ffffff'], ['#ff4fd8', '#ffe53b', '#4dff6b', '#3bd8ff', '#c45bff', '#ff9a3b']][Math.random() < 0.5 ? 0 : 1];
  return shade(new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ map: stripeTexture(cols), roughness: 0.25 })), true, false);
}
const crateTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d79a5c'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#b57a42';
  for (let i = 0; i < 4; i++) g.fillRect(0, i * 32 + 30, 128, 3);
  g.strokeStyle = '#8a5528'; g.lineWidth = 12; g.strokeRect(6, 6, 116, 116);
  g.beginPath(); g.moveTo(10, 10); g.lineTo(118, 118); g.stroke();
  g.fillStyle = '#ff4fd8'; g.font = 'bold 28px sans-serif'; g.fillText('✦', 76, 48);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const crateGeo = new RoundedBoxGeometry(0.38, 0.38, 0.38, 2, 0.03);
const crateMat = new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.8 });
const makeCrate = () => shade(new THREE.Mesh(crateGeo, crateMat), true, true);
const rockGeo = new THREE.DodecahedronGeometry(0.21, 1);
function makeRock() {
  const col = ['#8f86a8', '#c9a7ff', '#7ad7ff', '#ff9fd0'][Math.floor(Math.random() * 4)];
  const m = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, flatShading: true, emissive: col, emissiveIntensity: 0.12 }));
  m.scale.set(1, 0.8, 0.95);
  return shade(m, true, true);
}

// density is relative to the jelly (1 = neutral). r is the collision sphere.
const KINDS = {
  duck:  { r: 0.17, dens: 0.3,  e: 0.35, mu: 0.6,  roll: false, make: makeDuck,  label: 'Ducks' },
  ball:  { r: 0.26, dens: 0.12, e: 0.78, mu: 0.06, roll: true,  make: makeBall,  label: 'Balls' },
  crate: { r: 0.22, dens: 0.55, e: 0.2,  mu: 0.8,  roll: false, make: makeCrate, label: 'Crates' },
  rock:  { r: 0.2,  dens: 2.6,  e: 0.15, mu: 0.12, roll: true,  make: makeRock,  label: 'Rocks' },
};

const bodies = [];
const isWater = (x, z) => Math.abs(x) < WE && Math.abs(z) < WE && terrainH(x, z) < LEVEL - 0.12;
function randomWaterPoint(minDepth = 0.35) {
  for (let i = 0; i < 300; i++) { const x = rand(-4.4, 4.4), z = rand(-4.4, 4.4); if (terrainH(x, z) < LEVEL - minDepth) return new THREE.Vector3(x, 0, z); }
  return new THREE.Vector3(WC.x, 0, WC.y);
}
function cameraSideLocal() {
  const v = block.worldToLocal(camera.position.clone());
  v.y = 0; return v.normalize();
}

function addBody(kind, p, v) {
  const cfg = KINDS[kind];
  const mesh = cfg.make();
  block.add(mesh);
  const b = {
    kind, cfg, mesh, p: p.clone(), v: v.clone(), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand(0, 6), 0)),
    w: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), yaw: rand(0, 6), f: 0, held: false, ground: false,
    m: cfg.dens * cfg.r * cfg.r * cfg.r * 30,
  };
  bodies.push(b);
  if (bodies.length > 70) removeBody(bodies.find(o => !o.held));
  updateCounts();
  return b;
}
function removeBody(b) {
  if (!b) return;
  block.remove(b.mesh);
  bodies.splice(bodies.indexOf(b), 1);
  updateCounts();
}

// throw from the camera side in a ballistic arc onto a target point
function throwBody(kind, target) {
  const T = target ? target.clone() : randomWaterPoint();
  T.y = LEVEL;
  const S = T.clone().addScaledVector(cameraSideLocal(), rand(3.5, 5)); S.y = rand(4.5, 6);
  const tau = rand(0.85, 1.05);
  const v = new THREE.Vector3((T.x - S.x) / tau, (T.y - S.y) / tau + 0.5 * G * tau, (T.z - S.z) / tau);
  const b = addBody(kind, S, v);
  if (kind === 'duck') sfx.quack();
  return b;
}
function dropBody(kind, target) {
  const T = target ? target.clone() : randomWaterPoint();
  return addBody(kind, new THREE.Vector3(T.x + rand(-0.3, 0.3), 7, T.z + rand(-0.3, 0.3)), new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.3, 0.3)));
}

const gLocal = new THREE.Vector3();
const _n = new THREE.Vector3(), _a = new THREE.Vector3(), _vt = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _w = new THREE.Vector3();
const windVec = new THREE.Vector2();

function collideGround(b, groundY, n, dt) {
  const { p, v, cfg } = b;
  if (p.y - cfg.r >= groundY) return false;
  p.y = groundY + cfg.r;
  const vn = v.dot(n);
  if (vn < 0) {
    const e = -vn > 1.0 ? cfg.e : 0;
    v.addScaledVector(n, -(1 + e) * vn);
    if (-vn > 2.5) sfx.thud(Math.min(1, -vn / 8));
  }
  // Coulomb friction on the tangential velocity (rolling bodies only feel rolling resistance)
  _vt.copy(v).addScaledVector(n, -v.dot(n));
  const vt = _vt.length();
  if (vt > 1e-5) {
    const dec = (cfg.roll ? cfg.mu * 0.5 : cfg.mu) * G * dt * Math.max(0.3, n.y);
    v.addScaledVector(_vt, -Math.min(1, dec / vt));
  }
  b.ground = true;
  b.groundN.copy(n);
  return true;
}

function stepBody(b, dt, t) {
  const { p, v, cfg } = b;
  const r = cfg.r;
  if (!b.groundN) b.groundN = new THREE.Vector3(0, 1, 0);
  b.ground = false;
  const inside = Math.abs(p.x) < HALF && Math.abs(p.z) < HALF;

  if (b.held) {
    _a.copy(b.target).sub(p);
    const np = p.clone().addScaledVector(_a, 1 - Math.exp(-dt * 18));
    v.lerp(np.clone().sub(p).divideScalar(Math.max(dt, 1e-4)), 0.35);
    p.copy(np);
  } else {
    _a.copy(gLocal);
    // buoyancy: submerged fraction of the sphere
    let f = 0, sy = -99;
    if (inside) {
      sy = surfaceY(p.x, p.z, t);
      const d = clamp((sy - (p.y - r)) / (2 * r), 0, 1);
      f = d * d * (3 - 2 * d);
    }
    if (f > 0) {
      // buoyancy, divided by the added mass of the jelly that has to move with the body
      _a.addScaledVector(gLocal, -f / cfg.dens).multiplyScalar(1 / (1 + 0.5 * f / cfg.dens));
      const [gx, gz] = surfaceGrad(p.x, p.z, t);
      // floaters slide down the wave faces and get carried by currents
      _a.x += -gx * G * f * 0.9; _a.z += -gz * G * f * 0.9;
      if (stir > 0.02) {
        const dx = p.x - WC.x, dz = p.z - WC.y, dd = Math.hypot(dx, dz) || 1;
        _a.x += (-dz / dd * 2.4 - dx * 0.35) * stir * f;
        _a.z += (dx / dd * 2.4 - dz * 0.35) * stir * f;
      }
      // jelly drag: lighter/smaller bodies feel more of it; the vertical term is close to
      // critical damping for the buoyancy spring so floaters bob a couple of times and settle
      const lat = clamp(0.06 / (cfg.dens * r), 0.8, 5);
      const bobW = Math.sqrt(G / (cfg.dens * 2 * r) / (1 + 0.5 / cfg.dens));
      _a.x -= v.x * f * lat; _a.z -= v.z * f * lat;
      _a.y -= v.y * f * Math.max(2, 1.5 * bobW);
    }
    // wind pushes on whatever sticks out of the water
    const exposed = 1 - f * 0.8;
    const wk = exposed * 0.9 / (cfg.dens * 3 + 0.45);
    _a.x += windVec.x * wk; _a.z += windVec.y * wk;
    // air drag
    _a.addScaledVector(v, -0.04 * v.length());

    v.addScaledVector(_a, dt);
    p.addScaledVector(v, dt);

    // splash on entry
    if (f > 0.04 && b.f <= 0.04 && v.y < -1.2) {
      const power = clamp(-v.y / 8, 0.35, 1.6) * Math.sqrt(cfg.r / 0.2) * (cfg.dens > 1 ? 1.3 : 1);
      spawnSplash(p.x, sy, p.z, Math.round(28 * power), power);
      disturb(p.x, p.z, r * 3 + 0.2, 0.1 * power + 0.02 * -v.y * cfg.dens);
      kick(0.12 * power);
      sfx.bloop(power);
    }
    // moving through the jelly leaves a wake
    if (f > 0) {
      const hs = Math.hypot(v.x, v.z);
      const push = (hs > 0.3 ? hs * 0.004 : 0) + (v.y < -0.6 ? -v.y * 0.002 : 0);
      if (push > 0) disturb(p.x, p.z, r * 2.2, push * f * 60 * dt);
      if (hs > 2.5 && Math.random() < hs * dt * 3) spawnSplash(p.x, sy, p.z, 2, 0.4);
    }
    b.f = f;
  }

  // the jelly walls contain floaters; anything flying above them can leave the block
  for (const ax of ['x', 'z']) {
    const lim = HALF - r;
    if (Math.abs(p[ax]) > lim && Math.abs(p[ax]) < HALF + r) {
      const ex = ax === 'x' ? Math.sign(p.x) * WE : clamp(p.x, -WE, WE);
      const ez = ax === 'z' ? Math.sign(p.z) * WE : clamp(p.z, -WE, WE);
      const top = Math.max(terrainH(ex, ez), surfaceY(ex, ez, t));
      if (p.y - r * 0.4 < top) {
        const s = Math.sign(p[ax]);
        p[ax] = s * lim;
        if (v[ax] * s > 0) v[ax] *= -0.45;
      }
    }
  }

  if (Math.abs(p.x) < HALF && Math.abs(p.z) < HALF) {
    collideGround(b, terrainH(p.x, p.z), terrainNormal(p.x, p.z, _n), dt);
    // villa: an oriented box you can bounce off or land on
    const lx0 = p.x - VILLA_POS.x, lz0 = p.z - VILLA_POS.y;
    const c = Math.cos(VILLA_ROT), s = Math.sin(VILLA_ROT);
    const lx = lx0 * c - lz0 * s, lz = lx0 * s + lz0 * c;
    const hx = VILLA_HALF[0] + r, hz = VILLA_HALF[1] + r;
    if (Math.abs(lx) < hx && Math.abs(lz) < hz && p.y - r < VILLA_ROOF) {
      if (p.y - r > VILLA_ROOF - 0.25) collideGround(b, VILLA_ROOF, _n.set(0, 1, 0), dt);
      else {
        const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
        let nx = 0, nz = 0;
        if (px < pz) nx = Math.sign(lx); else nz = Math.sign(lz);
        // back to block space
        const wx = nx * c + nz * s, wz = -nx * s + nz * c;
        const pen = Math.min(px, pz);
        p.x += wx * pen; p.z += wz * pen;
        const vn = v.x * wx + v.z * wz;
        if (vn < 0) { v.x -= (1 + cfg.e) * vn * wx; v.z -= (1 + cfg.e) * vn * wz; }
      }
    }
    // palm trunks
    for (const pm of palms) {
      const ty = (p.y - pm.base.y) / pm.height;
      if (ty < -0.1 || ty > 0.92) continue;
      const k = Math.pow(clamp(ty, 0, 1), 1.7) * pm.height * 0.38;
      const dx = p.x - (pm.base.x + pm.leanX * k), dz = p.z - (pm.base.z + pm.leanZ * k);
      const d = Math.hypot(dx, dz), minD = r + 0.1;
      if (d < minD && d > 1e-4) {
        const nx = dx / d, nz = dz / d;
        p.x += nx * (minD - d); p.z += nz * (minD - d);
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) { v.x -= (1 + cfg.e) * vn * nx; v.z -= (1 + cfg.e) * vn * nz; }
      }
    }
  }
}

function collideBodies() {
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const dx = a.p.x - b.p.x, dy = a.p.y - b.p.y, dz = a.p.z - b.p.z;
      const minD = a.cfg.r + b.cfg.r;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= minD * minD || d2 < 1e-8) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
      const ia = a.held ? 0 : 1 / a.m, ib = b.held ? 0 : 1 / b.m;
      if (ia + ib === 0) continue;
      const pen = minD - d;
      a.p.x += nx * pen * ia / (ia + ib); a.p.y += ny * pen * ia / (ia + ib); a.p.z += nz * pen * ia / (ia + ib);
      b.p.x -= nx * pen * ib / (ia + ib); b.p.y -= ny * pen * ib / (ia + ib); b.p.z -= nz * pen * ib / (ia + ib);
      const rv = (a.v.x - b.v.x) * nx + (a.v.y - b.v.y) * ny + (a.v.z - b.v.z) * nz;
      if (rv >= 0) continue;
      const e = Math.min(a.cfg.e, b.cfg.e);
      const jimp = -(1 + e) * rv / (ia + ib);
      a.v.x += jimp * ia * nx; a.v.y += jimp * ia * ny; a.v.z += jimp * ia * nz;
      b.v.x -= jimp * ib * nx; b.v.y -= jimp * ib * ny; b.v.z -= jimp * ib * nz;
      if (-rv > 2) { sfx.thud(Math.min(1, -rv / 8)); if (a.kind === 'duck' || b.kind === 'duck') sfx.squeak(); }
    }
  }
}

function orientBody(b, dt, t) {
  const { v, cfg, q } = b;
  if (cfg.roll) {
    if (b.ground) {
      _w.crossVectors(b.groundN, v).divideScalar(cfg.r);
      b.w.lerp(_w, 0.6);
    } else if (b.f > 0) {
      _w.crossVectors(UP, v).divideScalar(cfg.r * 2);
      b.w.lerp(_w, 0.08);
    }
  } else if (b.held || b.f > 0.12 || b.ground) {
    let n = b.groundN;
    if (b.f > 0.12 && !b.ground) {
      const [gx, gz] = surfaceGrad(b.p.x, b.p.z, t);
      n = _n.set(-gx, 1, -gz).normalize();
    }
    if (b.held) n = UP;
    const hs = Math.hypot(v.x, v.z);
    if (b.kind === 'duck' && hs > 0.12) b.yaw = lerpAngle(b.yaw, Math.atan2(-v.z, v.x), clamp(dt * 3, 0, 1));
    _qy.setFromAxisAngle(UP, b.yaw);
    _qa.setFromUnitVectors(UP, n).multiply(_qy);
    q.slerp(_qa, 1 - Math.exp(-dt * (b.kind === 'duck' ? 5 : 3)));
    b.w.multiplyScalar(0.8);
    b.mesh.quaternion.copy(q);
    return;
  }
  const wl = b.w.length();
  if (wl > 1e-4) {
    _dq.setFromAxisAngle(_w.copy(b.w).divideScalar(wl), wl * dt);
    q.premultiply(_dq);
  }
  // keep yaw in sync with tumbling so the upright pose resumes smoothly
  if (!cfg.roll) { const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q); b.yaw = Math.atan2(-fwd.z, fwd.x); }
  b.mesh.quaternion.copy(q);
}

// ---------------------------------------------------------------------------
// Fish: swim under the jelly, jump out in arcs
// ---------------------------------------------------------------------------
const fishes = [];
{
  const cols = ['#ff4fd8', '#ffd34f', '#3fe8ff', '#7dff6a', '#ff7a3c', '#b38bff', '#ffffff'];
  const bodyGeo = new THREE.SphereGeometry(0.1, 14, 10);
  const tailGeo = new THREE.ConeGeometry(0.07, 0.12, 4); tailGeo.rotateZ(Math.PI / 2);
  for (let i = 0; i < 8; i++) {
    const col = cols[i % cols.length];
    const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.45, roughness: 0.3 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, mat); body.scale.set(1.7, 0.75, 0.55);
    const tail = new THREE.Mesh(tailGeo, mat); tail.position.x = -0.2; tail.scale.set(1, 1.3, 0.35);
    const fin = new THREE.Mesh(tailGeo, mat); fin.position.set(0, 0.08, 0); fin.rotation.z = -Math.PI / 2; fin.scale.set(0.6, 0.6, 0.25);
    const eye = new THREE.Mesh(eyeGeo, eyeMat); eye.scale.setScalar(0.5); eye.position.set(0.12, 0.02, 0.045);
    const eye2 = eye.clone(); eye2.position.z = -0.045;
    g.add(body, tail, fin, eye, eye2);
    g.scale.setScalar(rand(0.9, 1.5));
    const p = randomWaterPoint(0.5);
    p.y = LEVEL - 0.4;
    block.add(g);
    fishes.push({ g, tail, p, heading: rand(0, 6), speed: rand(0.5, 0.9), turn: 0, ph: rand(0, 6), state: 'swim', v: new THREE.Vector3(), nextJump: rand(3, 10) });
  }
}

function updateFish(dt, t) {
  for (const f of fishes) {
    f.tail.rotation.y = Math.sin(t * (f.state === 'swim' ? 10 : 22) + f.ph) * 0.5;
    if (f.state === 'swim') {
      // wander, steer away from shallows and the walls
      f.turn += rand(-1, 1) * dt * 2; f.turn *= 0.97;
      const look = 0.7;
      const ax = f.p.x + Math.cos(f.heading) * look, az = f.p.z - Math.sin(f.heading) * look;
      if (!isWater(ax, az) || terrainH(ax, az) > LEVEL - 0.35 || Math.abs(ax) > 4.6 || Math.abs(az) > 4.6) f.turn += 4 * dt * (f.ph > 3 ? 1 : -1);
      if (stir > 0.05) {
        const target = Math.atan2(-(f.p.x - WC.x), -(f.p.z - WC.y));
        f.heading = lerpAngle(f.heading, target, stir * dt);
      }
      f.heading += f.turn * dt * 2;
      const sp = f.speed * (1 + stir);
      const nx = f.p.x + Math.cos(f.heading) * sp * dt, nz = f.p.z - Math.sin(f.heading) * sp * dt;
      if (isWater(nx, nz) && terrainH(nx, nz) < LEVEL - 0.25) { f.p.x = nx; f.p.z = nz; } else f.heading += Math.PI * 0.5;
      const floor = terrainH(f.p.x, f.p.z) + 0.12, ceil = surfaceY(f.p.x, f.p.z, t) - 0.14;
      f.p.y = clamp(lerp(f.p.y, lerp(floor, ceil, 0.5 + 0.35 * Math.sin(t * 0.7 + f.ph)), dt * 1.5), floor, ceil);
      f.g.rotation.set(0, f.heading, Math.sin(t * 1.3 + f.ph) * 0.1);
      f.nextJump -= dt;
      if (params.fish && f.nextJump <= 0 && terrainH(f.p.x, f.p.z) < LEVEL - 0.4) {
        f.state = 'jump';
        const sp2 = rand(1.6, 2.6);
        f.v.set(Math.cos(f.heading) * sp2, rand(4.2, 5.6), -Math.sin(f.heading) * sp2);
        f.wasUnder = true;
      }
    } else {
      f.v.y -= G * dt;
      f.p.addScaledVector(f.v, dt);
      const sy = Math.abs(f.p.x) < HALF && Math.abs(f.p.z) < HALF ? surfaceY(f.p.x, f.p.z, t) : -99;
      const under = f.p.y < sy;
      if (f.wasUnder && !under) { spawnSplash(f.p.x, sy, f.p.z, 10, 0.55); disturb(f.p.x, f.p.z, 0.35, 0.05); }
      if (!f.wasUnder && under && f.v.y < 0) {
        spawnSplash(f.p.x, sy, f.p.z, 14, 0.6); disturb(f.p.x, f.p.z, 0.4, 0.07); sfx.bloop(0.6);
        if (!isWater(f.p.x, f.p.z)) { f.p.copy(randomWaterPoint(0.5)); f.p.y = LEVEL - 0.4; }
        f.state = 'swim'; f.nextJump = rand(4, 11);
        f.p.y = Math.max(f.p.y, terrainH(f.p.x, f.p.z) + 0.15);
      }
      if (Math.abs(f.p.x) > HALF + 1 || Math.abs(f.p.z) > HALF + 1 || f.p.y < -10) { f.p.copy(randomWaterPoint(0.5)); f.p.y = LEVEL - 0.4; f.state = 'swim'; }
      f.wasUnder = under;
      f.g.rotation.set(0, f.heading, Math.atan2(f.v.y, Math.hypot(f.v.x, f.v.z)));
    }
    f.g.position.copy(f.p);
  }
}

// ---------------------------------------------------------------------------
// Boat
// ---------------------------------------------------------------------------
const boat = new THREE.Group();
{
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.2); shape.lineTo(0.3, -0.2);
  shape.quadraticCurveTo(0.55, -0.12, 0.68, 0); shape.quadraticCurveTo(0.55, 0.12, 0.3, 0.2);
  shape.lineTo(-0.5, 0.2); shape.lineTo(-0.5, -0.2);
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  hullGeo.rotateX(-Math.PI / 2);
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 }));
  hull.position.y = -0.06;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.47), new THREE.MeshStandardMaterial({ color: '#ff3b8b', emissive: '#ff3b8b', emissiveIntensity: 0.25 }));
  stripe.position.set(-0.05, 0.03, 0);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.3), new THREE.MeshStandardMaterial({ color: '#f4f4f4' }));
  cabin.position.set(-0.08, 0.2, 0);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: '#4ec9ff', emissive: '#4ec9ff', emissiveIntensity: 0.3, transparent: true, opacity: 0.8 }));
  shield.position.set(0.1, 0.24, 0); shield.rotation.z = -0.5;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.01), new THREE.MeshStandardMaterial({ color: '#ffd34f', emissive: '#ffd34f', emissiveIntensity: 0.4 }));
  flag.position.set(-0.4, 0.42, 0);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.35), new THREE.MeshStandardMaterial({ color: '#ddd' }));
  mast.position.set(-0.47, 0.3, 0);
  boat.add(hull, stripe, cabin, shield, flag, mast);
  boat.scale.setScalar(0.85);
  shade(boat, true, false);
  block.add(boat);
}
const boatState = { a: 0, pitch: 0, roll: 0, y: LEVEL };

function updateBoat(dt, t) {
  if (!params.boat) return;
  boatState.a += dt * 0.32;
  const a = boatState.a;
  const bx = WC.x + Math.cos(a) * 1.6, bz = WC.y + Math.sin(a) * 1.25;
  const vx = -Math.sin(a) * 1.6 * 0.32, vz = Math.cos(a) * 1.25 * 0.32;
  const len = Math.hypot(vx, vz), hx = vx / len, hz = vz / len;
  // pitch/roll follow the water under bow, stern and both sides (a 4-point float)
  const yb = surfaceY(bx + hx * 0.45, bz + hz * 0.45, t), ys = surfaceY(bx - hx * 0.45, bz - hz * 0.45, t);
  const yl = surfaceY(bx - hz * 0.2, bz + hx * 0.2, t), yr = surfaceY(bx + hz * 0.2, bz - hx * 0.2, t);
  const k = 1 - Math.exp(-dt * 6);
  boatState.y = lerp(boatState.y, (yb + ys + yl + yr) / 4, k);
  boatState.pitch = lerp(boatState.pitch, Math.atan2(yb - ys, 0.9), k);
  boatState.roll = lerp(boatState.roll, Math.atan2(yl - yr, 0.4), k);
  boat.position.set(bx, boatState.y + 0.02, bz);
  boat.rotation.set(0, Math.atan2(-vz, vx), 0);
  boat.rotateZ(boatState.pitch);
  boat.rotateX(boatState.roll + 0.04);
  // the hull pushes water aside: a continuous depression at the bow becomes a V wake
  disturb(bx + hx * 0.3, bz + hz * 0.3, 0.32, 0.5 * dt);
  if (Math.random() < dt * 8) spawnSplash(bx + hx * 0.4, boatState.y, bz + hz * 0.4, 1, 0.35, new THREE.Vector3(-hz, 0, hx).multiplyScalar(Math.random() < 0.5 ? 1 : -1));
  // shove floaters out of the way
  for (const b of bodies) {
    const dx = b.p.x - bx, dz = b.p.z - bz, d = Math.hypot(dx, dz), minD = 0.45 + b.cfg.r;
    if (d < minD && d > 1e-4 && b.p.y < boatState.y + 0.5) {
      const nx = dx / d, nz = dz / d;
      b.p.x += nx * (minD - d); b.p.z += nz * (minD - d);
      const vn = (b.v.x - vx) * nx + (b.v.z - vz) * nz;
      if (vn < 0) { b.v.x -= 1.4 * vn * nx; b.v.z -= 1.4 * vn * nz; }
    }
  }
}

// ---------------------------------------------------------------------------
// Meteor
// ---------------------------------------------------------------------------
const meteors = [];
const meteorGeo = new THREE.IcosahedronGeometry(0.35, 1);
function launchMeteor() {
  const T = randomWaterPoint(0.5);
  T.y = LEVEL;
  const from = T.clone().add(new THREE.Vector3(rand(-6, -3), 16, rand(-6, -3)));
  const mesh = new THREE.Mesh(meteorGeo, new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff6a1a', emissiveIntensity: 3, flatShading: true }));
  mesh.position.copy(from);
  block.add(mesh);
  meteors.push({ mesh, p: from, v: T.clone().sub(from).normalize().multiplyScalar(17) });
  toast('☄ Incoming!');
  sfx.whoosh();
}
let shake = 0;
function updateMeteors(dt, t) {
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    m.p.addScaledVector(m.v, dt);
    m.mesh.position.copy(m.p);
    m.mesh.rotation.x += dt * 8; m.mesh.rotation.y += dt * 6;
    burst(block.localToWorld(m.p.clone()), 6, 0.8, rand(0.02, 0.1), 0.04, 0.6, -0.5, [0.4, 0.8]);
    const sy = Math.abs(m.p.x) < HALF && Math.abs(m.p.z) < HALF ? surfaceY(m.p.x, m.p.z, t) : -99;
    if (m.p.y <= sy) {
      block.remove(m.mesh);
      meteors.splice(i, 1);
      // impact: crater in the jelly, a ring of spray, shockwave on everything nearby
      disturb(m.p.x, m.p.z, 1.6, 0.8);
      spawnSplash(m.p.x, sy, m.p.z, 180, 2.1);
      burst(block.localToWorld(m.p.clone().setY(sy + 0.3)), 260, 5, 0.06, 0.06, 0.6, 3);
      for (const b of bodies) {
        const dx = b.p.x - m.p.x, dz = b.p.z - m.p.z, d = Math.hypot(dx, dz);
        if (d < 4.5) {
          const k = (4.5 - d) / 4.5;
          b.v.x += dx / (d || 1) * k * 5; b.v.z += dz / (d || 1) * k * 5; b.v.y += k * 6;
          b.w.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
        }
      }
      for (const f of fishes) if (f.state === 'swim' && f.p.distanceTo(m.p) < 3) { f.state = 'jump'; f.v.set(rand(-2, 2), rand(5, 7), rand(-2, 2)); f.wasUnder = true; }
      kick(1.5); shake = 1; flash = Math.max(flash, 0.5);
      sfx.boom();
    }
  }
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
function kick(amount) { wob.v += amount * 6 * (0.4 + params.wobble); }
let bounce = { t: -1 };

function bigWave() {
  // a line source along an open-sea edge sends a plane wave across the block
  const side = Math.random() < 0.5;
  for (let u = -4.9; u <= 4.9; u += 0.25) {
    if (side) disturb(u, 4.75, 0.55, -0.45); else disturb(4.75, u, 0.55, -0.45);
  }
  kick(0.4); sfx.bloop(1.4);
  toast('🌊 Wave incoming!');
}

const actions = {
  duck: () => throwBody('duck'),
  ball: () => dropBody('ball'),
  crate: () => dropBody('crate'),
  rock: () => throwBody('rock'),
  meteor: () => launchMeteor(),
  wave: () => bigWave(),
  tip: () => {
    const a = rand(0, Math.PI * 2);
    tilt.vx += Math.cos(a) * 1.4; tilt.vz += Math.sin(a) * 1.4;
    kick(0.5); sfx.bloop(1.2); toast('Whoa — tipped!');
  },
  stir: () => {
    stir = 1;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; disturb(WC.x + Math.cos(a) * 1.4, WC.y + Math.sin(a) * 1.4, 0.5, 0.12); }
    sfx.bloop(0.8); toast('Stirring the sea…');
  },
  bounce: () => { if (bounce.t < 0) { bounce.t = 0; bounce.launched = false; sfx.boing(); } },
  wobble: () => { kick(1.6); sfx.bloop(1.5); disturb(0, 0, 3, 0.05); },
  magic: () => {
    magicQueue.push(...Array.from({ length: 7 }, (_, i) => i * 0.22));
    for (let i = 0; i < 5; i++) setTimeout(() => throwBody('duck'), 250 + i * 160);
    toast('✦ Magic! ✦');
  },
  clear: () => { [...bodies].forEach(b => { burst(block.localToWorld(b.p.clone()), 20, 1.5, Math.random(), 0.2); removeBody(b); }); sfx.chime(); },
};
const magicQueue = [];

document.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { sfx.unlock(); actions[b.dataset.act](); }));

const swWrap = document.getElementById('swatches');
FLAVORS.forEach((f, i) => {
  const b = document.createElement('button');
  b.className = 'sw' + (i === 0 ? ' on' : '');
  b.innerHTML = `<i style="background:${f.rainbow ? 'conic-gradient(#ff3b5c,#ffe53b,#4dff6b,#3bd8ff,#c45bff,#ff3b5c)' : `linear-gradient(135deg, ${f.accent}, ${f.color})`}"></i>${f.name}`;
  b.addEventListener('click', () => setFlavor(i));
  swWrap.appendChild(b);
});
function setFlavor(i) {
  flavorIndex = i;
  const f = FLAVORS[i];
  flavorTarget.set(f.color); accentTarget.set(f.accent);
  [...swWrap.children].forEach((c, k) => c.classList.toggle('on', k === i));
  document.getElementById('flavorName').textContent = f.name;
  document.documentElement.style.setProperty('--flavor', f.color);
  document.documentElement.style.setProperty('--flavor2', f.accent);
  kick(0.7);
  disturb(WC.x, WC.y, 0.6, 0.12);
  burst(block.localToWorld(new THREE.Vector3(WC.x, LEVEL + 0.4, WC.y)), 120, 2.6, new THREE.Color(f.color).getHSL({}).h, 0.08);
  sfx.bloop(0.9);
}

function segment(attr, cb) {
  document.querySelectorAll(`[data-${attr}]`).forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll(`[data-${attr}]`).forEach(o => o.classList.toggle('on', o === b));
    cb(b.dataset[attr]);
  }));
}
segment('sky', k => { skyKey = k; document.body.classList.toggle('night', k === 'night'); });
segment('weather', k => { weatherKey = k; if (k === 'storm') nextLightning = 1.5; toast({ clear: '☀ Clear skies', rain: '🌧 Rain', storm: '⛈ Storm!' }[k]); });
segment('tool', k => { tool = k; canvas.classList.toggle('finger', k === 'finger'); toast(k === 'finger' ? 'ลากในน้ำเพื่อวาดคลื่น' : 'ลากเพื่อหมุนกล้อง'); });

for (const id of ['wobble', 'waves', 'wind', 'sparkle']) {
  const el = document.getElementById(id), out = document.getElementById('o-' + id);
  const sync = () => { params[id] = el.value / 100; out.textContent = el.value; el.style.setProperty('--p', el.value + '%'); };
  el.addEventListener('input', sync); sync();
}
document.querySelectorAll('[data-tg]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.tg; params[k] = !params[k]; b.classList.toggle('on', params[k]);
  if (k === 'spin') controls.autoRotate = params.spin;
  if (k === 'boat') boat.visible = params.boat;
  if (k === 'sound' && params.sound) { sfx.unlock(); sfx.quack(); }
}));

const panel = document.getElementById('panel'), pt = document.getElementById('panelToggle');
pt.addEventListener('click', () => { panel.classList.toggle('open'); pt.classList.toggle('up'); pt.textContent = panel.classList.contains('open') ? '✕ Close' : '✦ Controls'; });

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  const map = { d: 'duck', b: 'ball', c: 'crate', r: 'rock', x: 'meteor', w: 'wave', t: 'tip', s: 'stir', j: 'bounce', m: 'magic', q: 'wobble' };
  if (map[k]) { sfx.unlock(); actions[map[k]](); }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= FLAVORS.length) setFlavor(n - 1);
});

// ---- pointer: grab & throw bodies, finger-paint waves, click ripples ----
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const dragPlane = new THREE.Plane();
let downAt = null, grabbed = null, fingering = false, lastFinger = null, lastFingerT = 0;

function setRay(e) {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function bodyUnder(e) {
  setRay(e);
  const hits = ray.intersectObjects(bodies.map(b => b.mesh), true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !bodies.some(b => b.mesh === o)) o = o.parent;
  return bodies.find(b => b.mesh === o) || null;
}
function waterUnder(e) {
  setRay(e);
  const h = ray.intersectObject(waterTop, false)[0];
  if (!h) return null;
  const local = block.worldToLocal(h.point.clone());
  return isWater(local.x, local.z) ? local : null;
}

// capture phase so we can claim the gesture before OrbitControls sees it
canvas.addEventListener('pointerdown', e => {
  sfx.unlock();
  downAt = [e.clientX, e.clientY];
  const b = bodyUnder(e);
  if (b) {
    grabbed = b;
    b.held = true;
    b.w.set(rand(-2, 2), rand(-2, 2), rand(-2, 2));
    const wp = block.localToWorld(b.p.clone());
    wp.y += 0.9;
    dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), wp);
    b.target = b.p.clone().setY(b.p.y + 0.9);
    controls.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    if (b.kind === 'duck') sfx.squeak();
    return;
  }
  if (tool === 'finger') {
    const w = waterUnder(e);
    if (w) {
      fingering = true; lastFinger = w; lastFingerT = performance.now();
      controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
    }
  }
}, { capture: true });

canvas.addEventListener('pointermove', e => {
  if (grabbed) {
    setRay(e);
    const hit = new THREE.Vector3();
    if (ray.ray.intersectPlane(dragPlane, hit)) {
      const local = block.worldToLocal(hit);
      local.x = clamp(local.x, -6, 6); local.z = clamp(local.z, -6, 6);
      if (Math.abs(local.x) < HALF && Math.abs(local.z) < HALF) local.y = Math.max(local.y, terrainH(local.x, local.z) + grabbed.cfg.r);
      grabbed.target.copy(local);
    }
    return;
  }
  if (fingering) {
    const w = waterUnder(e);
    const now = performance.now();
    if (w && lastFinger) {
      const dt = Math.max(0.008, (now - lastFingerT) / 1000);
      const dist = Math.hypot(w.x - lastFinger.x, w.z - lastFinger.z);
      const speed = dist / dt;
      const steps = Math.max(1, Math.ceil(dist / 0.12));
      for (let s = 1; s <= steps; s++) {
        const x = lerp(lastFinger.x, w.x, s / steps), z = lerp(lastFinger.z, w.z, s / steps);
        disturb(x, z, 0.34, clamp(speed * 0.007, 0.01, 0.09));
      }
      if (speed > 4 && Math.random() < 0.5) spawnSplash(w.x, w.y, w.z, 2, 0.45, new THREE.Vector3(w.x - lastFinger.x, 0, w.z - lastFinger.z).normalize());
      // drag floaters along with the finger
      for (const b of bodies) {
        const d = Math.hypot(b.p.x - w.x, b.p.z - w.z);
        if (d < 0.6 && b.f > 0) { b.v.x += (w.x - lastFinger.x) / dt * 0.25 * (1 - d / 0.6); b.v.z += (w.z - lastFinger.z) / dt * 0.25 * (1 - d / 0.6); }
      }
    }
    if (w) { lastFinger = w; lastFingerT = now; }
    return;
  }
  // hover feedback
  if (e.buttons === 0 && (e.pointerType === 'mouse')) {
    canvas.style.cursor = bodyUnder(e) ? 'grab' : (tool === 'finger' ? 'crosshair' : '');
  }
});

function endPointer(e) {
  const moved = downAt ? Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) : 99;
  if (grabbed) {
    const b = grabbed;
    b.held = false;
    b.v.y += 1.2;
    const sp = b.v.length();
    if (sp > 16) b.v.multiplyScalar(16 / sp);
    b.w.set(rand(-6, 6), rand(-6, 6), rand(-6, 6)).multiplyScalar(clamp(sp / 6, 0.2, 1.5));
    if (sp > 6 && b.kind === 'duck') sfx.quack();
    grabbed = null;
    controls.enabled = true;
    canvas.style.cursor = '';
    downAt = null;
    return;
  }
  if (fingering) { fingering = false; controls.enabled = true; downAt = null; return; }
  if (downAt && moved < 6 && e.type === 'pointerup') {
    setRay(e);
    const hits = ray.intersectObjects([waterTop, terrain, villa], true);
    if (hits.length) {
      const h = hits[0];
      const local = block.worldToLocal(h.point.clone());
      if (h.object === waterTop && isWater(local.x, local.z)) {
        disturb(local.x, local.z, 0.45, 0.16);
        spawnSplash(local.x, local.y, local.z, 12, 0.6);
        kick(0.1); sfx.bloop(0.5);
      } else {
        burst(h.point, 70, 2.2, Math.random(), 0.3);
        sfx.chime();
      }
    }
  }
  downAt = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('dblclick', e => {
  if (tool === 'finger') return;
  const w = waterUnder(e);
  if (w) throwBody('duck', w);
});

function updateCounts() {
  const counts = { duck: 0, ball: 0, crate: 0, rock: 0 };
  bodies.forEach(b => counts[b.kind]++);
  document.getElementById('counts').innerHTML = Object.entries(counts).map(([k, n]) => `<span>${KINDS[k].label} <b>${n}</b></span>`).join('');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

// tiny synth for bloops, quacks, thuds and thunder
const sfx = (() => {
  let ctx = null, noise = null;
  const ok = () => params.sound && ctx;
  const env = (g, t, peak, dur) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); };
  const noiseSrc = () => {
    if (!noise) { noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(); s.buffer = noise; return s;
  };
  let last = 0;
  const throttle = (ms) => { const n = performance.now(); if (n - last < ms) return true; last = n; return false; };
  return {
    unlock() { if (!ctx && params.sound) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { /* no audio */ } } },
    bloop(p = 1) {
      if (!ok() || throttle(40)) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(rand(500, 760) / Math.sqrt(p), t); o.frequency.exponentialRampToValueAtTime(140, t + 0.18);
      env(g, t, 0.16, 0.25);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.3);
    },
    quack() {
      if (!ok()) return;
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
      o.type = 'sawtooth'; o.frequency.setValueAtTime(rand(380, 460), t); o.frequency.linearRampToValueAtTime(260, t + 0.16);
      f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 3;
      env(g, t, 0.2, 0.2);
      o.connect(f).connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.22);
    },
    squeak() {
      if (!ok()) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
      o.type = 'square'; o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.12);
      env(g, t, 0.05, 0.14);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.15);
    },
    thud(p = 0.5) {
      if (!ok() || throttle(60)) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
      env(g, t, 0.25 * p, 0.16);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.18);
    },
    boing() {
      if (!ok()) return;
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
      o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(420, t + 0.25); o.frequency.exponentialRampToValueAtTime(180, t + 0.5);
      env(g, t, 0.22, 0.55);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.6);
    },
    whoosh() {
      if (!ok()) return;
      const s = noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
      f.type = 'bandpass'; f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.9);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      s.connect(f).connect(g).connect(ctx.destination); s.start(t); s.stop(t + 1.05);
    },
    boom() {
      if (!ok()) return;
      const s = noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
      f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(80, t + 1.2);
      env(g, t, 0.6, 1.4);
      s.connect(f).connect(g).connect(ctx.destination); s.start(t); s.stop(t + 1.5);
    },
    thunder() {
      if (!ok()) return;
      const s = noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
      f.type = 'lowpass'; f.frequency.value = 260;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      s.connect(f).connect(g).connect(ctx.destination); s.start(t); s.stop(t + 2);
    },
    chime() {
      if (!ok()) return;
      const t = ctx.currentTime;
      [880, 1320, 1760].forEach((fr, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = fr * rand(0.98, 1.02);
        env(g, t + i * 0.06, 0.08, 0.5);
        o.connect(g).connect(ctx.destination); o.start(t + i * 0.06); o.stop(t + i * 0.06 + 0.55);
      });
    },
  };
})();

// ---------------------------------------------------------------------------
// Sky & weather transitions
// ---------------------------------------------------------------------------
const skyNow = {
  top: new THREE.Color(SKIES.day.top), mid: new THREE.Color(SKIES.day.mid), bot: new THREE.Color(SKIES.day.bot),
  sun: new THREE.Color(SKIES.day.sun), sunI: SKIES.day.sunI, sunPos: new THREE.Vector3(...SKIES.day.sunPos),
  hemiI: SKIES.day.hemiI, night: 0, rainbow: SKIES.day.rainbow,
};
const _tc = new THREE.Color(), _sp = new THREE.Vector3();
const GLOOM = new THREE.Color('#3b3552');
function updateSky(dt) {
  const s = SKIES[skyKey], k = clamp(dt * 2.2, 0, 1);
  const w = WEATHER[weatherKey];
  for (const key of ['rain', 'gloom', 'wind', 'waves']) weatherNow[key] = lerp(weatherNow[key], w[key], clamp(dt * 0.8, 0, 1));
  const gl = weatherNow.gloom;
  skyNow.top.lerp(_tc.set(s.top).lerp(GLOOM, gl), k);
  skyNow.mid.lerp(_tc.set(s.mid).lerp(GLOOM, gl * 0.9), k);
  skyNow.bot.lerp(_tc.set(s.bot).lerp(GLOOM, gl * 0.8), k);
  skyNow.sun.lerp(_tc.set(s.sun), k);
  skyNow.sunI = lerp(skyNow.sunI, s.sunI * (1 - gl * 0.6), k);
  skyNow.sunPos.lerp(_sp.set(...s.sunPos), k);
  skyNow.hemiI = lerp(skyNow.hemiI, s.hemiI * (1 - gl * 0.35), k);
  skyNow.night = lerp(skyNow.night, s.night, k);
  skyNow.rainbow = lerp(skyNow.rainbow, s.rainbow * (1 - gl), k);

  flash = Math.max(0, flash - dt * 3.5);
  boltMat.opacity = Math.max(0, boltMat.opacity - dt * 5);
  skyUniforms.top.value.copy(skyNow.top); skyUniforms.mid.value.copy(skyNow.mid); skyUniforms.bot.value.copy(skyNow.bot);
  skyUniforms.flash.value = flash * 0.6;
  sun.color.copy(skyNow.sun); sun.intensity = skyNow.sunI + flash * 3; sun.position.copy(skyNow.sunPos);
  hemi.intensity = skyNow.hemiI + flash * 2;
  hemi.color.copy(skyNow.top).lerp(_tc.set('#ffffff'), 0.5);
  hemi.groundColor.copy(skyNow.bot);
  starMat.opacity = skyNow.night * (1 - gl);
  const n = skyNow.night;
  windowMats.forEach(m => { m.emissiveIntensity = Math.max(n, gl * 0.7) * 1.6; });
  villa.userData.lamp.intensity = Math.max(n, gl * 0.7) * 6;
  mushCaps.forEach(m => { m.emissiveIntensity = 0.2 + Math.max(n, gl * 0.6) * 1.4; });
  nightGlow = Math.max(n, gl * 0.5);
  rainbow.children.forEach(m => { m.material.opacity = skyNow.rainbow; });
  underGlow.intensity = 25 + n * 40;
  bloom.strength = 0.5 + n * 0.45 + flash * 0.6;
  cloudMat.color.set('#ffffff').lerp(_tc.set('#6c6787'), gl);
  cloudMat.emissiveIntensity = 0.25 * (1 - gl);
  rainMat.opacity = clamp(weatherNow.rain * 1.4, 0, 0.55);
}

function updateRain(dt, t) {
  const intensity = weatherNow.rain;
  const active = Math.floor(RAIN * intensity);
  rainGeo.setDrawRange(0, active * 2);
  if (!active) return;
  const slantX = windVec.x * 0.12, slantZ = windVec.y * 0.12;
  const wy = world.position.y;
  const tmp = new THREE.Vector3();
  for (let i = 0; i < active; i++) {
    const d = rainDrops[i];
    d.y -= d.sp * dt;
    d.x += slantX * d.sp * dt; d.z += slantZ * d.sp * dt;
    const inside = Math.abs(d.x) < WE && Math.abs(d.z) < WE;
    const floor = inside ? Math.max(LEVEL, terrainH(d.x, d.z)) + wy : -6;
    if (d.y < floor) {
      if (inside && isWater(d.x, d.z)) {
        tmp.set(d.x, d.y, d.z);
        block.worldToLocal(tmp);
        disturb(tmp.x, tmp.z, 0.18, 0.012);
        if (Math.random() < 0.06) spawnSplash(tmp.x, surfaceY(tmp.x, tmp.z, t), tmp.z, 1, 0.25);
      }
      d.x = rand(-7, 7); d.z = rand(-7, 7); d.y = rand(10, 14);
    }
    const j = i * 6;
    rainPos[j] = d.x; rainPos[j + 1] = d.y; rainPos[j + 2] = d.z;
    rainPos[j + 3] = d.x - slantX * 0.35; rainPos[j + 4] = d.y + 0.35; rainPos[j + 5] = d.z - slantZ * 0.35;
  }
  rainGeo.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _wq = new THREE.Quaternion();
let intro = 0;
let simTime = 0;

function tick() {
  frame(Math.min(clock.getDelta(), 0.05));
  composer.render();
  requestAnimationFrame(tick);
}

function frame(dt) {
  simTime += dt;
  const t = simTime;
  skyUniforms.time.value = t;
  causticUniforms.uTime.value = t;
  causticUniforms.uLevel.value = LEVEL + (seaScaleY - 1) * (LEVEL - SEABED);

  // flavour fade
  flavorCol.lerp(flavorTarget, clamp(dt * 3, 0, 1));
  accentCol.lerp(accentTarget, clamp(dt * 3, 0, 1));
  causticUniforms.uCaustic.value.copy(accentCol).lerp(foam, 0.4).multiplyScalar(0.9 + nightGlow * 0.6);
  waterMat.emissive.copy(flavorCol); wallMat.emissive.copy(flavorCol);
  waterMat.emissiveIntensity = wallMat.emissiveIntensity = 0.42 + nightGlow * 0.45;
  poolMat.color.copy(flavorCol); poolMat.emissive.copy(flavorCol);
  if (FLAVORS[flavorIndex].rainbow) {
    _c.setHSL((t * 0.1) % 1, 1, 0.55);
    poolMat.color.copy(_c); poolMat.emissive.copy(_c); waterMat.emissive.copy(_c); wallMat.emissive.copy(_c);
    waterMat.emissiveIntensity = wallMat.emissiveIntensity = 0.08 + nightGlow * 0.15;
    causticUniforms.uCaustic.value.copy(_c).lerp(foam, 0.4);
  }

  // wind: slowly veering direction, gusty in storms
  const windStrength = clamp(params.wind + weatherNow.wind, 0, 1.8) * (1 + 0.35 * Math.sin(t * 1.7) * weatherNow.wind);
  const wa = t * 0.05 + 0.6;
  windVec.set(Math.cos(wa), Math.sin(wa)).multiplyScalar(windStrength);
  weatherWaves = weatherNow.waves;
  // cat's paws: the wind roughens the surface
  if (Math.random() < windStrength * 1.2 * dt * 60 * 0.15) { const p = randomWaterPoint(0.1); disturb(p.x, p.z, 0.3, 0.008 * windStrength); }

  // jelly spring
  const stiff = lerp(70, 18, params.wobble), damp = lerp(4.5, 1.4, params.wobble);
  wob.v += (-stiff * wob.s - damp * wob.v) * dt;
  wob.s += wob.v * dt;
  wob.s = clamp(wob.s, -0.6, 0.6);
  seaScaleY = 1 + wob.s * 0.55;
  sea.scale.set(1 - wob.s * 0.04, 1, 1 - wob.s * 0.04);
  block.scale.set(1 - wob.s * 0.03, 1 + wob.s * 0.05, 1 - wob.s * 0.03);

  // tipping + sloshing
  tilt.vx += (-26 * tilt.x - 3.2 * tilt.vx) * dt; tilt.vz += (-26 * tilt.z - 3.2 * tilt.vz) * dt;
  tilt.x += tilt.vx * dt; tilt.z += tilt.vz * dt;
  const tgx = -tilt.z * 0.55, tgz = tilt.x * 0.55;
  slosh.vx += ((tgx - slosh.x) * 14 - slosh.vx * 1.6) * dt; slosh.vz += ((tgz - slosh.z) * 14 - slosh.vz * 1.6) * dt;
  slosh.x += slosh.vx * dt; slosh.z += slosh.vz * dt;
  stir = Math.max(0, stir - dt * 0.22);

  // intro rise, bob, jelly bounce, camera shake
  intro = Math.min(1, intro + dt * 0.7);
  const ease = 1 - Math.pow(1 - intro, 3);
  let bounceY = 0;
  if (bounce.t >= 0) {
    bounce.t += dt;
    const bt = bounce.t / 0.7;
    bounceY = Math.sin(Math.min(1, bt) * Math.PI) * 1.4;
    // the block decelerates at the top of the hop: everything loose keeps flying up
    if (!bounce.launched && bt > 0.3) {
      bounce.launched = true;
      for (const b of bodies) if (!b.held && (b.ground || b.f > 0)) { b.v.y += rand(3.5, 5.5); b.v.x += rand(-0.6, 0.6); b.v.z += rand(-0.6, 0.6); b.w.set(rand(-9, 9), rand(-9, 9), rand(-9, 9)); }
      for (let i = 0; i < 30; i++) { const p = randomWaterPoint(0.1); disturb(p.x, p.z, 0.4, rand(-0.12, 0.12)); }
    }
    if (bt >= 1) { bounce.t = -1; kick(1.2); disturb(0, 0, 6, 0.04); sfx.thud(1); }
  }
  shake = Math.max(0, shake - dt * 2.5);
  world.position.set(rand(-1, 1) * shake * 0.25, Math.sin(t * 0.8) * 0.18 - (1 - ease) * 6 + bounceY + rand(-1, 1) * shake * 0.25, rand(-1, 1) * shake * 0.25);
  world.rotation.set(tilt.x, (1 - ease) * -1.2, tilt.z);
  world.updateMatrixWorld();

  // gravity in block space (so tipping the block makes things roll)
  world.getWorldQuaternion(_wq).invert();
  gLocal.set(0, -G, 0).applyQuaternion(_wq);

  // water simulation (two half steps for stability)
  simStep(dt / 2); simStep(dt / 2);

  // rigid bodies: substeps for stable contacts
  const SUB = 3, sdt = dt / SUB;
  for (let s = 0; s < SUB; s++) {
    for (const b of bodies) stepBody(b, sdt, t);
    collideBodies();
  }
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (b.p.y < -25 || Math.abs(b.p.x) > 40 || Math.abs(b.p.z) > 40) { removeBody(b); continue; }
    orientBody(b, dt, t);
    b.mesh.position.copy(b.p);
  }

  updateSea(t);
  updateFish(dt, t);
  updateBoat(dt, t);
  updateMeteors(dt, t);
  updateRain(dt, t);

  if (weatherKey === 'storm') { nextLightning -= dt; if (nextLightning <= 0) { lightning(); nextLightning = rand(2.5, 7); } }

  // palms sway with the wind
  for (const p of palms) {
    const w = windStrength;
    p.crown.rotation.z = Math.sin(t * p.sp * (1 + w) + p.ph) * (0.03 + w * 0.12) + windVec.x * 0.05;
    p.crown.rotation.x = Math.cos(t * p.sp * 0.8 * (1 + w) + p.ph) * (0.02 + w * 0.08) - windVec.y * 0.05;
    p.crown.children.forEach((fr, i) => { if (fr.userData.frond) fr.rotation.z = Math.sin(t * 2.4 * (0.5 + w) + i + p.ph) * 0.05 * (0.3 + w); });
  }

  // splash droplets: ballistic, and they make tiny ripples when they fall back in
  for (let i = 0; i < SPL; i++) {
    const sp = splash[i];
    if (sp.life <= 0) continue;
    sp.life -= dt;
    sp.v.y -= G * dt;
    sp.p.addScaledVector(sp.v, dt);
    if (sp.v.y < 0 && isWater(sp.p.x, sp.p.z) && sp.p.y < surfaceY(sp.p.x, sp.p.z, t)) {
      disturb(sp.p.x, sp.p.z, 0.15, 0.006 * sp.s);
      sp.life = 0;
    }
    const sc = sp.life > 0 ? sp.s * Math.min(1, sp.life * 2.5) : 0;
    m4.compose(sp.p, _q.identity(), _s.setScalar(sc));
    splashMesh.setMatrixAt(i, m4);
  }
  splashMesh.instanceMatrix.needsUpdate = true;

  // magic fireworks
  for (let i = magicQueue.length - 1; i >= 0; i--) {
    magicQueue[i] -= dt;
    if (magicQueue[i] <= 0) {
      magicQueue.splice(i, 1);
      burst(new THREE.Vector3(rand(-5, 5), rand(5, 9), rand(-5, 5)), 220, rand(3, 4.5));
      kick(0.25); sfx.chime();
    }
  }
  for (let i = 0; i < SPARKS; i++) {
    const s = sparks[i];
    if (s.life <= 0) continue;
    s.life -= dt;
    s.v.y -= s.grav * dt; s.v.multiplyScalar(1 - 1.2 * dt);
    const j = i * 3;
    sparkPos[j] += s.v.x * dt; sparkPos[j + 1] += s.v.y * dt; sparkPos[j + 2] += s.v.z * dt;
    const k = s.life > 0 ? Math.pow(s.life / s.max, 1.4) * (0.75 + 0.25 * Math.sin(t * 30 + i)) : 0;
    sparkCol[j] = s.c.r * k; sparkCol[j + 1] = s.c.g * k; sparkCol[j + 2] = s.c.b * k;
    if (s.life <= 0) sparkPos[j + 1] = 9999;
  }
  sparkGeo.attributes.position.needsUpdate = true;
  sparkGeo.attributes.color.needsUpdate = true;

  // ambient sparkles / fireflies
  const visible = Math.floor(AMB * params.sparkle);
  ambGeo.setDrawRange(0, visible);
  const warm = _c2.set('#ffd36b');
  for (let i = 0; i < visible; i++) {
    const a = amb[i];
    a.y += a.sp * dt; if (a.y > 9) a.y = -5;
    const j = i * 3;
    ambPos[j] = a.x + Math.sin(t * 0.5 + a.ph) * 0.4 + windVec.x * 0.3;
    ambPos[j + 1] = a.y + world.position.y;
    ambPos[j + 2] = a.z + Math.cos(t * 0.4 + a.ph) * 0.4 + windVec.y * 0.3;
    const tw = Math.pow(0.5 + 0.5 * Math.sin(t * a.tw + a.ph), 3) * (0.6 + nightGlow * 0.8);
    _c.copy(a.c).lerp(warm, nightGlow * 0.5);
    ambCol[j] = _c.r * tw; ambCol[j + 1] = _c.g * tw; ambCol[j + 2] = _c.b * tw;
  }
  ambGeo.attributes.position.needsUpdate = true;
  ambGeo.attributes.color.needsUpdate = true;

  for (const c of crystals) {
    c.a += c.sp * dt;
    c.m.position.set(Math.cos(c.a) * c.r, c.y + Math.sin(t * 1.2 + c.ph) * 0.5 + world.position.y, Math.sin(c.a) * c.r);
    c.m.rotation.y += dt * 0.9; c.m.rotation.x = Math.sin(t + c.ph) * 0.3;
  }
  for (const c of clouds) {
    c.a += c.sp * (0.5 + windStrength * 1.5) * dt;
    c.g.position.set(Math.cos(c.a) * c.r, c.y + Math.sin(t * 0.4 + c.r) * 0.3, Math.sin(c.a) * c.r);
    c.g.lookAt(0, c.g.position.y, 0);
  }
  rainbow.position.y = -2 + world.position.y;

  updateSky(dt);
  controls.update();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.position.sub(controls.target).setLength(camDist()).add(controls.target);
});

// first impression: a welcome wobble and a few floaters
setTimeout(() => kick(1.2), 900);
setTimeout(() => throwBody('duck'), 1500);
setTimeout(() => throwBody('duck'), 2100);
setTimeout(() => dropBody('ball'), 2700);
setTimeout(() => dropBody('crate'), 3300);

updateCounts();
tick();
const hideLoader = () => document.getElementById('loader').classList.add('gone');
requestAnimationFrame(hideLoader);
setTimeout(hideLoader, 1200);

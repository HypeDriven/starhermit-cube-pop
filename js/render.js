/* Cube Pop — Three.js renderer (ES module).
 * Cheerful toy studio: a wall of soft-edged cubes on a wooden table.
 * Instanced cubes per color, pooled particles, authored fixed camera with
 * drag-orbit, graphics presets (js/gfx.js) with an optional post chain,
 * deterministic layout (visual seed only
 * decorates the studio, never the board).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const Gfx = window.CPGfx;

const SPACING = 1.04;          // cube pitch on the wall
const CUBE = 0.94;             // cube edge
const BASE_Y = 1.05;           // height of the wall's bottom row (sits on the table top, never inside it)
const POP_MS = 160, FALL_MS = 220, BLAST_MS = 260, SHUFFLE_MS = 450;

const MOTE_COUNT = 70;         // ambient dust motes drifting in the key light

// Colour grade + vignette (display-space colours in, display-space out):
// gentle S-curve, a touch more saturation, warm highlights / cool shadows.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.2 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.18);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.97, 0.98, 1.03), vec3(1.03, 1.0, 0.96), smoothstep(0.2, 0.8, l));
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.0, 0.85));
      c *= 1.0 - uVignette * smoothstep(0.38, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`
};

// Soft round sprite for particles and motes (procedural, authored once).
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Low-contrast wallpaper: soft vertical stripes and a scatter of tiny dots,
// tinted from the theme's wall colour so every theme keeps its mood.
function wallpaperTexture(wallHex) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const base = new THREE.Color(wallHex);
  const css = (col) => '#' + col.getHexString();
  g.fillStyle = css(base);
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = css(base.clone().multiplyScalar(0.94));
  for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 26, 256);
  g.fillStyle = css(base.clone().lerp(new THREE.Color(0xffffff), 0.25));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 60; i++) {
    g.beginPath();
    g.arc(45 + Math.floor(rnd() * 4) * 64 + (rnd() - 0.5) * 8, rnd() * 256, 1.6, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 5);
  t.anisotropy = 4;
  return t;
}

// Floorboards: plank seams with a little per-plank value noise.
function floorTexture(floorHex) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const base = new THREE.Color(floorHex);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = '#' + base.clone().multiplyScalar(0.93 + rnd() * 0.12).getHexString();
    g.fillRect(0, i * 32, 256, 32);
    g.fillStyle = '#' + base.clone().multiplyScalar(0.8).getHexString();
    g.fillRect(0, i * 32, 256, 2);
    g.fillRect(Math.floor(rnd() * 256), i * 32, 2, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8);
  t.anisotropy = 4;
  return t;
}

function hex(n) { return new THREE.Color(n); }

// Soft-edged cube: rounded-square extrude with bevel (procedural, authored).
// The bevel grows the outline, so the shape is inset by it and the finished
// cube measures exactly `size` (neighbours on the wall never interpenetrate).
function roundedCubeGeo(size, detailed) {
  const b = size * 0.1, r = size * 0.1, h = size / 2 - b - r;
  const s = new THREE.Shape();
  s.moveTo(-h, -h - r);
  s.lineTo(h, -h - r); s.absarc(h, -h, r, -Math.PI / 2, 0);
  s.lineTo(h + r, h); s.absarc(h, h, r, 0, Math.PI / 2);
  s.lineTo(-h, h + r); s.absarc(-h, h, r, Math.PI / 2, Math.PI);
  s.lineTo(-h - r, -h); s.absarc(-h, -h, r, Math.PI, Math.PI * 1.5);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: size - 2 * b, bevelEnabled: true,
    bevelThickness: b, bevelSize: b,
    bevelSegments: detailed ? 4 : 2, curveSegments: detailed ? 8 : 5
  });
  g.center();
  return g;
}

function starGeo(radius, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? radius : radius * 0.45;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.center();
  return g;
}

// Per-color charm shapes reinforce color (accessibility: shape ≠ color-only).
function charmGeo(idx) {
  switch (idx % 6) {
    case 0: return new THREE.SphereGeometry(0.14, 10, 8);                    // cherry: ball
    case 1: return starGeo(0.18, 0.07);                                      // lemon: star
    case 2: return new THREE.ConeGeometry(0.14, 0.26, 8);                    // leaf: cone
    case 3: return new THREE.OctahedronGeometry(0.16);                       // sky: diamond
    case 4: return new THREE.TorusGeometry(0.13, 0.05, 6, 12);               // grape: ring
    default: return new THREE.IcosahedronGeometry(0.15);                     // tangerine: gem
  }
}

export class BoardRenderer {
  constructor(container, opts) {
    this.container = container;
    this.opts = opts || {};
    this.onPick = opts.onPick || function () {};
    this.onHover = opts.onHover || function () {};
    this.reducedMotion = false;
    this.gpu = this.opts.gpu || '';
    this.detected = this.opts.detected || 'balanced';
    this.q = Gfx.resolve(this.opts.graphics || {}, this.detected);
    this.size = [0, 0];
    this.pixelRatio = 1;
    this.adaptiveScale = 1;
    this._frames = [];
    this.fps = 0;
    this.postKey = null;
    this.composer = null;
    this.postFailed = false;
    this.clock = 0;              // ambient animation time (frozen under reduced motion)
    this._prm = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.entities = [];          // {key,color,special,x,y,z,scale,tx,ty,tz,tscale,specialMesh?}
    this.entityByCell = {};
    this.rows = 0; this.cols = 0;
    this.palette = null; this.colors = [];
    this.orbit = { yaw: 0, pitch: 0 };
    this.shake = 0;
    this.anims = [];             // timed entity tweens
    this.timers = [];
    this.focusCell = null; this.hoverGroup = []; this.hintCell = null;
    this.disposed = false;
    this._initGL();
    this._initScene();
    this._initParticles();
    this._initMotes();
    this._initInput();
    this._loadWoodTexture();
    this._applyGraphics();
    this._loop = this._loop.bind(this);
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  _initGL() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.dataset.gfxPreset = this.q.preset;
    this.container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.scene = new THREE.Scene();
    this._onResize = this._resize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._resize();
  }

  // Image-based lighting from a neutral studio room (built once, on demand).
  _envMap() {
    if (!this._envTex) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment(this.renderer);
      this._envTex = pmrem.fromScene(room, 0.04).texture;
      room.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      pmrem.dispose();
    }
    return this._envTex;
  }

  // Authored wood grain for the table top (assets/table-wood.webp). Loads
  // lazily; until it arrives (or if it fails) the flat theme colour stands.
  _loadWoodTexture() {
    this.woodTex = null;
    try {
      new THREE.TextureLoader().load('assets/table-wood.webp', (tex) => {
        if (this.disposed) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(3, 1);
        this.woodTex = tex;
        if (this.tableMesh) { this.tableMesh.material.map = tex; this.tableMesh.material.needsUpdate = true; }
      }, undefined, () => { /* keep flat colour */ });
    } catch (e) { /* texture is cosmetic */ }
  }

  _initScene() {
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.keyLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.keyLight.position.set(4, 8, 6);
    this.keyLight.castShadow = false;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.shadow.radius = 3;
    this.keyDir = new THREE.Vector3(4, 8, 6).normalize();
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);
    this.fillLight = new THREE.HemisphereLight(0xffffff, 0x8a6a4a, 0.9);
    this.scene.add(this.fillLight);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(this.ambient);
    // cool rim from the left so cube bevels read against the wall
    this.rimLight = new THREE.DirectionalLight(0xcfe0ff, 0.0);
    this.rimLight.position.set(-6, 4, 3);
    this.scene.add(this.rimLight);

    // environment group (rebuilt per theme)
    this.envGroup = new THREE.Group();
    this.world.add(this.envGroup);
    this.boardGroup = new THREE.Group();
    this.world.add(this.boardGroup);
    this.markerGroup = new THREE.Group();   // selection/ghost layer
    this.world.add(this.markerGroup);

    // picking plane (interaction layer; never intercepts cosmetic rays)
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({ visible: false }));
    this.pickPlane.position.z = CUBE / 2;
    this.world.add(this.pickPlane);
    this.raycaster = new THREE.Raycaster();

    // outline markers pool for group preview + focus ring
    this.markers = [];
    // Outline markers sit just behind the cube face and a little wider, so they read as a rim.
    const mGeo = new THREE.BoxGeometry(CUBE * 1.09, CUBE * 1.09, 0.06);
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(mGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.0, depthWrite: false }));
      m.visible = false;
      this.markerGroup.add(m);
      this.markers.push(m);
    }
    this.focusRing = new THREE.Mesh(
      new THREE.TorusGeometry(CUBE * 0.72, 0.045, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.focusRing.visible = false;
    this.markerGroup.add(this.focusRing);
  }

  _initParticles() {
    const cap = 2048;
    this.pCap = cap;
    const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3);
    this.pVel = new Float32Array(cap * 3);
    this.pLife = new Float32Array(cap);
    this.pHead = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.pGeo = g;
    this._dotTex = dotTexture();
    const m = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false });
    this.pMat = m;
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.raycast = function () {}; // cosmetic: never intercepts picking
    this.world.add(this.points);
    for (let i = 0; i < cap; i++) { pos[i * 3 + 1] = -100; }
  }

  // Ambient dust motes drifting slowly through the key light (background: animated).
  _initMotes() {
    const pos = new Float32Array(MOTE_COUNT * 3);
    this.moteSeed = [];
    for (let i = 0; i < MOTE_COUNT; i++) {
      const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 12543.123, c = Math.sin(i * 39.425) * 24634.634;
      this.moteSeed.push([a - Math.floor(a), b - Math.floor(b), c - Math.floor(c)]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.moteGeo = g;
    this.motes = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.07, map: this._dotTex, color: 0xfff1d0, transparent: true, opacity: 0.45, depthWrite: false }));
    this.motes.frustumCulled = false;
    this.motes.raycast = function () {};
    this.motes.visible = false;
    this.world.add(this.motes);
    this._updateMotes(0);
  }
  _updateMotes(t) {
    const pos = this.moteGeo.attributes.position.array;
    const w = Math.max(this.cols * SPACING + 3, 8), top = BASE_Y + Math.max(this.rows, 6) * SPACING + 1;
    for (let i = 0; i < MOTE_COUNT; i++) {
      const [a, b, c] = this.moteSeed[i];
      const y = ((b * top + t * (0.08 + a * 0.08)) % top);
      pos[i * 3] = (a - 0.5) * w + Math.sin(t * 0.3 + i) * 0.25;
      pos[i * 3 + 1] = y + 0.3;
      pos[i * 3 + 2] = -1.6 + c * 4.2;
    }
    this.moteGeo.attributes.position.needsUpdate = true;
  }

  spawnBurst(x, y, z, colorHex, count) {
    const high = this.q.particles === 'high';
    const n = Math.min(high ? Math.ceil(count * 1.5) : count, Gfx.PARTICLES[this.q.particles]);
    const c = hex(colorHex);
    const pos = this.pGeo.attributes.position.array;
    const col = this.pGeo.attributes.color.array;
    for (let k = 0; k < n; k++) {
      const i = this.pHead = (this.pHead + 1) % this.pCap;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      // High: every fifth particle is an over-bright sparkle that the bloom pass catches.
      const glow = high && k % 5 === 0 ? 2.6 : 1;
      col[i * 3] = glow > 1 ? glow : c.r; col[i * 3 + 1] = glow > 1 ? glow * 0.95 : c.g; col[i * 3 + 2] = glow > 1 ? glow * 0.8 : c.b;
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
      const sp = 1.5 + Math.random() * 2.5;
      this.pVel[i * 3] = Math.cos(a) * Math.cos(e) * sp;
      this.pVel[i * 3 + 1] = Math.abs(Math.sin(e)) * sp + 1.2;
      this.pVel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * sp * 0.5;
      this.pLife[i] = 0.7 + Math.random() * 0.4;
    }
  }

  // ---------- theme / environment ----------
  setTheme(palette, colorDefs, highContrast) {
    this.palette = palette;
    this._colorDefs = colorDefs;
    this._hc = highContrast;
    this.colors = colorDefs.map(d => highContrast ? d.colorHC : d.color);
    this.scene.background = hex(palette.wall);
    this.scene.fog = new THREE.Fog(hex(palette.fog), 18, 40);
    this.keyLight.color = hex(palette.light);

    // dispose previous env
    while (this.envGroup.children.length) {
      const ch = this.envGroup.children.pop();
      this.envGroup.remove(ch);
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material) {
        if (ch.material.map && ch.material.map !== this.woodTex) ch.material.map.dispose();
        ch.material.dispose();
      }
    }
    const P = palette;
    const detailed = this.q.detail === 'detailed';
    const mat = (c, rough) => new THREE.MeshStandardMaterial({ color: c, roughness: rough == null ? 0.8 : rough,
      metalness: 0.05, envMapIntensity: 0.2 });
    // floor
    const floorMat = mat(detailed ? 0xffffff : P.floor, 0.9);
    if (detailed) floorMat.map = floorTexture(P.floor);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true;
    this.envGroup.add(floor);
    // back wall
    const wallMat = mat(detailed ? 0xffffff : P.wall, 0.95);
    if (detailed) wallMat.map = wallpaperTexture(P.wall);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), wallMat);
    wall.position.set(0, 10, -2.2); wall.receiveShadow = true;
    this.envGroup.add(wall);
    if (detailed) {
      // skirting board where wall meets floor
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(60, 0.5, 0.12), mat(P.frame, 0.6));
      skirt.position.set(0, 0.23, -2.14); skirt.receiveShadow = true;
      this.envGroup.add(skirt);
    }
    // table under the wall
    const tableMat = mat(P.table, 0.7);
    if (this.woodTex) tableMat.map = this.woodTex;
    const table = new THREE.Mesh(new THREE.BoxGeometry(14, 0.5, 4), tableMat);
    table.position.set(0, 0.25, 0.8); table.receiveShadow = true; table.castShadow = true;
    this.envGroup.add(table);
    this.tableMesh = table;
    // two legs
    [-5.5, 5.5].forEach(x => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), mat(P.frame, 0.75));
      leg.position.set(x, -0.45, 0.8);
      this.envGroup.add(leg);
    });
    if (detailed) {
      // shelf + toy props (deterministic decor, seeded by theme palette)
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(20, 0.3, 1.2), mat(P.frame, 0.8));
      shelf.position.set(0, 7.6, -1.9);
      this.envGroup.add(shelf);
      const rngSeed = P.accent;
      for (let i = 0; i < 6; i++) {
        const pr = ((rngSeed >> (i * 3)) & 7) / 7;
        const prop = new THREE.Mesh(
          i % 2 ? new THREE.ConeGeometry(0.3, 0.7, 8) : new THREE.SphereGeometry(0.32, 10, 8),
          mat(i % 3 ? P.accent : P.metal, 0.6));
        prop.position.set(-8 + i * 3.2, 8.05 + pr * 0.1, -1.9);
        prop.castShadow = true;
        this.envGroup.add(prop);
      }
      // a little stack of toy blocks and a ring toy between the props
      const blockCols = [P.accent, 0xf2c14e, 0x5b8fd4];
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(roundedCubeGeo(0.42, true), new THREE.MeshPhysicalMaterial({
          color: blockCols[i], roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.25 }));
        b.position.set(-3.2 + (i === 2 ? 0.22 : i * 0.46), 7.97 + (i === 2 ? 0.43 : 0), -1.9);
        b.rotation.y = (i - 1) * 0.25;
        b.castShadow = true;
        this.envGroup.add(b);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.09, 10, 24), new THREE.MeshPhysicalMaterial({
        color: 0x8fd48f, roughness: 0.4, clearcoat: 0.5, envMapIntensity: 0.25 }));
      ring.position.set(3.4, 8.1, -1.9); ring.rotation.x = -Math.PI / 2 + 0.25;
      ring.castShadow = true;
      this.envGroup.add(ring);
    }
    this._rebuildBoardMeshes();
  }

  // ---------- graphics settings ----------
  /** Apply saved graphics settings ({preset, render_scale, adaptive, show_fps, <category>}). */
  setGraphics(saved, detected, gpu) {
    if (detected) this.detected = detected;
    if (gpu) this.gpu = gpu;
    const key = JSON.stringify(saved || {}) + '|' + this.detected;
    if (key === this._gfxKey) return; // unrelated settings changed
    this._gfxKey = key;
    const before = this.q;
    this.q = Gfx.resolve(saved || {}, this.detected);
    this._applyGraphics();
    if (this.palette && (before.detail !== this.q.detail)) {
      this.setTheme(this.palette, this._colorDefs || [], this._hc);
    }
  }

  _applyGraphics() {
    const g = this.q;
    const size = Gfx.SHADOW_MAP[g.shadows];
    const wasShadow = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = size > 0;
    this.keyLight.castShadow = size > 0;
    if (size > 0 && this.keyLight.shadow.mapSize.x !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      if (this.keyLight.shadow.map) { this.keyLight.shadow.map.dispose(); this.keyLight.shadow.map = null; }
    }
    // Image-based lighting replaces most of the flat fill when reflections are on.
    const ibl = g.reflections === 'on';
    this.scene.environment = ibl ? this._envMap() : null;
    this.fillLight.intensity = ibl ? 0.7 : 0.9;
    this.ambient.intensity = ibl ? 0.1 : 0.25;
    this.rimLight.intensity = g.detail === 'detailed' ? 0.6 : 0;
    this.motes.visible = g.background === 'animated';
    // High particles: larger soft round confetti; Low keeps the original cheap squares.
    this.pMat.map = g.particles === 'high' ? this._dotTex : null;
    this.pMat.size = g.particles === 'high' ? 0.16 : 0.09;
    this.pMat.needsUpdate = true;
    this.renderer.domElement.dataset.gfxPreset = g.preset;
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this.postFailed = false;
    this._fpsVisible(g.showFps);
    if (wasShadow !== this.renderer.shadowMap.enabled) {
      this.scene.traverse(o => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; });
      });
    }
  }

  /** What the settings panel shows: GPU, auto choice, resolved tiers, cost and frame rate. */
  graphicsInfo() {
    const px = [Math.round(this.size[0] * this.pixelRatio), Math.round(this.size[1] * this.pixelRatio)];
    return {
      gpu: this.gpu || '', detected: this.detected, resolved: this.q,
      summary: Gfx.describe(this.q, px), pixels: px,
      fps: Math.round(this.fps || 0), adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed
    };
  }

  _fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.appendChild(el);
    }
    if (el) el.hidden = !on;
  }

  _postKey(w, h) {
    const g = this.q;
    return g.post && !this.postFailed ? [g.ao, g.bloom, g.grade, g.antialias, w, h, this.pixelRatio].join('|') : 'none';
  }

  _buildPost(w, h) {
    const g = this.q;
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (!g.post || this.postFailed) return;
    try {
      const pw = Math.max(1, Math.round(w * this.pixelRatio)), ph = Math.max(1, Math.round(h * this.pixelRatio));
      const target = new THREE.WebGLRenderTarget(pw, ph, {
        type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0 });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(this.pixelRatio);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const hi = g.ao === 'high';
        const ao = new GTAOPass(this.scene, this.camera, pw, ph);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.85;
        ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.2, thickness: 1.0, scale: 1.0, samples: hi ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8 });
        composer.addPass(ao);
      }
      // High threshold: only fuse sparks, sparkles and hot highlights bloom.
      if (g.bloom === 'on') composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.4, 0.9));
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      composer.addPass(new OutputPass());
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass(pw, ph));
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch (e) {
      // Post-processing is an enhancement: render directly and let the panel say so.
      this.postFailed = true;
      this.composer = null;
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  _adapt(dtMs) {
    const f = this._frames;
    f.push(dtMs);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = Math.round(this.fps) + ' fps · ' + (Math.round(this.pixelRatio * 100) / 100) + '×';
    if (!this.q.adaptive) return false;
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
    return before !== this.adaptiveScale;
  }

  // Shadow frustum fitted tightly around the wall, the table top and the
  // strip of back wall its shadow lands on.
  _fitShadow() {
    const w = Math.max(this.cols, 4) * SPACING / 2 + 1.2;
    const top = BASE_Y + Math.max(this.rows, 4) * SPACING + 0.6;
    const center = new THREE.Vector3(0, top / 2, 0.2);
    const radius = Math.hypot(w, top / 2, 2.6);
    const cam = this.keyLight.shadow.camera;
    cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
    cam.near = 0.5; cam.far = 20 + radius * 2;
    cam.updateProjectionMatrix();
    this.keyLight.target.position.copy(center);
    this.keyLight.position.copy(center).addScaledVector(this.keyDir, 20);
    this.keyLight.target.updateMatrixWorld();
  }

  setReducedMotion(on) { this.reducedMotion = on; }

  // ---------- board construction ----------
  cellPos(r, c) {
    return {
      x: (c - (this.cols - 1) / 2) * SPACING,
      y: BASE_Y + (this.rows - 1 - r) * SPACING,
      z: 0
    };
  }

  _rebuildBoardMeshes() {
    // cube instanced meshes per color + charm instanced meshes
    if (this.cubeMeshes) this.cubeMeshes.forEach(m => { this.boardGroup.remove(m); m.material.dispose(); });
    if (this.charmMeshes) this.charmMeshes.forEach(m => { this.boardGroup.remove(m); m.material.dispose(); m.geometry.dispose(); });
    if (this._cubeGeo) this._cubeGeo.dispose();
    this.cubeMeshes = []; this.charmMeshes = [];
    if (!this.rows) return;
    const cap = this.rows * this.cols;
    const detailed = this.q.detail === 'detailed';
    const cubeGeo = roundedCubeGeo(CUBE, detailed);
    this._cubeGeo = cubeGeo;
    for (let i = 0; i < this.colors.length; i++) {
      // Detailed: soft-touch toy plastic with a thin clearcoat that catches the room light.
      const cubeMat = detailed
        ? new THREE.MeshPhysicalMaterial({ color: this.colors[i], roughness: 0.5, metalness: 0,
          clearcoat: 0.4, clearcoatRoughness: 0.18, envMapIntensity: 0.22 })
        : new THREE.MeshStandardMaterial({ color: this.colors[i], roughness: 0.55, metalness: 0.05, envMapIntensity: 0.25 });
      const m = new THREE.InstancedMesh(cubeGeo, cubeMat, cap);
      m.castShadow = true; m.receiveShadow = true;
      m.count = 0;
      m.raycast = function () {};  // picking uses the plane, not the cubes
      this.boardGroup.add(m);
      this.cubeMeshes.push(m);
      const cm = new THREE.InstancedMesh(charmGeo(i),
        new THREE.MeshStandardMaterial({ color: 0xfff6e8, roughness: 0.35, metalness: 0.1, envMapIntensity: 0.3 }), cap);
      cm.castShadow = detailed;
      cm.count = 0;
      cm.raycast = function () {};
      this.boardGroup.add(cm);
      this.charmMeshes.push(cm);
    }
  }

  // Load full state → entities (authoritative; ends every animation).
  syncToState(state) {
    this.rows = state.grid.length;
    this.cols = state.grid[0] ? state.grid[0].length : 0;
    if (!this.cubeMeshes || this.cubeMeshes.length !== this.colors.length) this._rebuildBoardMeshes();
    // drop special meshes
    this.entities.forEach(e => { if (e.specialMesh) { this.boardGroup.remove(e.specialMesh); disposeObj(e.specialMesh); } });
    this.entities = [];
    this.entityByCell = {};
    this.anims = [];
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const cell = state.grid[r][c];
        if (!cell) continue;
        const p = this.cellPos(r, c);
        const e = { key: r + ':' + c, color: cell.c, special: cell.s, r, c,
          x: p.x, y: p.y, z: p.z, tx: p.x, ty: p.y, tz: p.z, scale: 1, tscale: 1 };
        if (cell.s !== 0) e.specialMesh = this._makeSpecialMesh(cell.s, cell.c, p);
        this.entities.push(e);
        this.entityByCell[e.key] = e;
      }
    this._layoutCamera();
    this._fitShadow();
    this._updateMarkers();
  }

  _makeSpecialMesh(s, colorIdx, p) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(roundedCubeGeo(CUBE * 0.9, this.q.detail === 'detailed'),
      new THREE.MeshPhysicalMaterial({ color: this.colors[colorIdx], roughness: 0.4, metalness: 0.1,
        clearcoat: this.q.detail === 'detailed' ? 0.5 : 0, clearcoatRoughness: 0.2, envMapIntensity: 0.25 }));
    base.castShadow = true;
    g.add(base);
    let top;
    const dark = new THREE.MeshPhysicalMaterial({ color: 0x4a4038, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.4 });
    if (s === 3) { // bomb: sphere + fuse with a glowing spark (bloom catches it)
      top = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12), dark);
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.22, 6),
        new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0x664400 }));
      fuse.position.y = 0.42;
      g.add(fuse);
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 2.2, 0.9) }));
      spark.position.set(0, 0.55, CUBE / 2 + 0.1);
      spark.userData.spark = true;
      g.add(spark);
      g.userData.spark = spark;
    } else { // rocket: cone on stick; H rockets lie flat, V rockets stand
      top = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 10),
        new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.35 }));
      body.position.y = 0.25;
      const fin = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.3, 8),
        new THREE.MeshStandardMaterial({ color: 0xd84f45, roughness: 0.5 }));
      fin.position.y = -0.05;
      top.add(body); top.add(fin);
      if (s === 1) top.rotation.z = -Math.PI / 2; // row rocket points sideways
    }
    top.position.z = CUBE / 2 + 0.1;
    if (s !== 3) top.position.y = 0;
    g.add(top);
    g.position.set(p.x, p.y, p.z);
    g.userData.top = top;
    g.userData.phase = (p.x * 1.7 + p.y * 0.9) % (Math.PI * 2);
    this.boardGroup.add(g);
    return g;
  }

  // ---------- move animation ----------
  // events from rules; returns total animation duration in ms.
  playEvents(events, newState, colorOf) {
    if (this.reducedMotion) { this.syncToState(newState); return 0; }
    let t = 0;
    const later = (ms, fn) => { this.timers.push(setTimeout(fn, ms)); };
    let blastN = 0;
    events.forEach(ev => {
      if (ev.type === 'pop') {
        const cells = ev.cells || [];
        cells.forEach((cl, i) => {
          const e = this.entityByCell[cl.r + ':' + cl.c];
          if (!e) return;
          const at = t + Math.min(i * 12, 90);
          later(at, () => {
            this.spawnBurst(e.x, e.y, e.z + 0.4, this.colors[e.color], 10);
            this._tween(e, { tscale: 0.01 }, POP_MS);
          });
        });
        t += POP_MS + Math.min(cells.length * 12, 90);
      } else if (ev.type === 'special-create') {
        // handled at final sync; small flash now
        const p = this.cellPos(ev.r, ev.c);
        later(t, () => this.spawnBurst(p.x, p.y, p.z + 0.5, 0xffffff, 18));
        t += 80;
      } else if (ev.type === 'fire') {
        const e = this.entityByCell[ev.r + ':' + ev.c];
        const p = e || Object.assign({ z: 0 }, this.cellPos(ev.r, ev.c));
        later(t, () => {
          this.spawnBurst(p.x, p.y, (p.z || 0) + 0.4, this.colors[ev.color] || 0xffffff, 24);
        });
        t += 60;
      } else if (ev.type === 'blast') {
        const at = t + blastN * 90;
        ev.cells.forEach(cl => {
          const e = this.entityByCell[cl.r + ':' + cl.c];
          later(at, () => {
            const p = e || Object.assign({ z: 0 }, this.cellPos(cl.r, cl.c));
            this.spawnBurst(p.x, p.y, (p.z || 0) + 0.4, e ? this.colors[e.color] : 0xffe9a8, 8);
            if (e) this._tween(e, { tscale: 0.01 }, BLAST_MS);
          });
        });
        blastN++;
        if (!this.reducedMotion) this.shake = Math.min(this.shake + 0.12, 0.3);
        t += BLAST_MS * 0.7;
      } else if (ev.type === 'fall') {
        later(t, () => {
          ev.moves.forEach(mv => {
            const e = this.entityByCell[mv.fromR + ':' + mv.fromC];
            if (!e) return;
            delete this.entityByCell[mv.fromR + ':' + mv.fromC];
            this.entityByCell[mv.toR + ':' + mv.toC] = e;
            e.r = mv.toR; e.c = mv.toC; e.key = mv.toR + ':' + mv.toC;
            const p = this.cellPos(mv.toR, mv.toC);
            this._tween(e, { tx: p.x, ty: p.y }, FALL_MS);
            if (e.specialMesh) this._tweenObj(e.specialMesh.position, p, FALL_MS);
          });
        });
        t += FALL_MS;
      } else if (ev.type === 'refill') {
        later(t, () => {
          ev.cells.forEach(cl => {
            const p = this.cellPos(cl.r, cl.c);
            const e = { key: cl.r + ':' + cl.c, color: cl.color, special: 0, r: cl.r, c: cl.c,
              x: p.x, y: p.y + this.rows * SPACING * 0.5 + 1.5, z: 0, tx: p.x, ty: p.y, tz: 0, scale: 1, tscale: 1 };
            this.entities.push(e);
            this.entityByCell[e.key] = e;
            this._tween(e, { ty: p.y }, FALL_MS + 120);
          });
        });
        t += FALL_MS + 120;
      } else if (ev.type === 'shuffle') {
        t += SHUFFLE_MS; // final sync lands positions
        this.shake = Math.min(this.shake + 0.08, 0.2);
      } else if (ev.type === 'wave' || ev.type === 'win') {
        later(t, () => {
          for (let i = 0; i < 24; i++) {
            const a = (i / 24) * Math.PI * 2;
            this.spawnBurst(Math.cos(a) * 2.5, BASE_Y + this.rows * 0.5 + Math.sin(a) * 1.5, 1,
              [0xffd76a, 0xff9d5c, 0x8fd48f][i % 3], 3);
          }
        });
        t += 200;
      }
    });
    // authoritative landing
    later(t + 30, () => { this.syncToState(newState); if (this.opts.onSettled) this.opts.onSettled(); });
    return t + 30;
  }

  _tween(e, to, ms) {
    this.anims.push({ e, from: { tx: e.tx, ty: e.ty, tz: e.tz, tscale: e.tscale }, to, t0: performance.now(), ms });
  }
  _tweenObj(obj, to, ms) {
    this.anims.push({ obj, from: { x: obj.x, y: obj.y, z: obj.z }, to: { x: to.x, y: to.y, z: to.z }, t0: performance.now(), ms });
  }

  // ---------- selection / focus ----------
  setFocusCell(r, c) {
    this.focusCell = (r == null) ? null : { r, c };
    this._updateMarkers();
  }
  setHoverGroup(cells, invalid) {
    this.hoverGroup = cells || [];
    this.hoverInvalid = !!invalid;
    this._updateMarkers();
  }
  setHintCell(r, c) {
    this.hintCell = (r == null) ? null : { r, c };
    this._updateMarkers();
  }

  _updateMarkers() {
    let mi = 0;
    const use = (x, y, color, opacity) => {
      if (mi >= this.markers.length) return;
      const m = this.markers[mi++];
      m.visible = true;
      m.position.set(x, y, CUBE / 2 - 0.05);
      m.material.color.set(color);
      m.material.opacity = opacity;
    };
    this.hoverGroup.forEach(cl => {
      const p = this.cellPos(cl.r, cl.c);
      use(p.x, p.y, this.hoverInvalid ? 0xd84f45 : 0xffffff, 0.85);
    });
    if (this.hintCell) {
      const p = this.cellPos(this.hintCell.r, this.hintCell.c);
      use(p.x, p.y, 0xffd76a, 1);
    }
    for (let i = mi; i < this.markers.length; i++) this.markers[i].visible = false;
    if (this.focusCell) {
      const p = this.cellPos(this.focusCell.r, this.focusCell.c);
      this.focusRing.visible = true;
      this.focusRing.position.set(p.x, p.y, CUBE / 2 + 0.06);
    } else this.focusRing.visible = false;
  }

  // ---------- camera ----------
  _layoutCamera() {
    const w = Math.max(this.cols * SPACING + 0.6, 5), h = Math.max(this.rows * SPACING + 0.8, 5);
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const dist = Math.max(h / (2 * Math.tan(this.camera.fov * Math.PI / 360)), w / (2 * Math.tan(this.camera.fov * Math.PI / 360) * aspect)) + 1.2;
    this.camDist = dist;
    this._applyCamera();
  }
  _applyCamera() {
    const cy = BASE_Y + (this.rows - 1) * SPACING / 2;
    const yaw = this.orbit.yaw, pitch = this.orbit.pitch;
    const d = this.camDist || 12;
    let x = Math.sin(yaw) * d, z = Math.cos(yaw) * Math.cos(pitch) * d, y = cy + Math.sin(pitch) * d + 0.6;
    if (this.shake > 0.001 && !this.reducedMotion) {
      x += (Math.random() - 0.5) * this.shake;
      y += (Math.random() - 0.5) * this.shake;
      this.shake *= 0.88;
    }
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, cy, 0);
  }
  resetCamera() { this.orbit.yaw = 0; this.orbit.pitch = 0; }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._syncSize(w, h, true);
    this._layoutCamera();
  }

  // Pixel ratio = min(dpr, preset cap) × preset/user scale × adaptive scale.
  _syncSize(w, h, force) {
    const g = this.q;
    const ratio = Math.min(window.devicePixelRatio || 1, g.dprCap) * g.scale * this.adaptiveScale;
    if (force || w !== this.size[0] || h !== this.size[1] || ratio !== this.pixelRatio) {
      const resized = w !== this.size[0] || h !== this.size[1];
      this.size = [w, h];
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(w, h);
      if (resized) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        if (this.rows) this._layoutCamera();
      }
    }
  }

  // ---------- input ----------
  _initInput() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    let downAt = 0, downXY = null, dragging = false, pid = null;
    const toCell = (ev) => {
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObject(this.pickPlane, false)[0];
      if (!hit) return null;
      const c = Math.round(hit.point.x / SPACING + (this.cols - 1) / 2);
      const r = Math.round((this.rows - 1) - (hit.point.y - BASE_Y) / SPACING);
      if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return null;
      return { r, c };
    };
    el.addEventListener('pointerdown', (ev) => {
      pid = ev.pointerId; downAt = performance.now();
      downXY = { x: ev.clientX, y: ev.clientY }; dragging = false;
      el.setPointerCapture(pid);
    });
    el.addEventListener('pointermove', (ev) => {
      if (downXY && pid === ev.pointerId) {
        const dx = ev.clientX - downXY.x, dy = ev.clientY - downXY.y;
        if (!dragging && Math.hypot(dx, dy) > 12) dragging = true; // drag threshold
        if (dragging) {
          this.orbit.yaw = THREE.MathUtils.clamp(this.orbit.yaw - dx * 0.002, -0.35, 0.35);
          this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + dy * 0.002, -0.15, 0.3);
          downXY = { x: ev.clientX, y: ev.clientY };
          return;
        }
      }
      const cell = toCell(ev);
      this.onHover(cell);
    });
    el.addEventListener('pointerup', (ev) => {
      const wasDrag = dragging, dt = performance.now() - downAt;
      dragging = false; downXY = null;
      try { el.releasePointerCapture(pid); } catch (e) {}
      pid = null;
      if (wasDrag || dt > 600) return; // tap: short, stationary
      const cell = toCell(ev);
      if (cell) this.onPick(cell);
    });
    el.addEventListener('pointercancel', () => { dragging = false; downXY = null; pid = null; });
    el.addEventListener('pointerleave', () => { if (!downXY) this.onHover(null); });
    el.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      if (this.opts.onContextLost) this.opts.onContextLost();
    });
  }

  // ---------- frame loop ----------
  _loop(nowMs) {
    if (this.disposed) return;
    requestAnimationFrame(this._loop);
    const rawMs = Math.min(250, nowMs - this._last);
    const dt = Math.min(0.05, rawMs / 1000);
    this._last = nowMs;
    if (document.hidden) return; // heartbeat: no rendering while hidden
    const ambient = this.q.background === 'animated' && !this.reducedMotion && !(this._prm && this._prm.matches);
    if (ambient) this.clock += dt;

    // tweens
    const keep = [];
    for (const a of this.anims) {
      const t = Math.min(1, (nowMs - a.t0) / Math.max(1, a.ms));
      const k = t * t * (3 - 2 * t); // smoothstep
      if (a.e) {
        a.e.tx = a.from.tx + (a.to.tx !== undefined ? (a.to.tx - a.from.tx) * k : 0);
        a.e.ty = a.from.ty + (a.to.ty !== undefined ? (a.to.ty - a.from.ty) * k : 0);
        a.e.tscale = a.from.tscale + ((a.to.tscale !== undefined ? a.to.tscale : a.e.tscale) - a.from.tscale) * k;
      } else if (a.obj) {
        a.obj.x = a.from.x + (a.to.x - a.from.x) * k;
        a.obj.y = a.from.y + (a.to.y - a.from.y) * k;
        a.obj.z = a.from.z + (a.to.z - a.from.z) * k;
      }
      if (t < 1) keep.push(a);
    }
    this.anims = keep;

    // write instance matrices
    if (this.cubeMeshes && this.cubeMeshes.length) {
      const counts = this.cubeMeshes.map(() => 0);
      const charmCounts = this.charmMeshes.map(() => 0);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      const e3 = new THREE.Euler();
      for (const e of this.entities) {
        const b = e.color % this.cubeMeshes.length;
        const i = counts[b]++;
        sc.setScalar(Math.max(0.001, e.tscale));
        // hover lift
        let z = e.tz;
        if (this.hoverGroup.length && !this.reducedMotion &&
            this.hoverGroup.some(cl => cl.r === e.r && cl.c === e.c)) z += 0.12;
        m4.compose(new THREE.Vector3(e.tx, e.ty, z), q.identity(), sc);
        this.cubeMeshes[b].setMatrixAt(i, m4);
        const ci = charmCounts[b]++;
        e3.set(0, 0, 0);
        m4.compose(new THREE.Vector3(e.tx, e.ty, z + CUBE / 2 + 0.02),
          q.setFromEuler(e3), sc.setScalar(Math.max(0.001, e.tscale) * 0.9));
        this.charmMeshes[b].setMatrixAt(ci, m4);
      }
      this.cubeMeshes.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; });
      this.charmMeshes.forEach((m, i) => { m.count = charmCounts[i]; m.instanceMatrix.needsUpdate = true; });
    }
    // special meshes follow their entities
    // (idle bob and fuse flicker under animated background, frozen under reduced motion)
    for (const e of this.entities) {
      if (!e.specialMesh) continue;
      const u = e.specialMesh.userData;
      const bob = ambient ? Math.sin(this.clock * 2.2 + u.phase) * 0.035 : 0;
      e.specialMesh.position.set(e.tx, e.ty + bob, e.tz);
      if (u.spark) {
        const f = ambient ? 0.75 + 0.25 * Math.sin(this.clock * 17 + u.phase) * Math.sin(this.clock * 7.3) : 1;
        u.spark.scale.setScalar(f);
      }
    }
    if (this.motes.visible && ambient) this._updateMotes(this.clock);
    // warm light shimmer: a slow, tiny breathing of the key light
    this.keyLight.intensity = 2.2 * (ambient ? 1 + 0.025 * Math.sin(this.clock * 0.9) : 1);

    // particles
    const pos = this.pGeo.attributes.position.array;
    for (let i = 0; i < this.pCap; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= 6 * dt;
      pos[i * 3] += this.pVel[i * 3] * dt;
      pos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt;
      if (this.pLife[i] <= 0) pos[i * 3 + 1] = -100;
    }
    this.pGeo.attributes.position.needsUpdate = true;

    this._applyCamera();
    // keep the drawing buffer matched to the container (layout can change without a window resize)
    const rescale = this._adapt(rawMs);
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    if (cw && ch) this._syncSize(cw, ch, rescale);
    const pkey = this._postKey(this.size[0], this.size[1]);
    if (pkey !== this.postKey) {
      this.postKey = pkey;
      this._buildPost(this.size[0], this.size[1]);
      if (this.postFailed) this.postKey = this._postKey(this.size[0], this.size[1]);
    }
    if (this.composer) {
      try { this.composer.render(dt); }
      catch (err) { this.postFailed = true; this.composer = null; this.renderer.render(this.scene, this.camera); }
    } else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.timers.forEach(t => clearTimeout(t));
    window.removeEventListener('resize', this._onResize);
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }
    });
    if (this.composer) this.composer.dispose();
    if (this._envTex) this._envTex.dispose();
    if (this._dotTex) this._dotTex.dispose();
    this._fpsVisible(false);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}

function disposeObj(o) {
  o.traverse(ch => {
    if (ch.geometry) ch.geometry.dispose();
    if (ch.material) ch.material.dispose();
  });
}

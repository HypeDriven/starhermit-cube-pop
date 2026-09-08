/* Cube Pop — Three.js renderer (ES module).
 * Cheerful toy studio: a wall of soft-edged cubes on a wooden table.
 * Instanced cubes per color, pooled particles, authored fixed camera with
 * drag-orbit, tiered quality, deterministic layout (visual seed only
 * decorates the studio, never the board).
 */
import * as THREE from '../vendor/three.module.min.js';

const SPACING = 1.04;          // cube pitch on the wall
const CUBE = 0.94;             // cube edge
const BASE_Y = 0.6;            // height of the wall's bottom row
const POP_MS = 160, FALL_MS = 220, BLAST_MS = 260, SHUFFLE_MS = 450;

const QUALITY = {
  high:   { dpr: 2,   shadows: true,  particles: 160, envDetail: 1 },
  medium: { dpr: 1.5, shadows: true,  particles: 80,  envDetail: 1 },
  low:    { dpr: 1,   shadows: false, particles: 30,  envDetail: 0 }
};

function hex(n) { return new THREE.Color(n); }

// Soft-edged cube: rounded-square extrude with bevel (procedural, authored).
function roundedCubeGeo(size) {
  const r = size * 0.18, h = size / 2 - r;
  const s = new THREE.Shape();
  s.moveTo(-h - r, -h);
  s.lineTo(h, -h - r); s.absarc(h, -h, r, -Math.PI / 2, 0);
  s.lineTo(h + r, h); s.absarc(h, h, r, 0, Math.PI / 2);
  s.lineTo(-h, h + r); s.absarc(-h, h, r, Math.PI / 2, Math.PI);
  s.lineTo(-h - r, -h); s.absarc(-h, -h, r, Math.PI, Math.PI * 1.5);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: size - 2 * r * 0.6, bevelEnabled: true,
    bevelThickness: r * 0.6, bevelSize: r * 0.6, bevelSegments: 2, curveSegments: 5
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
    this.tier = 'high';
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
    this._initInput();
    this._loop = this._loop.bind(this);
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  _initGL() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.scene = new THREE.Scene();
    this._onResize = this._resize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._resize();
  }

  _initScene() {
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.keyLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.keyLight.position.set(4, 8, 6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.left = -7; this.keyLight.shadow.camera.right = 7;
    this.keyLight.shadow.camera.top = 9; this.keyLight.shadow.camera.bottom = -2;
    this.scene.add(this.keyLight);
    this.fillLight = new THREE.HemisphereLight(0xffffff, 0x8a6a4a, 0.9);
    this.scene.add(this.fillLight);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));

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
    const mGeo = new THREE.BoxGeometry(CUBE * 1.02, CUBE * 1.02, 0.06);
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
    const m = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95 });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.raycast = function () {}; // cosmetic: never intercepts picking
    this.world.add(this.points);
    for (let i = 0; i < cap; i++) { pos[i * 3 + 1] = -100; }
  }

  spawnBurst(x, y, z, colorHex, count) {
    const n = Math.min(count, QUALITY[this.tier].particles);
    const c = hex(colorHex);
    const pos = this.pGeo.attributes.position.array;
    const col = this.pGeo.attributes.color.array;
    for (let k = 0; k < n; k++) {
      const i = this.pHead = (this.pHead + 1) % this.pCap;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
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
      if (ch.material) ch.material.dispose();
    }
    const P = palette;
    const mat = (c, rough) => new THREE.MeshStandardMaterial({ color: c, roughness: rough == null ? 0.8 : rough, metalness: 0.05 });
    // floor
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat(P.floor, 0.9));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true;
    this.envGroup.add(floor);
    // back wall
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), mat(P.wall, 0.95));
    wall.position.set(0, 10, -2.2); wall.receiveShadow = true;
    this.envGroup.add(wall);
    // table under the wall
    const table = new THREE.Mesh(new THREE.BoxGeometry(14, 0.5, 4), mat(P.table, 0.7));
    table.position.set(0, 0.25, 0.8); table.receiveShadow = true; table.castShadow = true;
    this.envGroup.add(table);
    // two legs
    [-5.5, 5.5].forEach(x => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), mat(P.frame, 0.75));
      leg.position.set(x, -0.45, 0.8);
      this.envGroup.add(leg);
    });
    if (QUALITY[this.tier].envDetail) {
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
    }
    this._rebuildBoardMeshes();
  }

  setQuality(tier) {
    if (!QUALITY[tier]) tier = 'high';
    this.tier = tier;
    const q = QUALITY[tier];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.renderer.shadowMap.enabled = q.shadows;
    this.keyLight.castShadow = q.shadows;
    if (this.palette) this.setTheme(this.palette, this._colorDefs || [], this._hc);
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
    const cubeGeo = roundedCubeGeo(CUBE);
    this._cubeGeo = cubeGeo;
    for (let i = 0; i < this.colors.length; i++) {
      const m = new THREE.InstancedMesh(cubeGeo,
        new THREE.MeshStandardMaterial({ color: this.colors[i], roughness: 0.55, metalness: 0.05 }), cap);
      m.castShadow = true; m.receiveShadow = true;
      m.count = 0;
      m.raycast = function () {};  // picking uses the plane, not the cubes
      this.boardGroup.add(m);
      this.cubeMeshes.push(m);
      const cm = new THREE.InstancedMesh(charmGeo(i),
        new THREE.MeshStandardMaterial({ color: 0xfff6e8, roughness: 0.4, metalness: 0.1 }), cap);
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
    this._updateMarkers();
  }

  _makeSpecialMesh(s, colorIdx, p) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(roundedCubeGeo(CUBE * 0.9),
      new THREE.MeshStandardMaterial({ color: this.colors[colorIdx], roughness: 0.4, metalness: 0.15 }));
    base.castShadow = true;
    g.add(base);
    let top;
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.5 });
    if (s === 3) { // bomb: sphere + fuse
      top = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), dark);
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.22, 6),
        new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0x664400 }));
      fuse.position.y = 0.42;
      g.add(fuse);
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
      m.position.set(x, y, CUBE / 2 + 0.03);
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
    const w = Math.max(this.cols * SPACING, 6), h = Math.max(this.rows * SPACING + 1.5, 6);
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const dist = Math.max(h / (2 * Math.tan(this.camera.fov * Math.PI / 360)), w / (2 * Math.tan(this.camera.fov * Math.PI / 360) * aspect)) + 2.2;
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
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[this.tier].dpr));
    this._layoutCamera();
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
    const dt = Math.min(0.05, (nowMs - this._last) / 1000);
    this._last = nowMs;
    if (document.hidden) return; // heartbeat: no rendering while hidden

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
    for (const e of this.entities) {
      if (e.specialMesh) e.specialMesh.position.set(e.tx, e.ty, e.tz);
    }

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
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.timers.forEach(t => clearTimeout(t));
    window.removeEventListener('resize', this._onResize);
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); }
    });
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

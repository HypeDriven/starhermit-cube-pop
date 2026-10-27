// The toy studio on starhermit:scene, as the browser build's js/render.js
// drew it: a wall of soft-edged cubes (one InstancedMesh per colour, rounded
// extrusions measuring exactly one cube) with cream charms per colour
// (ball, star, cone, diamond, ring, gem: shape as well as colour), rockets
// and bombs as small toys on their cubes, a wooden table under the wall
// (assets/table-wood.webp), the back wall and floor (wallpaper stripes and
// floorboards on the detailed looks, with a skirting board and a shelf of
// toys), pooled confetti bursts, drifting dust motes, white outline markers
// under a hovered or focused group (red when too small), the gold hint
// marker, the focus ring, the authored camera with a small drag orbit and
// the blast shake. The camera is fitted to the playfield the HUD leaves
// (setViewOffset), as the browser build's canvas sat between its rails and
// tray, and picking hits the cubes' front plane as before.
//
// Gaps and changes from three.js: light intensities are three.js's ÷ π (the
// engine's convention); the post chain is renderer.ao / bloom / grade /
// antialias (the grade the browser build's GradeShader in display space);
// animations and the blast shake run on the runtime's fixed steps (tick)
// instead of setTimeout and performance.now, so a round plays the same in
// every run; adaptive resolution, the frame-rate meter and the pixel-ratio
// cap are the runtime's.
import {
  ACESFilmicToneMapping, AmbientLight, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, ExtrudeGeometry, Fog, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, Plane, Points, PointsMaterial, Quaternion, Raycaster, RepeatWrapping,
  RoomEnvironment, Shape, SphereGeometry, SRGBColorSpace, TextureLoader, TorusGeometry, Vector3, pointerToNdc, renderer, scene,
  type Material, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas } from "starhermit:canvas";
import { LOW_BURST, MOTE_MAX, type Look } from "./quality.ts";
import type { RulesEvent, State, Theme } from "./classic.ts";

const PI = Math.PI;
const SPACING = 1.04; // cube pitch on the wall
const CUBE = 0.94; // cube edge
const BASE_Y = 1.05; // height of the wall's bottom row (on the table top)
const POP_MS = 160, FALL_MS = 220, BLAST_MS = 260, SHUFFLE_MS = 450;
const KEY = 2.2 / PI;

type Palette = Theme["palette"];
interface Entity {
  key: string; color: number; special: number; r: number; c: number;
  tx: number; ty: number; tz: number; tscale: number; specialMesh?: Group;
}
interface Anim { e?: Entity; obj?: Vector3; from: Record<string, number>; to: Record<string, number>; t0: number; ms: number }

// -- renderer and camera ------------------------------------------------------------------
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const camera = new PerspectiveCamera(38, 1, 0.1, 100);

let look: Look | null = null;
let reducedMotion = false;
let palette: Palette | null = null;
let colors: number[] = [];
let rows = 0, cols = 0;

// -- lights (js/render.js _initScene), three.js intensities ÷ π ------------------------------
const world = new Group();
scene.add(world);
const keyLight = new DirectionalLight(0xfff1d6, KEY);
keyLight.position.set(4, 8, 6);
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
keyLight.shadow.radius = 3;
const keyDir = new Vector3(4, 8, 6).normalize();
scene.add(keyLight);
scene.add(keyLight.target);
const fillLight = new HemisphereLight(0xffffff, 0x8a6a4a, 0.9 / PI);
scene.add(fillLight);
const ambient = new AmbientLight(0xffffff, 0.25 / PI);
scene.add(ambient);
// A cool rim from the left so cube bevels read against the wall (detailed looks).
const rimLight = new DirectionalLight(0xcfe0ff, 0);
rimLight.position.set(-6, 4, 3);
scene.add(rimLight);

const envGroup = new Group();
world.add(envGroup);
const boardGroup = new Group();
world.add(boardGroup);
const markerGroup = new Group();
world.add(markerGroup);

// Outline markers sit just behind the cube face and a little wider, so they read as a rim.
const markers: Mesh<MeshBasicMaterial>[] = [];
const markerGeo = new BoxGeometry(CUBE * 1.09, CUBE * 1.09, 0.06);
for (let i = 0; i < 80; i++) {
  const m = new Mesh(markerGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  m.visible = false;
  markerGroup.add(m);
  markers.push(m);
}
const focusRing = new Mesh(new TorusGeometry(CUBE * 0.72, 0.045, 8, 24), new MeshBasicMaterial({ color: 0xffffff }));
focusRing.visible = false;
markerGroup.add(focusRing);

let envTex: Texture | null = null;
function envMap(): Texture | null {
  if (!envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return envTex;
}

// -- procedural textures (visual only; never touch the rules' streams) -----------------------
const hexCss = (c: Color): string => "#" + c.getHex().toString(16).padStart(6, "0");
/** Low-contrast wallpaper: soft vertical stripes and a scatter of tiny dots, tinted from the wall colour. */
function wallpaperTexture(wallHex: number, size: number): Texture {
  const cv = new OffscreenCanvas(size, size);
  const g = cv.getContext("2d");
  g.scale(size / 256, size / 256);
  const base = new Color(wallHex);
  g.fillStyle = hexCss(base);
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = hexCss(base.clone().multiplyScalar(0.94));
  for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 26, 256);
  g.fillStyle = hexCss(base.clone().lerp(new Color(0xffffff), 0.25));
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 60; i++) {
    g.beginPath();
    g.arc(45 + Math.floor(rnd() * 4) * 64 + (rnd() - 0.5) * 8, rnd() * 256, 1.6, 0, PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(10, 5);
  t.anisotropy = 4;
  return t;
}
/** Floorboards: plank seams with a little per-plank value noise. */
function floorTexture(floorHex: number, size: number): Texture {
  const cv = new OffscreenCanvas(size, size);
  const g = cv.getContext("2d");
  g.scale(size / 256, size / 256);
  const base = new Color(floorHex);
  let seed = 11;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = hexCss(base.clone().multiplyScalar(0.93 + rnd() * 0.12));
    g.fillRect(0, i * 32, 256, 32);
    g.fillStyle = hexCss(base.clone().multiplyScalar(0.8));
    g.fillRect(0, i * 32, 256, 2);
    g.fillRect(Math.floor(rnd() * 256), i * 32, 2, 32);
  }
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(8, 8);
  t.anisotropy = 4;
  return t;
}
/** Soft round sprite for confetti and motes. */
function dotTexture(): Texture {
  const cv = new OffscreenCanvas(64, 64);
  const g = cv.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.45, "rgba(255,255,255,0.9)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// Authored wood grain for the table top; until it arrives (or if it fails) the flat theme colour stands.
let woodTex: Texture | null = null;
let tableMesh: Mesh | null = null;
new TextureLoader().loadAsync("assets/table-wood.webp").then((tex) => {
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(3, 1);
  woodTex = tex;
  if (tableMesh) (tableMesh.material as MeshStandardMaterial).map = tex;
}, () => { /* keep the flat colour */ });

// -- geometry -----------------------------------------------------------------------------
/** three.js BufferGeometry.center(): the bounding box's centre moved to the origin. */
function centered(g: BufferGeometry): BufferGeometry {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
  return g;
}
/** Soft-edged cube: a rounded square extruded with a bevel, inset so it measures exactly `size`. */
function roundedCubeGeo(size: number): BufferGeometry {
  const b = size * 0.1, r = size * 0.1, h = size / 2 - b - r;
  const s = new Shape();
  s.moveTo(-h, -h - r);
  s.lineTo(h, -h - r); s.absarc(h, -h, r, -PI / 2, 0, false);
  s.lineTo(h + r, h); s.absarc(h, h, r, 0, PI / 2, false);
  s.lineTo(-h, h + r); s.absarc(-h, h, r, PI / 2, PI, false);
  s.lineTo(-h - r, -h); s.absarc(-h, -h, r, PI, PI * 1.5, false);
  const bud = look!.budget;
  const g = new ExtrudeGeometry(s, {
    depth: size - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b,
    bevelSegments: bud.cubeBevel, curveSegments: bud.cubeCurve,
  });
  return centered(g);
}
function starGeo(radius: number, depth: number): BufferGeometry {
  const shape = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2 - PI / 2;
    const rr = i % 2 === 0 ? radius : radius * 0.45;
    if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  shape.closePath();
  return centered(new ExtrudeGeometry(shape, { depth, bevelEnabled: false }));
}
/** Per-colour charm shapes reinforce colour (shape ≠ colour-only). */
function charmGeo(idx: number): BufferGeometry {
  switch (idx % 6) {
    case 0: return new SphereGeometry(0.14, 10, 8); // cherry: ball
    case 1: return starGeo(0.18, 0.07); // lemon: star
    case 2: return new ConeGeometry(0.14, 0.26, 8); // leaf: cone
    case 3: return new OctahedronGeometry(0.16); // sky: diamond
    case 4: return new TorusGeometry(0.13, 0.05, 6, 12); // grape: ring
    default: return new IcosahedronGeometry(0.15); // tangerine: gem
  }
}

interface LitParams { color: number; roughness?: number; metalness?: number; clearcoat?: number; clearcoatRoughness?: number; envMapIntensity?: number; map?: Texture | null }
/** Lit material in the look's class: Lambert on Low, standard above, clear-coated physical where asked on High/Ultra. */
function lit(p: LitParams, physical = false): Material {
  const kind = look ? look.budget.material : "lambert";
  if (kind === "lambert") return new MeshLambertMaterial({ color: p.color, map: p.map ?? null });
  const sp = { color: p.color, map: p.map ?? null, roughness: p.roughness ?? 1, metalness: p.metalness ?? 0, envMapIntensity: p.envMapIntensity ?? 1 };
  if (kind === "physical" && physical) return new MeshPhysicalMaterial({ ...sp, clearcoat: p.clearcoat ?? 0, clearcoatRoughness: p.clearcoatRoughness ?? 0 });
  return new MeshStandardMaterial(sp);
}

function disposeTree(o: Object3D): void {
  o.traverse((ch) => {
    const m = ch as Mesh;
    if (m.geometry && m.geometry !== markerGeo) m.geometry.dispose();
    const mat = (m as { material?: Material | Material[] }).material;
    if (mat) for (const x of Array.isArray(mat) ? mat : [mat]) { const map = (x as MeshStandardMaterial).map; if (map && map !== woodTex) map.dispose(); x.dispose(); }
  });
}

// -- the studio -----------------------------------------------------------------------------
function buildEnvironment(): void {
  while (envGroup.children.length) { const ch = envGroup.children[envGroup.children.length - 1]!; envGroup.remove(ch); disposeTree(ch); }
  tableMesh = null;
  if (!palette || !look) return;
  const P = palette;
  const detailed = look.detailed;
  const tex = look.budget.texture;
  const mat = (c: number, rough = 0.8, map: Texture | null = null): Material => lit({ color: c, roughness: rough, metalness: 0.05, envMapIntensity: 0.2, map });
  const floor = new Mesh(new PlaneGeometry(60, 60), mat(detailed ? 0xffffff : P.floor, 0.9, detailed ? floorTexture(P.floor, tex) : null));
  floor.rotation.x = -PI / 2; floor.position.y = -0.02; floor.receiveShadow = true;
  envGroup.add(floor);
  const wall = new Mesh(new PlaneGeometry(60, 30), mat(detailed ? 0xffffff : P.wall, 0.95, detailed ? wallpaperTexture(P.wall, tex) : null));
  wall.position.set(0, 10, -2.2); wall.receiveShadow = true;
  envGroup.add(wall);
  if (detailed) {
    const skirt = new Mesh(new BoxGeometry(60, 0.5, 0.12), mat(P.frame, 0.6));
    skirt.position.set(0, 0.23, -2.14); skirt.receiveShadow = true;
    envGroup.add(skirt);
  }
  const table = new Mesh(new BoxGeometry(14, 0.5, 4), mat(P.table, 0.7, woodTex));
  table.position.set(0, 0.25, 0.8); table.receiveShadow = true; table.castShadow = true;
  envGroup.add(table);
  tableMesh = table;
  for (const x of [-5.5, 5.5]) {
    const leg = new Mesh(new BoxGeometry(0.5, 1.4, 0.5), mat(P.frame, 0.75));
    leg.position.set(x, -0.45, 0.8);
    envGroup.add(leg);
  }
  if (detailed) {
    // The shelf and its toy props (deterministic decor, seeded by the theme palette).
    const shelf = new Mesh(new BoxGeometry(20, 0.3, 1.2), mat(P.frame, 0.8));
    shelf.position.set(0, 7.6, -1.9);
    envGroup.add(shelf);
    for (let i = 0; i < 6; i++) {
      const pr = ((P.accent >> (i * 3)) & 7) / 7;
      const prop = new Mesh(i % 2 ? new ConeGeometry(0.3, 0.7, 8) : new SphereGeometry(0.32, 10, 8), mat(i % 3 ? P.accent : P.metal, 0.6));
      prop.position.set(-8 + i * 3.2, 8.05 + pr * 0.1, -1.9);
      prop.castShadow = true;
      envGroup.add(prop);
    }
    // A little stack of toy blocks and a ring toy between the props.
    const blockCols = [P.accent, 0xf2c14e, 0x5b8fd4];
    for (let i = 0; i < 3; i++) {
      const b = new Mesh(roundedCubeGeo(0.42), lit({ color: blockCols[i]!, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.25 }, true));
      b.position.set(-3.2 + (i === 2 ? 0.22 : i * 0.46), 7.97 + (i === 2 ? 0.43 : 0), -1.9);
      b.rotation.y = (i - 1) * 0.25;
      b.castShadow = true;
      envGroup.add(b);
    }
    const ring = new Mesh(new TorusGeometry(0.28, 0.09, 10, 24), lit({ color: 0x8fd48f, roughness: 0.4, clearcoat: 0.5, envMapIntensity: 0.25 }, true));
    ring.position.set(3.4, 8.1, -1.9); ring.rotation.x = -PI / 2 + 0.25;
    ring.castShadow = true;
    envGroup.add(ring);
  }
}

// -- the board meshes ------------------------------------------------------------------------
let cubeMeshes: InstancedMesh[] = [];
let charmMeshes: InstancedMesh[] = [];
let cubeGeo: BufferGeometry | null = null;
let meshCap = 0;
function rebuildBoardMeshes(): void {
  for (const m of cubeMeshes) { boardGroup.remove(m); m.material.dispose(); }
  for (const m of charmMeshes) { boardGroup.remove(m); m.material.dispose(); m.geometry.dispose(); }
  if (cubeGeo) cubeGeo.dispose();
  cubeMeshes = []; charmMeshes = []; cubeGeo = null; meshCap = 0;
  if (!rows || !look) return;
  // Room for every cell in one colour twice over (popped cubes shrink while their refills fall in).
  meshCap = rows * cols * 2;
  const detailed = look.detailed;
  cubeGeo = roundedCubeGeo(CUBE);
  for (let i = 0; i < colors.length; i++) {
    // Detailed: soft-touch toy plastic with a thin clearcoat that catches the room light.
    const cubeMat = detailed
      ? lit({ color: colors[i]!, roughness: 0.5, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.18, envMapIntensity: 0.22 }, true)
      : lit({ color: colors[i]!, roughness: 0.55, metalness: 0.05, envMapIntensity: 0.25 });
    const m = new InstancedMesh(cubeGeo, cubeMat, meshCap);
    m.castShadow = true; m.receiveShadow = true;
    m.count = 0;
    boardGroup.add(m);
    cubeMeshes.push(m);
    const cm = new InstancedMesh(charmGeo(i), lit({ color: 0xfff6e8, roughness: 0.35, metalness: 0.1, envMapIntensity: 0.3 }), meshCap);
    cm.castShadow = detailed;
    cm.count = 0;
    boardGroup.add(cm);
    charmMeshes.push(cm);
  }
}

function makeSpecialMesh(s: number, colorIdx: number, x: number, y: number): Group {
  const detailed = !!look && look.detailed;
  const g = new Group();
  const base = new Mesh(roundedCubeGeo(CUBE * 0.9), lit({
    color: colors[colorIdx] ?? 0xffffff, roughness: 0.4, metalness: 0.1, clearcoat: detailed ? 0.5 : 0, clearcoatRoughness: 0.2, envMapIntensity: 0.25,
  }, true));
  base.castShadow = true;
  g.add(base);
  let top: Object3D;
  const dark = lit({ color: 0x4a4038, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.4 }, true);
  let spark: Mesh | null = null;
  if (s === 3) { // bomb: a sphere with a fuse and a glowing spark (bloom catches it)
    top = new Mesh(new SphereGeometry(0.34, 18, 12), dark);
    const fuse = new Mesh(new CylinderGeometry(0.04, 0.04, 0.22, 6), new MeshStandardMaterial({ color: 0xffd76a, emissive: 0x664400 }));
    fuse.position.y = 0.42;
    g.add(fuse);
    spark = new Mesh(new SphereGeometry(0.07, 10, 8), new MeshBasicMaterial({ color: new Color(3.0, 2.2, 0.9) }));
    spark.position.set(0, 0.55, CUBE / 2 + 0.1);
    g.add(spark);
  } else { // rocket: a cone on a stick; row rockets lie flat, column rockets stand
    const t = new Group();
    const body = new Mesh(new ConeGeometry(0.2, 0.5, 10), new MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.35 }));
    body.position.y = 0.25;
    const fin = new Mesh(new CylinderGeometry(0.12, 0.16, 0.3, 8), new MeshStandardMaterial({ color: 0xd84f45, roughness: 0.5 }));
    fin.position.y = -0.05;
    t.add(body); t.add(fin);
    if (s === 1) t.rotation.z = -PI / 2;
    top = t;
  }
  top.position.z = CUBE / 2 + 0.1;
  g.add(top);
  g.position.set(x, y, 0);
  g.userData = { spark, phase: (x * 1.7 + y * 0.9) % (PI * 2) };
  boardGroup.add(g);
  return g;
}

// -- particles and motes ------------------------------------------------------------------
const P_CAP = 2048;
const dotTex = dotTexture();
const pGeo = new BufferGeometry();
const pPos = new Float32Array(P_CAP * 3), pCol = new Float32Array(P_CAP * 3);
const pVel = new Float32Array(P_CAP * 3), pLife = new Float32Array(P_CAP);
let pHead = 0;
for (let i = 0; i < P_CAP; i++) pPos[i * 3 + 1] = -100;
pGeo.setAttribute("position", new BufferAttribute(pPos, 3));
pGeo.setAttribute("color", new BufferAttribute(pCol, 3));
const pMat = new PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
const points = new Points(pGeo, pMat);
points.frustumCulled = false;
world.add(points);
let particlesLive = false;

const moteSeed: [number, number, number][] = [];
for (let i = 0; i < MOTE_MAX; i++) {
  const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 12543.123, c = Math.sin(i * 39.425) * 24634.634;
  moteSeed.push([a - Math.floor(a), b - Math.floor(b), c - Math.floor(c)]);
}
const moteGeo = new BufferGeometry();
const motePos = new Float32Array(MOTE_MAX * 3);
moteGeo.setAttribute("position", new BufferAttribute(motePos, 3));
const motes = new Points(moteGeo, new PointsMaterial({ size: 0.07, map: dotTex, color: 0xfff1d0, transparent: true, opacity: 0.45, depthWrite: false }));
motes.frustumCulled = false;
motes.visible = false;
world.add(motes);
function updateMotes(t: number): void {
  const w = Math.max(cols * SPACING + 3, 8), top = BASE_Y + Math.max(rows, 6) * SPACING + 1;
  const n = Math.min(MOTE_MAX, look ? look.budget.motes : 0);
  moteGeo.setDrawRange(0, n);
  for (let i = 0; i < n; i++) {
    const [a, b, c] = moteSeed[i]!;
    motePos[i * 3] = (a - 0.5) * w + Math.sin(t * 0.3 + i) * 0.25;
    motePos[i * 3 + 1] = ((b * top + t * (0.08 + a * 0.08)) % top) + 0.3;
    motePos[i * 3 + 2] = -1.6 + c * 4.2;
  }
  (moteGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
}

function spawnBurst(x: number, y: number, z: number, colorHex: number, count: number): void {
  if (!look) return;
  const high = look.particlesHigh;
  const n = Math.min(high ? Math.ceil(count * 1.5) : count, high ? look.budget.burst : LOW_BURST);
  const c = new Color(colorHex);
  for (let k = 0; k < n; k++) {
    const i = pHead = (pHead + 1) % P_CAP;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    // High: every fifth particle is an over-bright sparkle the bloom catches.
    const glow = high && k % 5 === 0 ? 2.6 : 1;
    pCol[i * 3] = glow > 1 ? glow : c.r; pCol[i * 3 + 1] = glow > 1 ? glow * 0.95 : c.g; pCol[i * 3 + 2] = glow > 1 ? glow * 0.8 : c.b;
    const a = Math.random() * PI * 2, e = Math.random() * PI - PI / 2;
    const sp = 1.5 + Math.random() * 2.5;
    pVel[i * 3] = Math.cos(a) * Math.cos(e) * sp;
    pVel[i * 3 + 1] = Math.abs(Math.sin(e)) * sp + 1.2;
    pVel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * sp * 0.5;
    pLife[i] = 0.7 + Math.random() * 0.4;
  }
  (pGeo.getAttribute("color") as BufferAttribute).needsUpdate = true;
  particlesLive = true;
}

// -- state, timers and tweens (fixed steps) ---------------------------------------------------
let entities: Entity[] = [];
let byCell: Record<string, Entity> = {};
let anims: Anim[] = [];
let timers: { at: number; fn: () => void }[] = [];
let clockMs = 0; // fixed-step time (tick)
let ambientT = 0;
let shake = 0;
let focusCell: { r: number; c: number } | null = null;
let hoverGroup: { r: number; c: number }[] = [];
let hoverInvalid = false;
let hintCell: { r: number; c: number } | null = null;
let lastState: State | null = null;

export function cellPos(r: number, c: number): { x: number; y: number } {
  return { x: (c - (cols - 1) / 2) * SPACING, y: BASE_Y + (rows - 1 - r) * SPACING };
}

/** Loads a whole state (authoritative; ends every animation). */
export function syncToState(state: State): void {
  lastState = state;
  const nr = state.grid.length, nc = state.grid[0] ? state.grid[0].length : 0;
  const resized = nr !== rows || nc !== cols;
  rows = nr; cols = nc;
  if (resized || cubeMeshes.length !== colors.length || meshCap < rows * cols * 2) rebuildBoardMeshes();
  for (const e of entities) if (e.specialMesh) { boardGroup.remove(e.specialMesh); disposeTree(e.specialMesh); }
  entities = []; byCell = {}; anims = []; timers = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = state.grid[r]![c];
    if (!cell) continue;
    const p = cellPos(r, c);
    const e: Entity = { key: r + ":" + c, color: cell.c, special: cell.s, r, c, tx: p.x, ty: p.y, tz: 0, tscale: 1 };
    if (cell.s !== 0) e.specialMesh = makeSpecialMesh(cell.s, cell.c, p.x, p.y);
    entities.push(e);
    byCell[e.key] = e;
  }
  if (resized) frameCamera();
  fitShadow();
  updateMarkers();
  if (motes.visible) updateMotes(ambientT);
}

function tween(e: Entity, to: Record<string, number>, ms: number): void {
  anims.push({ e, from: { tx: e.tx, ty: e.ty, tscale: e.tscale }, to, t0: clockMs, ms });
}
function tweenObj(obj: Vector3, to: { x: number; y: number }, ms: number): void {
  anims.push({ obj, from: { x: obj.x, y: obj.y, z: obj.z }, to: { x: to.x, y: to.y, z: obj.z }, t0: clockMs, ms });
}

/** The rules' events of one move as animation; returns its length in ms (js/render.js playEvents). */
export function playEvents(events: RulesEvent[], next: State): number {
  if (reducedMotion) { syncToState(next); return 0; }
  let t = 0;
  const later = (ms: number, fn: () => void): void => { timers.push({ at: clockMs + ms, fn }); };
  let blastN = 0;
  for (const ev of events) {
    if (ev.type === "pop") {
      const cells = ev.cells ?? [];
      cells.forEach((cl, i) => {
        const e = byCell[cl.r + ":" + cl.c];
        if (!e) return;
        later(t + Math.min(i * 12, 90), () => { spawnBurst(e.tx, e.ty, 0.4, colors[e.color] ?? 0xffffff, 10); tween(e, { tscale: 0.01 }, POP_MS); });
      });
      t += POP_MS + Math.min(cells.length * 12, 90);
    } else if (ev.type === "special-create") {
      const p = cellPos(ev.r!, ev.c!);
      later(t, () => spawnBurst(p.x, p.y, 0.5, 0xffffff, 18));
      t += 80;
    } else if (ev.type === "fire") {
      const e = byCell[ev.r + ":" + ev.c];
      const p = e ? { x: e.tx, y: e.ty } : cellPos(ev.r!, ev.c!);
      later(t, () => spawnBurst(p.x, p.y, 0.4, colors[ev.color!] ?? 0xffffff, 24));
      t += 60;
    } else if (ev.type === "blast") {
      const at = t + blastN * 90;
      for (const cl of ev.cells ?? []) {
        const e = byCell[cl.r + ":" + cl.c];
        later(at, () => {
          const p = e ? { x: e.tx, y: e.ty } : cellPos(cl.r, cl.c);
          spawnBurst(p.x, p.y, 0.4, e ? colors[e.color] ?? 0xffe9a8 : 0xffe9a8, 8);
          if (e) tween(e, { tscale: 0.01 }, BLAST_MS);
        });
      }
      blastN++;
      shake = Math.min(shake + 0.12, 0.3);
      t += BLAST_MS * 0.7;
    } else if (ev.type === "fall") {
      later(t, () => {
        for (const mv of ev.moves ?? []) {
          const e = byCell[mv.fromR + ":" + mv.fromC];
          if (!e) continue;
          delete byCell[mv.fromR + ":" + mv.fromC];
          byCell[mv.toR + ":" + mv.toC] = e;
          e.r = mv.toR; e.c = mv.toC; e.key = mv.toR + ":" + mv.toC;
          const p = cellPos(mv.toR, mv.toC);
          tween(e, { tx: p.x, ty: p.y }, FALL_MS);
          if (e.specialMesh) tweenObj(e.specialMesh.position, p, FALL_MS);
        }
      });
      t += FALL_MS;
    } else if (ev.type === "refill") {
      later(t, () => {
        for (const cl of ev.cells ?? []) {
          const p = cellPos(cl.r, cl.c);
          const e: Entity = { key: cl.r + ":" + cl.c, color: cl.color ?? 0, special: 0, r: cl.r, c: cl.c, tx: p.x, ty: p.y + rows * SPACING * 0.5 + 1.5, tz: 0, tscale: 1 };
          entities.push(e);
          byCell[e.key] = e;
          tween(e, { ty: p.y }, FALL_MS + 120);
        }
      });
      t += FALL_MS + 120;
    } else if (ev.type === "shuffle") {
      t += SHUFFLE_MS; // the final sync lands the positions
      shake = Math.min(shake + 0.08, 0.2);
    } else if (ev.type === "wave" || ev.type === "win") {
      later(t, () => {
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * PI * 2;
          spawnBurst(Math.cos(a) * 2.5, BASE_Y + rows * 0.5 + Math.sin(a) * 1.5, 1, [0xffd76a, 0xff9d5c, 0x8fd48f][i % 3]!, 3);
        }
      });
      t += 200;
    }
  }
  later(t + 30, () => syncToState(next)); // the authoritative landing
  return t + 30;
}

// -- selection and focus -------------------------------------------------------------------
export function setFocusCell(r: number | null, c = 0): void { focusCell = r == null ? null : { r, c }; updateMarkers(); }
export function setHoverGroup(cells: { r: number; c: number }[], invalid = false): void { hoverGroup = cells; hoverInvalid = invalid; updateMarkers(); }
export function setHintCell(r: number | null, c = 0): void { hintCell = r == null ? null : { r, c }; updateMarkers(); }
function updateMarkers(): void {
  let mi = 0;
  const use = (x: number, y: number, color: number, opacity: number): void => {
    if (mi >= markers.length) return;
    const m = markers[mi++]!;
    m.visible = true;
    m.position.set(x, y, CUBE / 2 - 0.05);
    m.material.color.set(color);
    m.material.opacity = opacity;
  };
  for (const cl of hoverGroup) { const p = cellPos(cl.r, cl.c); use(p.x, p.y, hoverInvalid ? 0xd84f45 : 0xffffff, 0.85); }
  if (hintCell) { const p = cellPos(hintCell.r, hintCell.c); use(p.x, p.y, 0xffd76a, 1); }
  for (let i = mi; i < markers.length; i++) markers[i]!.visible = false;
  if (focusCell && rows) {
    const p = cellPos(focusCell.r, focusCell.c);
    focusRing.visible = true;
    focusRing.position.set(p.x, p.y, CUBE / 2 + 0.06);
  } else focusRing.visible = false;
}

// -- camera ---------------------------------------------------------------------------------
let view = { x: 0, y: 0, w: 1, h: 1, W: 1, H: 1 };
const orbit = { yaw: 0, pitch: 0 };
let camDist = 12;
function frameCamera(): void {
  const w = Math.max(cols * SPACING + 0.6, 5), h = Math.max(rows * SPACING + 0.8, 5);
  const aspect = view.w / view.h;
  const tan = Math.tan((camera.fov * PI) / 360);
  camDist = Math.max(h / (2 * tan), w / (2 * tan * aspect)) + 1.2;
  camera.setViewOffset(view.w, view.h, -view.x, -view.y, view.W, view.H);
  applyCamera();
}
function applyCamera(): void {
  const cy = BASE_Y + ((rows - 1) * SPACING) / 2;
  const d = camDist;
  let x = Math.sin(orbit.yaw) * d, y = cy + Math.sin(orbit.pitch) * d + 0.6;
  const z = Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * d;
  if (shake > 0.001 && !reducedMotion) {
    x += (Math.random() - 0.5) * shake;
    y += (Math.random() - 0.5) * shake;
  }
  camera.position.set(x, y, z);
  camera.lookAt(0, cy, 0);
}
/** The playfield (window pixels) the wall is framed into, within the W × H window. */
export function setPlayfield(x: number, y: number, w: number, h: number, W: number, H: number): void {
  const next = { x, y, w: Math.max(1, w), h: Math.max(1, h), W: Math.max(1, W), H: Math.max(1, H) };
  if ((Object.keys(next) as (keyof typeof next)[]).every((k) => Math.abs(next[k] - view[k]) < 0.5)) return;
  view = next;
  frameCamera();
}
export function playfield(): { x: number; y: number; w: number; h: number } { return view; }
export function resetCamera(): void { orbit.yaw = 0; orbit.pitch = 0; }
/** A drag on the board orbits the camera a little (window pixels moved). */
export function orbitBy(dx: number, dy: number, scale: number): void {
  orbit.yaw = Math.max(-0.35, Math.min(0.35, orbit.yaw - (dx / scale) * 0.002));
  orbit.pitch = Math.max(-0.15, Math.min(0.3, orbit.pitch + (dy / scale) * 0.002));
}
/** Whether the studio draws (only in a round: the title and lists sit on the page colour). */
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }

const ray = new Raycaster();
const face = new Plane(new Vector3(0, 0, 1), -CUBE / 2);
const hit = new Vector3();
/** The cell under a window pixel, or null (js/render.js toCell: the cubes' front plane). */
export function pick(x: number, y: number): { r: number; c: number } | null {
  if (!rows || !renderer.camera || x < view.x || y < view.y || x > view.x + view.w || y > view.y + view.h) return null;
  ray.setFromCamera(pointerToNdc(x, y), camera);
  if (!ray.ray.intersectPlane(face, hit)) return null;
  const c = Math.round(hit.x / SPACING + (cols - 1) / 2);
  const r = Math.round(rows - 1 - (hit.y - BASE_Y) / SPACING);
  if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
  return { r, c };
}
/** Window pixel of a cell's centre (for the accessibility targets). */
export function cellScreen(r: number, c: number): { x: number; y: number; size: number } | null {
  if (!rows || !renderer.camera) return null;
  const p = cellPos(r, c);
  const v = new Vector3(p.x, p.y, CUBE / 2).project(camera);
  const v2 = new Vector3(p.x + SPACING / 2, p.y, CUBE / 2).project(camera);
  const sx = (v.x + 1) / 2 * view.W, sy = (1 - v.y) / 2 * view.H;
  const sx2 = (v2.x + 1) / 2 * view.W;
  return { x: sx, y: sy, size: Math.abs(sx2 - sx) * 2 };
}

function fitShadow(): void {
  const w = (Math.max(cols, 4) * SPACING) / 2 + 1.2;
  const top = BASE_Y + Math.max(rows, 4) * SPACING + 0.6;
  const center = new Vector3(0, top / 2, 0.2);
  const radius = Math.hypot(w, top / 2, 2.6);
  // The engine fits the directional shadow to the view out to `distance` (three.js fitted its ortho camera).
  keyLight.shadow.distance = 20 + radius * 2;
  keyLight.target.position.copy(center);
  keyLight.position.copy(center).addScaledVector(keyDir, 20);
}

// -- theme and look --------------------------------------------------------------------------
/** The theme's studio and the cube colours (the high-contrast palette while the runtime's option is on). */
export function setTheme(p: Palette, cubeColors: number[]): void {
  const same = palette === p && colors.length === cubeColors.length && colors.every((c, i) => c === cubeColors[i]);
  if (same) return;
  palette = p;
  colors = cubeColors.slice();
  scene.background = new Color(p.wall);
  scene.fog = new Fog(p.fog, 18, 40);
  keyLight.color.set(p.light);
  buildEnvironment();
  rebuildBoardMeshes();
  if (lastState) syncToState(lastState);
}

export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const before = look;
  look = next;
  const shadows = next.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  keyLight.castShadow = shadows;
  if (shadows) keyLight.shadow.mapSize = next.shadows;
  // Image-based lighting replaces most of the flat fill when reflections are on.
  scene.environment = next.reflections ? envMap() : null;
  fillLight.intensity = (next.reflections ? 0.7 : 0.9) / PI;
  ambient.intensity = (next.reflections ? 0.1 : 0.25) / PI;
  rimLight.intensity = next.detailed ? 0.6 / PI : 0;
  motes.visible = next.animated;
  // High particles: larger soft round confetti; Low keeps the cheap squares.
  pMat.map = next.particlesHigh ? dotTex : null;
  pMat.size = next.particlesHigh ? 0.16 : 0.09;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.85, radius: 0.45, distanceExponent: 1.2, thickness: 1.0, scale: 1.0, samples: next.ao === "high" ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // A high threshold: only sparks, sparkles and hot highlights bloom (UnrealBloomPass 0.45, 0.4, 0.9).
  renderer.bloom = next.bloom ? { strength: 0.45, radius: 0.4, threshold: 0.9, resolution: next.budget.bloomRes } : null;
  // js/render.js GradeShader (display space): a gentle S-curve, a touch more
  // saturation, warm highlights / cool shadows and the 0.2 vignette.
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.07, saturation: 1.1,
    shadows: [0.97, 0.98, 1.03], highlights: [1.03, 1.0, 0.96], split: [0.2, 0.8],
    vignette: { amount: 0.2, inner: 0.38, outer: 0.9, scale: [1, 0.85] },
  } : null;
  renderer.antialias = next.antialias;
  // Asset variants (material class, cube LOD, textures) are built into the meshes: build them again.
  const b = before?.budget;
  const assets = !b || before!.detailed !== next.detailed || b.material !== next.budget.material || b.cubeCurve !== next.budget.cubeCurve
    || b.cubeBevel !== next.budget.cubeBevel || b.texture !== next.budget.texture;
  if (assets && palette) {
    buildEnvironment();
    rebuildBoardMeshes();
    if (lastState) syncToState(lastState);
  }
  updateMotes(ambientT);
}
export function ambientLook(): boolean { return !!look && look.animated; }
export function setReducedMotion(on: boolean): void {
  reducedMotion = on;
  if (on && lastState && (anims.length || timers.length)) {
    const pending = timers.slice().sort((a, b) => a.at - b.at);
    timers = [];
    for (const t of pending) t.fn();
    syncToState(lastState);
  }
}
/** Leaves the round: nothing on the wall. */
export function clear(): void {
  lastState = null;
  for (const e of entities) if (e.specialMesh) { boardGroup.remove(e.specialMesh); disposeTree(e.specialMesh); }
  entities = []; byCell = {}; anims = []; timers = [];
  for (const m of cubeMeshes) m.count = 0;
  for (const m of charmMeshes) m.count = 0;
  focusCell = null; hoverGroup = []; hintCell = null;
  updateMarkers();
  shake = 0;
}

// -- the frame ---------------------------------------------------------------------------------
/** One fixed step (ms): timers, tweens, the ambient clock and the shake's decay. */
export function tick(dtMs: number): void {
  clockMs += dtMs;
  if (timers.length) {
    const due = timers.filter((t) => t.at <= clockMs).sort((a, b) => a.at - b.at);
    if (due.length) {
      timers = timers.filter((t) => t.at > clockMs);
      for (const t of due) t.fn();
    }
  }
  const keep: Anim[] = [];
  for (const a of anims) {
    const t = Math.min(1, (clockMs - a.t0) / Math.max(1, a.ms));
    const k = t * t * (3 - 2 * t); // smoothstep
    if (a.e) {
      if (a.to.tx !== undefined) a.e.tx = a.from.tx! + (a.to.tx - a.from.tx!) * k;
      if (a.to.ty !== undefined) a.e.ty = a.from.ty! + (a.to.ty - a.from.ty!) * k;
      if (a.to.tscale !== undefined) a.e.tscale = a.from.tscale! + (a.to.tscale - a.from.tscale!) * k;
    } else if (a.obj) {
      a.obj.set(a.from.x! + (a.to.x! - a.from.x!) * k, a.from.y! + (a.to.y! - a.from.y!) * k, a.from.z!);
    }
    if (t < 1) keep.push(a);
  }
  anims = keep;
  if (look && look.animated && !reducedMotion) ambientT += dtMs / 1000;
  if (shake > 0.001) shake *= Math.pow(0.88, dtMs / 16.67);
}

const m4 = new Matrix4(), q = new Quaternion(), sc = new Vector3(), pos = new Vector3();
/** Each rendered frame: instance matrices, the specials' bob, motes, the key light, confetti and the camera. */
export function update(dtIn: number): void {
  const dt = Math.min(0.05, Math.max(0, dtIn));
  const ambientOn = !!look && look.animated && !reducedMotion;
  if (cubeMeshes.length) {
    const counts = cubeMeshes.map(() => 0);
    const hover = new Set(reducedMotion ? [] : hoverGroup.map((h) => h.r + ":" + h.c));
    for (const e of entities) {
      const b = e.color % cubeMeshes.length;
      const i = counts[b]!;
      if (i >= meshCap) continue;
      counts[b] = i + 1;
      const s = Math.max(0.001, e.tscale);
      const z = e.tz + (hover.has(e.r + ":" + e.c) ? 0.12 : 0); // the hovered group lifts
      m4.compose(pos.set(e.tx, e.ty, z), q.identity(), sc.setScalar(s));
      cubeMeshes[b]!.setMatrixAt(i, m4);
      m4.compose(pos.set(e.tx, e.ty, z + CUBE / 2 + 0.02), q, sc.setScalar(s * 0.9));
      charmMeshes[b]!.setMatrixAt(i, m4);
    }
    cubeMeshes.forEach((m, i) => { m.count = counts[i]!; m.instanceMatrix.needsUpdate = true; });
    charmMeshes.forEach((m, i) => { m.count = counts[i]!; m.instanceMatrix.needsUpdate = true; });
  }
  // Specials follow their entities (an idle bob and a flickering fuse on animated looks).
  for (const e of entities) {
    if (!e.specialMesh) continue;
    const u = e.specialMesh.userData as { spark: Mesh | null; phase: number };
    const bob = ambientOn ? Math.sin(ambientT * 2.2 + u.phase) * 0.035 : 0;
    e.specialMesh.position.set(e.tx, e.ty + bob, e.tz);
    if (u.spark) u.spark.scale.setScalar(ambientOn ? 0.75 + 0.25 * Math.sin(ambientT * 17 + u.phase) * Math.sin(ambientT * 7.3) : 1);
  }
  if (motes.visible && ambientOn) updateMotes(ambientT);
  // Warm light shimmer: a slow, tiny breathing of the key light.
  keyLight.intensity = KEY * (ambientOn ? 1 + 0.025 * Math.sin(ambientT * 0.9) : 1);
  if (particlesLive) {
    let any = false;
    for (let i = 0; i < P_CAP; i++) {
      if (pLife[i]! <= 0) continue;
      any = true;
      pLife[i] = pLife[i]! - dt;
      pVel[i * 3 + 1] = pVel[i * 3 + 1]! - 6 * dt;
      pPos[i * 3] = pPos[i * 3]! + pVel[i * 3]! * dt;
      pPos[i * 3 + 1] = pPos[i * 3 + 1]! + pVel[i * 3 + 1]! * dt;
      pPos[i * 3 + 2] = pPos[i * 3 + 2]! + pVel[i * 3 + 2]! * dt;
      if (pLife[i]! <= 0) pPos[i * 3 + 1] = -100;
    }
    (pGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
    particlesLive = any;
  }
  applyCamera();
}

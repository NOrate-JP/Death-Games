// 共通3Dシーン：部屋・テーブル・席・各席のリボルバー・警報・配札・カメラ・ポストエフェクト
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sfx } from '../audio.js';

export const TABLE_Y = 0.78;
export const TABLE_R = 1.25;
const SEAT_R = 1.78;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- テクスチャ ----------
// 壁・床などはPS1風（低解像度×Nearest）、テーブルとカードは高解像度で読みやすく
function canvasTex(w, h, draw, { repeat, smooth = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (smooth) { t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; }
  else { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function speckle(g, w, h, n, a) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,255,255'},${Math.random() * a})`;
    g.fillRect(Math.random() * w | 0, Math.random() * h | 0, 1 + Math.random() * 2 | 0, 1 + Math.random() * 2 | 0);
  }
}
function stains(g, w, h, n, col) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * w * 0.2;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}
const lam = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
const easeIO = (t) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

const MASKS = [
  { mask: 0xd9d0bd, eye: 0x111111, hat: 'top', coat: 0x3a3028 },
  { mask: 0x9e2a22, eye: 0x111111, hat: 'hood', coat: 0x3e2020 },
  { mask: 0x222222, eye: 0xc9a14a, hat: 'none', coat: 0x283038 },
  { mask: 0xc9a14a, eye: 0x1a1008, hat: 'bowler', coat: 0x3e3420 },
  { mask: 0x6e7f86, eye: 0x0c0c0c, hat: 'hood', coat: 0x2a3438 },
  { mask: 0xe8e2d4, eye: 0x7a1010, hat: 'bowler', coat: 0x3a2c34 },
];

const POST_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FS = `
uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uFlash, uDark, uLevels, uRed;
varying vec2 vUv;
float b2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float b4(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); }
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float d = (b4(vUv * uRes) - 0.5) * 0.7;
  c = clamp(floor(c * uLevels + d + 0.5) / uLevels, 0.0, 1.0);
  vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.7;
  float n = fract(sin(dot(floor(vUv * uRes) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * 0.02;
  c = mix(c, c * vec3(1.35, 0.35, 0.3) + vec3(0.06, 0.0, 0.0), uRed);
  c = mix(c, vec3(1.0, 0.96, 0.86), uFlash);
  c *= (1.0 - uDark);
  gl_FragColor = vec4(c, 1.0);
}`;

export class TableScene {
  // opts: { pixel, attract(背景用の自動回転), dummySeats }
  constructor(container, { pixel = 2, attract = false } = {}) {
    this.container = container;
    this.pixel = pixel;
    this.tweens = [];
    this.seats = new Map();
    this.cardTex = new Map();
    this.mode = attract ? { kind: 'attract' } : { kind: 'overview' };
    this.lookOff = { yaw: 0, pitch: 0, dragging: false };
    this.attractAng = Math.random() * 6;
    this.alarm = 0; this.alarmTarget = 0;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.maxAniso = r.capabilities.getMaxAnisotropy();
    const cv = r.domElement;
    cv.className = 'scene-canvas';
    container.appendChild(cv);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'label-layer';
    container.appendChild(this.labelLayer);

    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x0c0807);
    s.fog = new THREE.Fog(0x0c0807, 5, 14);
    this.camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.03, 60);
    this.look = V(0, TABLE_Y, 0);
    this.camPos = V(0, 3.1, 3.5);
    this.camera.position.copy(this.camPos);

    this.rt = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.postU = {
      tDiffuse: { value: this.rt.texture }, uRes: { value: new THREE.Vector2(2, 2) },
      uTime: { value: 0 }, uFlash: { value: 0 }, uDark: { value: 0 }, uLevels: { value: 48 }, uRed: { value: 0 },
    };
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms: this.postU, vertexShader: POST_VS, fragmentShader: POST_FS, depthTest: false })));

    this.controls = new OrbitControls(this.camera, cv);
    this.controls.enabled = false;
    this.controls.target.set(0, TABLE_Y, 0);
    this.controls.maxDistance = 6.5; this.controls.minDistance = 0.6;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this._buildRoom();
    this._buildTable();
    this.props = new THREE.Group(); s.add(this.props); // ゲーム固有の小物置き場

    this._bindLook(cv);
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this.resize();
    this.clock = new THREE.Clock();
    this._alive = true;
    const loop = () => { if (!this._alive) return; this._raf = requestAnimationFrame(loop); this._frame(); };
    loop();
  }

  dispose() {
    this._alive = false; cancelAnimationFrame(this._raf); this._ro.disconnect();
    this.renderer.dispose(); this.renderer.forceContextLoss();
    this.container.innerHTML = '';
  }

  setPixel(p) { this.pixel = p; this.resize(); }

  resize() {
    const w = this.container.clientWidth || 2, h = this.container.clientHeight || 2;
    const rw = Math.max(2, Math.floor(w / this.pixel)), rh = Math.max(2, Math.floor(h / this.pixel));
    this.renderer.setSize(rw, rh, false);
    this.rt.setSize(rw, rh);
    this.postU.uRes.value.set(rw, rh);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------- 部屋 ----------
  _buildRoom() {
    const s = this.scene;
    const wallT = canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#6a5850'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) for (let x = (y / 8 % 2) * 8; x < w + 16; x += 16) {
        const v = 90 + Math.random() * 30 | 0;
        g.fillStyle = `rgb(${v + 20},${v * .62 | 0},${v * .52 | 0})`; g.fillRect(x - 15, y + 1, 14, 6);
      }
      stains(g, w, h, 5, 'rgba(20,10,5,.35)');
      speckle(g, w, h, 200, .2);
    }, { repeat: [10, 4] });
    const walls = new THREE.Mesh(new THREE.BoxGeometry(13, 5.2, 13), lam(0xffffff, { map: wallT, side: THREE.BackSide }));
    walls.position.y = 2.6; walls.receiveShadow = true; s.add(walls);
    const floorT = canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#3d3a3c'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
        const v = 52 + Math.random() * 16 | 0; g.fillStyle = `rgb(${v},${v - 2},${v + 4})`; g.fillRect(x + 1, y + 1, 14, 14);
      }
      stains(g, w, h, 4, 'rgba(10,8,6,.4)');
      speckle(g, w, h, 300, .2);
    }, { repeat: [10, 10] });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), lam(0xffffff, { map: floorT }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; floor.receiveShadow = true; s.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.9, 2.96, 40), new THREE.MeshBasicMaterial({ color: 0x8a8272 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; s.add(ring);

    const beamM = lam(0x3a2c22);
    for (let i = -2; i <= 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(13, 0.22, 0.25), beamM); b.position.set(0, 4.7, i * 2.4); s.add(b);
    }
    // 吊りランプ
    const lampG = new THREE.Group(); lampG.position.set(0, 2.75, 0); s.add(lampG);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.32, 8, 1, true), lam(0x3a3830, { side: THREE.DoubleSide }));
    lampG.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
    bulb.position.y = -0.12; lampG.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2, 4), lam(0x111111)); cord.position.y = 1.1; lampG.add(cord);
    this.lampG = lampG;
    const spot = new THREE.SpotLight(0xffd2a0, 22, 9, Math.PI * 0.38, 0.6, 1.0);
    spot.position.set(0, 2.6, 0); spot.target.position.set(0, 0, 0);
    spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0015;
    s.add(spot); s.add(spot.target); this.spot = spot; this.spotBase = 22;
    this.lampLight = new THREE.PointLight(0xffc080, 7, 10, 1.1); this.lampLight.position.set(0, 2.5, 0); s.add(this.lampLight);
    this.hemi = new THREE.HemisphereLight(0xb8a8a0, 0x302420, 2.0); s.add(this.hemi);
    this.hemiCol = this.hemi.color.clone();
    this.amb = new THREE.AmbientLight(0x4a3a34, 1.0); s.add(this.amb);
    const red = new THREE.PointLight(0xff4a2a, 8, 12, 1.2); red.position.set(-5.5, 3.6, -5.5); s.add(red);
    const fill = new THREE.PointLight(0xa0b0c0, 5, 12, 1.2); fill.position.set(5.5, 3.2, 5); s.add(fill);
    const emerg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.1), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    emerg.position.set(-5.6, 3.6, -6.4); s.add(emerg);
    // 警報灯（回転灯）
    this.alarmLights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xff1a0a, 0, 14, 1.0); s.add(l); this.alarmLights.push(l);
    }
    const beacons = [];
    for (const [x, z] of [[-6.3, 0], [6.3, 0], [0, -6.3]]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.24, 8), new THREE.MeshBasicMaterial({ color: 0x401010 }));
      b.position.set(x, 3.9, z); s.add(b); beacons.push(b);
    }
    this.beacons = beacons;

    // ステージライト
    const mkStage = (x, z, ry) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; s.add(g);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 5), lam(0x2a2a2a)); pole.position.y = 1.6; g.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.06, 6), lam(0x2a2a2a)); g.add(base);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 7), lam(0x3a3a3a)); head.position.y = 3.2; head.rotation.x = 1.0; g.add(head);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.2, 7), new THREE.MeshBasicMaterial({ color: 0x6a5a40 }));
      lens.position.set(0, 3.08, 0.22); lens.rotation.x = 1.0 - Math.PI / 2; g.add(lens);
    };
    mkStage(-3.6, -3.2, 0.7); mkStage(3.6, -3.2, -0.7);
    const spk = (x, z, ry, sc = 1) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(sc); s.add(g);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.6), lam(0x3b3430)); b.position.y = 0.65; b.castShadow = true; g.add(b);
      const c1 = new THREE.Mesh(new THREE.CircleGeometry(0.3, 8), lam(0x151515)); c1.position.set(0, 0.5, 0.31); g.add(c1);
      const c2 = new THREE.Mesh(new THREE.CircleGeometry(0.12, 8), lam(0x151515)); c2.position.set(0, 1.05, 0.31); g.add(c2);
    };
    spk(-5.2, -2, 1.2, 1.2); spk(-5.4, -0.6, 1.4); spk(5.3, -1.6, -1.3, 1.1);
    const crateT = canvasTex(32, 32, (g, w, h) => {
      g.fillStyle = '#7a5a36'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#5a3f24'; for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 1);
      g.strokeStyle = '#4a3018'; g.lineWidth = 3; g.strokeRect(1, 1, w - 2, h - 2);
      speckle(g, w, h, 60, .2);
    });
    const crate = (x, y, z, sz, ry) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), lam(0xffffff, { map: crateT })); m.position.set(x, y + sz / 2, z); m.rotation.y = ry; m.castShadow = true; s.add(m);
    };
    crate(4.8, 0, 3.2, 0.8, 0.3); crate(5.2, 0.8, 3.4, 0.55, 0.9); crate(-4.9, 0, 3.8, 0.7, -0.2);
    const shelf = new THREE.Group(); shelf.position.set(4.6, 0, -4.8); shelf.rotation.y = -0.4; s.add(shelf);
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.5), lam(0x4a3a2c)); p.position.y = 0.4 + i * 0.55; shelf.add(p);
      for (let k = 0; k < 4; k++) if (Math.random() < 0.7) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.25 + Math.random() * 0.2, 0.2 + Math.random() * 0.2, 0.3), lam([0x6a5e4c, 0x4a4a42, 0x7a3a2c][k % 3]));
        box.position.set(-0.6 + k * 0.4, 0.55 + i * 0.55, 0); shelf.add(box);
      }
    }
    const cableM = lam(0x151210);
    for (let i = 0; i < 7; i++) {
      const a = V(-6 + Math.random() * 12, 4.6, -6 + Math.random() * 12);
      const b = V(-6 + Math.random() * 12, 4.6, -6 + Math.random() * 12);
      const mid = a.clone().lerp(b, 0.5); mid.y = 2.8 + Math.random() * 1.2;
      s.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 10, 0.025, 4, false), cableM));
    }
  }

  // ---------- テーブル（テクスチャは高解像度） ----------
  _buildTable() {
    const s = this.scene;
    const felt = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#2f4a3a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '200,220,200'},${Math.random() * .06})`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      stains(g, w, h, 10, 'rgba(20,15,8,.25)');
      g.strokeStyle = 'rgba(225,215,180,.55)'; g.lineWidth = 4;
      g.beginPath(); g.arc(w / 2, h / 2, w * 0.235, 0, 7); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.arc(w / 2, h / 2, w * 0.455, 0, 7); g.stroke();
      g.setLineDash([10, 10]); g.lineWidth = 2; g.beginPath(); g.arc(w / 2, h / 2, w * 0.36, 0, 7); g.stroke();
    }, { smooth: true });
    felt.anisotropy = this.maxAniso;
    const top = new THREE.Mesh(new THREE.CircleGeometry(TABLE_R, 40), new THREE.MeshLambertMaterial({ color: 0xffffff, map: felt }));
    top.rotation.x = -Math.PI / 2; top.position.y = TABLE_Y + 0.001; top.receiveShadow = true; s.add(top);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R, TABLE_R * 0.97, 0.08, 24), lam(0x5a3a22));
    body.position.y = TABLE_Y - 0.04; body.receiveShadow = true; s.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R, 0.05, 5, 32), lam(0x6a4024));
    rim.rotation.x = Math.PI / 2; rim.position.y = TABLE_Y + 0.01; s.add(rim);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, TABLE_Y - 0.08, 6), lam(0x3a2414)); leg.position.y = (TABLE_Y - 0.08) / 2; s.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.06, 6), lam(0x3a2414)); foot.position.y = 0.03; s.add(foot);
  }

  // ---------- リボルバー（+Z方向が銃口） ----------
  _makeRevolver() {
    const g = new THREE.Group();
    const metal = lam(0x5a5e64), dark = lam(0x2a2b2e), wood = lam(0x7a4424);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.24), metal); barrel.position.set(0, 0.035, 0.14); g.add(barrel);
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.24), dark); rib.position.set(0, 0.06, 0.14); g.add(rib);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.075, 6), metal); drum.rotation.x = Math.PI / 2; drum.position.set(0, 0.02, -0.005); g.add(drum);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.1), dark); frame.position.set(0, 0.03, -0.06); g.add(frame);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.13, 0.055), wood); grip.position.set(0, -0.045, -0.12); grip.rotation.x = -0.35; g.add(grip);
    const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.035, 0.02), dark); hammer.position.set(0, 0.07, -0.1); g.add(hammer);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 3, 6, Math.PI), dark); guard.position.set(0, -0.01, -0.04); guard.rotation.y = Math.PI / 2; guard.rotation.z = Math.PI; g.add(guard);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.scale.setScalar(1.4);
    const muzzle = new THREE.PointLight(0xffe0a0, 0, 4, 1.2); muzzle.position.set(0, 0.04, 0.3); g.add(muzzle);
    g.userData = { drum, muzzle };
    return g;
  }

  // ---------- 席 ----------
  // seats: [{uid, name}]（席順）, me: 自分のuid（観戦者はnull）, opts.empty: 椅子とリボルバーだけ（背景用）
  setSeats(seats, me, { empty = false } = {}) {
    for (const st of this.seats.values()) { this.scene.remove(st.group); this.scene.remove(st.marker); this.scene.remove(st.gun); st.label.remove(); }
    this.seats.clear();
    this.me = me;
    const n = seats.length;
    const meIdx = Math.max(0, seats.findIndex((x) => x.uid === me));
    seats.forEach((p, i) => {
      const a = Math.PI / 2 + ((i - meIdx) * Math.PI * 2) / n;
      const pos = V(Math.cos(a) * SEAT_R, 0, Math.sin(a) * SEAT_R);
      const st = this._makeSeat(p, i, pos, p.uid === me, empty);
      this.seats.set(p.uid, st);
    });
  }

  _makeSeat(p, i, pos, isMe, empty) {
    const v = MASKS[i % MASKS.length];
    const g = new THREE.Group(); g.position.copy(pos);
    g.rotation.y = Math.atan2(-pos.x, -pos.z);
    this.scene.add(g);
    g.updateMatrixWorld();
    const chairM = lam(0x5a3a24);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.5), chairM); seat.position.set(0, 0.47, -0.12); g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.06), chairM); back.position.set(0, 0.85, -0.38); g.add(back);
    for (const [x, z] of [[-.24, .1], [.24, .1], [-.24, -.34], [.24, -.34]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.47, 0.05), chairM); l.position.set(x, 0.235, z); g.add(l);
    }
    const body = new THREE.Group(); body.position.set(0, 0.5, -0.12); g.add(body);
    const coatM = lam(v.coat);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.72, 7), coatM); torso.position.y = 0.38; body.add(torso);
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.12, 0.26), coatM); shoulder.position.y = 0.7; body.add(shoulder);
    const head = new THREE.Group(); head.position.set(0, 0.93, 0.02); body.add(head);
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), lam(0x4a3a30)); head.add(skull);
    const maskM = lam(v.mask, { emissive: v.mask, emissiveIntensity: 0.1 });
    const mask = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.11, 0.05, 7), maskM);
    mask.rotation.x = Math.PI / 2; mask.position.z = 0.14; mask.scale.set(1, 1, 1.25); head.add(mask);
    const eyeM = new THREE.MeshBasicMaterial({ color: v.eye });
    for (const x of [-0.05, 0.05]) {
      const e = new THREE.Mesh(new THREE.CircleGeometry(0.022, 5), eyeM); e.position.set(x, 0.025, 0.167); head.add(e);
    }
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.008), eyeM); mouth.position.set(0, -0.06, 0.167); head.add(mouth);
    const hatM = lam(0x1a1816);
    if (v.hat === 'top') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 8), hatM); brim.position.y = 0.13; head.add(brim);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.26, 8), hatM); crown.position.y = 0.26; head.add(crown);
    } else if (v.hat === 'bowler') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.02, 8), hatM); brim.position.y = 0.11; head.add(brim);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), hatM); crown.position.y = 0.11; head.add(crown);
    } else if (v.hat === 'hood') {
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.48, 7, 1, true), lam(v.coat, { side: THREE.DoubleSide })); hood.position.set(0, 0.06, -0.04); head.add(hood);
    }
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.48), coatM);
      arm.position.set(sx * 0.24, 0.62, 0.22); arm.rotation.x = 0.45; arm.rotation.y = -sx * 0.25; body.add(arm);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.1), lam(0x6a5448)); hand.position.set(sx * 0.13, 0.42, 0.48); body.add(hand);
    }
    body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const fan = new THREE.Group(); fan.position.set(0, 0.98, 0.5); fan.rotation.x = -0.5; g.add(fan);
    // 卓上マーカー
    const ang = Math.atan2(pos.z, pos.x);
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.13, 16), new THREE.MeshBasicMaterial({ color: 0x4a3a30, transparent: true, opacity: 0.8 }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(Math.cos(ang) * (TABLE_R - 0.18), TABLE_Y + 0.004, Math.sin(ang) * (TABLE_R - 0.18));
    this.scene.add(marker);
    // 各自のリボルバー（手元の右側に置かれている）
    const gun = this._makeRevolver();
    const restPos = g.localToWorld(V(0.34, TABLE_Y + 0.035, 0.78));
    const restQ = g.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.35, Math.PI / 2)));
    gun.position.copy(restPos); gun.quaternion.copy(restQ);
    this.scene.add(gun);
    // ラベル
    const label = document.createElement('div');
    label.className = 'seat-label';
    label.innerHTML = `<div class="nm"></div><div class="st"></div><div class="gx"></div><div class="ex"></div>`;
    label.querySelector('.nm').textContent = p.name || '';
    this.labelLayer.appendChild(label);
    if (isMe || empty) body.visible = false;
    if (empty) label.style.display = 'none';
    return { uid: p.uid, name: p.name, group: g, body, head, maskM, fan, marker, label, isMe, empty, alive: true, pos, idx: i, handCount: -1, gun, restPos, restQ, raised: false };
  }

  setSeatStatus(uid, { status, extra, active, alive, game } = {}) {
    const st = this.seats.get(uid); if (!st) return;
    if (game !== undefined) st.label.querySelector('.gx').textContent = game;
    if (status !== undefined) st.label.querySelector('.st').textContent = status;
    if (extra !== undefined) st.label.querySelector('.ex').textContent = extra;
    if (active !== undefined) {
      st.label.classList.toggle('active', active);
      st.marker.material.color.set(active ? 0xff5030 : 0x4a3a30);
    }
    if (alive !== undefined && alive !== st.alive) this.setDead(uid, !alive, true);
  }

  setDead(uid, dead, instant) {
    const st = this.seats.get(uid); if (!st || !dead || !st.alive) return;
    st.alive = false;
    st.label.classList.add('dead');
    this.setHandCount(uid, 0);
    st.maskM.emissiveIntensity = 0;
    const doIt = (t) => { st.body.rotation.x = 0.95 * t; st.body.position.y = 0.5 - 0.08 * t; };
    if (instant) doIt(1); else this.tween(900, doIt, easeOut);
    st.body.traverse((o) => {
      if (o.isMesh && o.material.color) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.45); }
    });
  }

  setBackCanvas(c) { this._backCanvas = c; }
  // 席のローカル座標（+zがテーブル中央方向）→ワールド座標
  seatPoint(uid, x, y, z) { const st = this.seats.get(uid); return st ? st.group.localToWorld(V(x, y, z)) : V(0, y, 0); }
  seatYaw(uid) { const st = this.seats.get(uid); return st ? st.group.rotation.y : 0; }

  setHandCount(uid, n) {
    const st = this.seats.get(uid); if (!st || st.isMe) return;
    n = Math.min(n, 14);
    if (st.handCount === n) return;
    st.handCount = n;
    st.fan.clear();
    if (!n || !this._backCanvas) return;
    const tex = this.texFor('__back', this._backCanvas);
    const geo = new THREE.PlaneGeometry(0.1, 0.15);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      m.position.set(t * 0.24, -Math.abs(t) * 0.03, i * 0.002);
      m.rotation.z = -t * 0.6;
      m.rotation.y = Math.PI;
      st.fan.add(m);
    }
  }

  // ---------- カード ----------
  texFor(key, canvas) {
    if (!this.cardTex.has(key)) {
      const t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.anisotropy = this.maxAniso; t.colorSpace = THREE.SRGBColorSpace;
      this.cardTex.set(key, t);
    }
    return this.cardTex.get(key);
  }
  makeCard(key, canvas, w = 0.24) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 1.5), new THREE.MeshLambertMaterial({ map: this.texFor(key, canvas), color: 0xcfc6b6 }));
    m.receiveShadow = true;
    return m;
  }
  handWorldPos(uid) {
    const st = this.seats.get(uid);
    if (!st) return V(0, TABLE_Y + 0.3, 0);
    if (st.isMe && this.mode.kind === 'seat' && this.mode.uid === uid) {
      const f = new THREE.Vector3(); this.camera.getWorldDirection(f);
      return this.camera.position.clone().add(f.multiplyScalar(0.5)).add(V(0, -0.28, 0));
    }
    return st.fan.getWorldPosition(new THREE.Vector3());
  }
  flyCard(mesh, fromUid, toPos, toRotZ = 0, dur = 480) {
    const from = this.handWorldPos(fromUid);
    mesh.position.copy(from);
    this.scene.add(mesh);
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, Math.random() * 6, 0));
    const q1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, toRotZ));
    return this.tween(dur, (t) => {
      mesh.position.lerpVectors(from, toPos, t);
      mesh.position.y += Math.sin(t * Math.PI) * 0.25;
      mesh.quaternion.slerpQuaternions(q0, q1, t);
    }, easeOut);
  }
  // 中央から各席へカードを配る演出。onArrive(uid, k) で到着通知
  async dealCards(uids, n, onArrive) {
    if (!this._backCanvas || !uids.length) return;
    const tex = this.texFor('__back', this._backCanvas);
    const geo = new THREE.PlaneGeometry(0.12, 0.18);
    const src = V(0, TABLE_Y + 0.4, 0);
    const per = Math.max(35, Math.min(110, 1400 / (n * uids.length)));
    const all = [];
    for (let k = 1; k <= n; k++) {
      for (const u of uids) {
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
        mesh.position.copy(src); this.scene.add(mesh);
        const to = this.handWorldPos(u);
        const spin = Math.random() * 4;
        sfx.deal();
        all.push(this.tween(340, (t) => {
          mesh.position.lerpVectors(src, to, t); mesh.position.y += Math.sin(t * Math.PI) * 0.18;
          mesh.rotation.set(-Math.PI / 2 + t * 1.2, spin * (1 - t), 0);
        }, easeOut).then(() => { this.scene.remove(mesh); onArrive && onArrive(u, k); }));
        await this.wait(per);
      }
    }
    await Promise.all(all);
  }
  seatAngle(uid) { const st = this.seats.get(uid); return st ? Math.atan2(st.pos.z, st.pos.x) : 0; }

  // ---------- カメラ ----------
  // {kind:'seat', uid} | {kind:'overview'} | {kind:'free'} | {kind:'attract'}
  setView(mode, instant = false, dur = 700) {
    this.mode = mode;
    this.controls.enabled = mode.kind === 'free';
    this.lampG.visible = mode.kind !== 'top'; // 真上視点ではランプを隠す
    for (const st of this.seats.values()) {
      const own = (mode.kind === 'seat' || mode.kind === 'custom') && mode.uid === st.uid;
      st.body.visible = !own && !st.empty;
      st.label.style.display = own || st.empty ? 'none' : '';
    }
    if (mode.kind === 'attract') return Promise.resolve();
    const { pos, look } = this._viewTarget(mode);
    if (mode.kind === 'free') this.controls.target.copy(look);
    if (instant) { this.camPos.copy(pos); this.look.copy(look); this.camera.position.copy(pos); return Promise.resolve(); }
    const p0 = this.camera.position.clone(), l0 = this.look.clone();
    return this.tween(dur, (t) => {
      this.camPos.lerpVectors(p0, pos, t); this.camPos.y += Math.sin(t * Math.PI) * (dur > 1500 ? 0.5 : 0);
      this.look.lerpVectors(l0, look, t);
      if (mode.kind === 'free') this.camera.position.copy(this.camPos);
    }, easeIO);
  }
  _viewTarget(mode) {
    if (mode.kind === 'seat') {
      const st = this.seats.get(mode.uid);
      if (st) {
        const dir = st.pos.clone().setY(0).normalize();
        if (st.isMe) return { pos: dir.clone().multiplyScalar(SEAT_R + 0.05).setY(1.42), look: V(0, TABLE_Y + 0.22, 0).addScaledVector(dir, -0.55) };
        return { pos: dir.clone().multiplyScalar(SEAT_R + 0.4).setY(1.68), look: V(0, TABLE_Y + 0.15, 0).addScaledVector(dir, -0.4) };
      }
    }
    if (mode.kind === 'free') return { pos: V(2.6, 2.6, 2.6), look: V(0, TABLE_Y, 0) };
    if (mode.kind === 'custom') return { pos: mode.pos.clone(), look: mode.look.clone() };
    if (mode.kind === 'top') {
      // 卓上全体を真上寄りから（自分の席側から見下ろす）
      const st = mode.uid && this.seats.get(mode.uid);
      const dir = st ? st.pos.clone().setY(0).normalize() : V(0, 0, 1);
      return { pos: dir.clone().multiplyScalar(0.3).setY(3.7), look: V(0, TABLE_Y, 0).addScaledVector(dir, 0.04) };
    }
    return { pos: V(0, 3.1, 3.5), look: V(0, TABLE_Y - 0.05, -0.2) };
  }
  lookAtTemp(worldPos, dur = 500) {
    const l0 = this.look.clone();
    return this.tween(dur, (t) => this.look.lerpVectors(l0, worldPos, t), easeIO);
  }
  resetLook(dur = 600) { if (this.mode.kind === 'attract') return; return this.lookAtTemp(this._viewTarget(this.mode).look, dur); }

  _bindLook(cv) {
    let sx = 0, sy = 0, y0 = 0, p0 = 0;
    cv.addEventListener('pointerdown', (e) => {
      if (this.mode.kind === 'free' || this.mode.kind === 'attract') return;
      this.lookOff.dragging = true; sx = e.clientX; sy = e.clientY; y0 = this.lookOff.yaw; p0 = this.lookOff.pitch;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.lookOff.dragging) return;
      this.lookOff.yaw = THREE.MathUtils.clamp(y0 - (e.clientX - sx) * 0.004, -1.1, 1.1);
      this.lookOff.pitch = THREE.MathUtils.clamp(p0 - (e.clientY - sy) * 0.004, -0.5, 0.6);
    });
    const up = () => { this.lookOff.dragging = false; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  }

  // ---------- 警報 ----------
  setAlarm(on) { this.alarmTarget = typeof on === 'number' ? on : (on ? 1 : 0); }

  // ---------- リボルバー：構える → 撃つ ----------
  _aimPose(st, isMe) {
    const watchingSelf = isMe && this.mode.kind === 'seat' && this.mode.uid === st.uid;
    let target, aim;
    if (watchingSelf) {
      const f = new THREE.Vector3(); this.camera.getWorldDirection(f);
      const right = new THREE.Vector3().crossVectors(f, V(0, 1, 0)).normalize();
      target = this.camera.position.clone().addScaledVector(right, 0.2).addScaledVector(f, 0.4).add(V(0, -0.11, 0));
      aim = this.camera.position.clone().addScaledVector(right, 0.05).add(V(0, 0.02, 0));
    } else {
      const headW = st.head.getWorldPosition(new THREE.Vector3());
      const right = V(1, 0, 0).applyQuaternion(st.group.quaternion);
      target = headW.clone().addScaledVector(right, 0.3).add(V(0, 0.02, 0));
      aim = headW;
    }
    const o = new THREE.Object3D(); o.position.copy(target); o.lookAt(aim);
    return { pos: target, q: o.quaternion.clone(), head: aim };
  }

  async raiseGun(uid, isMe, instant = false) {
    const st = this.seats.get(uid); if (!st || st.raised) return;
    st.raised = true;
    const gun = st.gun;
    const { pos, q, head } = this._aimPose(st, isMe);
    const selfView = isMe && this.mode.kind === 'seat' && this.mode.uid === uid;
    const s0 = gun.scale.x, s1 = selfView ? 0.8 : 1.4;
    if (!(isMe && this.mode.kind === 'seat') && this.mode.kind === 'seat') this.lookAtTemp(head.clone().lerp(V(0, TABLE_Y, 0), 0.3), 800);
    if (instant) { gun.position.copy(pos); gun.quaternion.copy(q); gun.scale.setScalar(s1); return; }
    sfx.cock();
    const p0 = gun.position.clone(), q0 = gun.quaternion.clone();
    const mid = p0.clone().lerp(pos, 0.5); mid.y += 0.3;
    await this.tween(1100, (t) => {
      const a = p0.clone().lerp(mid, t), b = mid.clone().lerp(pos, t);
      gun.position.lerpVectors(a, b, t);
      gun.quaternion.slerpQuaternions(q0, q, t);
      gun.scale.setScalar(s0 + (s1 - s0) * t);
    }, easeIO);
  }

  // {uid, hit, dead, isMe, revolverMode, onDark}
  async fire({ uid, hit, dead, isMe, revolverMode, onDark }) {
    const st = this.seats.get(uid); if (!st) return;
    if (!st.raised) await this.raiseGun(uid, isMe);
    const gun = st.gun, { drum, muzzle } = gun.userData;
    if (revolverMode) { sfx.spin(); await this.tween(450, (t) => { drum.rotation.y = t * Math.PI * 4; }); }
    await this.wait(250);
    const backHome = () => { gun.position.copy(st.restPos); gun.quaternion.copy(st.restQ); gun.scale.setScalar(1.4); st.raised = false; };
    if (hit) {
      sfx.shot();
      muzzle.intensity = 40;
      this.postU.uFlash.value = 1;
      await this.tween(110, (t) => { this.postU.uFlash.value = 1 - t; muzzle.intensity = 40 * (1 - t); });
      this.postU.uDark.value = 1;
      this.setAlarm(false); this.alarm = 0;
      if (dead && !isMe) this.setDead(uid, true, true);
      onDark && onDark();
      backHome();
      await this.wait(isMe && dead ? 2400 : 1500);
      await this.tween(isMe && dead ? 1400 : 800, (t) => { this.postU.uDark.value = 1 - t; });
      this.postU.uDark.value = 0;
    } else {
      sfx.click();
      const base = gun.position.clone();
      await this.tween(160, (t) => { gun.position.copy(base).add(V(0, Math.sin(t * Math.PI) * 0.02, 0)); });
      this.setAlarm(false);
      onDark && onDark();
      await this.wait(900);
      const p1 = gun.position.clone(), q1 = gun.quaternion.clone();
      const sc1 = gun.scale.x;
      await this.tween(700, (t) => { gun.position.lerpVectors(p1, st.restPos, t); gun.quaternion.slerpQuaternions(q1, st.restQ, t); gun.scale.setScalar(sc1 + (1.4 - sc1) * t); }, easeIO);
      st.raised = false;
    }
    this.resetLook(600);
  }

  // ---------- tween ----------
  tween(dur, fn, ease = (t) => t) {
    return new Promise((res) => this.tweens.push({ t0: performance.now(), dur, fn, ease, res }));
  }
  wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  _frame() {
    const now = performance.now();
    const dt = Math.min(0.1, this.clock.getDelta());
    this.tweens = this.tweens.filter((tw) => {
      const t = Math.min(1, (now - tw.t0) / tw.dur);
      tw.fn(tw.ease(t));
      if (t >= 1) { tw.res(); return false; }
      return true;
    });
    const tt = now / 1000;
    // 警報
    this.alarm += (this.alarmTarget - this.alarm) * Math.min(1, dt * 4);
    const al = this.alarm;
    const pulse = 0.55 + 0.45 * Math.sin(tt * 6);
    this.alarmLights.forEach((l, i) => {
      const a = tt * 2.4 + i * 2.1;
      l.position.set(Math.cos(a) * 4.5, 3.6, Math.sin(a) * 4.5);
      l.intensity = al * 40 * pulse;
    });
    this.beacons.forEach((b) => b.material.color.setRGB(0.25 + al * pulse * 0.75, 0.06, 0.05));
    this.postU.uRed.value = al * (0.35 + 0.25 * pulse);
    this.hemi.intensity = 2.0 * (1 - al * 0.6);
    this.spot.intensity = this.spotBase * (1 - al * 0.55);
    this.lampG.rotation.z = Math.sin(tt * 0.7) * 0.03;
    this.lampLight.intensity = (7 + Math.sin(tt * 13) * 0.25 + (Math.random() < 0.008 ? -3 : 0)) * (1 - al * 0.5);
    // カメラ
    if (this.mode.kind === 'free') {
      this.controls.update();
    } else if (this.mode.kind === 'attract') {
      this.attractAng += dt * 0.07;
      this.camera.position.set(Math.cos(this.attractAng) * 4.3, 2.35 + Math.sin(tt * 0.2) * 0.15, Math.sin(this.attractAng) * 4.3);
      this.camera.lookAt(0, TABLE_Y + 0.1, 0);
    } else {
      if (!this.lookOff.dragging) { this.lookOff.yaw *= 0.92; this.lookOff.pitch *= 0.92; }
      this.camera.position.copy(this.camPos);
      const dir = this.look.clone().sub(this.camPos);
      const len = dir.length();
      dir.applyAxisAngle(V(0, 1, 0), this.lookOff.yaw);
      const side = new THREE.Vector3().crossVectors(dir, V(0, 1, 0)).normalize();
      dir.applyAxisAngle(side, this.lookOff.pitch);
      this.camera.lookAt(this.camPos.clone().add(dir.setLength(len)));
    }
    this.postU.uTime.value = tt % 100;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCam);
    this._updateLabels();
  }

  _updateLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const v = new THREE.Vector3();
    for (const st of this.seats.values()) {
      if (st.label.style.display === 'none') continue;
      st.head.getWorldPosition(v); v.y += 0.42;
      v.project(this.camera);
      if (v.z > 1 || v.z < -1) { st.label.style.visibility = 'hidden'; continue; }
      st.label.style.visibility = '';
      st.label.style.transform = `translate(-50%,-100%) translate(${(v.x * 0.5 + 0.5) * w}px,${(-v.y * 0.5 + 0.5) * h}px)`;
    }
  }
}

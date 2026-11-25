// 共通3Dシーン：部屋・テーブル・席・リボルバー・処刑演出・カメラ・低解像度ポストエフェクト
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sfx } from '../audio.js';

export const TABLE_Y = 0.78;
export const TABLE_R = 1.25;
const SEAT_R = 1.78;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- 小物 ----------
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
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
const lam = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
const easeIO = (t) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

const MASKS = [
  { mask: 0xd9d0bd, eye: 0x111111, hat: 'top', coat: 0x24201c },
  { mask: 0x9e2a22, eye: 0x111111, hat: 'hood', coat: 0x2a1414 },
  { mask: 0x1b1b1b, eye: 0xc9a14a, hat: 'none', coat: 0x1c2024 },
  { mask: 0xc9a14a, eye: 0x1a1008, hat: 'bowler', coat: 0x2b2416 },
  { mask: 0x6e7f86, eye: 0x0c0c0c, hat: 'hood', coat: 0x1d2326 },
  { mask: 0xe8e2d4, eye: 0x7a1010, hat: 'bowler', coat: 0x2a2026 },
];

const POST_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FS = `
uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uFlash, uDark, uLevels;
varying vec2 vUv;
float b2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float b4(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); }
void main(){
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  c = pow(c, vec3(0.85)) * 1.25;
  float d = b4(vUv * uRes) - 0.5;
  c = clamp(floor(c * uLevels + d + 0.5) / uLevels, 0.0, 1.0);
  vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 1.1;
  float n = fract(sin(dot(floor(vUv * uRes) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) * 0.035;
  c = mix(c, vec3(1.0, 0.96, 0.86), uFlash);
  c *= (1.0 - uDark);
  gl_FragColor = vec4(c, 1.0);
}`;

export class TableScene {
  constructor(container, { pixel = 3 } = {}) {
    this.container = container;
    this.pixel = pixel;
    this.tweens = [];
    this.seats = new Map();
    this.cardTex = new Map();
    this.mode = { kind: 'overview' };
    this.lookOff = { yaw: 0, pitch: 0, dragging: false };

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.BasicShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    const cv = r.domElement;
    cv.className = 'scene-canvas';
    container.appendChild(cv);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'label-layer';
    container.appendChild(this.labelLayer);

    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x050303);
    s.fog = new THREE.FogExp2(0x0a0505, 0.07);
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.03, 60);
    this.look = V(0, TABLE_Y, 0);
    this.camPos = V(0, 4, 3.4);
    this.camera.position.copy(this.camPos);

    this.rt = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.postU = {
      tDiffuse: { value: this.rt.texture }, uRes: { value: new THREE.Vector2(2, 2) },
      uTime: { value: 0 }, uFlash: { value: 0 }, uDark: { value: 0 }, uLevels: { value: 22 },
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
    this._buildRevolver();
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
    this.renderer.dispose(); this.container.innerHTML = '';
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
    const brick = canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#2a1512'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) for (let x = (y / 8 % 2) * 8; x < w + 16; x += 16) {
        const v = 50 + Math.random() * 30 | 0;
        g.fillStyle = `rgb(${v + 30},${v * .45 | 0},${v * .35 | 0})`; g.fillRect(x - 15, y + 1, 14, 6);
      }
      speckle(g, w, h, 300, .25);
    }, [10, 4]);
    const walls = new THREE.Mesh(new THREE.BoxGeometry(13, 5.2, 13), lam(0x7a5a50, { map: brick, side: THREE.BackSide }));
    walls.position.y = 2.6; walls.receiveShadow = true; s.add(walls);
    const floorT = canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#1d140f'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) { g.fillStyle = `rgb(${30 + Math.random() * 14 | 0},${20 + Math.random() * 8 | 0},14)`; g.fillRect(0, y, w, 7); }
      speckle(g, w, h, 260, .3);
    }, [8, 8]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), lam(0x806050, { map: floorT }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01; floor.receiveShadow = true; s.add(floor);
    // 床の円ライン（コート風）
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.9, 2.95, 28), new THREE.MeshBasicMaterial({ color: 0x6a6252 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; s.add(ring);

    const beamM = lam(0x2a1c14);
    for (let i = -2; i <= 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(13, 0.22, 0.25), beamM); b.position.set(0, 4.7, i * 2.4); s.add(b);
    }
    // 吊りランプ
    const lampG = new THREE.Group(); lampG.position.set(0, 2.75, 0); s.add(lampG);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.32, 8, 1, true), lam(0x2c2a24, { side: THREE.DoubleSide }));
    lampG.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    bulb.position.y = -0.12; lampG.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2, 4), lam(0x111111)); cord.position.y = 1.1; lampG.add(cord);
    this.lampG = lampG;
    const spot = new THREE.SpotLight(0xffc890, 13, 9, Math.PI * 0.36, 0.7, 1.1);
    spot.position.set(0, 2.6, 0); spot.target.position.set(0, 0, 0);
    spot.castShadow = true; spot.shadow.mapSize.set(512, 512); spot.shadow.bias = -0.002;
    s.add(spot); s.add(spot.target); this.spot = spot;
    this.lampLight = new THREE.PointLight(0xffb070, 6, 9, 1.2); this.lampLight.position.set(0, 2.5, 0); s.add(this.lampLight);
    s.add(new THREE.HemisphereLight(0x8a6a60, 0x1a0a08, 1.3));
    s.add(new THREE.AmbientLight(0x3a2622, 0.8));
    const red = new THREE.PointLight(0xff2a1a, 14, 12, 1.2); red.position.set(-5.5, 3.6, -5.5); s.add(red);
    const red2 = new THREE.PointLight(0xc04a20, 9, 10, 1.2); red2.position.set(5.5, 1.2, 5); s.add(red2);
    const emerg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.1), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    emerg.position.set(-5.6, 3.6, -6.4); s.add(emerg);

    // ステージライト
    const mkStage = (x, z, ry) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; s.add(g);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 5), lam(0x1a1a1a)); pole.position.y = 1.6; g.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.06, 6), lam(0x1a1a1a)); g.add(base);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 7), lam(0x2a2a2a)); head.position.y = 3.2; head.rotation.x = 1.0; g.add(head);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.2, 7), new THREE.MeshBasicMaterial({ color: 0x3a3020 }));
      lens.position.set(0, 3.08, 0.22); lens.rotation.x = 1.0 - Math.PI / 2; g.add(lens);
    };
    mkStage(-3.6, -3.2, 0.7); mkStage(3.6, -3.2, -0.7);
    // スピーカー・機材
    const spk = (x, z, ry, sc = 1) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; g.scale.setScalar(sc); s.add(g);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.3, 0.6), lam(0x2b2622)); b.position.y = 0.65; b.castShadow = true; g.add(b);
      const c1 = new THREE.Mesh(new THREE.CircleGeometry(0.3, 8), lam(0x111111)); c1.position.set(0, 0.5, 0.31); g.add(c1);
      const c2 = new THREE.Mesh(new THREE.CircleGeometry(0.12, 8), lam(0x111111)); c2.position.set(0, 1.05, 0.31); g.add(c2);
    };
    spk(-5.2, -2, 1.2, 1.2); spk(-5.4, -0.6, 1.4); spk(5.3, -1.6, -1.3, 1.1);
    const crate = (x, y, z, sz, ry) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), lam(0x4a3420)); m.position.set(x, y + sz / 2, z); m.rotation.y = ry; m.castShadow = true; s.add(m);
    };
    crate(4.8, 0, 3.2, 0.8, 0.3); crate(5.2, 0.8, 3.4, 0.55, 0.9); crate(-4.9, 0, 3.8, 0.7, -0.2);
    // 棚と機材ラック
    const shelf = new THREE.Group(); shelf.position.set(4.6, 0, -4.8); shelf.rotation.y = -0.4; s.add(shelf);
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.5), lam(0x3a2a1c)); p.position.y = 0.4 + i * 0.55; shelf.add(p);
      for (let k = 0; k < 4; k++) if (Math.random() < 0.7) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.25 + Math.random() * 0.2, 0.2 + Math.random() * 0.2, 0.3), lam([0x51473a, 0x30302a, 0x5a2a20][k % 3]));
        box.position.set(-0.6 + k * 0.4, 0.55 + i * 0.55, 0); shelf.add(box);
      }
    }
    // 垂れ下がるケーブル
    const cableM = lam(0x0e0c0b);
    for (let i = 0; i < 7; i++) {
      const a = V(-6 + Math.random() * 12, 4.6, -6 + Math.random() * 12);
      const b = V(-6 + Math.random() * 12, 4.6, -6 + Math.random() * 12);
      const mid = a.clone().lerp(b, 0.5); mid.y = 2.8 + Math.random() * 1.2;
      const curve = new THREE.CatmullRomCurve3([a, mid, b]);
      s.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.025, 4, false), cableM));
    }
  }

  // ---------- テーブル ----------
  _buildTable() {
    const s = this.scene;
    const felt = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#3a4030'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 1400, .18);
      g.strokeStyle = 'rgba(210,200,170,.32)'; g.lineWidth = 2;
      g.beginPath(); g.arc(w / 2, h / 2, w * 0.24, 0, 7); g.stroke();
      g.beginPath(); g.arc(w / 2, h / 2, w * 0.46, 0, 7); g.stroke();
    });
    const top = new THREE.Mesh(new THREE.CircleGeometry(TABLE_R, 24), lam(0xffffff, { map: felt }));
    top.rotation.x = -Math.PI / 2; top.position.y = TABLE_Y + 0.001; top.receiveShadow = true; s.add(top);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R, TABLE_R * 0.97, 0.08, 24), lam(0x3b2414));
    body.position.y = TABLE_Y - 0.04; body.receiveShadow = true; s.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R, 0.045, 4, 24), lam(0x4a2c18));
    rim.rotation.x = Math.PI / 2; rim.position.y = TABLE_Y + 0.01; s.add(rim);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, TABLE_Y - 0.08, 6), lam(0x2a1a10)); leg.position.y = (TABLE_Y - 0.08) / 2; s.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.06, 6), lam(0x2a1a10)); foot.position.y = 0.03; s.add(foot);
  }

  // ---------- リボルバー（+Z方向が銃口） ----------
  _buildRevolver() {
    const g = new THREE.Group();
    const metal = lam(0x34363a), dark = lam(0x18191b), wood = lam(0x5a3018);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.24), metal); barrel.position.set(0, 0.035, 0.14); g.add(barrel);
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.24), dark); rib.position.set(0, 0.06, 0.14); g.add(rib);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.075, 6), metal); drum.rotation.x = Math.PI / 2; drum.position.set(0, 0.02, -0.005); g.add(drum);
    this.revDrum = drum;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.1), dark); frame.position.set(0, 0.03, -0.06); g.add(frame);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.13, 0.055), wood); grip.position.set(0, -0.045, -0.12); grip.rotation.x = -0.35; g.add(grip);
    const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.035, 0.02), dark); hammer.position.set(0, 0.07, -0.1); g.add(hammer);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 3, 6, Math.PI), dark); guard.position.set(0, -0.01, -0.04); guard.rotation.y = Math.PI / 2; guard.rotation.z = Math.PI; g.add(guard);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.scale.setScalar(1.5);
    this.muzzle = new THREE.PointLight(0xffe0a0, 0, 4, 1.2); this.muzzle.position.set(0, 0.04, 0.3); g.add(this.muzzle);
    this.revolver = g;
    this.revRest = { pos: V(0.62, TABLE_Y + 0.05, -0.28), rot: new THREE.Euler(Math.PI / 2, 0, 0.9, 'YXZ') };
    this._placeRevolverRest();
    this.scene.add(g);
  }
  _placeRevolverRest() {
    const r = this.revolver;
    r.position.copy(this.revRest.pos);
    r.quaternion.setFromEuler(new THREE.Euler(0, 2.2, Math.PI / 2, 'YXZ'));
  }
  setRevolverRest(x, z) { this.revRest.pos.set(x, TABLE_Y + 0.05, z); this._placeRevolverRest(); }

  // ---------- 席 ----------
  // seats: [{uid, name}]（席順）, me: 自分のuid（観戦者はnull）
  setSeats(seats, me) {
    for (const st of this.seats.values()) { this.scene.remove(st.group); this.scene.remove(st.marker); st.label.remove(); }
    this.seats.clear();
    this.me = me;
    const n = seats.length;
    const meIdx = Math.max(0, seats.findIndex((x) => x.uid === me));
    seats.forEach((p, i) => {
      const a = Math.PI / 2 + ((i - meIdx) * Math.PI * 2) / n;
      const pos = V(Math.cos(a) * SEAT_R, 0, Math.sin(a) * SEAT_R);
      const st = this._makeSeat(p, i, pos, p.uid === me);
      this.seats.set(p.uid, st);
    });
  }

  _makeSeat(p, i, pos, isMe) {
    const v = MASKS[i % MASKS.length];
    const g = new THREE.Group(); g.position.copy(pos);
    g.rotation.y = Math.atan2(-pos.x, -pos.z);
    this.scene.add(g);
    // 椅子
    const chairM = lam(0x3a2416);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.5), chairM); seat.position.set(0, 0.47, -0.12); g.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 0.06), chairM); back.position.set(0, 0.85, -0.38); g.add(back);
    for (const [x, z] of [[-.24, .1], [.24, .1], [-.24, -.34], [.24, -.34]]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.47, 0.05), chairM); l.position.set(x, 0.235, z - 0.0); g.add(l);
    }
    const body = new THREE.Group(); body.position.set(0, 0.5, -0.12); g.add(body);
    const coatM = lam(v.coat, { emissive: 0x2a1810, emissiveIntensity: 0.6 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.72, 7), coatM); torso.position.y = 0.38; body.add(torso);
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.12, 0.26), coatM); shoulder.position.y = 0.7; body.add(shoulder);
    const head = new THREE.Group(); head.position.set(0, 0.93, 0.02); body.add(head);
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), lam(0x2a221c)); head.add(skull);
    const maskM = lam(v.mask, { emissive: v.mask, emissiveIntensity: 0.12 });
    const mask = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.11, 0.05, 7), maskM);
    mask.rotation.x = Math.PI / 2; mask.position.z = 0.14; mask.scale.set(1, 1, 1.25); head.add(mask);
    const eyeM = new THREE.MeshBasicMaterial({ color: v.eye });
    for (const x of [-0.05, 0.05]) {
      const e = new THREE.Mesh(new THREE.CircleGeometry(0.022, 5), eyeM); e.position.set(x, 0.025, 0.167); head.add(e);
    }
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.008), eyeM); mouth.position.set(0, -0.06, 0.167); head.add(mouth);
    const hatM = lam(0x121010);
    if (v.hat === 'top') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 8), hatM); brim.position.y = 0.13; head.add(brim);
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.26, 8), hatM); crown.position.y = 0.26; head.add(crown);
    } else if (v.hat === 'bowler') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.02, 8), hatM); brim.position.y = 0.11; head.add(brim);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), hatM); crown.position.y = 0.11; head.add(crown);
    } else if (v.hat === 'hood') {
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.48, 7, 1, true), lam(v.coat, { side: THREE.DoubleSide })); hood.position.set(0, 0.06, -0.04); head.add(hood);
    }
    // 腕
    const arms = [];
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.48), coatM);
      arm.position.set(sx * 0.24, 0.62, 0.22); arm.rotation.x = 0.45; arm.rotation.y = -sx * 0.25; body.add(arm);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.1), lam(0x3a2e28)); hand.position.set(sx * 0.13, 0.42, 0.48); body.add(hand);
      arms.push(arm);
    }
    body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    // 手札（カードの裏）
    const fan = new THREE.Group(); fan.position.set(0, 0.98, 0.5); fan.rotation.x = -0.5; g.add(fan);
    // 卓上マーカー
    const ang = Math.atan2(pos.z, pos.x);
    const mPos = V(Math.cos(ang) * (TABLE_R - 0.2), TABLE_Y + 0.004, Math.sin(ang) * (TABLE_R - 0.2));
    const marker = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.13, 10), new THREE.MeshBasicMaterial({ color: 0x3a2a20, transparent: true, opacity: 0.8 }));
    marker.rotation.x = -Math.PI / 2; marker.position.copy(mPos); this.scene.add(marker);
    // HTMLラベル
    const label = document.createElement('div');
    label.className = 'seat-label';
    label.innerHTML = `<div class="nm"></div><div class="st"></div><div class="ex"></div>`;
    label.querySelector('.nm').textContent = p.name;
    this.labelLayer.appendChild(label);
    if (isMe) body.visible = false;
    return { uid: p.uid, name: p.name, group: g, body, head, mask, maskM, fan, marker, label, isMe, alive: true, pos, idx: i, handCount: -1 };
  }

  setSeatStatus(uid, { status, extra, active, alive } = {}) {
    const st = this.seats.get(uid); if (!st) return;
    if (status !== undefined) st.label.querySelector('.st').textContent = status;
    if (extra !== undefined) st.label.querySelector('.ex').textContent = extra;
    if (active !== undefined) {
      st.label.classList.toggle('active', active);
      st.marker.material.color.set(active ? 0xff5030 : 0x3a2a20);
    }
    if (alive !== undefined && alive !== st.alive) this.setDead(uid, !alive, true);
  }

  setDead(uid, dead, instant) {
    const st = this.seats.get(uid); if (!st) return;
    st.alive = !dead;
    st.label.classList.toggle('dead', dead);
    if (dead) {
      this.setHandCount(uid, 0);
      st.maskM.emissiveIntensity = 0;
      const doIt = (t) => { st.body.rotation.x = 0.95 * t; st.body.position.y = 0.5 - 0.08 * t; };
      if (instant) doIt(1); else this.tween(900, doIt, easeOut);
      st.body.traverse((o) => {
        if (o.isMesh && o.material.color) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.45); }
      });
    }
  }

  setHandCount(uid, n, backCanvas) {
    const st = this.seats.get(uid); if (!st || st.isMe) return;
    if (backCanvas) this._backCanvas = backCanvas;
    n = Math.min(n, 12);
    if (st.handCount === n) return;
    st.handCount = n;
    st.fan.clear();
    if (!n || !this._backCanvas) return;
    const tex = this.texFor('__back', this._backCanvas);
    const geo = new THREE.PlaneGeometry(0.1, 0.15);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      m.position.set(t * 0.22, -Math.abs(t) * 0.03, i * 0.002);
      m.rotation.z = -t * 0.6;
      m.rotation.y = Math.PI; // 裏面をこちらに
      st.fan.add(m);
    }
  }

  // ---------- カード ----------
  texFor(key, canvas) {
    if (!this.cardTex.has(key)) {
      const t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace;
      this.cardTex.set(key, t);
    }
    return this.cardTex.get(key);
  }
  makeCard(key, canvas, w = 0.2) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 1.5), new THREE.MeshLambertMaterial({ map: this.texFor(key, canvas), color: 0x8a8274 }));
    m.castShadow = false; m.receiveShadow = true;
    return m;
  }
  handWorldPos(uid) {
    const st = this.seats.get(uid);
    if (!st) return V(0, TABLE_Y + 0.3, 0);
    if (st.isMe && this.mode.kind === 'seat' && this.mode.uid === uid) {
      const f = new THREE.Vector3(); this.camera.getWorldDirection(f);
      return this.camera.position.clone().add(f.multiplyScalar(0.5)).add(V(0, -0.25, 0));
    }
    return st.fan.getWorldPosition(new THREE.Vector3());
  }
  // カードを手元からテーブル上へ飛ばす
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
  seatAngle(uid) { const st = this.seats.get(uid); return st ? Math.atan2(st.pos.z, st.pos.x) : 0; }

  // ---------- カメラ ----------
  // {kind:'seat', uid} | {kind:'overview'} | {kind:'free'}
  setView(mode, instant = false) {
    this.mode = mode;
    this.controls.enabled = mode.kind === 'free';
    for (const st of this.seats.values()) {
      const own = mode.kind === 'seat' && mode.uid === st.uid;
      st.body.visible = !own;
      st.label.style.display = own ? 'none' : '';
    }
    const { pos, look } = this._viewTarget(mode);
    if (mode.kind === 'free') { this.controls.target.copy(look); }
    if (instant) { this.camPos.copy(pos); this.look.copy(look); this.camera.position.copy(pos); }
    else {
      const p0 = this.camera.position.clone(), l0 = this.look.clone();
      this._camTween = this.tween(700, (t) => { this.camPos.lerpVectors(p0, pos, t); this.look.lerpVectors(l0, look, t); if (mode.kind === 'free') this.camera.position.copy(this.camPos); }, easeIO);
    }
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
    return { pos: V(0, 3.1, 3.5), look: V(0, TABLE_Y - 0.05, -0.2) };
  }
  lookAtTemp(worldPos, dur = 500) {
    const l0 = this.look.clone();
    return this.tween(dur, (t) => this.look.lerpVectors(l0, worldPos, t), easeIO);
  }
  resetLook(dur = 600) { return this.lookAtTemp(this._viewTarget(this.mode).look, dur); }

  _bindLook(cv) {
    let sx = 0, sy = 0, y0 = 0, p0 = 0;
    cv.addEventListener('pointerdown', (e) => {
      if (this.mode.kind === 'free') return;
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

  // ---------- 処刑演出 ----------
  // {uid, hit, dead, isMe, onDark}
  async execute({ uid, hit, dead, isMe, revolverMode, onDark }) {
    const st = this.seats.get(uid); if (!st) return;
    const gun = this.revolver;
    const startPos = gun.position.clone(), startQ = gun.quaternion.clone();
    let target, aim;
    const watchingSelf = isMe && this.mode.kind === 'seat' && this.mode.uid === uid;
    if (watchingSelf) {
      const f = new THREE.Vector3(); this.camera.getWorldDirection(f);
      const right = new THREE.Vector3().crossVectors(f, V(0, 1, 0)).normalize();
      target = this.camera.position.clone().addScaledVector(right, 0.13).addScaledVector(f, 0.24).add(V(0, -0.06, 0));
      aim = this.camera.position.clone().addScaledVector(right, 0.03);
    } else {
      const headW = st.head.getWorldPosition(new THREE.Vector3());
      const right = V(1, 0, 0).applyQuaternion(st.group.quaternion);
      target = headW.clone().addScaledVector(right, 0.3).add(V(0, 0.02, 0));
      aim = headW;
      if (this.mode.kind === 'seat') this.lookAtTemp(headW.clone().lerp(V(0, TABLE_Y, 0), 0.25), 700);
    }
    const m = new THREE.Object3D(); m.position.copy(target); m.lookAt(aim);
    const endQ = m.quaternion.clone();
    sfx.cock();
    // 持ち上げ → 頭の横へ
    const mid = startPos.clone().lerp(target, 0.5); mid.y += 0.35;
    await this.tween(1100, (t) => {
      const a = startPos.clone().lerp(mid, t), b = mid.clone().lerp(target, t);
      gun.position.lerpVectors(a, b, t);
      gun.quaternion.slerpQuaternions(startQ, endQ, t);
    }, easeIO);
    // 溜め
    this.spot.intensity = 8;
    if (revolverMode) { sfx.spin(); await this.tween(500, (t) => { this.revDrum.rotation.y = t * Math.PI * 4; }); }
    sfx.heartbeat();
    await this.wait(700); sfx.heartbeat();
    await this.wait(700);
    if (hit) {
      sfx.shot();
      this.muzzle.intensity = 40;
      this.postU.uFlash.value = 1;
      await this.tween(110, (t) => { this.postU.uFlash.value = 1 - t; this.muzzle.intensity = 40 * (1 - t); });
      this.postU.uDark.value = 1;
      if (dead && !isMe) this.setDead(uid, true, true);
      onDark && onDark();
      // 暗転中に銃を戻す
      gun.position.copy(startPos); gun.quaternion.copy(startQ);
      await this.wait(isMe && dead ? 2400 : 1500);
      this.spot.intensity = 13;
      await this.tween(isMe && dead ? 1400 : 800, (t) => { this.postU.uDark.value = 1 - t; });
      this.postU.uDark.value = 0;
    } else {
      sfx.click();
      const base = gun.position.clone();
      await this.tween(160, (t) => { gun.position.copy(base).add(V(0, Math.sin(t * Math.PI) * 0.02, 0)); });
      onDark && onDark();
      await this.wait(900);
      this.spot.intensity = 13;
      const p1 = gun.position.clone(), q1 = gun.quaternion.clone();
      await this.tween(700, (t) => { gun.position.lerpVectors(p1, startPos, t); gun.quaternion.slerpQuaternions(q1, startQ, t); }, easeIO);
    }
    if (this.mode.kind === 'seat') this.resetLook(600);
  }

  // ---------- tween ----------
  tween(dur, fn, ease = (t) => t) {
    return new Promise((res) => this.tweens.push({ t0: performance.now(), dur, fn, ease, res }));
  }
  wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  _frame() {
    const now = performance.now();
    const dt = this.clock.getDelta();
    this.tweens = this.tweens.filter((tw) => {
      const t = Math.min(1, (now - tw.t0) / tw.dur);
      tw.fn(tw.ease(t));
      if (t >= 1) { tw.res(); return false; }
      return true;
    });
    // ランプのゆらぎ
    const tt = now / 1000;
    this.lampG.rotation.z = Math.sin(tt * 0.7) * 0.03;
    this.lampLight.intensity = 6 + Math.sin(tt * 13) * 0.25 + (Math.random() < 0.01 ? -2.5 : 0);
    // カメラ
    if (this.mode.kind === 'free') {
      this.controls.update();
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

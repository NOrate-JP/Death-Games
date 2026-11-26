// LUCK BUTTON : 表示（ボタン装置・指の演出・手札）
import * as THREE from 'three';
import { CARD_DEFS, NB, canUseCard, unpressed } from './rules.js';
import { preloadCards, cardCanvas, cardURL } from '../../card-art.js';
import { TABLE_Y } from '../../scene/scene.js';
import { sfx } from '../../audio.js';
import { makeHandCard, layoutFan } from '../../hand-ui.js';

const KEY = 'luck-button';
const ART_DEFS = Object.fromEntries(Object.entries(CARD_DEFS).map(([k, d]) => [k, { ...d, type: 'sp' }]));
const ORDER = Object.keys(CARD_DEFS);
const COL = { idle: 0xf4f0e8, hover: 0xfff6c8, dark: 0x1a1a1a, out: 0xff2010, ana: 0xffc400, safe: 0x30ff60, bad: 0xff2a1a };
const easeIO = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const TILT = -0.42; // 押す人の方へ傾ける角度

export async function createView(ctx) {
  const v = new LuckButtonView(ctx);
  await v.init();
  return v;
}

class LuckButtonView {
  constructor(ctx) {
    this.ctx = ctx;
    this.inputOn = false;
    this.handEls = new Map();
    this.handLimit = 0;
    this.lastM = null;
    this.pressing = -1;
    this.hover = -1;
    this.atUid = null;
    this.revealOuts = null;
    this.focused = false;
  }

  async init() {
    await preloadCards(KEY, ART_DEFS);
    const sc = this.ctx.scene;
    sc.setBackCanvas(cardCanvas(KEY, 'back'));
    this.buildDevice();
    this.buildFinger();
    this.buildHud();
    this.pulseMarkers();
    sc.onPick = (d) => { if (d && d.lbButton !== undefined) this.tryPress(d.lbButton); };
    sc.onHover = (d) => {
      const i = d && d.lbButton !== undefined ? d.lbButton : -1;
      if (i === this.hover) return;
      this.hover = i;
      sc.renderer.domElement.style.cursor = i >= 0 && this.canPress(this.lastM) && !this.lastM.sub.pressed[i] ? 'pointer' : '';
      this.paintButtons(this.lastM);
    };
  }

  // ---------- 3D：ボタン装置（押す人の方へ傾いている） ----------
  buildDevice() {
    const sc = this.ctx.scene;
    const g = new THREE.Group();
    const metal = new THREE.MeshLambertMaterial({ color: 0x3a3c40, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1d20, flatShading: true });
    // 台（くさび形）
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.36), dark); foot.position.y = 0.025; g.add(foot);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.08), dark); prop.position.set(0, 0.08, 0.13); g.add(prop);
    const top = new THREE.Group(); top.position.set(0, 0.1, 0.0); top.rotation.x = TILT; g.add(top);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.38), metal); base.castShadow = true; top.add(base);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, 0.34), dark); plate.position.y = 0.03; top.add(plate);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.04), new THREE.MeshBasicMaterial({ color: 0x401010 })); lamp.position.set(0, 0.05, 0.2); top.add(lamp);
    this.lamp = lamp;
    this.buttons = [];
    const geo = new THREE.CylinderGeometry(0.034, 0.036, 0.026, 14);
    const ringGeo = new THREE.CylinderGeometry(0.043, 0.043, 0.01, 14);
    for (let i = 0; i < NB; i++) {
      const r = Math.floor(i / 4), c = i % 4;
      // 押す人から見て 左上=1 … 右下=12（席ローカルの +x が本人の左、+z が奥）
      const x = (1.5 - c) * 0.1, z = (1 - r) * 0.095 - 0.01;
      const ring = new THREE.Mesh(ringGeo, dark); ring.position.set(x, 0.039, z); top.add(ring);
      const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: COL.idle, emissiveIntensity: 0.9 });
      const b = new THREE.Mesh(geo, mat);
      b.position.set(x, 0.056, z);
      b.userData = { lbButton: i };
      top.add(b);
      this.buttons.push(b);
      // ANALYZE / X-RAY 用の目印（光の柱＋リング）
      const mk = new THREE.Group(); mk.visible = false;
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd000, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.3, 12, 1, true), beamMat); beam.position.y = 0.16; mk.add(beam);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd000, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mring = new THREE.Mesh(new THREE.RingGeometry(0.044, 0.06, 20), ringMat); mring.rotation.x = -Math.PI / 2; mring.position.y = 0.016; mk.add(mring);
      mk.position.copy(b.position);
      top.add(mk);
      // マウスを合わせた時の赤いフチ
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.007, 6, 24), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
      rim.rotation.x = Math.PI / 2; rim.position.set(x, 0.062, z); rim.visible = false;
      top.add(rim);
      (this.rims = this.rims || []).push(rim);
      (this.markers = this.markers || []).push({ g: mk, beamMat, ringMat });
      sc.pickables.push(b);
    }
    this.glow = new THREE.PointLight(0xfff4e0, 1.2, 1.4, 2); this.glow.position.set(0, 0.3, -0.1); g.add(this.glow);
    g.position.set(0, TABLE_Y, 0);
    sc.props.add(g);
    this.device = g;
  }

  // ---------- 3D：人差し指を突き出した手 ----------
  buildFinger() {
    const skin = new THREE.MeshLambertMaterial({ color: 0x8a6656, flatShading: true });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0x4a3630, flatShading: true });
    const h = new THREE.Group();
    // 指先が原点。人差し指は -Y 方向（下）に伸びる
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.09, 0.022), skin); finger.position.set(0, 0.045, 0); h.add(finger);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.014, 0.02), skin); tip.position.set(0, 0.004, 0); h.add(tip);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.035), skin); palm.position.set(0.025, 0.125, -0.005); h.add(palm);
    for (let k = 0; k < 3; k++) { // 握った指
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.03), skin); f.position.set(0.03 + k * 0.022, 0.085, 0.012); h.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.045, 0.02), skin); thumb.position.set(-0.03, 0.11, 0.015); thumb.rotation.z = 0.6; h.add(thumb);
    const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.05, 0.04), skin); wrist.position.set(0.025, 0.185, -0.01); h.add(wrist);
    const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.055), sleeve); cuff.position.set(0.025, 0.22, -0.01); h.add(cuff); // 腕は描かず手首まで
    h.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const pivot = new THREE.Group(); pivot.add(h);
    pivot.visible = false;
    this.ctx.scene.scene.add(pivot);
    this.finger = pivot; this.fingerInner = h;
  }

  // 席uid側から手を伸ばしてボタンiを押す
  async fingerPress(uid, i, onPress) {
    const sc = this.ctx.scene;
    const btnW = this.buttons[i].getWorldPosition(new THREE.Vector3());
    const yaw = sc.seatYaw(uid);
    const f = this.finger;
    f.visible = true;
    f.rotation.set(0, yaw + 0.4, 0); // 少し右側から手を伸ばす
    // 手前（本人側）から斜めに伸ばす：指が少し奥を向く
    this.fingerInner.rotation.set(-1.25, 0, 0); // 腕は本人側へほぼ水平に伸び、指先は前下を向く
    const start = sc.seatPoint(uid, -0.12, TABLE_Y + 0.2, 0.42);
    const above = btnW.clone().add(new THREE.Vector3(0, 0.13, 0)).add(sc.seatPoint(uid, 0, 0, -0.05).sub(sc.seatPoint(uid, 0, 0, 0)));
    const touch = btnW.clone().add(new THREE.Vector3(0, 0.018, 0));
    const pushed = btnW.clone().add(new THREE.Vector3(0, 0.004, 0));
    // ゆっくり近づく
    await sc.tween(1300, (t) => { f.position.lerpVectors(start, above, t); }, easeIO);
    // 迷う・溜める（指先が震える）
    const hold = 900 + Math.random() * 1100;
    const t0 = performance.now(); let beat = -1;
    await sc.tween(hold, (t) => {
      const k = (performance.now() - t0) / 1000;
      f.position.copy(above).add(new THREE.Vector3(Math.sin(k * 23) * 0.0025, Math.sin(k * 3) * 0.008 - t * 0.04, Math.cos(k * 19) * 0.0025));
      const b = Math.floor(t * 3); if (b > beat) { beat = b; sfx.heartbeat(); }
    });
    const p1 = f.position.clone();
    await sc.tween(380, (t) => { f.position.lerpVectors(p1, touch, t); }, (t) => t * t);
    // 押し込む
    sfx.click();
    const by = this.buttons[i].position.y;
    await sc.tween(160, (t) => { f.position.lerpVectors(touch, pushed, t); this.buttons[i].position.y = by - 0.014 * t; });
    await onPress();
    await sc.wait(250);
    const p2 = f.position.clone();
    await sc.tween(700, (t) => { f.position.lerpVectors(p2, start, t); }, easeIO);
    f.visible = false;
  }

  setMarker(i, color) {
    const mk = this.markers[i]; if (!mk) return;
    mk.g.visible = color !== null;
    if (color !== null) { mk.beamMat.color.setHex(color); mk.ringMat.color.setHex(color); }
  }
  pulseMarkers() {
    const t = performance.now() / 1000;
    for (const mk of this.markers || []) if (mk.g.visible) {
      mk.beamMat.opacity = 0.35 + 0.3 * Math.abs(Math.sin(t * 3));
      mk.g.children[1].scale.setScalar(1 + 0.25 * Math.abs(Math.sin(t * 3)));
    }
    this._raf = requestAnimationFrame(() => this.pulseMarkers());
  }

  setButton(i, state) {
    const b = this.buttons[i]; if (!b) return;
    const map = { idle: [COL.idle, 0.9], hover: [COL.hover, 1.7], dark: [COL.dark, 0], out: [COL.out, 1.6], ana: [COL.ana, 2.6], safe: [COL.safe, 2.4], bad: [COL.bad, 2.6] };
    const [col, it] = map[state] || map.idle;
    b.material.emissive.setHex(col); b.material.emissiveIntensity = it;
    b.material.color.setHex(state === 'dark' ? 0x2a2a2a : 0xffffff);
    b.position.y = state === 'dark' || state === 'out' ? 0.042 : 0.056;
    this.setMarker(i, { ana: COL.ana, safe: COL.safe, bad: COL.bad }[state] ?? null);
  }

  // ANALYZE / X-RAY の光：使った本人の画面で、そのターンにボタンを押すまでの間だけ
  activeSecrets(m) {
    const s = m?.sub, me = this.ctx.me;
    if (!s?.turn || !me || s.turn.uid !== me || m.phase !== 'round') return [];
    if (this.pressing >= 0 || s.turn.pressedN > 0) return [];
    return (s.secret?.[me] || []).filter((k) => k.turnNo === s.turn.no);
  }

  paintButtons(m) {
    const s = m?.sub; if (!s?.pressed) return;
    const ana = new Set(), xr = {};
    for (const k of this.activeSecrets(m)) {
      if (k.kind === 'analyze') k.idx.forEach((i) => ana.add(i));
      if (k.kind === 'xray') xr[k.idx] = k.out;
    }
    const canP = this.canPress(m);
    this.rims.forEach((r, i) => { r.visible = canP && i === this.hover && !s.pressed[i]; });
    for (let i = 0; i < NB; i++) {
      if (i === this.pressing) continue;
      if (s.pressed[i]) { this.setButton(i, i === this.outIdx ? 'out' : 'dark'); continue; }
      if (xr[i] !== undefined) this.setButton(i, xr[i] ? 'bad' : 'safe');
      else if (ana.has(i)) this.setButton(i, 'ana');
      else this.setButton(i, canP && i === this.hover ? 'hover' : 'idle');
    }
  }

  devicePose(uid) {
    const sc = this.ctx.scene;
    if (!uid) return { pos: new THREE.Vector3(0, TABLE_Y, 0), rot: 0 };
    return { pos: sc.seatPoint(uid, 0, TABLE_Y, 0.95), rot: sc.seatYaw(uid) };
  }
  async moveDevice(uid, instant) {
    if (this.atUid === uid && !instant) return;
    this.atUid = uid;
    const { pos, rot } = this.devicePose(uid);
    const d = this.device;
    if (instant) { d.position.copy(pos); d.rotation.y = rot; return; }
    const p0 = d.position.clone(); const r0 = d.rotation.y;
    let dr = rot - r0; while (dr > Math.PI) dr -= Math.PI * 2; while (dr < -Math.PI) dr += Math.PI * 2;
    sfx.deal();
    await this.ctx.scene.tween(650, (t) => {
      d.position.lerpVectors(p0, pos, t); d.position.y = TABLE_Y + Math.sin(t * Math.PI) * 0.05;
      d.rotation.y = r0 + dr * t;
    }, easeIO);
  }

  // 自分のターン中はカメラを装置に向ける
  focus(on) {
    const sc = this.ctx.scene;
    if (on === this.focused || sc.mode.kind !== 'seat' || sc.mode.uid !== this.ctx.me) return;
    this.focused = on;
    if (on) {
      const p = this.device.position.clone(); p.y += 0.05;
      sc.lookAtTemp(p.lerp(new THREE.Vector3(0, TABLE_Y, 0), 0.25), 600);
    } else sc.resetLook(600);
  }

  // ---------- HUD ----------
  buildHud() {
    const h = this.ctx.hud;
    h.innerHTML = `
      <div class="lb-top"><div class="lb-risk" id="lbRisk"></div></div>
      <div class="cc-turn" id="lbTurn"></div>
      <div class="cc-badges" id="lbBadges"></div>
      <div class="hand-fan" id="lbHand"></div>`;
    this.el = { risk: h.querySelector('#lbRisk'), turn: h.querySelector('#lbTurn'), badges: h.querySelector('#lbBadges'), hand: h.querySelector('#lbHand') };
  }

  renderRisk(m) {
    const s = m.sub; if (!s?.pressed) return;
    const up = unpressed(s).length, outs = s.outs.length;
    const p = up ? Math.min(1, outs / up) : 1;
    this.el.risk.innerHTML = `<span class="k">OUTボタン</span><b class="o">${outs}</b><span class="k">残りボタン</span><b>${up}</b><span class="k">次に押してOUTの確率</span><b class="p ${p >= 0.25 ? 'hot' : ''}">${Math.round(p * 100)}%</b>`;
  }

  canPress(m) {
    const s = m?.sub, me = this.ctx.me;
    return !!(this.inputOn && s?.turn && s.turn.uid === me && m.phase === 'round' && this.pressing < 0);
  }
  tryPress(i) {
    const m = this.lastM;
    if (!this.canPress(m) || m.sub.pressed[i]) return;
    this.inputOn = false;
    this.pressing = i;
    this.ctx.scene.renderer.domElement.style.cursor = '';
    this.paintButtons(m); this.renderHand(m);
    this.ctx.send({ type: 'press', idx: i });
  }

  showTurn(m, uid, t) {
    for (const u of m.seats) this.ctx.scene.setSeatStatus(u, { active: u === uid });
    if (!uid) { this.el.turn.textContent = ''; this.el.badges.innerHTML = ''; return; }
    const mine = uid === this.ctx.me;
    this.el.turn.className = 'cc-turn' + (mine ? ' mine' : '');
    const n = t?.presses || 1;
    this.el.turn.textContent = mine
      ? (t?.phase === 'press' ? `▶ 目の前のボタンを押せ${n > 1 ? `（あと${n}つ）` : ''}` : '▶ 目の前のボタンを押すか、カードを使うか')
      : `${this.ctx.name(uid)} のターン`;
    const b = [];
    if (n > 1) b.push(`<span class="bdg r">DOUBLE：${n}つ押す</span>`);
    if (t?.taboo) b.push('<span class="bdg r">TABOO：カード禁止</span>');
    if (t?.onehit) b.push('<span class="bdg r">ONEHIT：OUTなら即死</span>');
    const s = m.sub;
    if (s) {
      const al = m.seats.filter((u) => m.alive[u]);
      const i = al.indexOf(uid);
      if (i >= 0 && al.length > 1) b.push(`<span class="bdg dim">次 → ${this.ctx.name(al[(i + s.dir + al.length) % al.length])}</span>`);
    }
    this.el.badges.innerHTML = b.join('');
  }

  renderHand(m) {
    const me = this.ctx.me, s = m.sub;
    const hand = me && s?.hands && m.alive[me] ? (s.hands[me] || []) : null;
    const box = this.el.hand;
    if (!hand) { box.style.display = 'none'; return; }
    box.style.display = '';
    const usable = this.inputOn && this.pressing < 0 && m.phase === 'round' && canUseCard(m, me);
    const order = hand.map((id, i) => ({ id, i })).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id) || a.i - b.i).slice(0, this.handLimit);
    const seen = {}, keep = new Set();
    let prev = null;
    for (const { id, i } of order) {
      seen[id] = (seen[id] || 0) + 1;
      const key = `${id}#${seen[id]}`; keep.add(key);
      let b = this.handEls.get(key);
      if (!b) {
        const d = CARD_DEFS[id];
        b = makeHandCard({ img: cardURL(KEY, id), label: d.label, tip: `【${d.label}】${d.desc}`, onPlay: (x) => this.onCard(x) });
        b.classList.add('new'); setTimeout(() => b.classList.remove('new'), 300);
        this.handEls.set(key, b);
      }
      b.dataset.idx = i; b.dataset.card = id;
      b.classList.toggle('playable', usable); b.classList.toggle('locked', !usable);
      const want = prev ? prev.nextSibling : box.firstChild;
      if (want !== b) box.insertBefore(b, want);
      prev = b;
    }
    for (const [key, b] of this.handEls) if (!keep.has(key)) { b.remove(); this.handEls.delete(key); }
    layoutFan(box);
  }

  onCard(btn) {
    const m = this.lastM, me = this.ctx.me;
    if (!this.inputOn || !m || !canUseCard(m, me)) return;
    this.inputOn = false;
    btn.classList.remove('peek'); btn.classList.add('leaving');
    for (const [k, v] of this.handEls) if (v === btn) this.handEls.delete(k); // 使ったカードの要素は再利用しない
    setTimeout(() => btn.remove(), 320);
    this.el.hand.querySelectorAll('.hand-card').forEach((b) => b.classList.add('locked'));
    this.ctx.send({ type: 'card', idx: +btn.dataset.idx, card: btn.dataset.card });
  }

  // ---------- 同期 ----------
  onQueue(evs, m) {
    if (evs.some((e) => e.t === 'lb_setup')) { this.handLimit = 0; this.renderHand(m); }
  }
  setInput(on, m) {
    this.inputOn = on; this.lastM = m;
    if (on) this.pressing = -1;
    this.focus(on || this.pressing >= 0); // 選ぶ→押す→結果まで同じカメラ
    this.renderHand(m); this.paintButtons(m);
  }
  sync(m) {
    this.lastM = m;
    const s = m.sub; if (!s?.pressed) return;
    this.handLimit = Infinity;
    for (const u of m.seats) this.ctx.scene.setHandCount(u, m.alive[u] ? (s.hands[u] || []).length : 0);
    if (m.phase === 'round' && s.turn) { this.moveDevice(s.turn.uid, this.atUid === null); this.showTurn(m, s.turn.uid, s.turn); }
    else { this.showTurn(m, null); this.focus(false); }
    if (this.pressing >= 0 && !(m.phase === 'round' && s.turn?.uid === this.ctx.me)) this.pressing = -1;
    this.renderRisk(m);
    this.paintButtons(m);
    this.renderHand(m);
  }

  // ---------- イベント演出 ----------
  async animate(ev, m) {
    const sc = this.ctx.scene, name = this.ctx.name, me = this.ctx.me;
    this.lastM = m;
    switch (ev.t) {
      case 'lb_setup': {
        this.outIdx = -1; this.pressing = -1;
        for (let i = 0; i < NB; i++) this.setButton(i, 'dark');
        this.lamp.material.color.setHex(0x401010);
        await this.moveDevice(null);
        sfx.special();
        for (let i = 0; i < NB; i++) { this.setButton(i, 'idle'); sfx.tick(); await sc.wait(45); }
        this.el.risk.innerHTML = '<span class="k">OUTボタン</span><b class="o">1</b><span class="k">残りボタン</span><b>12</b><span class="k">次に押してOUTの確率</span><b class="p">8%</b>';
        await this.ctx.banner('LUCK BUTTON', `12個のうち1つがOUT　／　手札 ${ev.hs}枚　／　スタート：${name(ev.start)}`, 1700);
        for (const u of m.seats) sc.setHandCount(u, 0);
        this.handLimit = 0; this.renderHand(m);
        if (ev.hs > 0) await sc.dealCards(ev.players, ev.hs, (u, k) => {
          if (u === me) { this.handLimit = k; this.renderHand(m); } else sc.setHandCount(u, k);
        });
        this.handLimit = Infinity; this.renderHand(m);
        return;
      }
      case 'lb_turn': {
        this.showTurn(m, ev.uid, { presses: ev.presses, taboo: ev.taboo, onehit: ev.onehit, phase: 'choose' });
        if (ev.uid !== me) this.focus(false);
        await this.moveDevice(ev.uid);
        if (ev.uid === me) sfx.tick();
        if (ev.onehit) this.ctx.popText('ONEHIT', 'r');
        await sc.wait(200);
        return;
      }
      case 'lb_card': {
        const d = CARD_DEFS[ev.card];
        sc.setHandCount(ev.uid, ev.left);
        sfx.card();
        await this.ctx.reveal({ img: cardURL(KEY, ev.card), who: name(ev.uid), ms: 1100 });
        sfx.special();
        switch (ev.card) {
          case 'skip': this.ctx.popText('SKIP — ボタンを押さずにターン終了', 'b'); break;
          case 'discard':
            if (ev.discarded) { sc.setHandCount(ev.target, ev.targetLeft); this.ctx.popText(`${name(ev.target)} の ${CARD_DEFS[ev.discarded].label} を破棄！`, 'r'); }
            else this.ctx.popText(`${name(ev.target)} の手札はなかった`);
            break;
          case 'analyze': this.ctx.popText(ev.uid === me ? '3つのボタンが黄色に光った（1つ以上がOUT）— 押すまでに覚えろ' : `${name(ev.uid)} だけが何かを見ている…`); break;
          case 'xray': this.ctx.popText(ev.uid === me ? '1つのボタンの正体が見えた — 押すまでに覚えろ' : `${name(ev.uid)} だけが何かを見ている…`); break;
          case 'shuffle': {
            this.ctx.popText('OUTの位置がシャッフルされた！', 'r');
            sfx.rattle?.(10);
            const d0 = this.device.position.clone();
            await sc.tween(600, (t) => { this.device.position.copy(d0); this.device.position.x += Math.sin(t * 40) * 0.01 * (1 - t); });
            break;
          }
          default: this.ctx.popText(`${d.label}：${d.desc.replace(/^ボタンを1つ押す。(その後、)?/, '')}`); break;
        }
        this.paintButtons(m);
        this.showTurn(m, ev.uid, { ...m.sub?.turn, phase: ev.card === 'skip' ? 'choose' : 'press' });
        await sc.wait(700);
        return;
      }
      case 'lb_press': {
        const i = ev.idx;
        this.pressing = i;
        this.paintButtons(m); // ここで秘密の光は消える
        await this.fingerPress(ev.uid, i, async () => {
          if (ev.out) {
            this.outIdx = i;
            this.setButton(i, 'out');
            this.lamp.material.color.setHex(0xff2010);
            this.ctx.alarmNow(); // 押した瞬間にサイレン
            this.ctx.popText('OUT', 'r');
            await sc.wait(500);
          } else {
            this.setButton(i, 'dark');
            sfx.tick();
            this.ctx.popText(ev.left > 0 ? `SAFE — もう${ev.left}つ` : 'SAFE', 'g');
          }
        });
        this.pressing = -1;
        if (m.sub?.pressed) this.renderRisk(m);
        if (!ev.out && !(m.phase === 'round' && m.sub?.turn?.uid === me)) this.focus(false);
        return;
      }
      case 'lb_out': {
        this.showTurn(m, null);
        await sc.wait(600);
        this.focus(false);
        return;
      }
      case 'lb_danger': {
        this.ctx.popText(`DANGER — OUTボタンが ${ev.count}個 に！`, 'r');
        this.lamp.material.color.setHex(0xff2010);
        await sc.tween(700, (t) => { this.glow.color.setHSL(0, 1, 0.5 + 0.5 * Math.abs(Math.sin(t * 12))); });
        this.glow.color.setHex(0xfff4e0); this.lamp.material.color.setHex(0x401010);
        if (m.sub?.outs) this.renderRisk(m);
        return;
      }
      case 'lb_reverse': this.ctx.popText('REVERSE — ターン順が逆に！'); await sc.wait(400); return;
    }
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    const sc = this.ctx.scene;
    sc.onPick = null; sc.onHover = null; sc.pickables.length = 0;
    sc.scene.remove(this.finger);
    this.ctx.hud.innerHTML = '';
    this.handEls.clear();
  }
}

// COUNT CARDS : 表示（3D小物 + 手札UI + イベント演出）
import * as THREE from 'three';
import { CARD_DEFS, CARD_ORDER } from './cards.js';
import { legalIndices, loseReason } from './rules.js';
import { preloadCards, cardCanvas, cardURL } from '../../card-art.js';
import { TABLE_Y } from '../../scene/scene.js';
import { sfx } from '../../audio.js';

const KEY = 'count-cards';

export async function createView(ctx) {
  const v = new CountCardsView(ctx);
  await v.init();
  return v;
}

class CountCardsView {
  // ctx: { scene, hud, me, name(uid), send(action), banner(text, sub, ms), popText(text), alive(uid) }
  constructor(ctx) {
    this.ctx = ctx;
    this.pile = [];
    this.counts = {};
    this.field = 0; this.target = 0;
    this.inputOn = false;
  }

  async init() {
    await preloadCards(KEY, CARD_DEFS);
    const sc = this.ctx.scene;
    sc.setRevolverRest(0.0, -0.86);
    // 中央の表示装置（六角柱）
    this.devCanvas = document.createElement('canvas'); this.devCanvas.width = 96; this.devCanvas.height = 128;
    this.devTex = new THREE.CanvasTexture(this.devCanvas);
    this.devTex.magFilter = THREE.NearestFilter; this.devTex.minFilter = THREE.NearestFilter;
    this.devTex.wrapS = THREE.RepeatWrapping; this.devTex.repeat.set(6, 1); this.devTex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group(); g.position.set(0, TABLE_Y, 0);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.04, 6), new THREE.MeshLambertMaterial({ color: 0x23201c, flatShading: true }));
    base.position.y = 0.02; g.add(base);
    const screen = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 6, 1, true),
      new THREE.MeshBasicMaterial({ map: this.devTex }));
    screen.position.y = 0.13; screen.rotation.y = Math.PI / 6; g.add(screen);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.03, 6), new THREE.MeshLambertMaterial({ color: 0x2b2824, flatShading: true }));
    cap.position.y = 0.235; g.add(cap);
    const glow = new THREE.PointLight(0x7aff9a, 0.6, 1.0, 2); glow.position.y = 0.14; g.add(glow);
    sc.props.add(g);
    this.drawDevice();
    this.buildHud();
  }

  drawDevice(flash = false) {
    const c = this.devCanvas, g = c.getContext('2d');
    g.fillStyle = flash ? '#3a0a08' : '#04120a'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(120,255,160,.07)';
    for (let y = 0; y < c.height; y += 3) g.fillRect(0, y, c.width, 1);
    const over = this.field > this.target;
    g.fillStyle = over ? '#ff5a3a' : '#8dffa8';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 50px "Courier New", monospace';
    g.fillText(String(this.field), c.width / 2, 48);
    g.fillStyle = '#d8b06a'; g.font = 'bold 22px "Courier New", monospace';
    g.fillText('/' + (this.target || '--'), c.width / 2, 98);
    this.devTex.needsUpdate = true;
  }

  buildHud() {
    const h = this.ctx.hud;
    h.innerHTML = `
      <div class="cc-top">
        <div class="cc-box"><div class="cc-k">場</div><div class="cc-v" id="ccField">0</div></div>
        <div class="cc-sep">/</div>
        <div class="cc-box"><div class="cc-k">目標値</div><div class="cc-v gold" id="ccTarget">--</div></div>
      </div>
      <div class="cc-turn" id="ccTurn"></div>
      <div class="cc-badges" id="ccBadges"></div>
      <div class="cc-hand" id="ccHand"></div>
      <div class="cc-tip" id="ccTip"></div>`;
    this.el = {
      field: h.querySelector('#ccField'), target: h.querySelector('#ccTarget'), turn: h.querySelector('#ccTurn'),
      badges: h.querySelector('#ccBadges'), hand: h.querySelector('#ccHand'), tip: h.querySelector('#ccTip'),
    };
  }

  setNums() {
    this.el.field.textContent = this.field;
    this.el.target.textContent = this.target || '--';
    this.el.field.classList.toggle('over', this.field > this.target);
    this.el.field.classList.toggle('near', this.field <= this.target && this.target - this.field <= 3);
    this.drawDevice();
  }

  // ---- 卓上の捨て札 ----
  clearPile() {
    for (const m of this.pile) this.ctx.scene.scene.remove(m);
    this.pile = [];
  }
  pilePos() {
    const a = Math.random() * Math.PI * 2, r = 0.34 + Math.random() * 0.3;
    return new THREE.Vector3(Math.cos(a) * r, TABLE_Y + 0.006 + this.pile.length * 0.0015, Math.sin(a) * r);
  }
  addPileMesh(id) {
    const m = this.ctx.scene.makeCard(`${KEY}:${id}`, cardCanvas(KEY, id), 0.2);
    this.pile.push(m);
    if (this.pile.length > 16) this.ctx.scene.scene.remove(this.pile.shift());
    return m;
  }

  // ---- 完全同期（途中参加・アニメ後） ----
  sync(m) {
    const s = m.sub; if (!s) return;
    this.field = s.field; this.target = s.target; this.setNums();
    for (const u of m.seats) {
      const n = m.alive[u] ? (s.hands[u] || []).length : 0;
      this.counts[u] = n;
      this.ctx.scene.setHandCount(u, n, cardCanvas(KEY, 'back'));
    }
    if (this.pile.length === 0 && s.pile.length) {
      for (const id of s.pile) {
        const mesh = this.addPileMesh(id);
        mesh.position.copy(this.pilePos()); mesh.rotation.set(-Math.PI / 2, 0, Math.random() * 6);
        this.ctx.scene.scene.add(mesh);
      }
    }
    if (m.phase === 'round' && s.turn) this.showTurn(m, s.turn.uid, s.turn);
    else this.showTurn(m, null);
    this.renderHand(m);
  }

  showTurn(m, uid, t) {
    for (const u of m.seats) this.ctx.scene.setSeatStatus(u, { active: u === uid });
    const el = this.el.turn;
    if (!uid) { el.textContent = ''; this.el.badges.innerHTML = ''; return; }
    const mine = uid === this.ctx.me;
    el.className = 'cc-turn' + (mine ? ' mine' : '');
    let left = t && t.left > 1 ? ` （あと${t.left}枚）` : '';
    el.textContent = mine ? `▶ あなたのターン${left}` : `${this.ctx.name(uid)} のターン${left}`;
    const b = [];
    if (t?.plus2) b.push('<span class="bdg r">+2 数字カードのみ</span>');
    if (t?.dbl || t?.double) b.push('<span class="bdg">DOUBLE</span>');
    if (t?.random) b.push('<span class="bdg r">RANDOM</span>');
    const s = m.sub;
    if (s) {
      const al = m.seats.filter((u) => m.alive[u]);
      const i = al.indexOf(uid);
      if (i >= 0 && al.length > 1) b.push(`<span class="bdg dim">次 → ${this.ctx.name(al[(i + s.dir + al.length) % al.length])}</span>`);
    }
    this.el.badges.innerHTML = b.join('');
  }

  // ---- 手札UI ----
  renderHand(m) {
    const me = this.ctx.me;
    const s = m.sub;
    const hand = me && s && m.alive[me] ? (s.hands[me] || []) : null;
    const box = this.el.hand;
    box.innerHTML = '';
    if (!hand) { box.style.display = 'none'; return; }
    box.style.display = '';
    const legal = new Set(this.inputOn ? legalIndices(m, me) : []);
    const order = hand.map((id, i) => ({ id, i })).sort((a, b) => CARD_ORDER.indexOf(a.id) - CARD_ORDER.indexOf(b.id));
    for (const { id, i } of order) {
      const b = document.createElement('button');
      b.className = 'card' + (legal.has(i) ? ' playable' : '') + (CARD_DEFS[id].type === 'sp' ? ' sp' : '');
      b.innerHTML = `<img src="${cardURL(KEY, id)}" alt="${CARD_DEFS[id].label}">`;
      b.disabled = !legal.has(i);
      b.addEventListener('mouseenter', () => { this.el.tip.textContent = CARD_DEFS[id].desc ? `${CARD_DEFS[id].label}：${CARD_DEFS[id].desc}` : `数字カード ${CARD_DEFS[id].label}`; });
      b.addEventListener('mouseleave', () => { this.el.tip.textContent = ''; });
      b.addEventListener('click', () => this.onCard(m, i, id, b));
      box.appendChild(b);
    }
  }

  setInput(on, m) { this.inputOn = on; this.renderHand(m); }

  async onCard(m, idx, id, btn) {
    if (!this.inputOn) return;
    let target = null;
    if (id === 'shot') {
      const others = m.seats.filter((u) => m.alive[u] && u !== this.ctx.me);
      target = await this.ctx.choose('SHOT — ターンを渡す相手を選ぶ', others.map((u) => ({ value: u, label: this.ctx.name(u) })));
      if (!target) return;
    }
    this.inputOn = false;
    btn.classList.add('leaving');
    this.el.hand.querySelectorAll('button').forEach((b) => (b.disabled = true));
    this.ctx.send({ type: 'play', idx, card: id, target });
  }

  // ---- イベント演出 ----
  async animate(ev, m) {
    const sc = this.ctx.scene, name = this.ctx.name;
    switch (ev.t) {
      case 'cc_setup': {
        this.clearPile();
        this.field = 0; this.target = ev.target; this.setNums();
        for (const u of ev.players) { this.counts[u] = 0; sc.setHandCount(u, 0, cardCanvas(KEY, 'back')); }
        await this.ctx.banner(`目標値 ${ev.target}`, `手札 ${ev.hs}枚　／　スタート：${name(ev.start)}`, 1900);
        for (let k = 1; k <= ev.hs; k++) {
          for (const u of ev.players) { this.counts[u] = k; sc.setHandCount(u, k); }
          sfx.deal(); await sc.wait(70);
        }
        if (this.ctx.me && ev.players.includes(this.ctx.me)) this.renderHand(m, true);
        return;
      }
      case 'cc_turn': {
        this.showTurn(m, ev.uid, ev);
        if (ev.uid === this.ctx.me) sfx.tick();
        await sc.wait(ev.plus2 || ev.double || ev.random ? 650 : 250);
        return;
      }
      case 'cc_play': {
        const def = CARD_DEFS[ev.card];
        if (ev.forced) this.ctx.popText('RANDOM!', 'r');
        const mesh = this.addPileMesh(ev.card);
        this.counts[ev.uid] = ev.left; sc.setHandCount(ev.uid, ev.left);
        if (ev.uid === this.ctx.me) {
          const el = this.el.hand.querySelector('.leaving'); if (el) el.remove();
          else { const imgs = [...this.el.hand.querySelectorAll('img')].filter((x) => x.alt === def.label); if (imgs[0]) imgs[0].parentElement.remove(); }
        }
        await sc.flyCard(mesh, ev.uid, this.pilePos(), Math.random() * 6);
        sfx.card();
        this.field = ev.field; this.setNums();
        if (def.type === 'sp') {
          sfx.special();
          let t = def.label;
          if (ev.card === 'shot' && ev.target) t = `SHOT → ${name(ev.target)}`;
          if (ev.card === 'shield') t = 'SHIELD';
          this.ctx.popText(t, ev.card === 'shield' ? 'b' : '');
          await sc.wait(450);
        } else if (ev.plus2) {
          this.ctx.popText(`${def.label} +2 = ${ev.value}`, 'r');
          await sc.wait(350);
        }
        await sc.wait(220);
        return;
      }
      case 'cc_transfer': this.ctx.popText(`DOUBLE → ${name(ev.to)}`); await sc.wait(500); return;
      case 'cc_draw': {
        this.counts[ev.uid] = (this.counts[ev.uid] || 0) + ev.n; sc.setHandCount(ev.uid, this.counts[ev.uid]);
        sfx.deal(); await sc.wait(150); return;
      }
      case 'cc_lose': {
        sfx.bust();
        this.drawDevice(true);
        this.showTurn(m, null);
        for (const u of m.seats) sc.setSeatStatus(u, { active: u === ev.uid });
        await this.ctx.banner(`${name(ev.uid)} の負け`, loseReason(ev), 2300, 'red');
        return;
      }
    }
  }

  dispose() { this.clearPile(); this.ctx.hud.innerHTML = ''; }
}

// COUNT CARDS : 表示（3D小物 + 手札UI + イベント演出）
import * as THREE from 'three';
import { CARD_DEFS, CARD_ORDER } from './cards.js';
import { legalIndices } from './rules.js';
import { preloadCards, cardCanvas, cardURL } from '../../card-art.js';
import { TABLE_Y } from '../../scene/scene.js';
import { sfx } from '../../audio.js';

const KEY = 'count-cards';

export async function createView(ctx) {
  const v = new CountCardsView(ctx);
  await v.init();
  return v;
}

// 効果の説明（カード公開後に表示）
function effectText(ev, name) {
  switch (ev.card) {
    case 'eq0': return '場の数字が 0 に！';
    case 'eqmax': return `場の数字が 目標値 ${ev.field} に！`;
    case 'reverse': return '順番が逆回りに！';
    case 'plus2': return '次の人は 数字カードのみ＆+2';
    case 'shot': return `${name(ev.target)} のターンへ！`;
    case 'double': return '次の人は 2枚プレイ！';
    case 'random': return '次の人は ランダムに強制プレイ！';
    case 'shield': {
      const c = ev.cancelled || {};
      const list = [c.plus2 && '+2', c.double && 'DOUBLE', c.random && 'RANDOM'].filter(Boolean);
      return list.length ? `${list.join('・')} を無効化！` : '次の人へパス';
    }
    default: return '';
  }
}

class CountCardsView {
  // ctx: { scene, hud, me, name(uid), send(action), banner, popText, choose, reveal }
  constructor(ctx) {
    this.ctx = ctx;
    this.pile = [];
    this.field = 0; this.target = 0;
    this.inputOn = false;
    this.handEls = new Map(); // key -> button
    this.handLimit = 0; // 配札演出が終わるまで手札は見せない
    this.lastM = null;
  }

  async init() {
    await preloadCards(KEY, CARD_DEFS);
    const sc = this.ctx.scene;
    sc.setBackCanvas(cardCanvas(KEY, 'back'));
    this.devCanvas = document.createElement('canvas'); this.devCanvas.width = 128; this.devCanvas.height = 160;
    this.devTex = new THREE.CanvasTexture(this.devCanvas);
    this.devTex.magFilter = THREE.LinearFilter; this.devTex.minFilter = THREE.LinearFilter;
    this.devTex.wrapS = THREE.RepeatWrapping; this.devTex.repeat.set(6, 1); this.devTex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group(); g.position.set(0, TABLE_Y, 0);
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.04, 6), mat(0x3a3630)); base.position.y = 0.02; g.add(base);
    const screen = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 6, 1, true), new THREE.MeshBasicMaterial({ map: this.devTex }));
    screen.position.y = 0.13; screen.rotation.y = Math.PI / 6; g.add(screen);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.03, 6), mat(0x4a463e)); cap.position.y = 0.235; g.add(cap);
    const glow = new THREE.PointLight(0x7aff9a, 0.6, 1.0, 2); glow.position.y = 0.14; g.add(glow);
    sc.props.add(g);
    this.drawDevice();
    this.buildHud();
  }

  drawDevice(flash = false) {
    const c = this.devCanvas, g = c.getContext('2d');
    g.fillStyle = flash ? '#3a0a08' : '#04140c'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(120,255,160,.06)';
    for (let y = 0; y < c.height; y += 4) g.fillRect(0, y, c.width, 2);
    const over = this.field > this.target;
    g.fillStyle = over ? '#ff5a3a' : '#8dffa8';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 64px "Courier New", monospace';
    g.fillText(String(this.field), c.width / 2, 60);
    g.fillStyle = '#e8c070'; g.font = 'bold 30px "Courier New", monospace';
    g.fillText('/' + (this.target || '--'), c.width / 2, 122);
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

  setNums(bump) {
    this.el.field.textContent = this.field;
    this.el.target.textContent = this.target || '--';
    this.el.field.classList.toggle('over', this.field > this.target);
    this.el.field.classList.toggle('near', this.field <= this.target && this.target - this.field <= 3);
    if (bump) { this.el.field.classList.remove('bump'); void this.el.field.offsetWidth; this.el.field.classList.add('bump'); }
    this.drawDevice();
  }

  // ---- 卓上の捨て札 ----
  clearPile() { for (const m of this.pile) this.ctx.scene.scene.remove(m); this.pile = []; }
  pilePos() {
    const a = Math.random() * Math.PI * 2, r = 0.36 + Math.random() * 0.3;
    return new THREE.Vector3(Math.cos(a) * r, TABLE_Y + 0.006 + this.pile.length * 0.0015, Math.sin(a) * r);
  }
  addPileMesh(id) {
    const m = this.ctx.scene.makeCard(`${KEY}:${id}`, cardCanvas(KEY, id));
    this.pile.push(m);
    if (this.pile.length > 16) this.ctx.scene.scene.remove(this.pile.shift());
    return m;
  }

  // ---- 完全同期 ----
  sync(m) {
    this.lastM = m;
    const s = m.sub; if (!s) return;
    this.field = s.field; this.target = s.target; this.setNums();
    for (const u of m.seats) this.ctx.scene.setHandCount(u, m.alive[u] ? (s.hands[u] || []).length : 0);
    if (this.pile.length === 0 && s.pile.length) {
      for (const id of s.pile) {
        const mesh = this.addPileMesh(id);
        mesh.position.copy(this.pilePos()); mesh.rotation.set(-Math.PI / 2, 0, Math.random() * 6);
        this.ctx.scene.scene.add(mesh);
      }
    }
    if (m.phase === 'round' && s.turn) this.showTurn(m, s.turn.uid, s.turn);
    else this.showTurn(m, null);
    this.handLimit = Infinity;
    this.renderHand(m);
  }

  showTurn(m, uid, t) {
    for (const u of m.seats) this.ctx.scene.setSeatStatus(u, { active: u === uid });
    const el = this.el.turn;
    if (!uid) { el.textContent = ''; this.el.badges.innerHTML = ''; return; }
    const mine = uid === this.ctx.me;
    el.className = 'cc-turn' + (mine ? ' mine' : '');
    const left = t && t.left > 1 ? ` （あと${t.left}枚）` : '';
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

  // ---- 手札UI（要素を使い回して差分更新：ちらつき防止） ----
  renderHand(m) {
    const me = this.ctx.me;
    const s = m.sub;
    const hand = me && s && m.alive[me] ? (s.hands[me] || []) : null;
    const box = this.el.hand;
    if (!hand) { box.style.display = 'none'; return; }
    box.style.display = '';
    const legal = new Set(this.inputOn && m.phase === 'round' ? legalIndices(m, me) : []);
    const order = hand.map((id, i) => ({ id, i })).sort((a, b) => CARD_ORDER.indexOf(a.id) - CARD_ORDER.indexOf(b.id) || a.i - b.i)
      .slice(0, this.handLimit);
    const seen = {};
    const keep = new Set();
    let prev = null;
    for (const { id, i } of order) {
      seen[id] = (seen[id] || 0) + 1;
      const key = `${id}#${seen[id]}`;
      keep.add(key);
      let b = this.handEls.get(key);
      if (!b) {
        b = document.createElement('button');
        b.innerHTML = `<img src="${cardURL(KEY, id)}" alt="${CARD_DEFS[id].label}" draggable="false">`;
        b.addEventListener('mouseenter', () => { this.el.tip.textContent = CARD_DEFS[id].desc ? `${CARD_DEFS[id].label}：${CARD_DEFS[id].desc}` : `数字カード ${CARD_DEFS[id].label}`; });
        b.addEventListener('mouseleave', () => { this.el.tip.textContent = ''; });
        b.addEventListener('click', () => this.onCard(b));
        b.classList.add('new');
        setTimeout(() => b.classList.remove('new'), 300);
        this.handEls.set(key, b);
      }
      b.dataset.idx = i; b.dataset.card = id;
      b.className = 'card' + (legal.has(i) ? ' playable' : '') + (CARD_DEFS[id].type === 'sp' ? ' sp' : '') + (b.classList.contains('new') ? ' new' : '');
      b.disabled = !legal.has(i);
      const want = prev ? prev.nextSibling : box.firstChild;
      if (want !== b) box.insertBefore(b, want);
      prev = b;
    }
    for (const [key, b] of this.handEls) if (!keep.has(key)) { b.remove(); this.handEls.delete(key); }
  }

  setInput(on, m) { this.inputOn = on; this.lastM = m; this.renderHand(m); }

  async onCard(btn) {
    const m = this.lastM;
    if (!this.inputOn || !m) return;
    const idx = +btn.dataset.idx, id = btn.dataset.card;
    let target = null;
    if (id === 'shot') {
      const others = m.seats.filter((u) => m.alive[u] && u !== this.ctx.me);
      target = await this.ctx.choose('SHOT — ターンを渡す相手を選ぶ', others.map((u) => ({ value: u, label: this.ctx.name(u) })));
      if (!target || !this.inputOn) return;
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
        for (const u of m.seats) sc.setHandCount(u, 0);
        this.handLimit = 0; this.renderHand(m);
        await this.ctx.banner(`目標値 ${ev.target}`, `手札 ${ev.hs}枚　／　スタート：${name(ev.start)}`, 1700);
        await sc.dealCards(ev.players, ev.hs, (u, k) => {
          if (u === this.ctx.me) { this.handLimit = k; this.renderHand(m); }
          else sc.setHandCount(u, k);
        });
        this.handLimit = Infinity; this.renderHand(m);
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
        sc.setHandCount(ev.uid, ev.left);
        // ① 何のカードが出たかを全員に見せる
        const fly = sc.flyCard(mesh, ev.uid, this.pilePos(), Math.random() * 6);
        sfx.card();
        await this.ctx.reveal({ img: cardURL(KEY, ev.card), who: name(ev.uid), forced: ev.forced, ms: def.type === 'sp' ? 1150 : 850 });
        await fly;
        // ② 効果を適用
        if (def.type === 'num') {
          const before = this.field;
          this.field = ev.field; this.setNums(true);
          sfx.tick();
          const add = ev.value >= 0 ? `+${ev.value}` : `${ev.value}`;
          this.ctx.popText(ev.plus2 ? `${def.label} +2 → ${add}` : add, ev.plus2 ? 'r' : 'g');
          await sc.wait(before === ev.field ? 250 : 420);
        } else {
          sfx.special();
          if (this.field !== ev.field) { this.field = ev.field; this.setNums(true); }
          this.ctx.popText(effectText(ev, name), ev.card === 'shield' ? 'b' : '');
          await sc.wait(700);
        }
        return;
      }
      case 'cc_transfer': this.ctx.popText(`DOUBLE → ${name(ev.to)}`); await sc.wait(600); return;
      case 'cc_draw': {
        const cur = m.sub?.hands?.[ev.uid]?.length;
        await sc.dealCards([ev.uid], ev.n, () => {});
        if (cur !== undefined) sc.setHandCount(ev.uid, cur);
        return;
      }
      case 'cc_lose': {
        this.drawDevice(true);
        this.showTurn(m, null);
        await sc.wait(300);
        return;
      }
    }
  }

  dispose() { this.clearPile(); this.ctx.hud.innerHTML = ''; this.handEls.clear(); }
}

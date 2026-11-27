// INDIAN SUM : 表示（おでこのカード・宣言UI・判定の計算演出）
import * as THREE from 'three';
import { CARD_DEFS, minBid } from './rules.js';
import { preloadCards, cardCanvas, cardURL } from '../../card-art.js';
import { sfx } from '../../audio.js';

const KEY = 'indian-sum';
const L = (c) => CARD_DEFS[c]?.label ?? c;

export async function createView(ctx) {
  const v = new IndianSumView(ctx);
  await v.init();
  return v;
}

class IndianSumView {
  constructor(ctx) {
    this.ctx = ctx;
    this.fore = new Map();   // uid -> mesh（おでこのカード）
    this.inputOn = false;
    this.revealed = false;
    this.hidden = true;      // 配り終わるまでカードを見せない
    this.sel = 1;
    this.lastM = null;
  }

  async init() {
    await preloadCards(KEY, CARD_DEFS);
    this.ctx.scene.setBackCanvas(cardCanvas(KEY, 'back'));
    this.buildHud();
  }

  buildHud() {
    const h = this.ctx.hud;
    h.innerHTML = `
      <div class="is-top"><div class="is-bid" id="isBid"></div><div class="is-deck" id="isDeck"></div></div>
      <div class="cc-turn" id="isTurn"></div>
      <div class="is-seen" id="isSeen"></div>
      <div class="is-mine" id="isMine"></div>
      <div class="is-ctrl" id="isCtrl"></div>
      <div class="is-board" id="isBoard"></div>
      <div class="ld-callout" id="isCallout"></div>`;
    this.el = Object.fromEntries(['Bid', 'Deck', 'Turn', 'Seen', 'Mine', 'Ctrl', 'Board', 'Callout'].map((k) => [k.toLowerCase(), h.querySelector('#is' + k)]));
  }

  // ---------- おでこのカード ----------
  setFore(uid, card) {
    const sc = this.ctx.scene, st = sc.seats.get(uid);
    let mesh = this.fore.get(uid);
    if (!card || !st || (st.isMe && !this.revealed)) { if (mesh) mesh.visible = false; return; }
    if (!mesh) {
      mesh = new THREE.Group();
      const front = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.225), new THREE.MeshBasicMaterial({ color: 0xe0dccc }));
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.225), new THREE.MeshBasicMaterial({ map: sc.texFor('__back', cardCanvas(KEY, 'back')), color: 0xb0a8a0 }));
      back.rotation.y = Math.PI; back.position.z = -0.002;
      mesh.add(front, back);
      mesh.position.set(0, 0.2, 0.2); mesh.rotation.x = -0.12;
      st.head.add(mesh); // 顔の前、おでこの高さに掲げる（外向き）
      this.fore.set(uid, mesh);
    }
    mesh.children[0].material.map = sc.texFor(`${KEY}:${card}`, cardCanvas(KEY, card));
    mesh.children[0].material.needsUpdate = true;
    mesh.visible = true;
    mesh.userData.card = card;
  }
  clearFore() { for (const [, mm] of this.fore) mm.visible = false; }

  // ---------- HUD ----------
  renderTop(m) {
    const s = m.sub;
    const b = s?.bid;
    this.el.bid.innerHTML = b
      ? `<span class="k">現在の宣言</span><b>${b.value}</b><span>以上</span><small>by ${this.ctx.name(b.uid)}</small>`
      : '<span class="k">現在の宣言</span><span class="none">まだ宣言はない</span>';
    this.el.deck.textContent = m.gs ? `山札 ${m.gs.deck.length}枚 ／ 捨て札 ${m.gs.discard.length}枚${m.gs.night ? ' ／ 次ラウンドで山札リセット' : ''}` : '';
  }
  renderSeen(m) {
    const s = m?.sub, me = this.ctx.me;
    if (!s?.cards || !m.alive || this.hidden) { this.el.seen.innerHTML = ''; return; }
    const others = m.seats.filter((u) => m.alive[u] && s.cards[u] && u !== me);
    this.el.seen.innerHTML = '<div class="is-sh">見えているカード</div>' + others.map((u) =>
      `<div class="is-row"><img src="${cardURL(KEY, s.cards[u])}"><span>${this.ctx.name(u)}</span></div>`).join('');
  }
  renderMine(m) {
    const me = this.ctx.me, s = m?.sub;
    if (!me || !m?.alive?.[me] || !s?.cards?.[me] || this.hidden) { this.el.mine.innerHTML = ''; return; }
    const show = this.revealed;
    this.el.mine.innerHTML = `<div class="is-sh">あなたのカード</div><img class="${show ? 'flip' : ''}" src="${cardURL(KEY, show ? s.cards[me] : 'back')}"><div class="is-q">${show ? L(s.cards[me]) : '？？？'}</div>`;
  }
  showTurn(m, uid) {
    for (const u of m.seats) this.ctx.scene.setSeatStatus(u, { active: u === uid });
    if (!uid) { this.el.turn.textContent = ''; return; }
    const mine = uid === this.ctx.me;
    this.el.turn.className = 'cc-turn is' + (mine ? ' mine' : '');
    this.el.turn.textContent = mine ? '▶ あなたの番：宣言をつり上げるか、ダウトか' : `${this.ctx.name(uid)} が考えている…`;
  }

  setInput(on, m) {
    const was = this.inputOn;
    this.inputOn = on; this.lastM = m;
    if (on && !was) this.sel = minBid(m);
    this.renderCtrl(m);
  }
  renderCtrl(m) {
    const box = this.el.ctrl;
    if (!this.inputOn || !m || m.phase !== 'round') { box.innerHTML = ''; box.classList.remove('on'); return; }
    box.classList.add('on');
    const lo = minBid(m);
    this.sel = Math.max(lo, this.sel);
    const canCall = !!m.sub.bid && m.sub.bid.uid !== this.ctx.me;
    box.innerHTML = `
      <div class="is-r"><span class="ld-lab">宣言する数</span>
        <button class="mini" data-d="-10">−10</button><button class="mini" data-d="-1">−</button>
        <span class="is-num">${this.sel}</span>
        <button class="mini" data-d="1">＋</button><button class="mini" data-d="5">+5</button><button class="mini" data-d="10">+10</button></div>
      <div class="is-r small">「場の合計は ${this.sel} 以上ある」（最低 ${lo}）</div>
      <div class="is-r btns"><button class="btn" id="isRaise">宣言する</button><button class="btn bluff" id="isCall" ${canCall ? '' : 'disabled'}>ダウト！</button></div>`;
    box.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { this.sel = Math.max(lo, this.sel + +b.dataset.d); this.renderCtrl(m); }));
    box.querySelector('#isRaise').onclick = () => this.send({ type: 'bid', value: this.sel });
    box.querySelector('#isCall').onclick = () => this.send({ type: 'call' });
  }
  send(a) {
    if (!this.inputOn) return;
    this.inputOn = false; this.el.ctrl.innerHTML = ''; this.el.ctrl.classList.remove('on');
    this.ctx.send(a);
  }
  callout(html, ms = 1300, cls = '') {
    const c = this.el.callout;
    c.className = 'ld-callout on ' + cls; c.innerHTML = html;
    return new Promise((r) => setTimeout(() => { c.classList.remove('on'); setTimeout(r, 150); }, ms));
  }

  // ---------- 同期 ----------
  onQueue(evs) { if (evs.some((e) => e.t === 'in_setup')) { this.hidden = true; this.clearFore(); this.renderSeen(this.lastM || {}); this.renderMine(this.lastM || {}); } }
  sync(m) {
    this.lastM = m;
    const s = m.sub; if (!s?.cards) return;
    this.hidden = false;
    for (const u of m.seats) this.setFore(u, m.alive[u] ? s.cards[u] : null);
    for (const u of m.seats) this.ctx.scene.setHandCount(u, 0);
    this.renderTop(m); this.renderSeen(m); this.renderMine(m);
    this.showTurn(m, m.phase === 'round' ? s.turn?.uid : null);
    this.renderCtrl(m);
  }

  // ---------- 演出 ----------
  async animate(ev, m) {
    const sc = this.ctx.scene, name = this.ctx.name, me = this.ctx.me;
    this.lastM = m;
    switch (ev.t) {
      case 'in_setup': {
        this.revealed = false; this.hidden = true;
        this.el.board.classList.remove('on'); this.el.board.innerHTML = '';
        this.clearFore(); this.renderSeen(m); this.renderMine(m); this.renderTop(m);
        if (ev.reset) { this.ctx.popText('夜が明けた — 山札リセット', 'b'); await sc.wait(900); }
        await this.ctx.banner('INDIAN SUM', `自分のカードだけ見えない　／　スタート：${name(ev.start)}`, 1500);
        await sc.dealCards(ev.players, 1, (u) => {
          if (u !== me) this.setFore(u, m.sub?.cards?.[u]);
        });
        this.hidden = false;
        this.renderSeen(m); this.renderMine(m);
        return;
      }
      case 'in_turn': this.showTurn(m, ev.uid); if (ev.uid === me) sfx.tick(); await sc.wait(200); return;
      case 'in_bid': {
        sfx.special();
        await this.callout(`<div class="who">${name(ev.uid)}</div><div class="say">合計 <b>${ev.value}</b> 以上</div>`, 1200);
        this.renderTop({ ...m, sub: { ...m.sub, bid: { value: ev.value, uid: ev.uid } } });
        return;
      }
      case 'in_call': {
        sfx.bust(); this.showTurn(m, null);
        await this.callout(`<div class="who">${name(ev.uid)}</div><div class="say bluff">ダウト！</div><div class="sub">${name(ev.target)} の「${ev.value} 以上」は嘘だ</div>`, 1700, 'red');
        return;
      }
      case 'in_reshuffle': this.ctx.popText('山札切れ — 捨て札をシャッフル', 'b'); await sc.wait(600); return;
      case 'in_reveal': return this.animateReveal(ev, m);
    }
  }

  async animateReveal(ev, m) {
    const sc = this.ctx.scene, name = this.ctx.name, me = this.ctx.me;
    this.revealed = true;
    // 自分のカードをめくる
    if (me && ev.cards[me]) { sfx.card(); this.renderMine({ ...m, sub: { ...m.sub, cards: ev.cards } }); }
    const order = m.seats.filter((u) => ev.cards[u]);
    const bd = this.el.board;
    bd.innerHTML = `<div class="ldb-h">オープン！ 宣言「${ev.bid} 以上」（${name(ev.bidder)}）</div>
      <div class="is-cards">${order.map((u) => `<div class="is-c ${u === me ? 'me' : ''}" data-u="${u}"><img data-card="${ev.cards[u]}" src="${cardURL(KEY, ev.cards[u])}"><span>${name(u)}</span></div>`).join('')}</div>
      <div class="is-steps" id="isSteps"></div>`;
    bd.classList.add('on');
    const steps = bd.querySelector('#isSteps');
    const add = (html, cls = '') => { const d = document.createElement('div'); d.className = 'is-step ' + cls; d.innerHTML = html; steps.appendChild(d); sfx.tick(); };
    await sc.wait(1100);
    for (const st of ev.steps) {
      if (st.kind === 'q') {
        const qEl = bd.querySelector('.is-c img[data-card="q"]');
        add(`<b>？</b> → 山札から引いたカードは <img src="${cardURL(KEY, st.card)}"> <b>${L(st.card)}</b>`, 'sp');
        if (qEl) { qEl.classList.add('swap'); await sc.wait(400); qEl.src = cardURL(KEY, st.card); qEl.dataset.card = st.card; }
      } else if (st.kind === 'max0') {
        add(st.card ? `<b>MAX→0</b>：一番大きい <b>${st.from}</b> が 0 になる` : '<b>MAX→0</b>：対象のカードなし', 'sp');
        if (st.card) { const t = bd.querySelector(`.is-c img[data-card="${st.card}"]:not(.zero)`); if (t) t.classList.add('zero'); }
      } else if (st.kind === 'sum') {
        const el = document.createElement('div'); el.className = 'is-step big'; steps.appendChild(el);
        // 合計をカウントアップ
        const target = st.value, n = 18;
        for (let k = 0; k <= n; k++) { el.innerHTML = `合計 <b>${Math.round((target * k) / n)}</b>`; sfx.tick(); await sc.wait(45); }
      } else if (st.kind === 'x2') {
        add(`<b>×2</b> → 合計 <b class="hl">${st.value}</b>`, 'sp big');
      }
      await sc.wait(750);
    }
    const over = ev.bid > ev.sum;
    add(over ? `宣言 <b>${ev.bid}</b> ＞ 合計 <b>${ev.sum}</b>　→ 宣言は嘘！` : `宣言 <b>${ev.bid}</b> ≦ 合計 <b>${ev.sum}</b>　→ 宣言は本当！`, over ? 'res ok' : 'res ng');
    if (ev.night) add('夜カード：次のラウンドで全カードを山札に戻してシャッフル', 'sp');
    this.renderTop(m);
    await sc.wait(2200); // この後、共通の「敗者決定（警報）」へ
  }

  dispose() {
    for (const [, mm] of this.fore) mm.parent?.remove(mm);
    this.ctx.hud.innerHTML = '';
  }
}

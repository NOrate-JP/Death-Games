// RUSSIAN DECK : 表示（山札・捨て札・手札・CANCELバー・各種選択）
import * as THREE from 'three';
import { CARD_DEFS, isMatch, canCancel, deadsInDeck, WINDOW_MS } from './rules.js';
import { preloadCards, cardCanvas, cardURL } from '../../card-art.js';
import { TABLE_Y } from '../../scene/scene.js';
import { sfx } from '../../audio.js';
import { makeHandCard, layoutFan } from '../../hand-ui.js';

const KEY = 'russian-deck';
const ART = Object.fromEntries(Object.entries(CARD_DEFS).map(([k, d]) => [k, { ...d, type: 'sp' }]));
const ORDER = ['revive', 'cancel', 'skip', 'attack', 'shuffle', 'search', 'give', 'ma', 'mb', 'mc', 'md', 'me', 'dead'];
const L = (c) => CARD_DEFS[c]?.label ?? c;
const UNPLAYABLE = new Set(['dead', 'revive', 'cancel']);

export async function createView(ctx) {
  const v = new RussianDeckView(ctx);
  await v.init();
  return v;
}

class RussianDeckView {
  constructor(ctx) {
    this.ctx = ctx;
    this.handEls = new Map();
    this.handLimit = 0;
    this.inputOn = false;
    this.lastM = null;
    this.sending = false;
  }

  async init() {
    await preloadCards(KEY, ART);
    const sc = this.ctx.scene;
    sc.setBackCanvas(cardCanvas(KEY, 'back'));
    // 山札（高さで枚数を表現）と捨て札
    const g = new THREE.Group(); g.position.set(-0.12, TABLE_Y, 0);
    this.deckBody = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.3), new THREE.MeshLambertMaterial({ color: 0x3a1410, flatShading: true }));
    this.deckTop = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.3), new THREE.MeshLambertMaterial({ map: sc.texFor('__back', cardCanvas(KEY, 'back')) }));
    this.deckTop.rotation.x = -Math.PI / 2;
    g.add(this.deckBody, this.deckTop);
    sc.props.add(g);
    this.deckG = g;
    this.discard = sc.makeCard(`${KEY}:back`, cardCanvas(KEY, 'back'), 0.2);
    this.discard.rotation.set(-Math.PI / 2, 0, 0.15); this.discard.position.set(0.2, TABLE_Y + 0.004, 0.02); this.discard.visible = false;
    sc.scene.add(this.discard);
    this.setDeck(40);
    this.buildHud();
    this._tick = setInterval(() => this.tickBar(), 50);
  }

  setDeck(n) {
    const h = Math.max(0.004, n * 0.0045);
    this.deckBody.scale.y = h; this.deckBody.position.y = h / 2;
    this.deckTop.position.y = h + 0.001;
    this.deckG.visible = n > 0;
  }
  setDiscard(card) {
    if (!card) { this.discard.visible = false; return; }
    this.discard.material.map = this.ctx.scene.texFor(`${KEY}:${card}`, cardCanvas(KEY, card));
    this.discard.material.needsUpdate = true;
    this.discard.visible = true;
  }
  deckTopPos() { const p = this.deckG.position.clone(); p.y += this.deckBody.scale.y + 0.02; return p; }

  // ---------- HUD ----------
  buildHud() {
    const h = this.ctx.hud;
    h.innerHTML = `
      <div class="rd-top" id="rdTop"></div>
      <div class="cc-turn" id="rdTurn"></div>
      <div class="cc-badges" id="rdBadges"></div>
      <div class="rd-bar" id="rdBar"><div class="rd-bt" id="rdBarT"></div><div class="rd-meter"><i id="rdMeter"></i></div><button class="rd-cancel" id="rdCancel">CANCEL</button></div>
      <div class="rd-act" id="rdAct"></div>
      <div class="rd-peek" id="rdPeek"></div>
      <div class="rd-modal" id="rdModal"></div>
      <div class="hand-fan" id="rdHand"></div>`;
    this.el = Object.fromEntries(['Top', 'Turn', 'Badges', 'Bar', 'BarT', 'Meter', 'Cancel', 'Act', 'Peek', 'Modal', 'Hand'].map((k) => [k.toLowerCase(), h.querySelector('#rd' + k)]));
    this.el.cancel.onclick = () => {
      const m = this.ctx.getMatch();
      if (!m || !canCancel(m, this.ctx.me) || this.ctx.now() > m.sub.react.deadline) return;
      this.el.cancel.disabled = true;
      this.ctx.send({ type: 'cancel' }, { quiet: true });
    };
  }

  renderTop(m) {
    const s = m.sub; if (!s?.deck) return;
    this.el.top.innerHTML = `<span class="k">山札</span><b>${s.deck.length}</b><span class="k">うちDEAD</span><b class="d">${deadsInDeck(s)}</b><span class="k">捨て札</span><b>${s.discard.length}</b>`;
    this.setDeck(s.deck.length);
    this.setDiscard(s.discard[s.discard.length - 1]);
  }

  showTurn(m) {
    const s = m.sub, t = s?.turn;
    const uid = m.phase === 'round' ? t?.uid : null;
    for (const u of m.seats) this.ctx.scene.setSeatStatus(u, { active: u === uid });
    if (!uid) { this.el.turn.textContent = ''; this.el.badges.innerHTML = ''; return; }
    const mine = uid === this.ctx.me;
    this.el.turn.className = 'cc-turn' + (mine ? ' mine' : '');
    this.el.turn.textContent = mine ? '▶ あなたのターン：カードを使うか、ドローしてターン終了' : `${this.ctx.name(uid)} のターン`;
    const b = [];
    if (t.left > 1) b.push(`<span class="bdg r">ATTACK：あと${t.left}ターン</span>`);
    const al = m.seats.filter((u) => m.alive[u]);
    const i = al.indexOf(uid);
    if (i >= 0 && al.length > 1) b.push(`<span class="bdg dim">次 → ${this.ctx.name(al[(i + 1) % al.length])}</span>`);
    this.el.badges.innerHTML = b.join('');
  }

  // ---------- CANCEL バー（最新の状態を常に読む） ----------
  tickBar() {
    const m = this.ctx.getMatch(); const bar = this.el.bar;
    const r = m?.phase === 'round' && m.sub?.phase === 'react' ? m.sub.react : null;
    if (!r) { bar.classList.remove('on'); return; }
    bar.classList.add('on');
    const t = this.ctx.now();
    const k = t < r.start ? 1 : Math.max(0, 1 - (t - r.start) / WINDOW_MS);
    this.el.meter.style.width = `${k * 100}%`;
    this.el.meter.className = k < 0.35 ? 'low' : '';
    const by = r.chain[0];
    const card = L(by.card) + (r.kind === 'match' ? ' ×2' : '');
    const nC = r.chain.length - 1;
    const eff = nC % 2 === 0;
    const key = `${r.deadline}`;
    if (this._barKey !== key) {
      this._barKey = key;
      this.el.bart.innerHTML = `<b>${this.ctx.name(by.uid)}</b> の <b class="c">${card}</b>${r.target ? ` → ${this.ctx.name(r.target)}` : ''}`
        + (nC ? `　<span class="${eff ? 'ok' : 'ng'}">CANCEL×${nC}：現在${eff ? '有効' : '無効'}</span>` : '');
      this.el.cancel.disabled = false;
    }
    const can = canCancel(m, this.ctx.me) && t <= r.deadline;
    this.el.cancel.classList.toggle('off', !can);
    if (!can) this.el.cancel.disabled = true;
    this.el.cancel.style.display = this.ctx.me && m.alive[this.ctx.me] ? '' : 'none';
  }

  // ---------- 手札 ----------
  renderHand(m) {
    const me = this.ctx.me, s = m?.sub;
    const hand = me && s?.hands && m.alive[me] ? (s.hands[me] || []) : null;
    const box = this.el.hand;
    if (!hand) { box.style.display = 'none'; return; }
    box.style.display = '';
    const myAct = this.inputOn && m.phase === 'round' && s.phase === 'act' && s.turn.uid === me;
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
      const ok = myAct && !UNPLAYABLE.has(id);
      b.classList.toggle('playable', ok); b.classList.toggle('locked', !ok);
      const want = prev ? prev.nextSibling : box.firstChild;
      if (want !== b) box.insertBefore(b, want);
      prev = b;
    }
    for (const [key, b] of this.handEls) if (!keep.has(key)) { b.remove(); this.handEls.delete(key); }
    layoutFan(box);
  }

  async onCard(btn) {
    const m = this.lastM, me = this.ctx.me;
    if (!this.inputOn || !m || m.sub.phase !== 'act' || m.sub.turn.uid !== me) return;
    const h = m.sub.hands[me];
    const idx = +btn.dataset.idx, card = btn.dataset.card;
    if (UNPLAYABLE.has(card)) return;
    let idxs = [idx], target = null;
    const others = m.seats.filter((u) => m.alive[u] && u !== me);
    const label = (u) => `${this.ctx.name(u)}（手札${(m.sub.hands[u] || []).length}枚）`;
    if (isMatch(card)) {
      const j = h.findIndex((c, k) => c === card && k !== idx);
      const opts = [];
      if (j >= 0) opts.push({ value: 'pair', label: `${L(card)} を2枚使う（相手から1枚奪う）` });
      opts.push({ value: 'single', label: `1枚だけ捨てる（効果なし）` });
      const c = await this.ctx.choose(`${L(card)}`, opts);
      if (!c) return;
      if (c === 'pair') {
        idxs = [idx, j];
        target = await this.ctx.choose('誰から奪う？', others.map((u) => ({ value: u, label: label(u) })));
        if (!target) return;
      }
    } else if (card === 'give') {
      target = await this.ctx.choose('GIVE — カードを渡させる相手', others.map((u) => ({ value: u, label: label(u) })));
      if (!target) return;
    }
    if (!this.inputOn) return;
    this.inputOn = false;
    for (const [k, v] of this.handEls) if (v === btn) this.handEls.delete(k);
    btn.classList.remove('peek'); btn.classList.add('leaving'); setTimeout(() => btn.remove(), 320);
    this.renderAct(m);
    this.ctx.send({ type: 'play', idx: idxs, target });
  }

  // ---------- 手番のボタン・各種選択 ----------
  renderAct(m) {
    const s = m?.sub, me = this.ctx.me, box = this.el.act;
    const myAct = this.inputOn && m?.phase === 'round' && s?.phase === 'act' && s.turn.uid === me;
    box.innerHTML = myAct ? `<button class="btn rd-draw" id="rdDraw">ドローしてターン終了</button>` : '';
    const d = box.querySelector('#rdDraw');
    if (d) d.onclick = () => { if (!this.inputOn) return; this.inputOn = false; box.innerHTML = ''; this.renderHand(m); this.ctx.send({ type: 'draw' }); };
  }
  renderPeek(m) {
    const s = m?.sub, me = this.ctx.me, p = s?.peek?.[me];
    const show = p && s.turn && s.turn.no === p.no && s.turn.uid === me && m.phase === 'round';
    this.el.peek.innerHTML = show ? `<div class="rd-ph">山札の上から3枚（左が一番上）</div><div class="rd-pc">${p.cards.map((c, i) => `<div><img src="${cardURL(KEY, c)}"><span>${i + 1}</span></div>`).join('')}${p.cards.length ? '' : '<em>なし</em>'}</div>` : '';
  }
  renderModal(m) {
    const s = m?.sub, me = this.ctx.me, box = this.el.modal;
    const key = `${s?.phase}:${s?.turn?.no}:${(s?.hands?.[me] || []).length}`;
    if (this.inputOn && s?.phase === 'give' && s.give.to === me) {
      if (this._modalKey === key) return; this._modalKey = key;
      const h = s.hands[me];
      box.className = 'rd-modal on';
      box.innerHTML = `<div class="rd-mh">${this.ctx.name(s.give.from)} に渡すカードを1枚選んでください</div><div class="rd-mc">${h.map((c, i) => `<button data-i="${i}"><img src="${cardURL(KEY, c)}"><span>${L(c)}</span></button>`).join('')}</div>`;
      box.querySelectorAll('button[data-i]').forEach((b) => (b.onclick = () => { if (!this.inputOn) return; this.inputOn = false; box.className = 'rd-modal'; this._modalKey = null; this.ctx.send({ type: 'give', idx: +b.dataset.i }); }));
      return;
    }
    if (this.inputOn && s?.phase === 'revive' && s.revive.uid === me) {
      if (this._modalKey === key) return; this._modalKey = key;
      const n = s.deck.length;
      box.className = 'rd-modal on';
      box.innerHTML = `<div class="rd-mh">REVIVE！ DEAD を山札のどこに戻す？（他の人には見えません）</div>
        <div class="rd-pos"><input type="range" min="1" max="${n + 1}" value="1" id="rdPos"><div>上から <b id="rdPosV">1</b> 枚目（全${n + 1}か所）</div></div>
        <div class="rd-qb"><button data-q="1">一番上</button><button data-q="2">2枚目</button><button data-q="mid">真ん中</button><button data-q="end">一番下</button><button data-q="rand">ランダム</button></div>
        <button class="btn" id="rdPlace">ここに戻す</button>`;
      const inp = box.querySelector('#rdPos'), v = box.querySelector('#rdPosV');
      inp.oninput = () => { v.textContent = inp.value; };
      box.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => {
        const q = b.dataset.q;
        inp.value = q === 'mid' ? Math.ceil((n + 1) / 2) : q === 'end' ? n + 1 : q === 'rand' ? 1 + Math.floor(Math.random() * (n + 1)) : q;
        v.textContent = inp.value;
      }));
      box.querySelector('#rdPlace').onclick = () => { if (!this.inputOn) return; this.inputOn = false; box.className = 'rd-modal'; this._modalKey = null; this.ctx.send({ type: 'place', pos: +inp.value - 1 }); };
      return;
    }
    this._modalKey = null;
    box.className = 'rd-modal'; box.innerHTML = '';
  }

  // ---------- 同期 ----------
  onQueue(evs, m) { if (evs.some((e) => e.t === 'rd_setup')) { this.handLimit = 0; this.renderHand(m); } }
  setInput(on, m) {
    this.inputOn = on; this.lastM = m;
    this.renderHand(m); this.renderAct(m); this.renderModal(m);
  }
  sync(m) {
    this.lastM = m;
    const s = m.sub; if (!s?.deck) return;
    this.handLimit = Infinity;
    for (const u of m.seats) this.ctx.scene.setHandCount(u, m.alive[u] ? (s.hands[u] || []).length : 0);
    this.renderTop(m); this.showTurn(m); this.renderHand(m); this.renderAct(m); this.renderPeek(m); this.renderModal(m);
  }

  // ---------- 演出 ----------
  async animate(ev, m) {
    const sc = this.ctx.scene, name = this.ctx.name, me = this.ctx.me;
    this.lastM = m;
    switch (ev.t) {
      case 'rd_setup': {
        this.setDiscard(null); this.setDeck(ev.deck);
        this.el.peek.innerHTML = '';
        for (const u of m.seats) sc.setHandCount(u, 0);
        this.handLimit = 0; this.renderHand(m);
        await this.ctx.banner('RUSSIAN DECK', `DEAD ${ev.deads}枚 ／ 全員に REVIVE 1枚 ／ スタート：${name(ev.start)}`, 1800);
        await sc.dealCards(ev.players, 8, (u, k) => {
          if (u === me) { this.handLimit = k; this.renderHand(m); } else sc.setHandCount(u, k);
        });
        this.handLimit = Infinity; this.renderHand(m);
        sfx.rattle?.(10);
        this.ctx.popText(`山札に DEAD を ${ev.deads}枚 入れてシャッフル`, 'r');
        await sc.wait(700);
        return;
      }
      case 'rd_turn': this.showTurn({ ...m, sub: { ...m.sub, turn: { uid: ev.uid, left: ev.left } } }); if (ev.uid === me) sfx.tick(); await sc.wait(200); return;
      case 'rd_play': {
        sc.setHandCount(ev.uid, ev.left);
        const mesh = sc.makeCard(`${KEY}:${ev.cards[0]}`, cardCanvas(KEY, ev.cards[0]), 0.2);
        const fly = sc.flyCard(mesh, ev.uid, this.discard.position.clone().add(new THREE.Vector3(0, 0.01, 0)), 0.15);
        sfx.card();
        await this.ctx.reveal({ img: cardURL(KEY, ev.cards[0]), text: `${name(ev.uid)} が出した${ev.kind === 'match' ? '（2枚）' : ''}${ev.target ? ` → ${name(ev.target)}` : ''}`, ms: 1000 });
        await fly; sc.scene.remove(mesh); this.setDiscard(ev.cards[ev.cards.length - 1]);
        if (ev.kind === 'single') this.ctx.popText('MATCH 1枚 — 効果なし');
        return;
      }
      case 'rd_window': sfx.tick(); return;
      case 'rd_cancel': {
        sc.setHandCount(ev.uid, ev.left);
        sfx.bust();
        this.setDiscard('cancel');
        await this.ctx.reveal({ img: cardURL(KEY, 'cancel'), text: `${name(ev.uid)} が CANCEL！`, ms: 800 });
        this.ctx.popText(ev.effective ? 'CANCEL返し！ 効果が復活' : 'CANCEL！ 無効化', ev.effective ? 'g' : 'r');
        return;
      }
      case 'rd_resolve': if (!ev.effective) { this.ctx.popText('無効化された', 'b'); await sc.wait(500); } return;
      case 'rd_attack': this.ctx.popText(`ATTACK！ ${name(ev.to)} は ${ev.turns}ターン連続`, 'r'); await sc.wait(800); return;
      case 'rd_skip': this.ctx.popText(`${name(ev.uid)} はスキップ`, 'b'); await sc.wait(500); return;
      case 'rd_shuffle': {
        this.ctx.popText('山札をシャッフル', 'b'); sfx.rattle?.(10);
        const p0 = this.deckG.position.clone();
        await sc.tween(700, (t) => { this.deckG.position.copy(p0); this.deckG.position.x += Math.sin(t * 40) * 0.015 * (1 - t); this.deckG.rotation.y = Math.sin(t * 25) * 0.2 * (1 - t); });
        this.deckG.position.copy(p0); this.deckG.rotation.y = 0;
        return;
      }
      case 'rd_search': if (ev.uid !== me) this.ctx.popText(`${name(ev.uid)} が山札の上3枚を見ている…`); else this.renderPeek(m); await sc.wait(500); return;
      case 'rd_give_wait': this.ctx.popText(`${name(ev.to)} が ${name(ev.from)} に渡すカードを選んでいる…`); await sc.wait(400); return;
      case 'rd_give_none': this.ctx.popText(`${name(ev.to)} は手札がない`); await sc.wait(500); return;
      case 'rd_given': case 'rd_steal': {
        const from = ev.from, to = ev.to;
        if (ev.t === 'rd_steal' && !ev.card) { this.ctx.popText(`${name(from)} は手札がない`); return; }
        const mesh = sc.makeCard('__back', cardCanvas(KEY, 'back'), 0.14);
        await sc.flyCard(mesh, from, sc.handWorldPos(to), 0, 600); sc.scene.remove(mesh);
        sc.setHandCount(from, (m.sub?.hands?.[from] || []).length); sc.setHandCount(to, (m.sub?.hands?.[to] || []).length);
        if (me === to) this.ctx.popText(`${L(ev.card)} を手に入れた`, 'g');
        else if (me === from) this.ctx.popText(`${L(ev.card)} を${ev.t === 'rd_steal' ? '奪われた' : '渡した'}`, 'r');
        else this.ctx.popText(`${name(from)} → ${name(to)} にカードが1枚`);
        await sc.wait(400);
        return;
      }
      case 'rd_draw': {
        this.setDeck(ev.deck);
        sfx.deal();
        await sc.dealCards([ev.uid], 1, () => sc.setHandCount(ev.uid, ev.left));
        return;
      }
      case 'rd_dead': {
        this.setDeck(Math.max(0, (m.sub?.deck?.length ?? 1)));
        if (!ev.revived) this.ctx.alarmNow(); // 助からない：引いた瞬間に警報
        else sfx.bust();
        await this.ctx.reveal({ img: cardURL(KEY, 'dead'), text: `${name(ev.uid)} が DEAD を引いた！`, ms: 1800 });
        if (ev.revived) { sfx.special(); this.ctx.popText('REVIVE！ 首の皮一枚つながった', 'g'); await sc.wait(900); }
        return;
      }
      case 'rd_revive': if (ev.uid !== me) this.ctx.popText(`${name(ev.uid)} が DEAD を山札に戻している…`); await sc.wait(300); return;
      case 'rd_placed': this.setDeck(ev.deck); sfx.deal(); this.ctx.popText(`${name(ev.uid)} が DEAD を山札のどこかへ…`, 'r'); await sc.wait(600); return;
    }
  }

  dispose() {
    clearInterval(this._tick);
    this.ctx.scene.scene.remove(this.discard);
    this.ctx.hud.innerHTML = '';
    this.handEls.clear();
  }
}

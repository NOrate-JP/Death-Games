// LIAR'S DICE : 表示（カップ・ダイス・宣言UI・判定演出）
import * as THREE from 'three';
import { STAR, bidText, isLegalBid, minRaise, maxCount, faces, canRaise, canReroll, hiddenIdx, totalDice } from './rules.js';
import { TABLE_Y } from '../../scene/scene.js';
import { sfx } from '../../audio.js';

export async function createView(ctx) {
  const v = new LiarDiceView(ctx);
  await v.init();
  return v;
}

// ---- ダイスの面画像 ----
const faceCanvas = {};
const faceURLs = {};
function drawFace(f) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e0cc'; g.fillRect(0, 0, S, S);
  const gr = g.createRadialGradient(S * .35, S * .3, 10, S / 2, S / 2, S * .75);
  gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(80,60,40,.35)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#8a7a60'; g.lineWidth = 6; g.strokeRect(3, 3, S - 6, S - 6);
  if (f === STAR) {
    g.fillStyle = '#b01818';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 20 : 48, a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(S / 2 + Math.cos(a) * r, S / 2 + 4 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
  } else {
    const P = { 1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.25, .25], [.5, .5], [.75, .75]],
      4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]], 5: [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]] }[f];
    g.fillStyle = f === 1 ? '#b01818' : '#1a1410';
    for (const [x, y] of P) { g.beginPath(); g.arc(x * S, y * S, f === 1 ? 17 : 12, 0, 7); g.fill(); }
  }
  return c;
}
function faceURL(f) { if (!faceURLs[f]) faceURLs[f] = faceCanvas[f].toDataURL(); return faceURLs[f]; }
const faceLabel = (f) => (f === STAR ? '★' : String(f));

class LiarDiceView {
  constructor(ctx) {
    this.ctx = ctx;
    this.cups = new Map();      // uid -> group
    this.diceMeshes = new Map(); // uid -> [mesh]
    this.revealed = false;
    this.hideMine = true;        // 配る演出が終わるまで自分のダイスは見せない
    this.mineShown = Infinity;
    this.inputOn = false;
    this.sel = { face: 2, count: 1, reroll: false, reveal: new Set() };
    this.lastM = null;
  }

  async init() {
    for (let f = 1; f <= 6; f++) faceCanvas[f] = drawFace(f);
    const sc = this.ctx.scene;
    this.faceMats = {};
    for (let f = 1; f <= 6; f++) {
      const t = new THREE.CanvasTexture(faceCanvas[f]);
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      this.faceMats[f] = new THREE.MeshLambertMaterial({ map: t });
    }
    this.dieGeo = new THREE.BoxGeometry(0.072, 0.072, 0.072);
    // 中央の表示装置
    this.devCanvas = document.createElement('canvas'); this.devCanvas.width = 128; this.devCanvas.height = 160;
    this.devTex = new THREE.CanvasTexture(this.devCanvas);
    this.devTex.wrapS = THREE.RepeatWrapping; this.devTex.repeat.set(6, 1); this.devTex.colorSpace = THREE.SRGBColorSpace;
    const g = new THREE.Group(); g.position.set(0, TABLE_Y, 0);
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.04, 6), mat(0x3a3630)); base.position.y = 0.02; g.add(base);
    const screen = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 6, 1, true), new THREE.MeshBasicMaterial({ map: this.devTex }));
    screen.position.y = 0.13; screen.rotation.y = Math.PI / 6; g.add(screen);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.03, 6), mat(0x4a463e)); cap.position.y = 0.235; g.add(cap);
    const glow = new THREE.PointLight(0x9ad0ff, 0.6, 1.0, 2); glow.position.y = 0.14; g.add(glow);
    sc.props.add(g);
    this.drawDevice(null);
    this.buildHud();
  }

  drawDevice(bid, red = false) {
    const c = this.devCanvas, g = c.getContext('2d');
    g.fillStyle = red ? '#3a0a08' : '#06101a'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(140,200,255,.06)';
    for (let y = 0; y < c.height; y += 4) g.fillRect(0, y, c.width, 2);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (bid) {
      g.drawImage(faceCanvas[bid.face], 34, 14, 60, 60);
      g.fillStyle = red ? '#ff6a4a' : '#9ad8ff'; g.font = 'bold 46px "Courier New", monospace';
      g.fillText('×' + bid.count, c.width / 2, 116);
    } else {
      g.fillStyle = '#5a7a90'; g.font = 'bold 30px "Courier New", monospace'; g.fillText('BID?', c.width / 2, 80);
    }
    this.devTex.needsUpdate = true;
  }

  buildHud() {
    const h = this.ctx.hud;
    h.innerHTML = `
      <div class="ld-top"><div class="ld-bid" id="ldBid">まだ宣言はない</div><div class="ld-total" id="ldTotal"></div></div>
      <div class="cc-turn" id="ldTurn"></div>
      <div class="ld-count" id="ldCount"></div>
      <div class="ld-callout" id="ldCallout"></div>
      <div class="ld-mine" id="ldMine"></div>
      <div class="ld-ctrl" id="ldCtrl"></div>`;
    this.el = Object.fromEntries(['Bid', 'Total', 'Turn', 'Count', 'Callout', 'Mine', 'Ctrl'].map((k) => [k.toLowerCase(), h.querySelector('#ld' + k)]));
  }

  setBidHud(m, bid) {
    this.el.bid.innerHTML = bid
      ? `<span class="k">現在の宣言</span><img src="${faceURL(bid.face)}"><b>× ${bid.count}</b><span>個以上</span><small>by ${this.ctx.name(bid.uid)}</small>`
      : '<span class="k">現在の宣言</span><span class="none">まだ宣言はない</span>';
    this.drawDevice(bid);
  }

  // ---- 3D：カップとダイス ----
  ensureCup(uid) {
    if (this.cups.has(uid)) return this.cups.get(uid);
    const sc = this.ctx.scene;
    const g = new THREE.Group();
    const leather = new THREE.MeshLambertMaterial({ color: 0x4a2a1a, flatShading: true });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.125, 0.2, 10), leather); body.position.y = 0.1; body.castShadow = true; g.add(body);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.127, 0.127, 0.025, 10), new THREE.MeshLambertMaterial({ color: 0xa08040, flatShading: true })); band.position.y = 0.03; g.add(band);
    g.position.copy(sc.seatPoint(uid, -0.36, TABLE_Y, 0.84));
    g.userData.base = g.position.clone();
    sc.scene.add(g);
    this.cups.set(uid, g);
    return g;
  }
  setCupLift(uid, t) {
    const g = this.cups.get(uid); if (!g) return;
    g.position.copy(g.userData.base); g.position.y += 0.32 * t;
    g.rotation.z = 0.5 * t;
  }
  clearDice(uid) {
    for (const mm of this.diceMeshes.get(uid) || []) this.ctx.scene.scene.remove(mm);
    this.diceMeshes.set(uid, []);
  }
  diePos(uid, i) {
    const row = Math.floor(i / 5), col = i % 5;
    return this.ctx.scene.seatPoint(uid, -0.18 + col * 0.09, TABLE_Y + 0.037, 0.64 + row * 0.095);
  }
  makeDie(face) {
    const others = [1, 2, 3, 4, 5, 6].filter((f) => f !== face).sort(() => Math.random() - 0.5);
    // BoxGeometry の面順: +x,-x,+y(上),-y,+z,-z
    const mats = [others[0], others[1], face, others[2], others[3], others[4]].map((f) => this.faceMats[f].clone());
    const mesh = new THREE.Mesh(this.dieGeo, mats);
    mesh.castShadow = true;
    return mesh;
  }
  // dice: 出目配列, mask: 表示するindex（null=全部）
  placeDice(uid, dice, mask) {
    this.clearDice(uid);
    const arr = [];
    dice.forEach((d, i) => {
      if (mask && !mask[i]) return;
      const mesh = this.makeDie(d);
      mesh.position.copy(this.diePos(uid, i));
      mesh.rotation.y = this.ctx.scene.seatYaw(uid) + (Math.random() - 0.5) * 0.3;
      mesh.userData = { face: d, i };
      this.ctx.scene.scene.add(mesh);
      arr.push(mesh);
    });
    this.diceMeshes.set(uid, arr);
    return arr;
  }

  // ---- 同期 ----
  onQueue(evs) {
    if (evs.some((e) => e.t === 'ld_setup')) { this.hideMine = true; this.renderMine(this.lastM); }
  }

  sync(m) {
    this.lastM = m;
    const s = m.sub; if (!s) return;
    this.hideMine = false; this.mineShown = Infinity;
    this.setBidHud(m, s.bid);
    this.el.total.textContent = `場のダイス 合計 ${totalDice(m)}個`;
    for (const u of m.seats) {
      const alive = m.alive[u];
      const n = alive ? (s.dice[u] || []).length : 0;
      this.ctx.scene.setSeatStatus(u, { game: alive ? `🎲 ×${n}` : '' });
      if (!alive) { this.clearDice(u); const c = this.cups.get(u); if (c) c.visible = false; continue; }
      const cup = this.ensureCup(u);
      cup.visible = n > 0;
      if (this.revealed) { this.setCupLift(u, 1); if ((this.diceMeshes.get(u) || []).length !== s.dice[u].length) this.placeDice(u, s.dice[u]); }
      else { this.setCupLift(u, 0); this.placeDice(u, s.dice[u], s.shown[u]); }
    }
    if (m.phase === 'round' && s.turn) this.showTurn(m, s.turn.uid);
    else this.showTurn(m, null);
    this.renderMine(m);
    this.renderCtrl(m);
  }

  showTurn(m, uid) {
    for (const u of m.seats) this.ctx.scene.setSeatStatus(u, { active: u === uid });
    const el = this.el.turn;
    if (!uid) { el.textContent = ''; return; }
    const mine = uid === this.ctx.me;
    el.className = 'cc-turn ld' + (mine ? ' mine' : '');
    el.textContent = mine ? '▶ あなたの番：レイズかブラフか' : `${this.ctx.name(uid)} が考えている…`;
  }

  renderMine(m) {
    const box = this.el.mine;
    const me = this.ctx.me;
    if (!m || !me || !m.alive[me] || !m.sub?.dice?.[me]) { box.innerHTML = ''; return; }
    if (this.hideMine) { box.innerHTML = '<div class="ld-cupmsg">カップの中…</div>'; return; }
    const dice = m.sub.dice[me], shown = m.sub.shown[me];
    const picking = this.inputOn && this.sel.reroll;
    box.innerHTML = `<div class="ld-mlabel">あなたのダイス${picking ? '<span>（公開するダイスを選択）</span>' : ''}</div>` + dice.slice(0, this.mineShown).map((d, i) => `
      <button class="ld-die ${shown[i] ? 'shown' : ''} ${this.sel.reveal.has(i) ? 'pick' : ''}" data-i="${i}" ${picking && !shown[i] ? '' : 'disabled'}>
        <img src="${faceURL(d)}" alt="${faceLabel(d)}" draggable="false">${shown[i] ? '<i>公開</i>' : ''}</button>`).join('')
      + (dice.length ? '' : '<div class="ld-cupmsg">ダイスなし（宣言のみ）</div>');
    box.querySelectorAll('.ld-die').forEach((b) => (b.onclick = () => {
      const i = +b.dataset.i;
      const hid = hiddenIdx(m, me);
      if (this.sel.reveal.has(i)) this.sel.reveal.delete(i);
      else if (this.sel.reveal.size < hid.length - 1) this.sel.reveal.add(i);
      this.renderMine(m); this.renderCtrl(m);
    }));
  }

  setInput(on, m) {
    const was = this.inputOn;
    this.inputOn = on; this.lastM = m;
    if (on && !was) {
      const s = m.sub, me = this.ctx.me;
      const mine = s.dice[me] || [];
      const cnt = (f) => mine.filter((d) => d === f || (f !== STAR && d === STAR)).length;
      let face = s.bid ? s.bid.face : [1, 2, 3, 4, 5].sort((a, b) => cnt(b) - cnt(a))[0];
      if (minRaise(m, face) === null) face = faces(m).find((f) => minRaise(m, f) !== null) ?? face;
      this.sel = { face, count: minRaise(m, face) ?? 1, reroll: false, reveal: new Set() };
    }
    this.renderMine(m);
    this.renderCtrl(m);
  }

  renderCtrl(m) {
    const box = this.el.ctrl;
    if (!this.inputOn || !m || m.phase !== 'round') { box.innerHTML = ''; box.classList.remove('on'); return; }
    box.classList.add('on');
    const s = m.sub, me = this.ctx.me, sel = this.sel;
    const canCall = !!s.bid && s.bid.uid !== me;
    const raisable = canRaise(m);
    const lo = minRaise(m, sel.face), hi = maxCount(m);
    if (lo !== null) sel.count = Math.max(lo, Math.min(hi, sel.count));
    const legal = lo !== null && isLegalBid(m, sel.face, sel.count);
    const rr = canReroll(m, me);
    const rrOk = !sel.reroll || sel.reveal.size >= 1;
    box.innerHTML = `
      <div class="ld-row"><span class="ld-lab">出目</span>${faces(m).map((f) => `<button class="ld-face ${f === sel.face ? 'sel' : ''}" data-f="${f}" ${minRaise(m, f) === null ? 'disabled' : ''}><img src="${faceURL(f)}"></button>`).join('')}</div>
      <div class="ld-row"><span class="ld-lab">個数</span>
        <button class="mini" data-c="-1" ${lo === null || sel.count <= lo ? 'disabled' : ''}>−</button>
        <span class="ld-cnt">${lo === null ? '-' : sel.count}</span>
        <button class="mini" data-c="1" ${lo === null || sel.count >= hi ? 'disabled' : ''}>＋</button>
        <span class="ld-prev">${lo === null ? '' : `「${bidText({ face: sel.face, count: sel.count })}」`}</span></div>
      ${rr ? `<div class="ld-row"><span class="ld-lab">振りなおし</span><button class="toggle ${sel.reroll ? 'on' : ''}" id="ldRr">${sel.reroll ? 'ON' : 'OFF'}</button>
        <small>${sel.reroll ? `公開 ${sel.reveal.size}個 → 残り${hiddenIdx(m, me).length - sel.reveal.size}個を振りなおす` : '宣言と同時にダイスを公開して振りなおす'}</small></div>` : ''}
      <div class="ld-row btns">
        <button class="btn" id="ldRaise" ${raisable && legal && rrOk ? '' : 'disabled'}>${s.bid ? 'レイズ' : '宣言する'}</button>
        <button class="btn bluff" id="ldCall" ${canCall ? '' : 'disabled'}>ブラフ！</button>
      </div>`;
    box.querySelectorAll('.ld-face').forEach((b) => (b.onclick = () => { sel.face = +b.dataset.f; sel.count = minRaise(m, sel.face) ?? 1; this.renderCtrl(m); }));
    box.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { sel.count += +b.dataset.c; this.renderCtrl(m); }));
    const t = box.querySelector('#ldRr');
    if (t) t.onclick = () => { sel.reroll = !sel.reroll; sel.reveal.clear(); this.renderMine(m); this.renderCtrl(m); };
    box.querySelector('#ldRaise').onclick = () => this.send({ type: 'bid', face: sel.face, count: sel.count, reveal: sel.reroll ? [...sel.reveal] : [] });
    box.querySelector('#ldCall').onclick = () => this.send({ type: 'call' });
  }

  send(a) {
    if (!this.inputOn) return;
    this.inputOn = false;
    this.el.ctrl.innerHTML = ''; this.el.ctrl.classList.remove('on');
    this.ctx.send(a);
  }

  callout(html, ms = 1300, cls = '') {
    const c = this.el.callout;
    c.className = 'ld-callout on ' + cls; c.innerHTML = html;
    return new Promise((r) => setTimeout(() => { c.classList.remove('on'); setTimeout(r, 150); }, ms));
  }

  // ---- イベント演出 ----
  async animate(ev, m) {
    const sc = this.ctx.scene, name = this.ctx.name;
    switch (ev.t) {
      case 'ld_setup': {
        this.revealed = false;
        this.el.count.innerHTML = '';
        this.setBidHud(m, null);
        this.el.total.textContent = `場のダイス 合計 ${ev.total}個`;
        for (const u of m.seats) {
          this.clearDice(u);
          const cup = this.cups.get(u); if (cup) this.setCupLift(u, 0);
          if (!ev.players.includes(u)) { if (cup) cup.visible = false; continue; }
          const c = this.ensureCup(u); c.visible = ev.counts[u] > 0;
          sc.setSeatStatus(u, { game: `🎲 ×${ev.counts[u]}` });
        }
        this.hideMine = true; this.renderMine(m);
        await this.ctx.banner('ダイスを振れ', `場のダイス 合計 ${ev.total}個　／　スタート：${name(ev.start)}`, 1500);
        // カップを振る
        sfx.rattle(14);
        await sc.tween(900, (t) => {
          for (const [, g] of this.cups) {
            if (!g.visible) continue;
            const k = Math.sin(t * Math.PI * 9) * (1 - t);
            g.position.copy(g.userData.base); g.position.y += Math.abs(k) * 0.06;
            g.rotation.x = k * 0.25; g.rotation.z = k * 0.2;
          }
        });
        for (const [, g] of this.cups) { g.rotation.set(0, 0, 0); g.position.copy(g.userData.base); }
        sfx.roll();
        // 自分のダイスを1個ずつ見せる
        this.hideMine = false;
        const n = (m.sub?.dice?.[this.ctx.me] || []).length;
        for (let k = 1; k <= n; k++) { this.mineShown = k; this.renderMine(m); sfx.tick(); await sc.wait(110); }
        this.mineShown = Infinity;
        return;
      }
      case 'ld_turn': {
        this.showTurn(m, ev.uid);
        if (ev.uid === this.ctx.me) sfx.tick();
        await sc.wait(250);
        return;
      }
      case 'ld_bid': {
        const bid = { face: ev.face, count: ev.count, uid: ev.uid };
        sfx.special();
        const done = this.callout(`<div class="who">${name(ev.uid)}</div><div class="say"><img src="${faceURL(ev.face)}"> が <b>${ev.count}</b> 個以上</div>`, 1300);
        await sc.wait(350);
        this.setBidHud(m, bid);
        await done;
        if (ev.revealFaces?.length) {
          // 公開したダイスを卓上に並べ、残りを振りなおす
          this.placeDice(ev.uid, ev.shownDice, ev.shown);
          const cup = this.cups.get(ev.uid);
          sfx.rattle(8);
          if (cup) await sc.tween(600, (t) => { const k = Math.sin(t * Math.PI * 8) * (1 - t); cup.rotation.x = k * 0.25; });
          if (cup) cup.rotation.set(0, 0, 0);
          this.ctx.popText(`${ev.revealFaces.map(faceLabel).join(' ')} を公開 → ${ev.rerolled}個 振りなおし`, 'b');
          await sc.wait(900);
        }
        return;
      }
      case 'ld_call': {
        sfx.bust();
        this.showTurn(m, null);
        this.drawDevice(ev.bid, true);
        await this.callout(`<div class="who">${name(ev.uid)}</div><div class="say bluff">BLUFF!</div><div class="sub">${name(ev.target)} の「${bidText(ev.bid)}」は嘘だ</div>`, 1700, 'red');
        return;
      }
      case 'ld_reveal': {
        this.revealed = true;
        sfx.rattle(6);
        const seats = m.seats.filter((u) => ev.dice[u]);
        // 全員のダイスが見えるよう一時的に俯瞰へ
        const prevMode = sc.mode;
        const swap = prevMode.kind === 'seat';
        if (swap) sc.setView({ kind: 'top', uid: prevMode.uid }, false, 900);
        await sc.tween(700, (t) => seats.forEach((u) => this.setCupLift(u, t)));
        const all = [];
        for (const u of seats) all.push(...this.placeDice(u, ev.dice[u]));
        await sc.wait(600);
        // 1個ずつ数える
        const f = ev.bid.face;
        const hit = (d) => (f === STAR ? d === STAR : d === f || d === STAR);
        let k = 0;
        const show = () => {
          this.el.count.innerHTML = `<img src="${faceURL(f)}">${f === STAR ? '' : '＋<img src="' + faceURL(STAR) + '">'} カウント <b>${k}</b> ／ 宣言 ${ev.bid.count}`;
          this.el.count.classList.toggle('over', k >= ev.bid.count);
        };
        show();
        for (const mesh of all) {
          if (!hit(mesh.userData.face)) { mesh.material.forEach((mt) => mt.color.setScalar(0.35)); continue; }
          k++; show(); sfx.tick();
          mesh.material.forEach((mt) => { mt.emissive = new THREE.Color(0x7a5a10); });
          const y0 = mesh.position.y;
          sc.tween(260, (t) => { mesh.position.y = y0 + Math.sin(t * Math.PI) * 0.06; });
          await sc.wait(Math.max(90, 260 - all.length * 5));
        }
        await sc.wait(500);
        const lie = ev.actual < ev.bid.count;
        await this.ctx.banner(`実際は ${ev.actual}個`, lie ? `${name(ev.bidder)} の宣言（${ev.bid.count}個）はウソだった` : `${name(ev.bidder)} の宣言は本当だった — ${name(ev.caller)} の読み違い`, 2000, lie ? '' : 'red');
        if (ev.diceLoss) this.ctx.scene.setSeatStatus(ev.loser, { game: `🎲 ×${ev.diceAfter}` });
        if (swap && sc.mode.kind === 'top') await sc.setView(prevMode, false, 900);
        return;
      }
    }
  }

  dispose() {
    for (const u of [...this.diceMeshes.keys()]) this.clearDice(u);
    for (const [, g] of this.cups) this.ctx.scene.scene.remove(g);
    this.ctx.hud.innerHTML = '';
  }
}

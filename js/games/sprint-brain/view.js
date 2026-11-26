// SPRINT BRAIN : 表示（ブラウン管モニター・ズーム・各問題UI）
import * as THREE from 'three';
import { QTYPES, frac, fop, fstr } from './rules.js';
import { TABLE_Y } from '../../scene/scene.js';
import { sfx } from '../../audio.js';

export async function createView(ctx) {
  const v = new SprintBrainView(ctx);
  v.init();
  return v;
}

const STATUS = {
  ready: { text: 'READY', bg: '#101010', fg: '#8a8a8a' },
  thinking: { text: 'Thinking…', bg: '#000000', fg: '#ffffff' },
  escape: { text: 'Escape!', bg: '#1f9a3a', fg: '#ffffff' },
  miss: { text: 'Miss!', bg: '#c0201a', fg: '#ffffff' },
  off: { text: '', bg: '#050505', fg: '#000' },
  safe: { text: 'SAFE', bg: '#13241c', fg: '#6aa880' },
};
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class SprintBrainView {
  constructor(ctx) {
    this.ctx = ctx;
    this.monitors = new Map();
    this.qKey = null;      // 表示中の問題（startAt）
    this.q = null;
    this.widget = null;    // 問題UI
    this.zoomed = false;
    this.lastM = null;
    this.myStatus = 'thinking';
    this.sending = false;
  }

  init() {
    this.buildHud();
    this._tick = setInterval(() => this.tickTimer(), 100);
  }

  buildHud() {
    const h = this.ctx.hud;
    h.innerHTML = `
      <div class="sb-crt" id="sbCrt"><div class="sb-screen">
        <div class="sb-head"><span class="sb-type" id="sbType"></span><span class="sb-timer" id="sbTimer"></span></div>
        <div class="sb-main"><div class="sb-body" id="sbBody"></div><div class="sb-side" id="sbSide"></div></div>
        <div class="sb-foot" id="sbFoot"></div>
        <div class="sb-scan"></div>
      </div></div>`;
    this.el = { crt: h.querySelector('#sbCrt'), type: h.querySelector('#sbType'), timer: h.querySelector('#sbTimer'), body: h.querySelector('#sbBody'), side: h.querySelector('#sbSide'), foot: h.querySelector('#sbFoot') };
  }

  // ---------- 3D：ブラウン管モニター ----------
  ensureMonitor(uid, drop = false) {
    if (this.monitors.has(uid)) return this.monitors.get(uid);
    const sc = this.ctx.scene;
    const g = new THREE.Group();
    g.position.copy(sc.seatPoint(uid, 0, TABLE_Y, 0.74));
    g.rotation.y = sc.seatYaw(uid);
    const plastic = new THREE.MeshLambertMaterial({ color: 0xb8ae98, flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2824, flatShading: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.36, 0.26), plastic); body.position.set(0, 0.22, -0.05); body.castShadow = true; g.add(body);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.17, 0.18, 4, 1), plastic); back.rotation.x = -Math.PI / 2; back.rotation.y = Math.PI / 4; back.position.set(0, 0.22, 0.16); g.add(back);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.22), dark); stand.position.set(0, 0.02, 0); g.add(stand);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.29, 0.01), dark); bezel.position.set(0, 0.23, -0.181); g.add(bezel);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 192;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.255), new THREE.MeshBasicMaterial({ map: tex }));
    screen.position.set(0, 0.23, -0.187); screen.rotation.y = Math.PI; g.add(screen);
    // 背面のステータス表示（他の人から見える）
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(0, 0.44, 0.02); g.add(sign);
    const signBack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.02), dark); signBack.position.set(0, 0.44, 0.005); g.add(signBack);
    const glow = new THREE.PointLight(0xffffff, 0.5, 0.9, 2); glow.position.set(0, 0.23, -0.35); g.add(glow);
    sc.scene.add(g);
    if (drop) {
      // 上から降りてきてテーブルに設置される
      const y0 = g.position.y;
      g.position.y = y0 + 1.6; g.visible = false;
      setTimeout(() => {
        g.visible = true;
        sc.tween(700, (t) => { const b = t < 0.8 ? (t / 0.8) ** 2 : 1 - Math.sin((t - 0.8) / 0.2 * Math.PI) * 0.03; g.position.y = y0 + 1.6 * (1 - b); })
          .then(() => { g.position.y = y0; sfx.thud?.(); sfx.deal(); });
      }, drop === true ? 0 : drop);
    }
    const mon = { g, cv, tex, glow, status: null };
    this.monitors.set(uid, mon);
    this.setMonitor(uid, 'ready');
    return mon;
  }
  setMonitor(uid, status) {
    const mon = this.monitors.get(uid); if (!mon || mon.status === status) return;
    mon.status = status;
    const st = STATUS[status] || STATUS.off;
    const g = mon.cv.getContext('2d');
    g.fillStyle = st.bg; g.fillRect(0, 0, 256, 192);
    g.fillStyle = 'rgba(255,255,255,.05)'; for (let y = 0; y < 192; y += 4) g.fillRect(0, y, 256, 2);
    g.fillStyle = st.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 44px "Courier New", monospace'; g.fillText(st.text, 128, 96);
    mon.tex.needsUpdate = true;
    mon.glow.color.set(status === 'escape' ? 0x40ff70 : status === 'miss' ? 0xff3020 : 0xc0d0ff);
    mon.glow.intensity = status === 'off' ? 0 : 0.6;
  }
  screenView(uid) {
    const sc = this.ctx.scene;
    return { kind: 'custom', uid, pos: sc.seatPoint(uid, 0, TABLE_Y + 0.24, 0.24), look: sc.seatPoint(uid, 0, TABLE_Y + 0.23, 0.56) };
  }

  // ---------- 共通ヘルパー ----------
  isPlayer(m) { const me = this.ctx.me; return !!(me && m.alive[me] && m.sub?.status?.[me] !== undefined); }
  canAnswer() {
    const m = this.lastM;
    return !!(m && this.isPlayer(m) && m.phase === 'round' && m.sub.phase === 'live' && this.myStatus === 'thinking' && !this.sending && this.ctx.now() >= m.sub.startAt);
  }
  answer(value) {
    if (!this.canAnswer()) return;
    const at = this.ctx.now(); // ボタンを押した瞬間の時刻（サーバー時刻補正済み）
    this.sending = true;
    Promise.resolve(this.ctx.send({ type: 'answer', value, at })).then((ok) => { if (ok === false) { this.sending = false; this.updateFoot(); } });
  }
  renderSide(m) {
    const s = m?.sub; if (!s?.status) { this.el.side.innerHTML = ''; return; }
    this.el.side.innerHTML = '<div class="sb-sh">PLAYERS</div>' + Object.keys(s.status).map((u) => {
      const st = this._shown?.[u] || s.status[u];
      return `<div class="sb-p ${st}"><span>${this.ctx.name(u)}${u === this.ctx.me ? ' (YOU)' : ''}</span><b>${STATUS[st]?.text || ''}</b></div>`;
    }).join('');
  }
  setShown(u, st) { this._shown = this._shown || {}; this._shown[u] = st; this.setMonitor(u, st); this.renderSide(this.lastM); }

  tickTimer() {
    const m = this.lastM, s = m?.sub;
    if (!s || !this.q || s.phase !== 'live') { this.el.timer.textContent = ''; return; }
    const t = this.ctx.now();
    if (t < s.startAt) { this.el.timer.textContent = ''; return; }
    const left = Math.max(0, (s.startAt + s.limit - t) / 1000);
    this.el.timer.textContent = `${left.toFixed(1)}s`;
    this.el.timer.classList.toggle('low', left < 10);
  }

  showCrt(on) { this.el.crt.classList.toggle('on', on); this.el.crt.classList.toggle('watch', on && !this.isPlayer(this.lastM || { alive: {} })); }
  clearWidget() { if (this.widget?.destroy) this.widget.destroy(); this.widget = null; this.el.body.innerHTML = ''; this.el.foot.innerHTML = ''; }

  // ---------- 同期 ----------
  sync(m) {
    this.lastM = m;
    const s = m.sub; if (!s) return;
    for (const u of m.seats) {
      if (!m.alive[u] && !s.status[u]) { const mon = this.monitors.get(u); if (mon) this.setMonitor(u, 'off'); continue; }
      if (s.status[u] === undefined) { if (this.monitors.has(u)) this.setMonitor(u, 'safe'); continue; }
      this.ensureMonitor(u);
      if (!this._shown?.[u] || s.phase !== 'live') this.setMonitor(u, s.status[u]);
    }
    if (this.ctx.me && s.status[this.ctx.me]) this.myStatus = s.status[this.ctx.me];
    this.renderSide(m);
    // 途中参加などで問題が出ていない場合
    if (m.phase === 'round' && s.phase === 'prep') {
      for (const u of m.seats) if (m.alive[u]) this.ensureMonitor(u);
      if (!this._standbyFor || this._standbyFor !== s.prepAt) this.showStandby({ players: s.players, sudden: s.sudden });
      this._standbyFor = s.prepAt;
      if (s.status[this.ctx.me] !== undefined && !s.ready[this.ctx.me]) this.sendReady(m);
    }
    if (m.phase === 'round' && s.phase === 'live' && this.qKey !== s.startAt) this.openQuestion(m, s.q, true);
    if (s.phase !== 'live' && this.qKey && !this._ending) { this.closeQuestion(false); }
    this.updateFoot();
  }
  setInput() { /* 全員同時入力のため独自に管理 */ }
  onQueue() {}

  updateFoot() {
    const m = this.lastM; if (!m || !this.q) return;
    if (!this.isPlayer(m)) { this.el.foot.dataset.mode = 'watch'; return; }
    this.widget?.setEnabled?.(this.canAnswer());
    const msg = this.el.crt.querySelector('.sb-done');
    if (this.myStatus === 'escape' && !msg) this.el.body.appendChild(el('div', 'sb-done', 'Escape!<small>他のプレイヤーを待っています…</small>'));
  }

  // ---------- 問題の表示 ----------
  async openQuestion(m, q, immediate) {
    this.clearWidget();
    this.q = q; this.qKey = m.sub.startAt; this._shown = {};
    this.myStatus = m.sub.status?.[this.ctx.me] || 'thinking';
    this.sending = false;
    this.el.type.textContent = QTYPES[q.type].name;
    this.showCrt(true);
    if (!immediate) {
      const s = m.sub;
      const sd = s.sudden ? '<div class="sb-sudden">SUDDEN DEATH</div>' : '';
      if (s.surprise ?? m.opts.surprise) {
        this.el.type.textContent = '???';
        this.el.body.appendChild(el('div', 'sb-intro', sd + '<div class="sb-ready">Ready…</div>'));
        while (this.ctx.now() < s.startAt) await wait(30);
        sfx.special();
      } else {
        this.el.body.appendChild(el('div', 'sb-intro', `${sd}<div class="sb-fmt">${QTYPES[q.type].name}</div><div class="sb-desc">${QTYPES[q.type].desc}</div><div class="sb-cd" id="sbCd"></div>`));
        let last = null;
        while (this.ctx.now() < s.startAt) {
          const left = Math.ceil((s.startAt - this.ctx.now()) / 1000);
          if (left <= 3 && left !== last) { last = left; const cd = this.el.body.querySelector('#sbCd'); if (cd) cd.textContent = left; sfx.tick(); }
          await wait(30);
        }
        sfx.special();
      }
      if (this.qKey !== s.startAt) return;
    }
    this.el.body.innerHTML = '';
    this.el.type.textContent = QTYPES[q.type].name + '　' + QTYPES[q.type].desc;
    this.widget = WIDGETS[q.type](this, q);
    this.el.body.appendChild(this.widget.root);
    this.widget.setEnabled?.(this.canAnswer());
    this.updateFoot();
  }

  // 問題を残したまま、下部に答えを重ねる
  showStrip(html, cls) {
    let st = this.el.crt.querySelector('.sb-strip');
    if (!st) { st = el('div', 'sb-strip'); this.el.crt.querySelector('.sb-screen').appendChild(st); }
    st.className = 'sb-strip on ' + (cls || ''); st.innerHTML = html;
  }
  hideStrip() { const st = this.el.crt.querySelector('.sb-strip'); if (st) st.remove(); }
  showAnswer(ev, extra) {
    this.el.crt.querySelectorAll('.sb-done').forEach((x) => x.remove());
    this.widget?.showAnswer?.(ev.answer);
    this.el.type.textContent = `${QTYPES[ev.qtype].name}　— 正解発表 —`;
    const rank = (ev.ranking || []).map((r, i) => `<span>${i + 1}. ${this.ctx.name(r.uid)} ${(r.ms / 1000).toFixed(3)}s</span>`).join('');
    this.showStrip(`${extra}<div class="k">答えはこれでした</div><div class="v">${ev.answer}</div>${rank ? `<div class="rk">${rank}</div>` : ''}`, 'answer');
  }

  // 全員の準備（ズーム完了）を待つ画面
  showStandby(ev) {
    this.clearWidget();
    this.q = null; this.qKey = null;
    this.el.type.textContent = ev.sudden ? 'SUDDEN DEATH' : 'STANDBY';
    this.el.crt.classList.toggle('sudden', !!ev.sudden);
    this.el.body.appendChild(el('div', 'sb-intro', `${ev.sudden ? '<div class="sb-sudden">SUDDEN DEATH</div>' : ''}<div class="sb-standby">STANDBY</div><div class="sb-desc">全員の準備が整うのを待っています…</div>`));
    this.showCrt(true);
  }
  sendReady(m) {
    const key = m.sub?.prepAt ?? 'x';
    if (this._readyKey === key) return;
    this._readyKey = key;
    this.ctx.send({ type: 'ready' }, { quiet: true });
  }

  closeQuestion(animate) {
    this.hideStrip();
    this.clearWidget();
    this.q = null; this.qKey = null;
    this.showCrt(false);
  }

  // ---------- イベント演出 ----------
  async animate(ev, m) {
    const sc = this.ctx.scene, me = this.ctx.me;
    this.lastM = m;
    switch (ev.t) {
      case 'sb_setup': {
        this._ending = false;
        this._shown = {};
        this.pendingQ = ev;
        // モニター設置（初回は上から降りてくる）
        let k = 0, dropped = false;
        for (const u of m.seats) {
          if (!m.alive[u]) continue;
          if (!this.monitors.has(u)) { this.ensureMonitor(u, 1 + 260 * k++); dropped = true; }
        }
        if (dropped) await sc.wait(260 * k + 800);
        for (const [u] of this.monitors) if (!ev.players.includes(u)) this.setMonitor(u, m.alive[u] ? 'safe' : 'off');
        for (const u of ev.players) this.setMonitor(u, 'ready');
        const amPlayer = me && ev.players.includes(me);
        if (amPlayer) { if (!this.zoomed) await sc.setView(this.screenView(me), false, 1100); this.zoomed = true; }
        else await sc.wait(400);
        this.showStandby(ev);
        if (amPlayer) this.sendReady(m);
        return;
      }
      case 'sb_start': {
        const p = this.pendingQ || {};
        const st = m.sub?.startAt === ev.startAt ? m.sub : null;
        const players = p.players || Object.keys(m.sub?.status || {});
        const fake = { ...m, sub: { ...(st || m.sub || {}), startAt: ev.startAt, surprise: p.surprise ?? m.opts.surprise, sudden: p.sudden, limit: p.limit ?? m.sub?.limit,
          status: st ? st.status : Object.fromEntries(players.map((u) => [u, 'thinking'])), phase: 'live' } };
        for (const u of players) this.setMonitor(u, 'thinking');
        this.el.crt.classList.toggle('sudden', !!p.sudden);
        this.lastM = fake;
        this.renderSide(fake);
        await this.openQuestion(fake, p.q || m.sub.q, false);
        this.lastM = m;
        return;
      }
      case 'sb_status': {
        if (ev.status === 'escape') {
          sfx.tick();
          this.setShown(ev.uid, 'escape');
          if (ev.uid === me) { this.myStatus = 'escape'; this.sending = false; this.widget?.setEnabled?.(false); this.updateFoot(); sfx.special(); }
        } else {
          sfx.bust();
          this.setShown(ev.uid, 'miss');
          if (ev.uid === me) { this.myStatus = ev.retry ? 'thinking' : 'miss'; this.sending = false; this.widget?.onMiss?.(); }
          if (ev.retry) {
            setTimeout(() => { if (this._shown?.[ev.uid] === 'miss') this.setShown(ev.uid, 'thinking'); if (ev.uid === me) this.widget?.setEnabled?.(this.canAnswer()); }, 1000);
          } else this.widget?.setEnabled?.(false);
        }
        await sc.wait(120);
        return;
      }
      case 'sb_timeout': {
        sfx.bust();
        this.ctx.popText('TIME UP!', 'r');
        await sc.wait(600);
        return;
      }
      case 'sb_judge': {
        this.showStrip('<span class="judge">判定中…</span>', 'judge');
        return;
      }
      case 'sb_tie': {
        this._ending = true;
        this.widget?.setEnabled?.(false);
        await sc.wait(400);
        this.showAnswer(ev, `<div class="tie">完全同着！</div><div class="k">${ev.players.map((u) => this.ctx.name(u)).join(' ・ ')} でサドンデス</div>`);
        sfx.bust();
        await sc.wait(3200);
        this.closeQuestion(true);
        this._ending = false;
        if (this.zoomed && !(me && ev.players.includes(me))) {
          await sc.setView(me && m.alive[me] ? { kind: 'seat', uid: me } : { kind: 'overview' }, false, 900);
          this.zoomed = false;
        }
        return;
      }
      case 'sb_end': {
        this._ending = true;
        this.widget?.setEnabled?.(false);
        await sc.wait(600);
        // 問題は表示したまま、答えを3秒表示
        this.showAnswer(ev, '');
        sfx.special();
        await sc.wait(3000);
        this.closeQuestion(true);
        this._ending = false;
        if (this.zoomed && me && m.alive[me]) { await sc.setView({ kind: 'seat', uid: me }, false, 900); }
        else if (this.zoomed) await sc.setView({ kind: 'overview' }, false, 900);
        this.zoomed = false;
        return;
      }
    }
  }

  dispose() {
    clearInterval(this._tick);
    this.clearWidget();
    for (const [, mon] of this.monitors) this.ctx.scene.scene.remove(mon.g);
    this.ctx.hud.innerHTML = '';
  }
}

// =========================================================
//  問題ウィジェット
// =========================================================

// 文字入力（数字 / アルファベット）
function textInput(view, kind, maxLen) {
  const root = el('div', 'sb-input');
  const disp = el('div', 'sb-disp', '');
  const pad = el('div', 'sb-pad ' + kind);
  const keys = kind === 'digits' ? '1234567890'.split('') : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  let val = ''; let enabled = false;
  const render = () => { disp.innerHTML = (val || '<span class="ph">入力してEnter</span>') + '<i class="caret"></i>'; };
  const add = (c) => { if (!enabled || val.length >= maxLen) return; val += c; sfx.tick(); render(); };
  const back = () => { if (!enabled) return; val = val.slice(0, -1); render(); };
  const submit = () => { if (!enabled || !val) return; view.answer(val); };
  keys.forEach((k) => { const b = el('button', 'sb-key', k); b.onclick = () => add(k); pad.appendChild(b); });
  const bs = el('button', 'sb-key wide', '⌫'); bs.onclick = back; pad.appendChild(bs);
  const ok = el('button', 'sb-key ok', 'ENTER'); ok.onclick = submit; pad.appendChild(ok);
  root.append(disp, pad);
  const onKey = (e) => {
    if (!enabled) return;
    if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); back(); return; }
    const c = e.key.toUpperCase();
    if (kind === 'digits' && /^[0-9]$/.test(c)) add(c);
    if (kind === 'letters' && /^[A-Z]$/.test(c)) add(c);
  };
  window.addEventListener('keydown', onKey);
  render();
  return {
    root,
    setEnabled(v) { enabled = v; root.classList.toggle('off', !v); },
    clear() { val = ''; render(); },
    destroy() { window.removeEventListener('keydown', onKey); },
  };
}

const WIDGETS = {
  // ---- Count Cube ----
  cube(view, q) {
    const root = el('div', 'sb-w sb-cube');
    const cv = document.createElement('canvas'); cv.width = 600; cv.height = 360; cv.className = 'sb-cubecv';
    const input = textInput(view, 'digits', 3);
    root.append(cv, input.root);
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.setSize(600, 360, false);
    const s = new THREE.Scene(); s.background = new THREE.Color(0x0b1410);
    const n = q.grid.length;
    const maxH = Math.max(...q.grid.flat());
    const cam = new THREE.PerspectiveCamera(32, 600 / 360, 0.1, 100);
    const dist = n * 2.05 + 2.6 + maxH * 0.5;
    cam.position.set(0, dist * 0.72, dist * 0.92); cam.lookAt(0, maxH * 0.4, 0); // 判定より少し高い角度から見下ろす
    s.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(3, 8, 5); s.add(dl);
    const grp = new THREE.Group(); s.add(grp);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(geo);
    const lineM = new THREE.LineBasicMaterial({ color: 0x0b1410 });
    const cols = [0xf0e6c8, 0xe0d4b0, 0xd0c098, 0xc0ac80];
    q.grid.forEach((row, x) => row.forEach((h, z) => {
      for (let y = 0; y < h; y++) {
        const c = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: cols[y % cols.length] }));
        c.position.set(x - (n - 1) / 2, y + 0.5, z - (n - 1) / 2);
        c.add(new THREE.LineSegments(edges, lineM));
        grp.add(c);
      }
    }));
    const plate = new THREE.Mesh(new THREE.BoxGeometry(n + 0.6, 0.1, n + 0.6), new THREE.MeshLambertMaterial({ color: 0x2a3a30 }));
    plate.position.y = -0.05; grp.add(plate);
    const t0 = performance.now();
    let alive = true;
    const loop = () => {
      if (!alive) return;
      grp.rotation.y = ((performance.now() - t0) / 10000) * Math.PI * 2; // 10秒で1回転
      r.render(s, cam);
      requestAnimationFrame(loop);
    };
    loop();
    return {
      root,
      setEnabled: input.setEnabled,
      onMiss: input.clear,
      destroy() { alive = false; input.destroy(); r.dispose(); r.forceContextLoss(); },
    };
  },

  // ---- Lost Alphabet ----
  alpha(view, q) {
    const root = el('div', 'sb-w sb-alpha');
    const grid = el('div', 'sb-agrid', q.letters.map((c) => `<span>${c}</span>`).join(''));
    const input = textInput(view, 'letters', 1);
    root.append(grid, input.root);
    return {
      root, setEnabled: input.setEnabled, onMiss: input.clear, destroy: input.destroy,
      showAnswer(a) { input.root.style.visibility = 'hidden'; grid.insertAdjacentHTML('beforeend', `<span class="ans">${a}</span>`); },
    };
  },

  // ---- Scroll Number ----
  scroll(view, q) {
    const root = el('div', 'sb-w sb-scroll');
    const vp = el('div', 'sb-vp');
    const txt = el('div', 'sb-stext ' + (q.motion === 'tb' || q.motion === 'bt' ? 'vert' : ''), q.digits);
    vp.appendChild(txt);
    const input = textInput(view, 'digits', 9);
    root.append(vp, input.root);
    let alive = true, dur = 650, cycleStart = performance.now();
    const loop = () => {
      if (!alive) return;
      const W = vp.clientWidth, H = vp.clientHeight, tw = txt.offsetWidth, th = txt.offsetHeight;
      let p = (performance.now() - cycleStart) / dur;
      if (p > 1.25) { cycleStart = performance.now(); dur = Math.min(2400, dur * 1.07); p = 0; }
      const vis = p <= 1;
      txt.style.visibility = vis ? 'visible' : 'hidden';
      const k = Math.min(1, p);
      let tf = '';
      switch (q.motion) {
        case 'lr': tf = `translate(${-tw + (W + tw) * k}px, ${(H - th) / 2}px)`; break;
        case 'rl': tf = `translate(${W - (W + tw) * k}px, ${(H - th) / 2}px)`; break;
        case 'tb': tf = `translate(${(W - tw) / 2}px, ${-th + (H + th) * k}px)`; break;
        case 'bt': tf = `translate(${(W - tw) / 2}px, ${H - (H + th) * k}px)`; break;
        case 'zoom': {
          const sc = 0.05 + 2.4 * k * k;
          tf = `translate(${(W - tw) / 2}px, ${(H - th) / 2}px) scale(${sc})`;
          txt.style.opacity = String(Math.min(1, k * 3) * (k > 0.8 ? (1 - k) / 0.2 : 1));
          break;
        }
      }
      txt.style.transform = tf;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return { root, setEnabled: input.setEnabled, onMiss: input.clear, destroy() { alive = false; input.destroy(); } };
  },

  // ---- Touch Number ----
  touch(view, q) {
    const root = el('div', 'sb-w sb-touch');
    const grid = el('div', 'sb-tgrid');
    const order = [...q.nums].sort((a, b) => a - b);
    let k = 0, enabled = false;
    const prog = el('div', 'sb-tprog', '0 / 12');
    q.nums.forEach((nm) => {
      const b = el('button', 'sb-tbtn', String(nm).padStart(2, '0'));
      b.onclick = () => {
        if (!enabled || b.classList.contains('done')) return;
        if (nm === order[k]) {
          b.classList.add('done'); k++; sfx.tick(); prog.textContent = `${k} / 12`;
          if (k === 12) view.answer('clear');
        } else {
          b.classList.add('bad'); setTimeout(() => b.classList.remove('bad'), 400);
          view.answer('miss');
        }
      };
      grid.appendChild(b);
    });
    root.append(grid, prog);
    return {
      root,
      setEnabled(v) { enabled = v; root.classList.toggle('off', !v); },
      showAnswer() { grid.querySelectorAll('.sb-tbtn').forEach((b) => { const n = +b.textContent; b.dataset.rank = order.indexOf(n) + 1; b.classList.add('ans'); }); },
    };
  },

  // ---- Quick Math ----
  math(view, q) {
    const root = el('div', 'sb-w sb-math');
    const head = el('div', 'sb-target', `お題 <b>${q.target}</b>`);
    const cardsEl = el('div', 'sb-mcards');
    const ops = el('div', 'sb-mops');
    const tools = el('div', 'sb-mtools');
    const hint = el('div', 'sb-mhint', 'カード → 記号 → カード の順にクリック');
    root.append(head, cardsEl, ops, tools, hint);
    let cards = q.cards.map((c, i) => ({ v: frac(c), id: i }));
    let sel = null, op = null, enabled = false, hist = [], nid = 100, cleared = false;
    const render = () => {
      cardsEl.innerHTML = '';
      cards.forEach((c, i) => {
        const b = el('button', 'sb-mcard' + (sel === i ? ' sel' : ''), fstr(c.v));
        b.onclick = () => clickCard(i);
        cardsEl.appendChild(b);
      });
      ops.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.op === op));
      if (cards.length === 1 && !cleared) {
        const ok = cards[0].v.d === 1 && cards[0].v.n === q.target;
        hint.textContent = ok ? 'CLEAR!' : `${fstr(cards[0].v)} はお題と違う — 戻してやり直そう`;
        hint.className = 'sb-mhint ' + (ok ? 'ok' : 'ng');
        if (ok) { cleared = true; view.answer('clear'); }
      } else if (!cleared) { hint.textContent = 'カード → 記号 → カード の順にクリック'; hint.className = 'sb-mhint'; }
    };
    const clickCard = (i) => {
      if (!enabled) return;
      if (sel === null || op === null) { sel = sel === i ? null : i; sfx.tick(); render(); return; }
      if (i === sel) { sel = null; op = null; render(); return; }
      const v = fop(cards[sel].v, cards[i].v, op);
      if (!v) { hint.textContent = '0では割れない'; hint.className = 'sb-mhint ng'; return; }
      hist.push(cards.map((c) => ({ ...c })));
      const nc = { v, id: nid++ };
      const next = cards.slice(); next[i] = nc; next.splice(sel, 1);
      cards = next; sel = null; op = null; sfx.tick(); render();
    };
    [['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷']].forEach(([o, label]) => {
      const b = el('button', 'sb-mop', label); b.dataset.op = o;
      b.onclick = () => { if (!enabled || sel === null) return; op = op === o ? null : o; render(); };
      ops.appendChild(b);
    });
    const undo = el('button', 'sb-mtool', '1手戻す');
    undo.onclick = () => { if (!enabled || !hist.length) return; cards = hist.pop(); sel = null; op = null; render(); };
    const reset = el('button', 'sb-mtool', 'リセット');
    reset.onclick = () => { if (!enabled) return; if (hist.length) cards = hist[0]; hist = []; sel = null; op = null; render(); };
    tools.append(undo, reset);
    render();
    return { root, setEnabled(v) { enabled = v && !cleared; root.classList.toggle('off', !v); } };
  },
};

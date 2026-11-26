// Death Games : 画面遷移・ロビー・試合同期
import { GAMES, COMING_SOON, getRules, defaultGameOptions } from './games/index.js';
import { createMatch, applyAction, advance, currentActor, statusText, aliveList, clampSurvivors, setClock } from './match.js';
import { DAMAGE_MODES, COMMON_PENALTY_OPTIONS, defaultDamageSettings } from './damage.js';
import { preloadCards, cardCanvas } from './card-art.js';
import { CARD_DEFS as CC_DEFS } from './games/count-cards/cards.js';
import { FirebaseRoom, LocalRoom, firebaseConfigured } from './net.js';
import { TableScene } from './scene/scene.js';
import { sfx } from './audio.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_PLAYERS = 6;
const CPU_NAMES = ['ジャック', 'ベアトリス', 'カラス', 'ドミノ', 'ミスター・K', 'ローズ', 'ヴィクター', 'ルー',
  'マダム・オウル', 'ギデオン', 'シルク', 'バロン', 'ノクターン', 'ハーレクイン', 'グレイ', 'ミモザ', 'ラッキー・ジョー',
  'ドクター・ノーマン', 'ヴェラ', 'オスカー', 'スカーレット', 'ハンク', 'イヴ', 'ルドルフ', 'ペトラ', 'サイラス',
  'ミセス・ホロウ', 'ジェスター', 'ファング', 'クロエ', 'ボーンズ', 'リリス', 'マックス', 'ウィドウ', 'トビー', 'ネロ'];

const store = {
  get name() { return localStorage.getItem('dg_name') || ''; },
  set name(v) { localStorage.setItem('dg_name', v); },
  get pixel() { return +(localStorage.getItem('dg_pixel2') || 2); },
  set pixel(v) { localStorage.setItem('dg_pixel2', v); },
  get muted() { return localStorage.getItem('dg_muted') === '1'; },
  set muted(v) { localStorage.setItem('dg_muted', v ? '1' : '0'); },
};

const App = {
  room: null, uid: null, data: null, screen: 'title',
  match: null, scene: null, view: null, queue: [], busy: false, lastEid: 0,
  entering: null, driverKey: null, resultShown: false, deadShown: false,

  // ================= タイトル =================
  init() {
    sfx.setMuted(store.muted);
    document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
    $('#nameInput').value = store.name;
    const q = new URLSearchParams(location.search).get('room');
    if (q) $('#codeInput').value = q.toUpperCase();
    $('#btnCreate').onclick = () => this.create();
    $('#btnJoin').onclick = () => this.join('player');
    $('#btnWatch').onclick = () => this.join('spectator');
    $('#btnOffline').onclick = () => this.offline();
    if (!firebaseConfigured()) {
      $('#fbWarn').style.display = '';
      ['#btnCreate', '#btnJoin', '#btnWatch'].forEach((s) => ($(s).disabled = true));
    }
    this.show('title');
  },
  show(id) {
    this.screen = id;
    document.querySelectorAll('.screen').forEach((e) => e.classList.toggle('on', e.id === id));
    if (id === 'game') this.stopBg(); else this.startBg();
  },
  // タイトル・ロビーの背景：テーブルの周りをゆっくり回るカメラ
  async startBg() {
    if (this.bg || this._bgStarting) return;
    this._bgStarting = true;
    try {
      const sc = new TableScene($('#bgStage'), { pixel: store.pixel, attract: true });
      this.bg = sc;
      sc.setSeats(Array.from({ length: 6 }, (_, i) => ({ uid: 'bg' + i, name: '' })), null, { empty: true });
      sc.setView({ kind: 'attract' });
      await preloadCards('count-cards', CC_DEFS);
      if (this.bg !== sc) return;
      sc.setBackCanvas(cardCanvas('count-cards', 'back'));
      const ids = Object.keys(CC_DEFS);
      for (let i = 0; i < 11; i++) {
        const id = ids[Math.floor(Math.random() * ids.length)];
        const mm = sc.makeCard('count-cards:' + id, cardCanvas('count-cards', id));
        const a = Math.random() * 6.28, r = 0.2 + Math.random() * 0.75;
        mm.position.set(Math.cos(a) * r, 0.785 + i * 0.002, Math.sin(a) * r);
        mm.rotation.set(-Math.PI / 2, 0, Math.random() * 6);
        sc.scene.add(mm);
      }
    } finally { this._bgStarting = false; }
  },
  stopBg() { if (this.bg) { this.bg.dispose(); this.bg = null; } },
  myName() {
    const n = $('#nameInput').value.trim().slice(0, 12) || '名無し' + Math.floor(Math.random() * 100);
    store.name = n; return n;
  },
  err(msg) { const e = $('#titleErr'); e.textContent = msg; setTimeout(() => { if (e.textContent === msg) e.textContent = ''; }, 4000); },
  baseSettings() {
    const gameOpts = {}; for (const id in GAMES) gameOpts[id] = defaultGameOptions(id);
    return { gameId: 'count-cards', gameOpts, damage: defaultDamageSettings() };
  },
  async create() {
    const name = this.myName();
    try {
      this.busyTitle(true);
      const room = await FirebaseRoom.create({ host: null, status: 'lobby' }, this.baseSettings());
      await room.updateMeta({ host: room.uid });
      await this.attach(room, name, 'player');
    } catch (e) { console.error(e); this.err('作成に失敗：' + e.message); } finally { this.busyTitle(false); }
  },
  async join(role) {
    const name = this.myName();
    const code = $('#codeInput').value.trim().toUpperCase();
    if (!code) return this.err('部屋コードを入力してください');
    try {
      this.busyTitle(true);
      const room = await FirebaseRoom.open(code);
      await this.attach(room, name, role);
    } catch (e) { console.error(e); this.err('参加に失敗：' + e.message); } finally { this.busyTitle(false); }
  },
  async offline() {
    const name = this.myName();
    const room = new LocalRoom({ host: null, status: 'lobby' }, this.baseSettings());
    room.data.meta.host = room.uid;
    await this.attach(room, name, 'player');
    for (let i = 0; i < 3; i++) await this.addCpu();
  },
  busyTitle(b) { document.querySelectorAll('#title button').forEach((x) => (x.dataset.busy = b ? '1' : '')); $('#title').classList.toggle('busy', b); },

  async attach(room, name, role) {
    this.room = room; this.uid = room.uid;
    setClock(() => room.now());
    this.data = null;
    room.subscribe((d) => this.onRoom(d));
    // 最初のスナップショットを待ってから自分を登録
    await new Promise((res) => { const t = setInterval(() => { if (this.data !== null) { clearInterval(t); res(); } }, 30); setTimeout(() => { clearInterval(t); res(); }, 4000); });
    const d = this.data || {};
    const members = d.members || {};
    const players = Object.values(members).filter((m) => m.role === 'player').length;
    const prev = members[this.uid];
    let r = prev?.role || role;
    if (r === 'player' && !prev && (d.meta?.status !== 'lobby' || players >= MAX_PLAYERS)) r = 'spectator';
    await room.setMember(this.uid, { name, role: r, online: true, isCpu: false, joinedAt: prev?.joinedAt || Date.now() });
    if (room instanceof FirebaseRoom) history.replaceState(null, '', `?room=${room.code}`);
  },

  async addCpu() {
    const d = this.data; if (!d) return;
    const members = d.members || {};
    const players = Object.values(members).filter((m) => m.role === 'player');
    if (players.length >= MAX_PLAYERS) return;
    // 今いるメンバーの名前と、追加処理中の名前だけを避けてランダムに命名（番号にはならない）
    this._cpuPending = this._cpuPending || new Set();
    const used = new Set([...Object.values(members).map((m) => m.name), ...this._cpuPending]);
    const pool = CPU_NAMES.filter((n) => !used.has(n));
    const nm = pool[Math.floor(Math.random() * pool.length)] || CPU_NAMES[Math.floor(Math.random() * CPU_NAMES.length)];
    this._cpuPending.add(nm);
    setTimeout(() => this._cpuPending.delete(nm), 3000);
    const id = 'cpu_' + Math.random().toString(36).slice(2, 8);
    await this.room.setMember(id, { name: nm, role: 'player', online: true, isCpu: true, joinedAt: Date.now() });
  },

  async leave() {
    try { await this.room?.leave(); } catch (e) { /* */ }
    this.room?.unsubscribe();
    this.teardownGame();
    this.room = null; this.data = null;
    history.replaceState(null, '', location.pathname);
    this.show('title');
  },

  // ================= 部屋の状態 =================
  isHost() {
    const d = this.data; if (!d) return false;
    const host = d.meta?.host; const hm = d.members?.[host];
    if (hm && hm.online !== false) return host === this.uid;
    return this.driverUid() === this.uid;
  },
  driverUid() {
    const ms = Object.entries(this.data?.members || {}).filter(([, m]) => !m.isCpu && m.online !== false)
      .sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    return ms[0]?.[0] || null;
  },

  async onRoom(d) {
    this.data = d;
    if (!d || !d.meta) { if (this.room) { alert('部屋が閉じられました'); this.leave(); } return; }
    if (d.meta.status === 'lobby') {
      if (this.screen === 'game') this.teardownGame();
      if (this.screen !== 'room') this.show('room');
      this.renderRoom();
    } else if (d.meta.status === 'playing' && d.game) {
      if (this.screen !== 'game') {
        if (!this.entering) this.entering = this.enterGame(JSON.parse(d.game.json)).finally(() => { this.entering = null; this.onRoom(this.data); });
        return;
      }
      if (this.entering) return;
      const m = JSON.parse(d.game.json);
      this.onMatch(m);
    }
  },

  // ================= ロビー =================
  renderRoom() {
    const d = this.data, host = this.isHost(), s = d.settings;
    $('#roomCode').textContent = this.room.code;
    $('#roomCodeBox').style.display = this.room instanceof LocalRoom ? 'none' : '';
    $('#offlineTag').style.display = this.room instanceof LocalRoom ? '' : 'none';
    // ゲーム一覧
    const gl = $('#gameList');
    gl.innerHTML = Object.entries(GAMES).map(([id, g]) => `
      <button class="game-tile ${s.gameId === id ? 'sel' : ''}" data-id="${id}" ${host ? '' : 'disabled'}>
        <div class="gt-name">${esc(g.rules.meta.name)}</div><div class="gt-sub">${esc(g.rules.meta.subtitle)}</div>
      </button>`).join('') + COMING_SOON.map(() => `<div class="game-tile soon"><div class="gt-name">???</div><div class="gt-sub">COMING SOON</div></div>`).join('');
    gl.querySelectorAll('button[data-id]').forEach((b) => (b.onclick = () => this.room.updateSettings({ gameId: b.dataset.id })));
    // ゲーム設定
    const rules = getRules(s.gameId);
    const go = { ...defaultGameOptions(s.gameId), ...(s.gameOpts?.[s.gameId] || {}) };
    $('#gameOptsTitle').textContent = rules.meta.name + ' の設定';
    $('#gameOpts').innerHTML = rules.meta.options.map((o) => optRow(o, go[o.key], host, 'g')).join('');
    bindOpts($('#gameOpts'), 'g', (k, v) => this.room.updateSettings({ [`gameOpts/${s.gameId}/${k}`]: v }), this.room);
    this.renderWeights(rules, go, host, s.gameId);
    // ダメージ方式
    const dm = s.damage;
    $('#dmgModes').innerHTML = Object.entries(DAMAGE_MODES).map(([k, m]) => `
      <button class="dmg-tile ${dm.mode === k ? 'sel' : ''}" data-k="${k}" ${host ? '' : 'disabled'}>
        <div class="dt-name">${esc(m.name)}</div><div class="dt-desc">${esc(m.desc)}</div></button>`).join('');
    $('#dmgModes').querySelectorAll('button').forEach((b) => (b.onclick = () => this.room.updateSettings({ 'damage/mode': b.dataset.k })));
    const nPlayers = Object.values(d.members || {}).filter((x) => x.role === 'player').length;
    const survMax = Math.max(1, nPlayers - 1);
    const common = COMMON_PENALTY_OPTIONS.map((o) => (o.key === 'survivors' ? { ...o, max: survMax } : o));
    const dmv = { ...dm, survivors: clampSurvivors(dm.survivors, Math.max(2, nPlayers)) };
    $('#dmgOpts').innerHTML = [...DAMAGE_MODES[dm.mode].options, ...common].map((o) => optRow(o, dmv[o.key], host, 'd')).join('');
    bindOpts($('#dmgOpts'), 'd', (k, v) => this.room.updateSettings({ [`damage/${k}`]: v }), this.room);
    // メンバー
    const ms = Object.entries(d.members || {}).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    const players = ms.filter(([, m]) => m.role === 'player'), specs = ms.filter(([, m]) => m.role !== 'player');
    const row = ([id, m], i) => `<div class="mem ${m.online === false ? 'off' : ''}">
        ${i !== undefined ? `<span class="seatno">${i + 1}</span>` : ''}
        <span class="mname">${esc(m.name)}</span>
        ${id === d.meta.host ? '<span class="tag">HOST</span>' : ''}${m.isCpu ? '<span class="tag cpu">CPU</span>' : ''}
        ${id === this.uid ? '<span class="tag me">YOU</span>' : ''}
        ${host && m.isCpu ? `<button class="mini" data-rm="${id}">×</button>` : ''}
      </div>`;
    $('#playerList').innerHTML = players.map((p, i) => row(p, i)).join('') + Array.from({ length: MAX_PLAYERS - players.length }, () => '<div class="mem empty">— 空席 —</div>').join('');
    $('#specList').innerHTML = specs.length ? specs.map((p) => row(p)).join('') : '<div class="mem empty">なし</div>';
    document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => this.room.removeMember(b.dataset.rm)));
    const me = d.members?.[this.uid];
    const tg = $('#btnRole');
    tg.textContent = me?.role === 'player' ? '観戦に回る' : 'プレイヤーになる';
    tg.disabled = me?.role !== 'player' && players.length >= MAX_PLAYERS;
    tg.onclick = () => this.room.updateMember(this.uid, { role: me?.role === 'player' ? 'spectator' : 'player' });
    $('#btnCpu').style.display = host ? '' : 'none';
    $('#btnCpu').disabled = players.length >= MAX_PLAYERS;
    $('#btnCpu').onclick = () => this.addCpu();
    const st = $('#btnStart');
    st.style.display = host ? '' : 'none';
    st.disabled = players.length < rules.meta.minPlayers;
    st.textContent = players.length < rules.meta.minPlayers ? `あと${rules.meta.minPlayers - players.length}人必要` : 'ゲーム開始';
    st.onclick = () => this.startGame();
    $('#waitHost').style.display = host ? 'none' : '';
    $('#btnLeave').onclick = () => this.leave();
    $('#btnCopy').onclick = () => { navigator.clipboard?.writeText(location.origin + location.pathname + '?room=' + this.room.code); $('#btnCopy').textContent = 'コピーしました'; setTimeout(() => ($('#btnCopy').textContent = '招待URLをコピー'), 1500); };
    $('#btnRules').onclick = () => this.showRules(s.gameId);
  },

  // 高度な設定：カードの出現率（そのカードの値 ÷ 全カードの合計）
  renderWeights(rules, go, host, gameId) {
    const box = $('#weightOpts');
    const cards = rules.meta.cards;
    if (!cards) { box.innerHTML = ''; return; }
    const w = (id) => (go.weights?.[id] ?? 10);
    const sum = cards.reduce((a, c) => a + Math.max(0, w(c.id)), 0) || 1;
    const open = box.querySelector('details')?.open;
    box.innerHTML = `<details ${open ? 'open' : ''}><summary>高度な設定：カードの出現率</summary>
      <div class="w-grid">${cards.map((c) => `<label class="w-row"><span class="w-l">${esc(c.label)}</span>
        <input type="number" min="0" max="99" value="${w(c.id)}" data-w="${c.id}" ${host ? '' : 'disabled'}>
        <span class="w-p">${(Math.max(0, w(c.id)) / sum * 100).toFixed(1)}%</span></label>`).join('')}</div>
      ${host ? '<button class="btn ghost sm" id="wReset">デフォルトに戻す（全部10）</button>' : ''}</details>`;
    box.querySelectorAll('input[data-w]').forEach((inp) => (inp.onchange = () => {
      const v = Math.max(0, Math.min(99, Math.round(+inp.value || 0)));
      this.room.updateSettings({ [`gameOpts/${gameId}/weights/${inp.dataset.w}`]: v });
    }));
    const r = box.querySelector('#wReset');
    if (r) r.onclick = () => this.room.updateSettings({ [`gameOpts/${gameId}/weights`]: null });
  },

  async startGame() {
    const d = this.data, s = d.settings;
    const ms = Object.entries(d.members || {}).filter(([, m]) => m.role === 'player').sort((a, b) => a[1].joinedAt - b[1].joinedAt);
    const seats = ms.map(([id]) => id);
    const names = {}, cpu = {};
    ms.forEach(([id, m]) => { names[id] = m.name; if (m.isCpu) cpu[id] = true; });
    const gameOpts = { ...defaultGameOptions(s.gameId), ...(s.gameOpts?.[s.gameId] || {}) };
    const m = createMatch({ seats, names, cpu, gameId: s.gameId, gameOpts, damage: { ...defaultDamageSettings(), ...s.damage, survivors: clampSurvivors(s.damage?.survivors, seats.length) } });
    sfx.unlock();
    await this.room.setGame(m);
    await this.room.updateMeta({ status: 'playing', startedAt: Date.now() });
  },

  showRules(gameId) {
    const r = getRules(gameId).meta;
    this.modal(`<h2>${esc(r.name)}</h2>${r.rulesHtml || ''}<h3>ダメージ方式</h3><ul>${Object.values(DAMAGE_MODES).map((m) => `<li><b>${m.name}</b>：${m.desc}</li>`).join('')}</ul>`);
  },
  modal(html) {
    const md = $('#modal'); $('#modalBody').innerHTML = html; md.classList.add('on');
    $('#modalClose').onclick = () => md.classList.remove('on');
  },

  // ================= ゲーム =================
  async enterGame(m) {
    this.show('game');
    sfx.startDrone();
    this.resultShown = false; this.queue = []; this.busy = false; this.driverKey = null; this.intro = false;
    $('#result').classList.remove('on');
    $('#log').innerHTML = '';
    this.hideShoot();
    const sc = this.scene = new TableScene($('#stage'), { pixel: store.pixel });
    const me = m.seats.includes(this.uid) ? this.uid : null;
    sc.setSeats(m.seats.map((u) => ({ uid: u, name: m.names[u] })), me);
    const mod = await GAMES[m.gameId].view();
    this.view = await mod.createView({
      scene: sc, hud: $('#gameHud'), me, name: (u) => m.names[u] || '?',
      send: (a, opts) => this.sendAction(a, opts), banner: (t, s, ms, cls) => this.banner(t, s, ms, cls),
      popText: (t, cls) => this.popText(t, cls), choose: (t, o) => this.choose(t, o),
      reveal: (o) => this.reveal(o),
      now: () => this.room.now(),
      alarmNow: () => { sc.setAlarm(true); sfx.siren(3.2); this._alarmPre = true; }, // ゲーム側で敗者確定の瞬間に警報
    });
    $('#hudGame').textContent = getRules(m.gameId).meta.name;
    $('#hudMode').textContent = DAMAGE_MODES[m.dmg.mode].name + (m.dmg.survivors > 1 ? `　／　生存枠 ${m.dmg.survivors}人` : '');
    this.bindGameMenu();
    const fresh = m.round === 1 && m.events[0]?.id === 1 && m.phase === 'round' && m.events.length < 60;
    const alive = me && m.alive[me];
    if (fresh) {
      // 開幕：俯瞰から自分の席へゆっくりカメラ移動 → 配札
      this.lastEid = 0; this.intro = true;
      sc.setView({ kind: 'overview' }, true);
      this.introView = alive ? { kind: 'seat', uid: me } : { kind: 'overview' };
    } else {
      this.lastEid = m.eid; this.match = m; this.view.sync(m); this.refreshSeats(m);
      sc.setView(alive ? { kind: 'seat', uid: me } : { kind: 'overview' }, true);
    }
    this.renderCamBar(m);
    if (!fresh) this.afterIdle();
  },

  teardownGame() {
    clearTimeout(this._autoT);
    this.view?.dispose(); this.view = null;
    this.scene?.dispose(); this.scene = null;
    this.match = null; this.queue = []; this.busy = false;
    sfx.stopDrone();
    this.hideShoot();
    $('#game').classList.remove('exec');
    $('#result').classList.remove('on');
    $('#camBar').innerHTML = '';
  },

  bindGameMenu() {
    $('#btnMute').textContent = store.muted ? '音:OFF' : '音:ON';
    $('#btnMute').onclick = () => { store.muted = !store.muted; sfx.setMuted(store.muted); $('#btnMute').textContent = store.muted ? '音:OFF' : '音:ON'; };
    const q = $('#selPixel'); q.value = String(store.pixel);
    q.onchange = () => { store.pixel = +q.value; this.scene?.setPixel(+q.value); };
    $('#btnGameRules').onclick = () => this.showRules(this.match?.gameId || 'count-cards');
    $('#btnExit').onclick = () => { if (confirm('部屋から退出しますか？（試合中の場合、あなたの手番は自動で進みます）')) this.leave(); };
  },

  onMatch(m) {
    this.match = m;
    if (m.eid < this.lastEid) { this.lastEid = 0; } // 新しい試合
    const evs = m.events.filter((e) => e.id > this.lastEid);
    if (evs.length && evs[0].id > this.lastEid + 1 && this.lastEid !== 0) {
      this.lastEid = m.eid; this.queue = [];
      this.view.sync(m); this.refreshSeats(m); this.afterIdle(); return;
    }
    this.lastEid = m.eid;
    // これから再生するイベントを先に知らせる（次ラウンドの手札が一瞬見える問題の対策）
    if (evs.length) this.view?.onQueue?.(evs, m);
    this.queue.push(...evs);
    this.pump();
  },

  async pump() {
    if (this.busy) return;
    if (!this.queue.length) { this.afterIdle(); return; }
    this.busy = true;
    this.view.setInput(false, this.match);
    try {
      while (this.queue.length && this.scene) {
        const ev = this.queue.shift();
        this.log(ev);
        await this.animateEvent(ev);
      }
    } catch (e) { console.error(e); }
    this.busy = false;
    if (this.scene) this.afterIdle();
  },

  log(ev) {
    const m = this.match; const name = (u) => m.names[u] || '?';
    let t = null;
    if (ev.t === 'roundStart') t = `— ROUND ${ev.round} —`;
    else if (ev.t === 'loser') t = ev.again ? null : `⚠ 敗者：${name(ev.uid)}${ev.times > 1 ? `（ペナルティ${ev.times}回）` : ''}`;
    else if (ev.t === 'execution') t = ev.hit ? `${name(ev.uid)} 被弾${ev.dmg ? `（-${ev.dmg}）` : ''}` : `${name(ev.uid)} 空砲`;
    else if (ev.t === 'death') t = `✝ ${name(ev.uid)} 死亡`;
    else if (ev.t === 'gameOver') t = `生存者：${(ev.winners || []).map(name).join('、')}`;
    else t = getRules(m.gameId).describeEvent(ev, name);
    if (!t) return;
    const div = document.createElement('div'); div.className = 'ln ' + ev.t; div.textContent = t;
    const lg = $('#log'); lg.appendChild(div);
    while (lg.children.length > 60) lg.firstChild.remove();
    lg.scrollTop = lg.scrollHeight;
  },

  async animateEvent(ev) {
    const m = this.match, sc = this.scene;
    switch (ev.t) {
      case 'roundStart': {
        $('#hudRound').textContent = `ROUND ${ev.round}`;
        if (this.intro) {
          this.intro = false;
          this.banner(getRules(m.gameId).meta.name, `${m.seats.length}人のプレイヤー　生き残れるのは ${m.dmg.survivors}人`, 2600);
          await sc.setView(this.introView, false, 3400);
          await sc.wait(200);
        }
        let sub = '';
        if (m.dmg.mode === 'roundlife') sub = `このラウンドの敗者ダメージ：${ev.round}`;
        await this.banner(`ROUND ${ev.round}`, sub, 1300);
        return;
      }
      case 'loser': return this.animateLoser(ev);
      case 'execution': return this.animateExecution(ev);
      case 'death': return;
      case 'gameOver': return this.showResult(ev);
      default: return this.view.animate(ev, m);
    }
  },

  // 敗者決定：警報 → 敗者が銃を構える（ここで本人の操作待ちになる）
  async animateLoser(ev) {
    const m = this.match, sc = this.scene, nm = m.names[ev.uid];
    const isMe = ev.uid === this.uid;
    if (ev.again) {
      // 複数回ペナルティの2回目以降
      sc.setAlarm(0.45);
      $('#game').classList.add('exec');
      this.caption(isMe ? `ペナルティ残り ${ev.left}回。もう一度引き金を引け。` : `${nm} は再び銃を構えた…（残り ${ev.left}回）`);
      await sc.raiseGun(ev.uid, isMe);
      return;
    }
    if (this._alarmPre) this._alarmPre = false; // 既に鳴らしている
    else { sc.setAlarm(true); sfx.siren(3.2); }
    setTimeout(() => { if (this.scene === sc && this.match?.phase === 'loser') sc.setAlarm(0.45); }, 3300);
    for (const u of m.seats) sc.setSeatStatus(u, { active: u === ev.uid });
    await this.banner(`${nm} の負け`, (ev.text || '') + (ev.times > 1 && !(ev.text || '').includes('ペナルティ') ? `　ペナルティ ${ev.times}回` : ''), 2800, 'red');
    $('#game').classList.add('exec');
    if (ev.fatal) this.popText('ONEHIT — 即死', 'r');
    this.caption(m.dmg.autoShoot ? `${nm} の頭に銃口が向けられた…` : (isMe ? 'あなたの番だ。自分のタイミングで引き金を引け。' : `${nm} がリボルバーを手に取った…`));
    await sc.raiseGun(ev.uid, isMe);
  },

  async animateExecution(ev) {
    const m = this.match, sc = this.scene, nm = m.names[ev.uid];
    const isMe = ev.uid === this.uid;
    const revolverMode = ev.mode === 'revolver';
    this.hideShoot();
    $('#game').classList.add('exec');
    this.caption(ev.fatal ? '即死' : revolverMode ? `実弾の確率 ${Math.round(ev.prob * 100)}%` : (ev.mode === 'roundlife' ? `ダメージ ${ev.dmg}` : ''));
    sfx.heartbeat();
    await sc.wait(400);
    await sc.fire({
      uid: ev.uid, hit: ev.hit, dead: ev.dead, isMe, revolverMode,
      onDark: () => {
        let st;
        if (revolverMode) st = ev.hit ? '' : `実弾 ${Math.round((ev.nextProb || 0) * 100)}%`;
        else st = `LIFE ${Math.max(0, ev.lifeAfter)}`;
        sc.setSeatStatus(ev.uid, { status: ev.dead ? 'DEAD' : st });
        if (isMe && ev.dead) $('#youDied').classList.add('on');
      },
    });
    this.caption('');
    $('#game').classList.remove('exec');
    if (ev.dead) {
      if (isMe) {
        await sc.wait(1200);
        $('#youDied').classList.remove('on');
        sc.setView({ kind: 'overview' }, false, 1200);
        this.view.setInput(false, m);
        this.renderCamBar(m, true);
      }
      await this.banner(`${nm} 死亡`, isMe ? 'あなたは観戦に回ります' : '', 1800, 'red');
    } else if (ev.hit) {
      await this.banner(`${nm} 被弾`, `残りライフ ${Math.max(0, ev.lifeAfter)}${ev.left > 0 ? `　／　あと ${ev.left}回` : ''}`, 1500);
    } else {
      await this.banner('空砲', `${nm} は生き延びた　次の実弾確率 ${Math.round((ev.nextProb || 0) * 100)}%${ev.left > 0 ? `　／　あと ${ev.left}回` : ''}`, 1600);
    }
  },

  // ---------- 引き金ボタン ----------
  showShoot() {
    const b = $('#shootBtn');
    if (b.classList.contains('on')) return;
    b.classList.add('on'); b.disabled = false;
    const go = () => {
      if (b.disabled) return;
      b.disabled = true;
      this.sendAction({ type: 'shoot' });
    };
    b.onclick = go;
    this._shootKey = (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); go(); } };
    window.addEventListener('keydown', this._shootKey);
  },
  hideShoot() {
    $('#shootBtn').classList.remove('on');
    if (this._shootKey) { window.removeEventListener('keydown', this._shootKey); this._shootKey = null; }
  },

  refreshSeats(m) {
    if (!this.scene) return;
    const act = currentActor(m);
    for (const u of m.seats) {
      this.scene.setSeatStatus(u, {
        status: m.alive[u] ? statusText(m, u) : 'DEAD',
        alive: m.alive[u], active: u === act,
        extra: m.cpu[u] ? 'CPU' : (this.data?.members?.[u]?.online === false || !this.data?.members?.[u] ? '切断中' : ''),
      });
    }
    $('#hudRound').textContent = `ROUND ${m.round}`;
    const me = this.uid;
    $('#hudMe').textContent = m.seats.includes(me) ? (m.alive[me] ? `あなた：${statusText(m, me)}` : 'あなた：死亡（観戦中）') : '観戦中';
  },

  afterIdle() {
    const m = this.match; if (!m || !this.scene || this.busy) return;
    this.view.sync(m);
    this.refreshSeats(m);
    const actor = currentActor(m);
    const mine = actor === this.uid && m.alive[this.uid];
    this.view.setInput(!!mine && m.phase === 'round', m);
    if (m.phase === 'loser') {
      // 途中参加などで演出を見ていない場合も、警報と構えた状態にそろえる
      this.scene.setAlarm(0.45);
      this.scene.raiseGun(actor, actor === this.uid, true);
      $('#game').classList.add('exec');
      if (mine && !m.dmg.autoShoot) this.showShoot(); else this.hideShoot();
    } else this.hideShoot();
    if (m.phase === 'over' && !this.resultShown) this.showResult({ winners: m.winners });
    this.drive();
  },

  async sendAction(a, opts = {}) {
    const ok = await this.room.transactGame((m) => { applyAction(m, this.uid, a); return m; });
    if (!ok && opts.quiet) return ok;
    if (!ok) {
      this.popText('操作が反映されませんでした', 'r');
      $('#shootBtn').disabled = false;
      this.afterIdle();
    }
    return ok;
  },

  // ホスト役（最古の接続中プレイヤー）がCPU・切断者・進行を担当
  drive() {
    const m = this.match;
    if (!m || this.driverUid() !== this.uid) return;
    if (m.phase === 'execution') {
      const key = `x${m.eid}`; if (this.driverKey === key) return; this.driverKey = key;
      setTimeout(() => this.room.transactGame((mm) => { if (mm.eid !== m.eid) return; advance(mm); return mm; })
        .then((ok) => { if (!ok) this.driverKey = null; }), 900);
      return;
    }
    if (m.phase !== 'round' && m.phase !== 'loser') return;
    const rules = getRules(m.gameId);
    if (m.phase === 'round' && rules.pendingAuto) return this.driveAuto();
    const a = currentActor(m); if (!a) return;
    const mem = this.data?.members?.[a];
    const offline = !mem || mem.online === false;
    const auto = m.phase === 'loser' && m.dmg.autoShoot;
    if (!m.cpu[a] && !offline && !auto) return;
    const key = `p${m.eid}:${a}:${offline}`; if (this.driverKey === key) return; this.driverKey = key;
    let delay = m.cpu[a] ? 650 + Math.random() * 700 : 4000;
    if (m.phase === 'loser') delay = auto ? 1800 : m.cpu[a] ? 1500 + Math.random() * 2500 : 7000; // CPUも少し溜めてから撃つ
    setTimeout(() => {
      if (!this.match || this.match.eid !== m.eid) return;
      const mem2 = this.data?.members?.[a];
      if (!m.cpu[a] && !auto && mem2 && mem2.online !== false) { this.driverKey = null; return; }
      this.room.transactGame((mm) => {
        if (mm.eid !== m.eid) return;
        const act = mm.phase === 'loser' ? { type: 'shoot' } : getRules(mm.gameId).cpuAction(mm, a);
        applyAction(mm, a, act);
        return mm;
      }).then((ok) => { if (!ok) { this.driverKey = null; setTimeout(() => this.afterIdle(), 500); } });
    }, delay);
  },

  // 全員同時型のゲーム：CPUの解答や時間切れなど、時刻で起きる処理
  driveAuto() {
    clearTimeout(this._autoT);
    const tick = () => {
      const m = this.match;
      if (!m || m.phase !== 'round' || this.driverUid() !== this.uid) return;
      const rules = getRules(m.gameId);
      const { due, nextAt } = rules.pendingAuto(m, this.room.now());
      if (!due.length) { if (nextAt) this._autoT = setTimeout(tick, Math.max(60, nextAt - this.room.now())); return; }
      if (this._autoBusy) return;
      this._autoBusy = true;
      this.room.transactGame((mm) => {
        if (mm.phase !== 'round') return;
        const r = rules.pendingAuto(mm, this.room.now());
        if (!r.due.length) return;
        for (const d of r.due) {
          if (mm.phase !== 'round') break;
          rules.applyAuto?.(mm, d);
          try { applyAction(mm, d.uid || this.uid, d.action); } catch (e) { /* 既に終わっている等 */ }
        }
        return mm;
      }).finally(() => { this._autoBusy = false; this._autoT = setTimeout(tick, 250); });
    };
    tick();
  },

  // ---------- 観戦カメラ ----------
  renderCamBar(m, force) {
    const bar = $('#camBar');
    const me = this.uid;
    const watching = !m.seats.includes(me) || !m.alive[me] || force;
    if (!watching) { bar.innerHTML = ''; return; }
    const btn = (label, mode) => ({ label, mode });
    const list = [btn('俯瞰', { kind: 'overview' }), btn('フリー', { kind: 'free' }),
      ...m.seats.map((u) => btn(m.names[u] + ' 視点', { kind: 'seat', uid: u }))];
    bar.innerHTML = '<span class="cb-t">視点</span>' + list.map((b, i) => `<button data-i="${i}">${esc(b.label)}</button>`).join('');
    bar.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      this.scene.setView(list[+b.dataset.i].mode);
      bar.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
    }));
  },

  // ---------- 演出用UI ----------
  banner(title, sub = '', ms = 1500, cls = '') {
    const b = $('#banner');
    b.className = 'banner on ' + cls;
    $('#bannerT').textContent = title; $('#bannerS').textContent = sub;
    clearTimeout(this._bannerT);
    return new Promise((res) => { this._bannerT = setTimeout(() => { b.classList.remove('on'); setTimeout(res, 200); }, ms); setTimeout(res, ms + 400); });
  },
  popText(t, cls = '') {
    if (!t) return;
    const el = document.createElement('div'); el.className = 'pop ' + cls; el.textContent = t;
    $('#popLayer').appendChild(el); setTimeout(() => el.remove(), 1400);
  },
  // 出されたカードを大きく見せる
  reveal({ img, who, forced, ms = 900 }) {
    const r = $('#reveal');
    $('#revealImg').src = img;
    $('#revealWho').textContent = `${who}${forced ? '（RANDOM）' : ''} が出した`;
    r.classList.remove('on'); void r.offsetWidth; r.classList.add('on');
    return new Promise((res) => setTimeout(() => { r.classList.remove('on'); setTimeout(res, 150); }, ms));
  },
  caption(t) { const c = $('#caption'); c.textContent = t; c.classList.toggle('on', !!t); },
  choose(title, options) {
    return new Promise((res) => {
      const md = $('#chooser');
      $('#chooserT').textContent = title;
      $('#chooserOpts').innerHTML = options.map((o, i) => `<button data-i="${i}">${esc(o.label)}</button>`).join('') + '<button class="cancel" data-i="-1">やめる</button>';
      md.classList.add('on');
      md.querySelectorAll('button').forEach((b) => (b.onclick = () => { md.classList.remove('on'); const i = +b.dataset.i; res(i < 0 ? null : options[i].value); }));
    });
  },

  showResult(ev) {
    if (this.resultShown) return; this.resultShown = true;
    const m = this.match; const name = (u) => esc(m.names[u] || '?');
    const winners = m.winners || ev.winners || [];
    const order = [...winners, ...m.deadOrder.slice().reverse()];
    $('#resultBody').innerHTML = `
      <div class="r-win">${winners.map(name).join('<br>')}</div><div class="r-sub">${winners.length > 1 ? '生存者' : '最後の生存者'}　（全${m.round}ラウンド）</div>
      <ol class="r-list">${order.map((u, i) => `<li><span>${i + 1}</span>${name(u)}${winners.includes(u) ? ' <b>SURVIVED</b>' : ' ✝'}</li>`).join('')}</ol>`;
    const host = this.isHost();
    $('#btnBackLobby').style.display = host ? '' : 'none';
    $('#resultWait').style.display = host ? 'none' : '';
    $('#btnBackLobby').onclick = async () => { await this.room.updateMeta({ status: 'lobby' }); await this.room.setGame(null); };
    $('#btnResultExit').onclick = () => this.leave();
    setTimeout(() => $('#result').classList.add('on'), 600);
  },
};

// ---------- 設定フォーム ----------
function optRow(o, val, enabled, prefix) {
  const dis = enabled ? '' : 'disabled';
  if (o.type === 'bool') {
    return `<label class="opt"><span class="ol">${esc(o.label)}${o.note ? `<small>${esc(o.note)}</small>` : ''}</span>
      <button class="toggle ${val ? 'on' : ''}" data-${prefix}="${o.key}" data-type="bool" ${dis}>${val ? 'ON' : 'OFF'}</button></label>`;
  }
  return `<label class="opt"><span class="ol">${esc(o.label)}${o.note ? `<small>${esc(o.note)}</small>` : ''}</span>
    <span class="num"><button class="mini" data-${prefix}="${o.key}" data-step="-1" ${dis}>−</button>
    <input type="number" min="${o.min}" max="${o.max}" value="${val ?? o.default}" data-${prefix}="${o.key}" data-type="number" ${dis}>
    <button class="mini" data-${prefix}="${o.key}" data-step="1" ${dis}>＋</button></span></label>`;
}
function bindOpts(root, prefix, save) {
  root.querySelectorAll(`[data-${prefix}]`).forEach((el) => {
    const key = el.dataset[prefix];
    if (el.dataset.type === 'bool') el.onclick = (e) => { e.preventDefault(); save(key, !el.classList.contains('on')); };
    else if (el.dataset.step) el.onclick = (e) => {
      e.preventDefault();
      const inp = root.querySelector(`input[data-${prefix}="${key}"]`);
      const v = Math.max(+inp.min, Math.min(+inp.max, (+inp.value || 0) + +el.dataset.step));
      save(key, v);
    };
    else if (el.tagName === 'INPUT') el.onchange = () => { const v = Math.max(+el.min, Math.min(+el.max, Math.round(+el.value || 0))); save(key, v); };
  });
}

window.App = App;
App.init();

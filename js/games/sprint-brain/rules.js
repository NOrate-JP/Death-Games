// SPRINT BRAIN : 脳トレ早解き（全員同時に解く）
import { pushEvent, aliveList, now } from '../../match.js';

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const QTYPES = {
  cube: { name: 'Count Cube', desc: '立方体の個数を数えなさい', opt: 'qCube' },
  alpha: { name: 'Lost Alphabet', desc: '唯一存在しない文字を答えなさい', opt: 'qAlpha' },
  scroll: { name: 'Scroll Number', desc: '高速で表示される数字を入力しなさい', opt: 'qScroll' },
  touch: { name: 'Touch Number', desc: '小さい順に数字をすべて押しなさい', opt: 'qTouch' },
  math: { name: 'Quick Math', desc: '四則演算ですばやくお題の数字を作りなさい', opt: 'qMath' },
};

export const meta = {
  id: 'sprint-brain',
  name: 'SPRINT BRAIN',
  subtitle: '脳トレ早解き。最後の1人が撃たれる',
  minPlayers: 2,
  maxPlayers: 6,
  options: [
    { key: 'qCube', label: '出題：Count Cube', type: 'bool', default: true },
    { key: 'qAlpha', label: '出題：Lost Alphabet', type: 'bool', default: true },
    { key: 'qScroll', label: '出題：Scroll Number', type: 'bool', default: true },
    { key: 'qTouch', label: '出題：Touch Number', type: 'bool', default: true },
    { key: 'qMath', label: '出題：Quick Math', type: 'bool', default: true },
    { key: 'missPenalty', label: '不正解ペナルティ', type: 'bool', default: true, note: 'OFFなら間違えても再挑戦できる' },
    { key: 'surprise', label: '抜き打ち出題', type: 'bool', default: false, note: '出題形式を出さず「Ready…」から突然開始' },
    { key: 'timeLimit', label: '制限時間（秒）', type: 'number', min: 20, max: 300, default: 90, note: '時間切れ時は未正解者からランダムに1人が敗者' },
  ],
  rulesHtml: `
    <p>毎ラウンド、全員に同じ脳トレ問題が出題されます。全員が同時に解きます。</p>
    <ul>
      <li><b>1人を除いて全員が正解</b> → 残った1人が敗者</li>
      <li><b>最初に不正解を送信した人</b> → その人が敗者（不正解ペナルティON時）</li>
    </ul>
    <h3>出題形式</h3>
    <ul>
      <li><b>Count Cube</b>：回転する積み木の立方体の数を答える（浮いている立方体はない）</li>
      <li><b>Lost Alphabet</b>：5×5に並んだアルファベットに無い1文字を答える</li>
      <li><b>Scroll Number</b>：高速で流れる7〜9桁の数字をそのまま入力</li>
      <li><b>Touch Number</b>：12個の数字を小さい順に押す（順番を間違えたらMiss）</li>
      <li><b>Quick Math</b>：カードを全部使い、四則演算でお題の数を作る（不正解なし）</li>
    </ul>`,
};

// ---------- 分数 ----------
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
export function frac(n, d = 1) { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d) || 1; return { n: n / g, d: d / g }; }
export function fop(a, b, op) {
  if (op === '+') return frac(a.n * b.d + b.n * a.d, a.d * b.d);
  if (op === '-') return frac(a.n * b.d - b.n * a.d, a.d * b.d);
  if (op === '*') return frac(a.n * b.n, a.d * b.d);
  if (op === '/') return b.n === 0 ? null : frac(a.n * b.d, a.d * b.n);
  return null;
}
// 小数第1位までで表せるものは小数、それ以外は分数表記
export function fstr(x) {
  if (x.d === 1) return String(x.n);
  if (10 % x.d === 0) return String(x.n / x.d);
  return `${x.n}/${x.d}`;
}
const OPS = { '+': '+', '-': '−', '*': '×', '/': '÷' };

// ---------- 問題生成 ----------
function genCube() {
  const n = pick([4, 4, 5]); // 土台 4×4 / 5×5
  const maxH = n === 4 ? 5 : 4;
  for (;;) {
    const grid = Array.from({ length: n }, () => Array.from({ length: n }, () => (Math.random() < 0.2 ? 0 : rint(1, maxH))));
    const total = grid.flat().reduce((a, b) => a + b, 0);
    if (total >= 18 && total <= 60) return { type: 'cube', grid, answer: String(total), show: String(total) };
  }
}
function genAlpha() {
  const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const miss = pick(all);
  return { type: 'alpha', letters: shuffle(all.filter((c) => c !== miss)), answer: miss, show: miss };
}
function genScroll() {
  const len = rint(7, 9);
  let s = String(rint(1, 9));
  while (s.length < len) s += rint(0, 9);
  return { type: 'scroll', digits: s, motion: pick(['lr', 'rl', 'tb', 'bt', 'zoom']), answer: s, show: s };
}
function genTouch() {
  const set = new Set();
  while (set.size < 12) set.add(rint(1, 99));
  const nums = shuffle([...set]);
  return { type: 'touch', nums, answer: 'clear', show: [...nums].sort((a, b) => a - b).map((x) => String(x).padStart(2, '0')).join(' → ') };
}
function genMath() {
  for (let tries = 0; tries < 500; tries++) {
    const cards = Array.from({ length: 4 }, () => rint(1, 9));
    let pool = cards.map((c) => ({ v: frac(c), s: String(c) }));
    const steps = [];
    while (pool.length > 1) {
      const i = rint(0, pool.length - 1); const a = pool.splice(i, 1)[0];
      const j = rint(0, pool.length - 1); const b = pool.splice(j, 1)[0];
      const op = pick(['+', '-', '*', '*', '/', '-', '+']);
      const v = fop(a.v, b.v, op);
      if (!v) { pool = null; break; }
      steps.push(`${fstr(a.v)}${OPS[op]}${fstr(b.v)}=${fstr(v)}`);
      pool.push({ v, s: '' });
    }
    if (!pool) continue;
    const t = pool[0].v;
    if (t.d !== 1 || t.n < 0 || t.n > 60) continue;
    if (cards.includes(t.n) && Math.random() < 0.6) continue;
    return { type: 'math', cards, target: t.n, answer: 'clear', show: steps.join('　') };
  }
  return { type: 'math', cards: [1, 2, 3, 4], target: 10, answer: 'clear', show: '1+2=3　3+3=6　6+4=10' };
}
const GEN = { cube: genCube, alpha: genAlpha, scroll: genScroll, touch: genTouch, math: genMath };

// CPUの解答時間（ms）と正答率の目安
const CPU_T = { cube: [12000, 32000], alpha: [6000, 18000], scroll: [4500, 14000], touch: [7000, 15000], math: [9000, 30000] };

// 判定待ち時間：決着しそうな解答が届いてから、この間に届いた解答も「押した時刻」順で比べる
export const GRACE_MS = 1000;

export function startRound(m) {
  m.gs = m.gs || {};
  startQuestion(m, aliveList(m), false);
}

// players: この問題に参加する人（サドンデスでは同着者のみ）
function startQuestion(m, players, sudden) {
  const o = m.opts;
  let types = Object.keys(QTYPES).filter((k) => o[QTYPES[k].opt] !== false);
  if (!types.length) types = Object.keys(QTYPES);
  if (m.gs?.lastType && types.length > 1) types = types.filter((t) => t !== m.gs.lastType);
  const type = pick(types);
  m.gs = { ...(m.gs || {}), lastType: type };
  const q = GEN[type]();
  const status = {};
  players.forEach((u) => { status[u] = 'thinking'; });
  // CPUの行動予定
  const cpuPlan = {};
  for (const u of players) if (m.cpu[u]) {
    const [lo, hi] = CPU_T[type];
    const steps = [];
    let t = rint(lo, hi);
    const missRate = type === 'math' ? 0 : (o.missPenalty !== false ? 0.07 : 0.18);
    if (Math.random() < missRate) { steps.push({ at: Math.round(t * 0.7), ok: false }); t += rint(2000, 6000); }
    steps.push({ at: t, ok: true });
    cpuPlan[u] = steps;
  }
  // まず全員の準備（モニター設置・カメラのズーム）を待つ。揃ったら sb_start でカウント開始
  m.sub = { phase: 'prep', q, prepAt: now(), ready: {}, introAt: null, startAt: null, limit: (o.timeLimit || 90) * 1000, players: players.slice(), sudden: !!sudden,
    status, subs: [], pendingUntil: null, cpuPlan, cpuStep: {} };
  pushEvent(m, { t: 'sb_setup', qtype: type, q: publicQ(q), surprise: !!o.surprise, sudden: !!sudden, limit: m.sub.limit, players: players.slice() });
}

// 出題データ（答えは含めない）
export function publicQ(q) { const { answer, show, ...rest } = q; return rest; }

export function currentActor() { return null; } // 全員同時

function normalize(q, v) {
  v = String(v ?? '').trim();
  if (q.type === 'alpha') return v.toUpperCase();
  if (q.type === 'cube') return String(parseInt(v, 10));
  return v.replace(/\s/g, '');
}

// 押した時刻順に並べて決着を判定する
// 戻り値: {kind:'loser', uid, reason} | {kind:'tie', players, reason} | null
function decide(m) {
  const s = m.sub, pen = m.opts.missPenalty !== false;
  const subs = s.subs.slice().sort((a, b) => a.at - b.at);
  const escaped = new Set();
  for (let i = 0; i < subs.length;) {
    const at = subs[i].at; const grp = [];
    while (i < subs.length && subs[i].at === at) grp.push(subs[i++]);
    // 不正解（同時刻なら不正解を優先して判定）
    if (pen) {
      const miss = [...new Set(grp.filter((x) => !x.ok && !escaped.has(x.uid)).map((x) => x.uid))];
      if (miss.length === 1) return { kind: 'loser', uid: miss[0], reason: 'miss' };
      if (miss.length >= 2) return { kind: 'tie', players: miss, reason: 'miss' };
    }
    const before = s.players.filter((u) => !escaped.has(u));
    grp.filter((x) => x.ok).forEach((x) => escaped.add(x.uid));
    const remain = s.players.filter((u) => !escaped.has(u));
    if (remain.length === 1) return { kind: 'loser', uid: remain[0], reason: 'last' };
    if (remain.length === 0) return { kind: 'tie', players: before, reason: 'last' }; // 最後の2人以上が完全同着
  }
  return null;
}

function finish(m, loser, reason) {
  const s = m.sub;
  s.phase = 'end';
  const text = { last: '最後まで解けなかった', miss: '最速で不正解を送信した', timeout: '時間切れ（未正解者から抽選）' }[reason];
  const ranking = s.subs.filter((x) => x.ok).sort((a, b) => a.at - b.at).map((x) => ({ uid: x.uid, ms: x.at - s.startAt }));
  pushEvent(m, { t: 'sb_end', loser, reason, answer: s.q.show, qtype: s.q.type, ranking, sudden: s.sudden });
  m.loser = { uid: loser, reason, text: `${s.sudden ? 'サドンデス ' : ''}${QTYPES[s.q.type].name}：${text}`, times: 1 };
}

function settle(m) {
  const s = m.sub;
  const d = decide(m);
  if (!d) { s.pendingUntil = null; return; }
  if (d.kind === 'loser') return finish(m, d.uid, d.reason);
  // 完全同着 → 同着者だけでサドンデス
  s.phase = 'end';
  pushEvent(m, { t: 'sb_tie', players: d.players, reason: d.reason, answer: s.q.show, qtype: s.q.type });
  startQuestion(m, d.players, true);
}

export const PREP_TIMEOUT = 12000; // 準備完了が来ない人（切断など）を待つ上限

function goLive(m) {
  const s = m.sub, o = m.opts;
  s.phase = 'live';
  s.introAt = now() + 400;
  s.startAt = s.introAt + (o.surprise ? rint(2500, 7000) : 5200); // 形式表示+3カウント / Ready…
  pushEvent(m, { t: 'sb_start', introAt: s.introAt, startAt: s.startAt });
}

function allReady(m) {
  const s = m.sub;
  return s.players.every((u) => m.cpu[u] || !m.alive[u] || s.ready[u]);
}

export function applyAction(m, uid, a) {
  const s = m.sub, o = m.opts;
  if (s && s.phase === 'prep') {
    if (a.type === 'ready') { s.ready[uid] = true; if (allReady(m)) goLive(m); return; }
    if (a.type === 'forceStart') { if (!allReady(m) && now() < s.prepAt + PREP_TIMEOUT) throw new Error('not yet'); return goLive(m); }
    throw new Error('not live');
  }
  if (!s || s.phase !== 'live') throw new Error('not live');
  if (a.type === 'settle') {
    if (!s.pendingUntil || now() < s.pendingUntil) throw new Error('not yet');
    return settle(m);
  }
  if (a.type === 'timeout') {
    if (now() < s.startAt + s.limit) throw new Error('not yet');
    if (s.pendingUntil) return settle(m);
    const left = s.players.filter((u) => s.status[u] !== 'escape' && m.alive[u]);
    pushEvent(m, { t: 'sb_timeout' });
    return finish(m, pick(left), 'timeout');
  }
  if (a.type !== 'answer') throw new Error('bad action');
  if (!s.players.includes(uid) || !m.alive[uid]) throw new Error('not participating');
  if (s.status[uid] === 'escape' || s.status[uid] === 'miss') throw new Error('done');
  const t = now();
  if (t < s.startAt - 400) throw new Error('too early');
  // 押した時刻（サーバー時刻補正済み）。明らかにおかしい値は丸める
  let at = Math.round(Number(a.at));
  if (!Number.isFinite(at)) at = t;
  at = Math.max(s.startAt, Math.min(t + 300, at));
  const ok = normalize(s.q, a.value) === normalize(s.q, s.q.answer);
  s.subs.push({ uid, at, ok });
  const ms = at - s.startAt;
  if (ok) {
    s.status[uid] = 'escape';
    pushEvent(m, { t: 'sb_status', uid, status: 'escape', ms });
  } else if (o.missPenalty !== false) {
    s.status[uid] = 'miss';
    pushEvent(m, { t: 'sb_status', uid, status: 'miss', ms, value: String(a.value ?? '') });
  } else {
    pushEvent(m, { t: 'sb_status', uid, status: 'miss', retry: true, ms, value: String(a.value ?? '') });
  }
  // 決着しそうなら判定待ちに入る（この間に届いた解答も押した時刻で比較）
  if (!s.pendingUntil && decide(m)) {
    s.pendingUntil = t + GRACE_MS;
    pushEvent(m, { t: 'sb_judge' });
  }
}

// ---- 自動行動（ホスト役が実行）：CPUの解答・時間切れ ----
function wrongValue(q) {
  if (q.type === 'cube') return String(+q.answer + pick([-2, -1, 1, 2]));
  if (q.type === 'alpha') return pick('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((c) => c !== q.answer));
  if (q.type === 'scroll') { const d = q.digits.split(''); const i = rint(0, d.length - 1); d[i] = String((+d[i] + rint(1, 8)) % 10); return d.join(''); }
  return 'miss';
}
export function pendingAuto(m, t) {
  const s = m.sub;
  const out = { due: [], nextAt: null };
  const consider = (at) => { if (out.nextAt === null || at < out.nextAt) out.nextAt = at; };
  if (m.phase === 'round' && s?.phase === 'prep') {
    // 人間が全員CPUなら即開始、切断者がいればタイムアウトで開始
    if (allReady(m)) out.due.push({ uid: null, action: { type: 'forceStart' }, force: true });
    else if (t >= s.prepAt + PREP_TIMEOUT) out.due.push({ uid: null, action: { type: 'forceStart' } });
    else consider(s.prepAt + PREP_TIMEOUT);
    return out;
  }
  if (m.phase !== 'round' || !s || s.phase !== 'live') return out;
  for (const [u, plan] of Object.entries(s.cpuPlan || {})) {
    if (!m.alive[u] || s.status[u] === 'escape' || s.status[u] === 'miss') continue;
    const k = s.cpuStep[u] || 0; const st = plan[k]; if (!st) continue;
    const at = s.startAt + st.at;
    if (t >= at) out.due.push({ uid: u, step: k, action: { type: 'answer', value: st.ok ? s.q.answer : wrongValue(s.q), at } });
    else consider(at);
  }
  if (s.pendingUntil) {
    if (t >= s.pendingUntil) { out.due.push({ uid: null, action: { type: 'settle' } }); return out; }
    consider(s.pendingUntil);
  }
  const lim = s.startAt + s.limit;
  if (t >= lim) out.due.push({ uid: null, action: { type: 'timeout' } });
  else consider(lim);
  return out;
}
export function applyAuto(m, d) {
  if (d.uid) m.sub.cpuStep[d.uid] = d.step + 1;
}

export function describeEvent(ev, name) {
  switch (ev.t) {
    case 'sb_setup': return `${ev.sudden ? '【サドンデス】' : ''}出題準備…`;
    case 'sb_start': return '出題開始';
    case 'sb_status':
      if (ev.status === 'escape') return `${name(ev.uid)} Escape!（${(ev.ms / 1000).toFixed(3)}秒）`;
      return `${name(ev.uid)} Miss!${ev.retry ? '（再挑戦）' : ''}`;
    case 'sb_timeout': return '時間切れ！';
    case 'sb_tie': return `完全同着！ ${ev.players.map(name).join('・')} でサドンデス`;
    case 'sb_end': return `答え：${ev.answer}`;
    default: return null;
  }
}

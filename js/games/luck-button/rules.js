// LUCK BUTTON : 12個のボタンのどれかがOUT
import { pushEvent, aliveList } from '../../match.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const NB = 12; // ボタン数（3×4）

export const CARD_DEFS = {
  skip: { label: 'SKIP', desc: 'ボタンを押さずにターンを終了する。' },
  reverse: { label: 'REVERSE', desc: 'ボタンを1つ押す。その後、ターン順を逆にする。' },
  discard: { label: 'DISCARD', desc: '次のプレイヤーの手札を1枚ランダムに破棄する。その後、ボタンを1つ押す。' },
  double: { label: 'DOUBLE', desc: 'ボタンを1つ押す。次のプレイヤーはボタンを2つ押さなければならない。' },
  danger: { label: 'DANGER', desc: 'ボタンを1つ押す。その後、ラウンド終了までOUTボタンが1つ増える。' },
  taboo: { label: 'TABOO', desc: 'ボタンを1つ押す。次のプレイヤーのターン、カードの使用を禁止する。' },
  onehit: { label: 'ONEHIT', desc: 'ボタンを1つ押す。次のプレイヤーはOUTボタンを押した場合、即座に死亡する。' },
  analyze: { label: 'ANALYZE', desc: 'ボタンのうち3つが黄色に光る（自分にだけ、ボタンを押すまでの間だけ見える）。その中の1つ以上はOUT。その後、ボタンを1つ押す。' },
  xray: { label: 'X-RAY', desc: 'ランダムな1つのボタンの正体がわかる（緑＝セーフ／赤＝OUT、自分にだけ、ボタンを押すまでの間だけ見える）。その後、ボタンを1つ押す。' },
  shuffle: { label: 'SHUFFLE', desc: 'OUTボタンの位置をランダムに入れ替える。その後、ボタンを1つ押す。' },
};

export const meta = {
  id: 'luck-button',
  name: 'LUCK BUTTON',
  subtitle: '12個のボタン、どれかが死への入口',
  minPlayers: 2,
  maxPlayers: 6,
  options: [
    { key: 'initHand', label: '初期手札枚数', type: 'number', min: 0, max: 10, default: 3 },
  ],
  cards: Object.entries(CARD_DEFS).map(([id, d]) => ({ id, label: d.label })),
  rulesHtml: `
    <p>テーブル中央に、白く光る12個のボタン（縦3×横4）の装置があります。そのうち1つは秘密の<b>OUTボタン</b>です。</p>
    <ul>
      <li>ターンプレイヤーは「ボタンを1つ押す」か「カードを1枚使う」のどちらかを行います。</li>
      <li>押したボタンは光が消え、もう選べません（OUTの確率は 1/12 → 1/11 → … と上がる）。</li>
      <li>OUTボタンを押した人が敗者。ラウンド終了後、ボタンは元に戻り、手札も配り直されます。</li>
      <li>効果を受けたプレイヤーがSKIPを使うと、その効果は消えます（次の人へは移りません）。</li>
    </ul>
    <h3>カード</h3>
    <ul>${Object.values(CARD_DEFS).map((d) => `<li><b>${d.label}</b>：${d.desc}</li>`).join('')}</ul>
    <p>ANALYZE・X-RAY の光は使った本人にしか見えず、<b>そのターンにボタンを押すまでの間だけ</b>光ります。覚えておきましょう。SHUFFLE が使われると、それまでの情報は無効になります。</p>`,
};

const DEFAULT_W = Object.fromEntries(Object.keys(CARD_DEFS).map((k) => [k, 10]));
function drawCard(weights) {
  const w = { ...DEFAULT_W, ...(weights || {}) };
  const ids = Object.keys(CARD_DEFS).filter((k) => w[k] > 0);
  if (!ids.length) return 'skip';
  const total = ids.reduce((a, k) => a + w[k], 0);
  let r = Math.random() * total;
  for (const k of ids) { r -= w[k]; if (r < 0) return k; }
  return ids[ids.length - 1];
}

function nextAlive(m, uid, dir) {
  const n = m.seats.length; let i = m.seats.indexOf(uid);
  for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (m.alive[m.seats[i]]) return m.seats[i]; }
  return uid;
}

export const unpressed = (s) => s.pressed.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);

export function startRound(m) {
  const o = m.opts;
  const al = aliveList(m);
  const hs = o.initHand ?? 3;
  const s = {
    pressed: Array(NB).fill(false),
    outs: [Math.floor(Math.random() * NB)],
    hands: {}, secret: {}, dir: 1, pending: {}, turn: null, turnNo: 0,
  };
  al.forEach((u) => { s.hands[u] = Array.from({ length: hs }, () => drawCard(o.weights)); s.secret[u] = []; });
  m.sub = s;
  const start = m.prevLoser && m.seats.includes(m.prevLoser) ? (m.alive[m.prevLoser] ? m.prevLoser : nextAlive(m, m.prevLoser, 1)) : pick(al);
  pushEvent(m, { t: 'lb_setup', players: al, hs, start });
  beginTurn(m, start);
}

function beginTurn(m, uid) {
  const s = m.sub, p = s.pending || {};
  s.pending = {};
  s.turnNo = (s.turnNo || 0) + 1;
  s.turn = { no: s.turnNo, uid, presses: p.double ? 2 : 1, taboo: !!p.taboo, onehit: !!p.onehit, card: null, after: [], phase: 'choose' };
  pushEvent(m, { t: 'lb_turn', uid, presses: s.turn.presses, taboo: s.turn.taboo, onehit: s.turn.onehit, dir: s.dir });
}

export function currentActor(m) {
  return m.phase === 'round' && m.sub?.turn ? m.sub.turn.uid : null;
}

export const canUseCard = (m, uid) => {
  const t = m.sub.turn;
  return t && t.uid === uid && t.phase === 'choose' && !t.taboo && (m.sub.hands[uid] || []).length > 0;
};

export function applyAction(m, uid, a) {
  const s = m.sub, t = s.turn;
  if (!t || t.uid !== uid) throw new Error('not your turn');
  if (a.type === 'card') {
    if (!canUseCard(m, uid)) throw new Error('cannot use card');
    const hand = s.hands[uid];
    if (hand[a.idx] !== a.card) throw new Error('stale');
    hand.splice(a.idx, 1);
    return playCard(m, uid, a.card);
  }
  if (a.type === 'press') return press(m, uid, +a.idx);
  throw new Error('bad action');
}

function playCard(m, uid, card) {
  const s = m.sub, t = s.turn;
  t.card = card;
  const ev = { t: 'lb_card', uid, card, left: s.hands[uid].length };
  const nxt = nextAlive(m, uid, s.dir);
  switch (card) {
    case 'skip':
      pushEvent(m, ev);
      return endTurn(m, true);
    case 'reverse': t.after.push('reverse'); break;
    case 'discard': {
      const h = s.hands[nxt] || [];
      if (h.length && nxt !== uid) {
        const i = Math.floor(Math.random() * h.length);
        ev.target = nxt; ev.discarded = h.splice(i, 1)[0]; ev.targetLeft = h.length;
      } else ev.target = nxt;
      break;
    }
    case 'double': t.after.push('double'); break;
    case 'danger': t.after.push('danger'); break;
    case 'taboo': t.after.push('taboo'); break;
    case 'onehit': t.after.push('onehit'); break;
    case 'analyze': {
      const up = unpressed(s);
      const outsUp = up.filter((i) => s.outs.includes(i));
      const safeUp = shuffle(up.filter((i) => !s.outs.includes(i)));
      const set = new Set([pick(outsUp)]);
      for (const i of shuffle([...safeUp, ...outsUp])) { if (set.size >= Math.min(3, up.length)) break; set.add(i); }
      s.secret[uid].push({ kind: 'analyze', idx: shuffle([...set]), turnNo: s.turnNo });
      break;
    }
    case 'xray': {
      const i = pick(unpressed(s));
      s.secret[uid].push({ kind: 'xray', idx: i, out: s.outs.includes(i), turnNo: s.turnNo });
      break;
    }
    case 'shuffle': {
      const up = shuffle(unpressed(s));
      s.outs = up.slice(0, s.outs.length);
      for (const u of Object.keys(s.secret)) s.secret[u] = []; // 位置が変わったので全員の情報は無効
      break;
    }
  }
  pushEvent(m, ev);
  t.phase = 'press';
}

function press(m, uid, idx) {
  const s = m.sub, t = s.turn;
  if (!(idx >= 0 && idx < NB) || s.pressed[idx]) throw new Error('bad button');
  s.pressed[idx] = true;
  const out = s.outs.includes(idx);
  t.presses -= 1;
  t.pressedN = (t.pressedN || 0) + 1;
  t.phase = 'press';
  pushEvent(m, { t: 'lb_press', uid, idx, out, left: out ? 0 : t.presses, onehit: t.onehit });
  if (out) {
    m.loser = { uid, reason: 'out', text: t.onehit ? 'ONEHIT中にOUTボタンを押した — 即死' : 'OUTボタンを押した', fatal: t.onehit };
    pushEvent(m, { t: 'lb_out', uid, idx, outs: s.outs.slice(), fatal: t.onehit });
    return;
  }
  if (t.presses > 0) return; // DOUBLE：もう1つ
  endTurn(m, false);
}

function endTurn(m, skipped) {
  const s = m.sub, t = s.turn;
  for (const a of t.after) {
    if (a === 'reverse') { s.dir *= -1; pushEvent(m, { t: 'lb_reverse', dir: s.dir }); }
    if (a === 'double') s.pending.double = true;
    if (a === 'taboo') s.pending.taboo = true;
    if (a === 'onehit') s.pending.onehit = true;
    if (a === 'danger') {
      const cand = unpressed(s).filter((i) => !s.outs.includes(i));
      if (cand.length) s.outs.push(pick(cand));
      pushEvent(m, { t: 'lb_danger', count: s.outs.length });
    }
  }
  beginTurn(m, nextAlive(m, t.uid, s.dir));
}

// --- CPU（自分の知っている情報だけで判断） ---
export function cpuAction(m, uid) {
  const s = m.sub, t = s.turn, hand = s.hands[uid] || [];
  const up = unpressed(s);
  const risk = s.outs.length / up.length;
  if (t.phase === 'choose' && canUseCard(m, uid)) {
    const si = hand.indexOf('skip');
    if (si >= 0 && (risk > 0.22 || t.presses > 1 || t.onehit)) return { type: 'card', idx: si, card: 'skip' };
    const others = hand.map((c, i) => ({ c, i })).filter((x) => x.c !== 'skip');
    if (others.length && Math.random() < 0.35 + risk) {
      const pref = ['xray', 'analyze', 'double', 'onehit', 'danger', 'taboo', 'discard', 'shuffle', 'reverse'];
      others.sort((a, b) => pref.indexOf(a.c) - pref.indexOf(b.c) + (Math.random() - 0.5) * 4);
      return { type: 'card', idx: others[0].i, card: others[0].c };
    }
  }
  const known = s.secret[uid] || [];
  const bad = new Set(), good = new Set(), sus = new Set();
  for (const k of known) {
    if (k.kind === 'xray') (k.out ? bad : good).add(k.idx);
    if (k.kind === 'analyze') k.idx.forEach((i) => sus.add(i));
  }
  const cand = up.filter((i) => !bad.has(i));
  const g = cand.filter((i) => good.has(i));
  if (g.length) return { type: 'press', idx: pick(g) };
  const safer = cand.filter((i) => !sus.has(i));
  return { type: 'press', idx: pick(safer.length ? safer : cand.length ? cand : up) };
}

export function describeEvent(ev, name) {
  const L = (c) => CARD_DEFS[c]?.label ?? c;
  switch (ev.t) {
    case 'lb_setup': return `手札 ${ev.hs}枚 ／ スタート: ${name(ev.start)}`;
    case 'lb_card': return `${name(ev.uid)} ▶ ${L(ev.card)}${ev.discarded ? `（${name(ev.target)} の ${L(ev.discarded)} を破棄）` : ''}`;
    case 'lb_press': return ev.out ? `${name(ev.uid)} がボタン${ev.idx + 1}を押した… OUT!` : `${name(ev.uid)} がボタン${ev.idx + 1}を押した — セーフ`;
    case 'lb_danger': return `OUTボタンが ${ev.count}個 に増えた`;
    case 'lb_reverse': return 'ターン順が逆になった';
    default: return null;
  }
}

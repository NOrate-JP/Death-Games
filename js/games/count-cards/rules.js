// COUNT CARDS : ルール（純粋ロジック。Firebaseトランザクション内でも実行される）
import { CARD_DEFS, DEFAULT_WEIGHTS, isNum } from './cards.js';
import { pushEvent, aliveList } from '../../match.js';

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function drawCard(weights) {
  const w = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const ids = Object.keys(w).filter((k) => CARD_DEFS[k] && w[k] > 0);
  const total = ids.reduce((a, k) => a + w[k], 0);
  let r = Math.random() * total;
  for (const k of ids) { r -= w[k]; if (r < 0) return k; }
  return ids[ids.length - 1];
}

export const meta = {
  id: 'count-cards',
  name: 'COUNT CARDS',
  subtitle: '目標値を超えた者が撃たれる',
  minPlayers: 2,
  maxPlayers: 6,
  options: [
    { key: 'initHand', label: '初期手札枚数', type: 'number', min: 1, max: 12, default: 5 },
    { key: 'drawPerPlay', label: 'プレイするたびドロー', type: 'bool', default: false,
      note: 'ONの間は「脱落ごとに初期手札+1」は無効' },
    { key: 'targetMin', label: '目標値の最小', type: 'number', min: 5, max: 99, default: 15 },
    { key: 'targetMax', label: '目標値の最大', type: 'number', min: 5, max: 99, default: 30 },
  ],
  cards: Object.entries(CARD_DEFS).map(([id, d]) => ({ id, label: d.label })),
  rulesHtml: `
    <p>ラウンド開始時に<b>目標値</b>（設定範囲からランダム）が決まり、各自に手札が配られます。
    ランダムに選ばれたスタートプレイヤーから順に、手札を<b>必ず1枚</b>出します。</p>
    <ul>
      <li>数字カードは場の数字に足される。<b>場の数字が目標値を超えたら</b>出した人の負け。</li>
      <li>ターンを迎えた時に手札が無い／出せるカードが無い人も負け。</li>
      <li>敗者が決まったらラウンド終了 → ダメージ処理 → 手札を配り直して次のラウンド。</li>
      <li>生存者が1人減るたび、初期手札が1枚増える（「プレイするたびドロー」ON時は無効）。</li>
    </ul>
    <h3>数字カード</h3><p>1〜9、0、-1、-5</p>
    <h3>特殊カード</h3>
    <ul>
      <li><b>=0</b>：場の数字を0にする</li>
      <li><b>=MAX</b>：場の数字を目標値と同じにする</li>
      <li><b>REVERSE</b>：ターン順を逆にして次の人へ</li>
      <li><b>+2</b>：次の人は数字カード（またはSHIELD）しか出せず、出した数字に+2（-1なら1）</li>
      <li><b>SHOT</b>：好きな相手を1人選び、その人のターンにする</li>
      <li><b>DOUBLE</b>：次の人は2枚プレイ。1枚目でREVERSE／SHOTを出した場合、DOUBLEは移った先の人に適用</li>
      <li><b>RANDOM</b>：次の人は手札からランダムに1枚を強制プレイ（SHIELDを持っていれば優先して使われる）</li>
      <li><b>SHIELD</b>：自分にかかっている効果（+2・DOUBLE・RANDOM）を無効にし、次の人のターンへ</li>
    </ul>
    <h3>オプション：プレイするたびドロー</h3>
    <p>カードを出すたびにランダムなカードを1枚補充（DOUBLE時は2枚出してから2枚補充）。</p>`,
};

export function handSize(m) {
  const o = m.opts || {};
  return (o.initHand || 5) + (o.drawPerPlay ? 0 : m.deaths);
}

function nextUid(m, uid, dir) {
  const al = aliveList(m);
  const i = al.indexOf(uid);
  return al[(i + dir + al.length) % al.length];
}

export function legalIndices(m, uid) {
  const s = m.sub;
  if (!s || !s.turn || s.turn.uid !== uid) return [];
  const hand = s.hands[uid] || [];
  const out = [];
  hand.forEach((id, i) => {
    if (s.turn.plus2 && !(isNum(id) || id === 'shield')) return;
    out.push(i);
  });
  return out;
}

export function startRound(m) {
  const o = m.opts || {};
  let lo = Math.min(o.targetMin ?? 15, o.targetMax ?? 30);
  let hi = Math.max(o.targetMin ?? 15, o.targetMax ?? 30);
  const al = aliveList(m);
  const hs = handSize(m);
  const s = { target: rint(lo, hi), field: 0, dir: 1, hands: {}, pending: {}, pile: [], turn: null };
  al.forEach((u) => { s.hands[u] = Array.from({ length: hs }, () => drawCard(o.weights)); });
  m.sub = s;
  const start = pick(al);
  pushEvent(m, { t: 'cc_setup', target: s.target, hs, start, players: al });
  beginTurn(m, start);
}

function beginTurn(m, uid) {
  const s = m.sub;
  const p = s.pending || {};
  s.pending = {};
  s.turn = { uid, left: p.double ? 2 : 1, plus2: !!p.plus2, random: !!p.random, played: 0, dbl: !!p.double };
  pushEvent(m, { t: 'cc_turn', uid, plus2: !!p.plus2, double: !!p.double, random: !!p.random, dir: s.dir });
  checkTurn(m);
}

function checkTurn(m) {
  const s = m.sub; const t = s.turn;
  const hand = s.hands[t.uid] || [];
  if (!hand.length) return lose(m, t.uid, 'empty');
  const lg = legalIndices(m, t.uid);
  if (!lg.length) return lose(m, t.uid, 'noplay');
  if (t.random) {
    let idx = hand.indexOf('shield'); // RANDOM時はSHIELDが優先的に使われる
    if (idx < 0) idx = pick(lg);
    let target = null;
    if (hand[idx] === 'shot') target = pick(aliveList(m).filter((u) => u !== t.uid));
    doPlay(m, t.uid, idx, target, true);
  }
}

function lose(m, uid, reason) {
  const s = m.sub;
  m.loser = { uid, reason, text: loseReason({ reason, field: s.field, target: s.target }) };
  pushEvent(m, { t: 'cc_lose', uid, reason, field: s.field, target: s.target });
}

function refill(m, uid, n) {
  if (!m.opts.drawPerPlay || n <= 0) return;
  const s = m.sub;
  for (let i = 0; i < n; i++) s.hands[uid].push(drawCard(m.opts.weights));
  pushEvent(m, { t: 'cc_draw', uid, n });
}

function doPlay(m, uid, idx, target, forced) {
  const s = m.sub; const t = s.turn;
  const id = s.hands[uid].splice(idx, 1)[0];
  const d = CARD_DEFS[id];
  t.played++;
  s.pile.push(id); if (s.pile.length > 14) s.pile.shift();
  const ev = { t: 'cc_play', uid, card: id, forced: !!forced };
  let pass = null;
  if (d.type === 'num') {
    let v = d.value;
    if (t.plus2) { v += 2; ev.plus2 = true; t.plus2 = false; }
    s.field += v; ev.value = v;
  } else {
    switch (id) {
      case 'eq0': s.field = 0; break;
      case 'eqmax': s.field = s.target; break;
      case 'reverse': s.dir *= -1; pass = nextUid(m, uid, s.dir); break;
      case 'shot': pass = target; ev.target = target; break;
      case 'shield': ev.cancelled = { plus2: t.plus2, double: t.left > 1, random: t.random };
        t.plus2 = false; t.random = false; pass = nextUid(m, uid, s.dir); break;
      case 'plus2': s.pending.plus2 = true; break;
      case 'double': s.pending.double = true; break;
      case 'random': s.pending.random = true; break;
    }
  }
  ev.field = s.field; ev.dir = s.dir; ev.left = s.hands[uid].length;
  pushEvent(m, ev);
  if (s.field > s.target) return lose(m, uid, 'bust');
  t.left--;
  if (pass) {
    if (id !== 'shield' && t.left > 0) { // DOUBLEの1枚目でターンを移した → 効果は移った先へ
      s.pending.double = true;
      pushEvent(m, { t: 'cc_transfer', from: uid, to: pass });
    }
    refill(m, uid, t.played);
    return beginTurn(m, pass);
  }
  if (t.left > 0) return checkTurn(m);
  refill(m, uid, t.played);
  beginTurn(m, nextUid(m, uid, s.dir));
}

export function currentActor(m) {
  return m.phase === 'round' && m.sub && m.sub.turn ? m.sub.turn.uid : null;
}

export function applyAction(m, uid, a) {
  const s = m.sub;
  if (!s || !s.turn || s.turn.uid !== uid) throw new Error('not your turn');
  if (a.type !== 'play') throw new Error('bad action');
  const hand = s.hands[uid];
  if (hand[a.idx] !== a.card) throw new Error('stale');
  if (!legalIndices(m, uid).includes(a.idx)) throw new Error('illegal');
  let target = null;
  if (a.card === 'shot') {
    target = a.target;
    if (!target || target === uid || !m.alive[target]) throw new Error('bad target');
  }
  doPlay(m, uid, a.idx, target, false);
}

// --- CPU ---
export function cpuAction(m, uid) {
  const s = m.sub; const hand = s.hands[uid];
  const lg = legalIndices(m, uid);
  const room = s.target - s.field; // あといくつ足せるか
  const others = aliveList(m).filter((u) => u !== uid);
  let best = null; let bestScore = -1e9;
  for (const i of lg) {
    const id = hand[i]; const d = CARD_DEFS[id];
    let sc = Math.random() * 2;
    if (d.type === 'num') {
      const v = d.value + (s.turn.plus2 ? 2 : 0);
      if (v > room) sc -= 1000;
      else sc += 10 + v - (room - v < 3 ? 4 : 0);
    } else {
      const danger = room <= 4;
      switch (id) {
        case 'eq0': sc += danger ? 30 : 1; break;
        case 'eqmax': sc += room > 6 ? 14 : 3; break;
        case 'shield': sc += danger ? 24 : 0; break;
        case 'reverse': case 'shot': sc += danger ? 22 : 4; break;
        case 'plus2': sc += danger ? 18 : 6; break;
        case 'double': sc += danger ? 19 : 7; break;
        case 'random': sc += danger ? 17 : 6; break;
      }
    }
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  const card = hand[best];
  let target = null;
  if (card === 'shot') {
    // 手札が少ない相手を狙う
    target = others.slice().sort((a, b) => (s.hands[a].length - s.hands[b].length) || (Math.random() - 0.5))[0];
  }
  return { type: 'play', idx: best, card, target };
}

export function describeEvent(ev, name) {
  const L = (id) => CARD_DEFS[id]?.label ?? id;
  switch (ev.t) {
    case 'cc_setup': return `目標値 ${ev.target} ／ 手札 ${ev.hs}枚 ／ スタート: ${name(ev.start)}`;
    case 'cc_play': {
      let s = `${name(ev.uid)} ▶ ${L(ev.card)}`;
      if (ev.forced) s = `[RANDOM] ` + s;
      if (ev.plus2) s += ` (+2 → ${ev.value})`;
      if (ev.target) s += ` → ${name(ev.target)}`;
      return s + `　場: ${ev.field}`;
    }
    case 'cc_transfer': return `DOUBLEの効果が ${name(ev.to)} に移った`;
    case 'cc_draw': return `${name(ev.uid)} が ${ev.n}枚 補充`;
    case 'cc_lose': return `${name(ev.uid)} 敗北 — ${loseReason(ev)}`;
    default: return null;
  }
}

export function loseReason(ev) {
  if (ev.reason === 'bust') return `場の数字 ${ev.field} が目標値 ${ev.target} を超えた`;
  if (ev.reason === 'empty') return '手札が無いままターンを迎えた';
  if (ev.reason === 'noplay') return '出せるカードが無い';
  return '';
}

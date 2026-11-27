// INDIAN SUM : 自分のカードだけ見えない、合計値のブラフゲーム（コヨーテ準拠）
import { pushEvent, aliveList } from '../../match.js';

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// カード定義（日本語版コヨーテと同じ36枚構成）
export const CARD_DEFS = {
  n1: { type: 'num', value: 1, label: '1', count: 4 },
  n2: { type: 'num', value: 2, label: '2', count: 4 },
  n3: { type: 'num', value: 3, label: '3', count: 4 },
  n4: { type: 'num', value: 4, label: '4', count: 4 },
  n5: { type: 'num', value: 5, label: '5', count: 4 },
  n10: { type: 'num', value: 10, label: '10', count: 3 },
  n15: { type: 'num', value: 15, label: '15', count: 2 },
  n20: { type: 'num', value: 20, label: '20', count: 1 },
  n0: { type: 'num', value: 0, label: '0', count: 3 },
  nm5: { type: 'num', value: -5, label: '-5', count: 2 },
  nm10: { type: 'num', value: -10, label: '-10', count: 1 },
  night: { type: 'sp', value: 0, label: '夜 0', count: 1, desc: '0として数える。判定後、すべてのカードを山札に戻してシャッフルする。' },
  x2: { type: 'sp', value: 0, label: '×2', count: 1, desc: '他のカードの合計を、最後に2倍にする。' },
  max0: { type: 'sp', value: 0, label: 'MAX→0', count: 1, desc: '場で一番大きい数のカード1枚を0にする。' },
  q: { type: 'sp', value: 0, label: '?', count: 1, desc: '判定時に山札から1枚引き、そのカードとして扱う。' },
};
export const FULL_DECK = Object.entries(CARD_DEFS).flatMap(([id, d]) => Array(d.count).fill(id));

export const meta = {
  id: 'indian-sum',
  name: 'INDIAN SUM',
  subtitle: '自分の数字だけが見えない',
  minPlayers: 2,
  maxPlayers: 6,
  options: [],
  rulesHtml: `
    <p>全員がカードを1枚、おでこに掲げます。<b>自分のカードだけ見えず、他の人のカードは全部見えます。</b></p>
    <p>スタートプレイヤーから順に、「場の全カードの合計は○以上ある」と数字を宣言していきます。
    次の人は、<b>前の数字より大きい数を宣言する</b>か、「前の人の宣言は合計を超えている」と思ったら<b>ダウト！</b>します。</p>
    <ul>
      <li>ダウトされたら全カードを公開して合計を計算。宣言が合計を<b>超えていたら宣言した人の負け</b>、超えていなければ（ぴったりも含む）ダウトした人の負け。</li>
      <li>次のラウンドは敗者から開始。使ったカードは捨て札になり、山札がなくなったら捨て札をシャッフルして山札にします。</li>
    </ul>
    <h3>カード（36枚）</h3>
    <p>1〜5 各4枚 / 10×3 / 15×2 / 20×1 / 0×3 / −5×2 / −10×1 / 特殊カード各1枚</p>
    <ul>
      <li><b>？</b>：判定時に山札から1枚引き、そのカードとして扱う（最初に処理）</li>
      <li><b>MAX→0</b>：場で一番大きい数のカード1枚を0にする（？の後に処理）</li>
      <li><b>×2</b>：合計を最後に2倍にする</li>
      <li><b>夜 0</b>：0として数える。判定後、捨て札も含めた全カードを山札に戻してシャッフル</li>
    </ul>`,
};

function drawFrom(m) {
  const g = m.gs;
  if (!g.deck.length) { g.deck = shuffle(g.discard); g.discard = []; pushEvent(m, { t: 'in_reshuffle', why: 'empty' }); }
  return g.deck.pop();
}
function nextAlive(m, uid) {
  const n = m.seats.length; let i = m.seats.indexOf(uid);
  for (let k = 0; k < n; k++) { i = (i + 1) % n; if (m.alive[m.seats[i]]) return m.seats[i]; }
  return uid;
}

export function startRound(m) {
  if (!m.gs) m.gs = { deck: shuffle(FULL_DECK.slice()), discard: [], night: false };
  let reset = false;
  if (m.gs.night) { m.gs.deck = shuffle(FULL_DECK.slice()); m.gs.discard = []; m.gs.night = false; reset = true; }
  const al = aliveList(m);
  const cards = {};
  for (const u of al) cards[u] = drawFrom(m);
  let start;
  if (m.prevLoser && m.seats.includes(m.prevLoser)) start = m.alive[m.prevLoser] ? m.prevLoser : nextAlive(m, m.prevLoser);
  else start = pick(al);
  m.sub = { cards, bid: null, turn: { uid: start }, history: [] };
  pushEvent(m, { t: 'in_setup', players: al, start, reset, deckLeft: m.gs.deck.length });
  pushEvent(m, { t: 'in_turn', uid: start });
}

export function currentActor(m) {
  return m.phase === 'round' && m.sub?.turn ? m.sub.turn.uid : null;
}

export function minBid(m) { return m.sub.bid ? m.sub.bid.value + 1 : 1; }

export function applyAction(m, uid, a) {
  const s = m.sub;
  if (!s?.turn || s.turn.uid !== uid) throw new Error('not your turn');
  if (a.type === 'bid') {
    const v = Math.round(+a.value);
    if (!Number.isFinite(v) || v < minBid(m) || v > 999) throw new Error('bad bid');
    s.bid = { value: v, uid };
    s.history.push(s.bid);
    pushEvent(m, { t: 'in_bid', uid, value: v });
    s.turn = { uid: nextAlive(m, uid) };
    pushEvent(m, { t: 'in_turn', uid: s.turn.uid });
    return;
  }
  if (a.type === 'call') {
    if (!s.bid || s.bid.uid === uid) throw new Error('nothing to call');
    return resolve(m, uid);
  }
  throw new Error('bad action');
}

// 合計の計算（？→ MAX→0 → 合計 → ×2 の順）
export function computeTotal(cardList, qDraw) {
  const steps = [];
  let list = cardList.slice();
  if (list.includes('q')) {
    list = list.filter((c) => c !== 'q');
    if (qDraw) { list.push(qDraw); steps.push({ kind: 'q', card: qDraw }); }
  }
  const vals = list.map((c) => ({ c, v: CARD_DEFS[c].type === 'num' ? CARD_DEFS[c].value : 0 }));
  if (list.includes('max0')) {
    let best = -1;
    vals.forEach((x, i) => { if (CARD_DEFS[x.c].type === 'num' && x.v > 0 && (best < 0 || x.v > vals[best].v)) best = i; });
    if (best >= 0) { steps.push({ kind: 'max0', card: vals[best].c, from: vals[best].v }); vals[best].v = 0; }
    else steps.push({ kind: 'max0', card: null, from: 0 });
  }
  let sum = vals.reduce((a, x) => a + x.v, 0);
  steps.push({ kind: 'sum', value: sum });
  if (list.includes('x2')) { sum *= 2; steps.push({ kind: 'x2', value: sum }); }
  return { sum, steps, night: list.includes('night') };
}

function resolve(m, caller) {
  const s = m.sub, g = m.gs, b = s.bid;
  pushEvent(m, { t: 'in_call', uid: caller, target: b.uid, value: b.value });
  const al = aliveList(m);
  const list = al.map((u) => s.cards[u]);
  let qDraw = null;
  if (list.includes('q')) qDraw = drawFrom(m);
  const { sum, steps, night } = computeTotal(list, qDraw);
  const over = b.value > sum; // 宣言が合計を超えていたら宣言者の負け
  const loser = over ? b.uid : caller;
  // 使ったカードは捨て札へ
  g.discard.push(...list, ...(qDraw ? [qDraw] : []));
  if (night) g.night = true;
  pushEvent(m, { t: 'in_reveal', cards: { ...s.cards }, qDraw, steps, sum, bid: b.value, bidder: b.uid, caller, loser, night });
  m.loser = { uid: loser, reason: over ? 'over' : 'wrongcall',
    text: over ? `宣言 ${b.value} は合計 ${sum} を超えていた` : `合計は ${sum}。宣言 ${b.value} は超えていなかった` };
}

// --- CPU：見えているカードと捨て札から、モンテカルロで合計の分布を推定 ---
export function cpuAction(m, uid) {
  const s = m.sub, g = m.gs;
  const al = aliveList(m);
  const visible = al.filter((u) => u !== uid).map((u) => s.cards[u]);
  // 自分のカード候補 = 全36枚 − 見えているカード − 捨て札
  const pool = FULL_DECK.slice();
  const remove = (c) => { const i = pool.indexOf(c); if (i >= 0) pool.splice(i, 1); };
  visible.forEach(remove); (g.discard || []).forEach(remove);
  const sums = [];
  for (let k = 0; k < 300; k++) {
    const p = pool.slice();
    const mine = p.splice(Math.floor(Math.random() * p.length), 1)[0];
    const list = [...visible, mine];
    const qd = list.includes('q') ? p[Math.floor(Math.random() * p.length)] : null;
    sums.push(computeTotal(list, qd).sum);
  }
  sums.sort((a, b) => a - b);
  const pAtLeast = (v) => sums.filter((x) => x >= v).length / sums.length;
  const b = s.bid;
  if (b && b.uid !== uid && pAtLeast(b.value) < 0.38 + Math.random() * 0.12) return { type: 'call' };
  const lo = minBid(m);
  // 「この数以上ある」確率が55%以上の最大値
  let target = lo;
  for (let v = lo; v <= lo + 80; v++) { if (pAtLeast(v) >= 0.55) target = v; else break; }
  if (b && pAtLeast(lo) < 0.5) return { type: 'call' };
  const v = b ? Math.min(target, lo + Math.floor(Math.random() * 3)) : Math.max(1, target - Math.floor(Math.random() * 4));
  return { type: 'bid', value: Math.max(lo, v) };
}

export function describeEvent(ev, name) {
  const L = (c) => CARD_DEFS[c]?.label ?? c;
  switch (ev.t) {
    case 'in_setup': return `${ev.reset ? '山札リセット ／ ' : ''}山札残り ${ev.deckLeft}枚 ／ スタート: ${name(ev.start)}`;
    case 'in_bid': return `${name(ev.uid)}「${ev.value}」`;
    case 'in_call': return `${name(ev.uid)} ▶ ダウト！（${name(ev.target)} の ${ev.value}）`;
    case 'in_reveal': return `合計 ${ev.sum}${ev.qDraw ? `（?＝${L(ev.qDraw)}）` : ''} → ${name(ev.loser)} の負け${ev.night ? '　※夜：山札リセット' : ''}`;
    case 'in_reshuffle': return '山札切れ：捨て札をシャッフル';
    default: return null;
  }
}

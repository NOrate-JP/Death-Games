// LIAR'S DICE : ルール（純粋ロジック）
import { pushEvent, aliveList } from '../../match.js';

export const STAR = 6; // 出目6 = ★（1〜5どれとしても数える）
const roll = () => 1 + Math.floor(Math.random() * 6);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export const meta = {
  id: 'liar-dice',
  name: "LIAR'S DICE",
  subtitle: 'カップの中の嘘を見抜け',
  minPlayers: 2,
  maxPlayers: 6,
  options: [
    { key: 'initDice', label: '初期ダイス数', type: 'number', min: 1, max: 10, default: 5 },
    { key: 'diffPenalty', label: '差分ペナルティ', type: 'bool', default: true, note: 'OFFならペナルティは常に1回' },
    { key: 'starBid', label: '★の宣言', type: 'bool', default: true, note: '「★がn個」の宣言を許可' },
    { key: 'diceLoss', label: '敗北時ダイス減少', type: 'bool', default: true, note: 'ペナルティ回数ぶんダイスが減る' },
    { key: 'reroll', label: '振りなおしルール', type: 'bool', default: false, note: '宣言後、ダイスを公開して残りを振りなおせる' },
  ],
  rulesHtml: `
    <p>各プレイヤーはカップの中でダイスを振ります（出目は 1〜5 と ★）。自分のダイスだけが見えます。</p>
    <p>スタートプレイヤーから順に、<b>全員のダイスの中に「出目○が○個以上ある」</b>と宣言していきます。
    次の人は「レイズ（宣言をつり上げる）」か「ブラフ（前の宣言は嘘だと指摘）」を選びます。</p>
    <ul>
      <li>レイズ：個数を増やす（出目は自由）か、個数そのままで出目を大きくする。</li>
      <li>ブラフ：全員のダイスを公開。宣言された出目の数＋<b>★の数</b>を数える（★は何の出目にもなる）。</li>
      <li>実際の数が宣言に届かなければ宣言した人の負け、届いていればブラフを宣言した人の負け。</li>
      <li>ペナルティ回数＝宣言と実際の差（ちょうどだった場合は1回）。その回数だけ引き金を引く。</li>
    </ul>
    <h3>★の宣言</h3>
    <p>「★がn個」は「1〜5が(2n−1)個」のすぐ上の強さ。<br>例：★4個 → 1〜5が8個 → 1〜5が9個 → ★5個 → 1〜5が10個。★の宣言は★だけを数えます。</p>
    <h3>振りなおしルール</h3>
    <p>宣言（レイズ）と同時に、手元のダイスを1個以上公開し、残りの非公開ダイスを全部振りなおせます。
    非公開が1個しかない時は不可。公開したダイスは戻せず、判定に含まれます。</p>
    <h3>その他</h3>
    <p>次のラウンドは前のラウンドの敗者から始まります（死亡していればその次の人）。</p>`,
};

export const bidScore = (b) => (b.face === STAR ? (2 * b.count - 1) * 10 + 6 : b.count * 10 + b.face);
export const bidText = (b) => (b ? `${b.face === STAR ? '★' : b.face} が ${b.count}個以上` : '');

export function totalDice(m) {
  const s = m.sub; if (!s) return 0;
  return aliveList(m).reduce((a, u) => a + (s.dice[u] || []).length, 0);
}
export const maxCount = (m) => Math.max(1, totalDice(m));

export function isLegalBid(m, face, count) {
  const s = m.sub;
  if (!(face >= 1 && face <= 6) || !Number.isInteger(count)) return false;
  if (face === STAR && !m.opts.starBid) return false;
  if (count < 1 || count > maxCount(m)) return false;
  return !s.bid || bidScore({ face, count }) > bidScore(s.bid);
}
export function minRaise(m, face) {
  for (let c = 1; c <= maxCount(m); c++) if (isLegalBid(m, face, c)) return c;
  return null;
}
export const faces = (m) => (m.opts.starBid ? [1, 2, 3, 4, 5, STAR] : [1, 2, 3, 4, 5]);
export const canRaise = (m) => faces(m).some((f) => minRaise(m, f) !== null);

function nextAlive(m, uid) {
  const n = m.seats.length; let i = m.seats.indexOf(uid);
  for (let k = 0; k < n; k++) { i = (i + 1) % n; if (m.alive[m.seats[i]]) return m.seats[i]; }
  return uid;
}

export function startRound(m) {
  const o = m.opts;
  if (!m.gs) m.gs = { dice: {} };
  for (const u of m.seats) if (m.gs.dice[u] == null) m.gs.dice[u] = o.initDice ?? 5;
  const al = aliveList(m);
  const s = { dice: {}, shown: {}, bid: null, turn: null, history: [] };
  const counts = {};
  for (const u of al) {
    const n = m.gs.dice[u];
    s.dice[u] = Array.from({ length: n }, roll);
    s.shown[u] = Array(n).fill(false);
    counts[u] = n;
  }
  m.sub = s;
  let start;
  if (m.prevLoser && m.seats.includes(m.prevLoser)) start = m.alive[m.prevLoser] ? m.prevLoser : nextAlive(m, m.prevLoser);
  else start = pick(al);
  pushEvent(m, { t: 'ld_setup', start, counts, total: totalDice(m), players: al });
  beginTurn(m, start);
}

function beginTurn(m, uid) {
  m.sub.turn = { uid };
  pushEvent(m, { t: 'ld_turn', uid, mustCall: !!m.sub.bid && !canRaise(m) });
}

export function currentActor(m) {
  return m.phase === 'round' && m.sub?.turn ? m.sub.turn.uid : null;
}

export function hiddenIdx(m, uid) {
  const sh = m.sub.shown[uid] || [];
  return sh.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
}
export const canReroll = (m, uid) => !!m.opts.reroll && hiddenIdx(m, uid).length >= 2;

export function applyAction(m, uid, a) {
  const s = m.sub;
  if (!s || !s.turn || s.turn.uid !== uid) throw new Error('not your turn');
  if (a.type === 'bid') {
    const face = +a.face, count = +a.count;
    if (!isLegalBid(m, face, count)) throw new Error('illegal bid');
    let revealFaces = [], rerolled = 0;
    if (a.reveal && a.reveal.length) {
      if (!canReroll(m, uid)) throw new Error('no reroll');
      const hid = hiddenIdx(m, uid);
      const rv = [...new Set(a.reveal.map(Number))];
      if (!rv.every((i) => hid.includes(i)) || rv.length < 1 || hid.length - rv.length < 1) throw new Error('bad reveal');
      rv.forEach((i) => { s.shown[uid][i] = true; revealFaces.push(s.dice[uid][i]); });
      s.dice[uid] = s.dice[uid].map((d, i) => (s.shown[uid][i] ? d : roll()));
      rerolled = hid.length - rv.length;
    }
    s.bid = { face, count, uid };
    s.history.push(s.bid);
    pushEvent(m, { t: 'ld_bid', uid, face, count, revealFaces, rerolled, shown: s.shown[uid].slice(), shownDice: s.dice[uid].map((d, i) => (s.shown[uid][i] ? d : 0)) });
    return beginTurn(m, nextAlive(m, uid));
  }
  if (a.type === 'call') {
    if (!s.bid || s.bid.uid === uid) throw new Error('nothing to call');
    return resolve(m, uid);
  }
  throw new Error('bad action');
}

function resolve(m, caller) {
  const s = m.sub, b = s.bid, o = m.opts;
  pushEvent(m, { t: 'ld_call', uid: caller, target: b.uid, bid: { ...b } });
  let actual = 0;
  for (const u of aliveList(m)) for (const d of s.dice[u]) {
    if (b.face === STAR ? d === STAR : (d === b.face || d === STAR)) actual++;
  }
  const bidderWrong = actual < b.count;
  const loser = bidderWrong ? b.uid : caller;
  const diff = Math.abs(b.count - actual);
  const pen = o.diffPenalty ? Math.max(1, diff) : 1;
  if (o.diceLoss) m.gs.dice[loser] = Math.max(0, m.gs.dice[loser] - pen);
  const text = bidderWrong
    ? `宣言「${bidText(b)}」→ 実際は ${actual}個。宣言者のウソ！`
    : `宣言「${bidText(b)}」→ 実際は ${actual}個。宣言は本当だった！`;
  pushEvent(m, { t: 'ld_reveal', caller, bidder: b.uid, bid: { ...b }, dice: s.dice, actual, loser, pen, diceAfter: m.gs.dice[loser], diceLoss: !!o.diceLoss });
  m.loser = { uid: loser, reason: bidderWrong ? 'lie' : 'wrongcall', text: `${text}　ペナルティ ${pen}回`, times: pen };
}

// --- CPU ---
export function cpuAction(m, uid) {
  const s = m.sub, mine = s.dice[uid] || [];
  const total = totalDice(m);
  let known = mine.length, knownDice = [...mine];
  for (const u of aliveList(m)) if (u !== uid) s.dice[u].forEach((d, i) => { if (s.shown[u][i]) { known++; knownDice.push(d); } });
  const unknown = total - known;
  const expect = (f) => knownDice.filter((d) => (f === STAR ? d === STAR : d === f || d === STAR)).length + unknown * (f === STAR ? 1 / 6 : 2 / 6);
  const b = s.bid;
  const canCall = b && b.uid !== uid;
  if (canCall && !canRaise(m)) return { type: 'call' };
  if (canCall) {
    const e = expect(b.face);
    if (b.count > e + 0.6 + Math.random() * 1.2) return { type: 'call' };
  }
  let best = null, bestSc = -1e9;
  for (const f of faces(m)) {
    const c = minRaise(m, f); if (c === null) continue;
    const sc = expect(f) - c + Math.random() * 0.6 + (f === STAR ? -0.3 : 0);
    if (sc > bestSc) { bestSc = sc; best = { f, c }; }
  }
  if (!best) return { type: 'call' };
  if (canCall && bestSc < -1.2 && Math.random() < 0.75) return { type: 'call' };
  let count = best.c;
  if (!b) count = Math.max(1, Math.min(maxCount(m), Math.floor(expect(best.f) * (0.55 + Math.random() * 0.3))));
  return { type: 'bid', face: best.f, count };
}

export function describeEvent(ev, name) {
  switch (ev.t) {
    case 'ld_setup': return `ダイス合計 ${ev.total}個 ／ スタート: ${name(ev.start)}`;
    case 'ld_bid': return `${name(ev.uid)}「${bidText(ev)}」${ev.revealFaces?.length ? `（${ev.revealFaces.map((d) => (d === STAR ? '★' : d)).join(',')} を公開して${ev.rerolled}個振りなおし）` : ''}`;
    case 'ld_call': return `${name(ev.uid)} ▶ BLUFF!（${name(ev.target)} へ）`;
    case 'ld_reveal': return `判定：実際 ${ev.actual}個 → ${name(ev.loser)} の負け（ペナルティ${ev.pen}）${ev.diceLoss ? ` ダイス残り${ev.diceAfter}` : ''}`;
    default: return null;
  }
}

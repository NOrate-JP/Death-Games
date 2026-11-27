// RUSSIAN DECK : DEADを引いたら終わり（こねこばくはつベース）
import { pushEvent, aliveList, now } from '../../match.js';

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export const WINDOW_MS = 3000;   // CANCEL の受付時間
export const REVEAL_MS = 1200;   // カード公開の演出ぶん、受付開始を遅らせる

const MATCH_DESC = '同じ文字の2枚（またはMATCH Xと組み合わせ）でプレイすると、他のプレイヤー1人からランダムに1枚奪う。1枚だけでは効果なし。';
export const CARD_DEFS = {
  dead: { label: 'DEAD', dark: true, desc: '引いた瞬間に全員に公開。REVIVEが無ければ敗者。' },
  odead: { label: 'OPEN DEAD', dark: true, desc: '最初に引いた時は助かり、山札の好きな位置へ（位置は全員に公開）。公開状態のこれを引いたら即敗者（REVIVE・CANCEL無効）。' },
  revive: { label: 'REVIVE', desc: 'DEADを引いた時に自動で使用。DEADを無効化し、山札の好きな位置に（秘密で）戻す。その後ターン終了。' },
  attack: { label: 'ATTACK 2', count: 4, desc: 'カードを引かずにターン終了。次のプレイヤーは2ターン連続で行う（ATTACKを受けている時に使うと「残りターン＋2」を押し付ける）。' },
  sniper: { label: 'SNIPER 2', count: 3, desc: 'プレイヤーを1人指名し、カードを引かずにターン終了。指名された人が連続2ターン行う（ATTACKと同様に蓄積する）。' },
  give: { label: 'GIVE', count: 4, desc: '他のプレイヤーを1人指名。その人は手札から1枚を選んであなたに渡す。' },
  cancel: { label: 'CANCEL', count: 5, desc: '他の人がカードをプレイした時、3秒以内に使える。その効果を無効化する（CANCELへのCANCELも可）。' },
  shuffle: { label: 'SHUFFLE', count: 4, desc: '山札をシャッフルする。' },
  skip: { label: 'SKIP', count: 4, desc: 'カードを引かずにターンを終了する（ATTACK中なら1ターン分だけ終了）。' },
  reverse: { label: 'REVERSE', count: 4, desc: 'ターン順を逆にして、カードを引かずにターンを終了する（ATTACK中なら1ターン分だけ終了）。' },
  bottom: { label: 'BOTTOM', count: 4, desc: '山札の一番下からカードを引いて、ターンを終了する。' },
  search: { label: 'SEARCH 3', count: 5, desc: '山札の上から3枚を自分だけ確認する（順番は変えない）。' },
  change: { label: 'CHANGE 3', count: 4, desc: '山札の上から3枚を見て、好きな順番に並べ替えて戻す（公開中のOPEN DEADも裏向きに戻る）。' },
  ma: { label: 'MATCH A', count: 4, desc: MATCH_DESC },
  mb: { label: 'MATCH B', count: 4, desc: MATCH_DESC },
  mc: { label: 'MATCH C', count: 4, desc: MATCH_DESC },
  md: { label: 'MATCH D', count: 4, desc: MATCH_DESC },
  me: { label: 'MATCH E', count: 4, desc: MATCH_DESC },
  mx: { label: 'MATCH X', count: 4, desc: '任意のMATCHカードの代わりとして使える（X2枚でもOK）。1枚だけでは効果なし。' },
};
export const isMatch = (c) => /^m[a-ex]$/.test(c);
export const isPair = (a, b) => isMatch(a) && isMatch(b) && (a === b || a === 'mx' || b === 'mx');
const LETHAL = new Set(['dead', 'odead']);
const DECK_CARDS = Object.entries(CARD_DEFS).filter(([, d]) => d.count).map(([id, d]) => ({ id, label: d.label, count: d.count }));

export const meta = {
  id: 'russian-deck',
  name: 'RUSSIAN DECK',
  subtitle: 'ドクロを引いたら、おしまい',
  minPlayers: 2,
  maxPlayers: 6,
  options: [
    { key: 'deadMode', label: 'DEADの枚数', type: 'select', default: 'players',
      choices: [{ value: 'players', label: '人数' }, { value: 'half', label: '人数÷2' }, { value: 'fixed', label: '固定' }],
      note: '人数＝そのラウンドの参加人数（÷2は切り上げ）' },
    { key: 'deadFixed', label: 'DEADの枚数（固定）', type: 'number', min: 0, max: 10, default: 3, showIf: (o) => o.deadMode === 'fixed' },
    { key: 'openDead', label: 'OPEN DEAD', type: 'select', default: 'swap',
      choices: [{ value: 'on', label: 'ON' }, { value: 'swap', label: 'DEADと交換' }, { value: 'off', label: 'OFF' }],
      note: 'ON：1枚追加 ／ 交換：DEADを1枚減らして代わりに入れる' },
  ],
  cardsMode: 'count',
  cards: DECK_CARDS,
  cardsNote: 'DEAD・OPEN DEAD・REVIVEは上のオプションと人数で決まる',
  rulesHtml: `
    <p>手番では「カードを好きなだけプレイ（またはパス）」→「山札から1枚ドロー」でターン終了。<b>DEAD</b> を引いて <b>REVIVE</b> が無ければ敗者です。</p>
    <h3>準備（毎ラウンド）</h3>
    <ul>
      <li>全員に REVIVE を1枚。余りの REVIVE を山札へ（2〜3人なら2枚だけ。REVIVEは全部で6枚）</li>
      <li>シャッフルして全員に7枚（手札8枚）</li>
      <li>DEAD（とOPEN DEAD）を入れてシャッフル（枚数はオプション）</li>
    </ul>
    <h3>カード</h3>
    <ul>${Object.entries(CARD_DEFS).filter(([k]) => !/^m[b-e]$/.test(k)).map(([k, d]) => `<li><b>${k === 'ma' ? 'MATCH A〜E' : d.label}</b>：${d.desc}</li>`).join('')}</ul>
    <h3>CANCEL</h3>
    <p>カードがプレイされるたびに3秒のバーが出ます。その間に CANCEL ボタンを押すと無効化できます（自分のプレイには使えないが、自分のプレイへのCANCELにはCANCELし返せる）。CANCELされると、そこからまた3秒。</p>`,
};

function nextAlive(m, uid, dir = 1) {
  const n = m.seats.length; let i = m.seats.indexOf(uid);
  for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (m.alive[m.seats[i]]) return m.seats[i]; }
  return uid;
}
export const deadsInDeck = (s) => s.deck.filter((c) => c === 'dead').length;
export const openDeadPos = (s) => (s.odOpen ? s.deck.indexOf('odead') : -1); // 公開中のOPEN DEADの位置（上から0始まり）

export function deadCount(m, n) {
  const o = m.opts || {};
  if (o.deadMode === 'half') return Math.ceil(n / 2);
  if (o.deadMode === 'fixed') return Math.max(0, Math.min(10, o.deadFixed ?? 3));
  return n; // 既定：人数
}

export function startRound(m) {
  const al = aliveList(m), n = al.length, o = m.opts || {};
  const base = [];
  for (const c of DECK_CARDS) for (let i = 0; i < Math.max(0, Math.min(30, o.counts?.[c.id] ?? c.count)); i++) base.push(c.id);
  const extraRevive = n <= 3 ? 2 : Math.max(0, 6 - n);
  const deck = shuffle([...base, ...Array(extraRevive).fill('revive')]);
  const hands = {};
  for (const u of al) hands[u] = ['revive'];
  for (let k = 0; k < 7; k++) for (const u of al) if (deck.length) hands[u].push(deck.pop());
  let deads = deadCount(m, n);
  const od = o.openDead ?? 'swap';
  let odead = 0;
  if (od === 'on') odead = 1;
  if (od === 'swap') { odead = 1; deads = Math.max(0, deads - 1); }
  for (let i = 0; i < deads; i++) deck.push('dead');
  if (odead) deck.push('odead');
  shuffle(deck);
  m.sub = { deck, discard: [], hands, dir: 1, odOpen: false, turn: null, turnNo: 0, phase: 'act', react: null, give: null, revive: null, oplace: null, change: null, peek: {} };
  let start;
  if (m.prevLoser && m.seats.includes(m.prevLoser)) start = m.alive[m.prevLoser] ? m.prevLoser : nextAlive(m, m.prevLoser);
  else start = pick(al);
  pushEvent(m, { t: 'rd_setup', players: al, start, deads, odead, extraRevive, deck: deck.length });
  beginTurn(m, start, 1, false);
}

function beginTurn(m, uid, left, attacked) {
  const s = m.sub;
  s.turnNo += 1;
  s.turn = { uid, left, attacked, no: s.turnNo, plays: 0 };
  s.phase = 'act';
  pushEvent(m, { t: 'rd_turn', uid, left, attacked, dir: s.dir });
}
function endTurnOne(m) {
  const s = m.sub, t = s.turn;
  if (t.left > 1) beginTurn(m, t.uid, t.left - 1, t.attacked);
  else beginTurn(m, nextAlive(m, t.uid, s.dir), 1, false);
}

export function currentActor(m) {
  const s = m.sub;
  if (m.phase !== 'round' || !s) return null;
  if (s.phase === 'act') return s.turn.uid;
  if (s.phase === 'give') return s.give.to;
  if (s.phase === 'revive') return s.revive.uid;
  if (s.phase === 'oplace') return s.oplace.uid;
  if (s.phase === 'change') return s.change.uid;
  return null; // CANCEL受付中は全員同時
}

export const canCancel = (m, uid) => {
  const s = m.sub, r = s?.react;
  if (!r || s.phase !== 'react' || !m.alive[uid]) return false;
  if (!(s.hands[uid] || []).includes('cancel')) return false;
  return r.chain[r.chain.length - 1].uid !== uid; // 最後に出したのが自分ならCANCEL不可
};

function openWindow(m, delay) {
  const s = m.sub, r = s.react;
  r.start = now() + delay;
  r.deadline = r.start + WINDOW_MS;
  r.plan = {};
  const by = r.chain[0].uid;
  const effective = (r.chain.length - 1) % 2 === 0;
  for (const u of aliveList(m)) {
    if (!m.cpu[u] || !canCancel(m, u)) continue;
    let want = 0.05;
    const hurts = (r.kind === 'give' || r.kind === 'match' || r.kind === 'sniper') ? r.target === u
      : r.kind === 'attack' ? nextAlive(m, by, s.dir) === u : false;
    if (effective && hurts) want = 0.7;
    if (!effective && u === by) want = 0.6;
    if (Math.random() < want) r.plan[u] = { at: r.start + rint(400, 2300), done: false };
  }
}

// ドロー（上から／下から）
function drawCard(m, uid, fromBottom) {
  const s = m.sub, h = s.hands[uid];
  const card = fromBottom ? s.deck.pop() : s.deck.shift();
  if (card === 'odead') {
    if (s.odOpen) { // 公開中を引いたら即敗者（REVIVE・CANCEL無効）
      pushEvent(m, { t: 'rd_odead', uid, open: true, bottom: !!fromBottom });
      s.phase = 'over';
      m.loser = { uid, reason: 'odead', text: '公開されたOPEN DEADを引いた' };
      return;
    }
    pushEvent(m, { t: 'rd_odead', uid, open: false, bottom: !!fromBottom });
    s.phase = 'oplace'; s.oplace = { uid };
    return;
  }
  if (card === 'dead') {
    const has = h.indexOf('revive');
    pushEvent(m, { t: 'rd_dead', uid, revived: has >= 0, bottom: !!fromBottom });
    if (has >= 0) {
      h.splice(has, 1); s.discard.push('revive');
      s.phase = 'revive'; s.revive = { uid };
      pushEvent(m, { t: 'rd_revive', uid, deck: s.deck.length });
      return;
    }
    s.phase = 'over';
    m.loser = { uid, reason: 'dead', text: 'DEADを引いた（REVIVEなし）' };
    return;
  }
  h.push(card);
  pushEvent(m, { t: 'rd_draw', uid, deck: s.deck.length, left: h.length, bottom: !!fromBottom });
  endTurnOne(m);
}

export function applyAction(m, uid, a) {
  const s = m.sub;
  if (!s) throw new Error('no round');
  if (a.type === 'cancel') {
    if (!canCancel(m, uid) || now() > s.react.deadline) throw new Error('cannot cancel');
    const h = s.hands[uid]; h.splice(h.indexOf('cancel'), 1); s.discard.push('cancel');
    s.react.chain.push({ uid, card: 'cancel' });
    const effective = (s.react.chain.length - 1) % 2 === 0;
    pushEvent(m, { t: 'rd_cancel', uid, n: s.react.chain.length - 1, effective, left: h.length });
    openWindow(m, 1100);
    pushEvent(m, { t: 'rd_window', start: s.react.start, deadline: s.react.deadline });
    return;
  }
  if (a.type === 'resolve') {
    if (s.phase !== 'react' || now() < s.react.deadline) throw new Error('not yet');
    return resolve(m);
  }
  if (a.type === 'give') {
    if (s.phase !== 'give' || s.give.to !== uid) throw new Error('not giving');
    const h = s.hands[uid];
    if (!(a.idx >= 0 && a.idx < h.length)) throw new Error('bad card');
    const card = h.splice(a.idx, 1)[0];
    s.hands[s.give.from].push(card);
    pushEvent(m, { t: 'rd_given', from: uid, to: s.give.from, card });
    s.give = null; s.phase = 'act';
    return;
  }
  if (a.type === 'place') { // REVIVE後のDEAD（位置は秘密）
    if (s.phase !== 'revive' || s.revive.uid !== uid) throw new Error('not placing');
    const pos = Math.max(0, Math.min(s.deck.length, Math.round(+a.pos)));
    s.deck.splice(pos, 0, 'dead');
    s.revive = null;
    pushEvent(m, { t: 'rd_placed', uid, deck: s.deck.length });
    return endTurnOne(m);
  }
  if (a.type === 'oplace') { // OPEN DEAD（位置は全員に公開）
    if (s.phase !== 'oplace' || s.oplace.uid !== uid) throw new Error('not placing');
    const pos = Math.max(0, Math.min(s.deck.length, Math.round(+a.pos)));
    s.deck.splice(pos, 0, 'odead');
    s.odOpen = true; s.oplace = null;
    pushEvent(m, { t: 'rd_oplaced', uid, pos, deck: s.deck.length });
    return endTurnOne(m);
  }
  if (a.type === 'reorder') { // CHANGE 3
    if (s.phase !== 'change' || s.change.uid !== uid) throw new Error('not changing');
    const k = s.change.cards.length;
    const order = (a.order || []).map(Number);
    if (order.length !== k || new Set(order).size !== k || order.some((i) => !(i >= 0 && i < k))) throw new Error('bad order');
    const top = order.map((i) => s.change.cards[i]);
    s.deck.splice(0, k, ...top);
    if (top.includes('odead')) s.odOpen = false; // 裏向きで戻す
    s.change = null; s.phase = 'act';
    pushEvent(m, { t: 'rd_changed', uid, hidOpen: top.includes('odead') });
    return;
  }
  // ここから手番プレイヤーの行動
  if (s.phase !== 'act' || s.turn.uid !== uid) throw new Error('not your turn');
  const h = s.hands[uid];
  if (a.type === 'draw') return drawCard(m, uid, false);
  if (a.type === 'play') {
    const idx = [...new Set((a.idx || []).map(Number))];
    if (!idx.length || idx.length > 2 || idx.some((i) => !(i >= 0 && i < h.length))) throw new Error('bad cards');
    const cards = idx.map((i) => h[i]);
    if (cards.some((c) => LETHAL.has(c) || c === 'revive' || c === 'cancel')) throw new Error('cannot play');
    let kind;
    if (cards.length === 2) {
      if (!isPair(cards[0], cards[1])) throw new Error('not a pair');
      kind = 'match';
    } else kind = isMatch(cards[0]) ? 'single' : cards[0];
    let target = null;
    if (kind === 'give' || kind === 'match' || kind === 'sniper') {
      target = a.target;
      if (!target || target === uid || !m.alive[target]) throw new Error('bad target');
    }
    idx.sort((x, y) => y - x).forEach((i) => h.splice(i, 1));
    s.discard.push(...cards);
    s.turn.plays += 1;
    pushEvent(m, { t: 'rd_play', uid, cards, kind, target, left: h.length });
    if (kind === 'single') return; // 1枚のMATCHは効果なし
    s.phase = 'react';
    s.react = { kind, target, chain: [{ uid, card: cards[0] }] };
    openWindow(m, REVEAL_MS);
    pushEvent(m, { t: 'rd_window', start: s.react.start, deadline: s.react.deadline });
    return;
  }
  throw new Error('bad action');
}

function resolve(m) {
  const s = m.sub, r = s.react, t = s.turn;
  const effective = (r.chain.length - 1) % 2 === 0;
  const by = r.chain[0].uid;
  s.react = null; s.phase = 'act';
  pushEvent(m, { t: 'rd_resolve', kind: r.kind, effective, uid: by, target: r.target });
  if (!effective) return;
  const pushTurns = (to) => { // ATTACK / SNIPER：ターン数の蓄積
    const turns = t.attacked ? t.left + 2 : 2;
    pushEvent(m, { t: 'rd_attack', from: by, to, turns, sniper: r.kind === 'sniper' });
    beginTurn(m, to, turns, true);
  };
  switch (r.kind) {
    case 'attack': return pushTurns(nextAlive(m, by, s.dir));
    case 'sniper': return pushTurns(r.target);
    case 'skip': pushEvent(m, { t: 'rd_skip', uid: by }); return endTurnOne(m);
    case 'reverse': s.dir *= -1; pushEvent(m, { t: 'rd_reverse', uid: by, dir: s.dir }); return endTurnOne(m);
    case 'bottom': return drawCard(m, by, true);
    case 'shuffle': shuffle(s.deck); pushEvent(m, { t: 'rd_shuffle', uid: by }); return;
    case 'search': s.peek[by] = { no: t.no, cards: s.deck.slice(0, 3) }; pushEvent(m, { t: 'rd_search', uid: by }); return;
    case 'change': {
      const cards = s.deck.slice(0, 3);
      if (!cards.length) return;
      s.phase = 'change'; s.change = { uid: by, cards };
      pushEvent(m, { t: 'rd_change', uid: by });
      return;
    }
    case 'give': {
      if (!(s.hands[r.target] || []).length) { pushEvent(m, { t: 'rd_give_none', from: by, to: r.target }); return; }
      s.phase = 'give'; s.give = { from: by, to: r.target };
      pushEvent(m, { t: 'rd_give_wait', from: by, to: r.target });
      return;
    }
    case 'match': {
      const th = s.hands[r.target] || [];
      if (!th.length) { pushEvent(m, { t: 'rd_steal', from: r.target, to: by, card: null }); return; }
      const card = th.splice(Math.floor(Math.random() * th.length), 1)[0];
      s.hands[by].push(card);
      pushEvent(m, { t: 'rd_steal', from: r.target, to: by, card });
      return;
    }
  }
}

// ---- 自動行動（ホスト役）：CPUのCANCEL・受付終了 ----
export function pendingAuto(m, t) {
  const s = m.sub, out = { due: [], nextAt: null };
  if (m.phase !== 'round' || s?.phase !== 'react') return out;
  const r = s.react;
  const consider = (at) => { if (out.nextAt === null || at < out.nextAt) out.nextAt = at; };
  for (const [u, p] of Object.entries(r.plan || {})) {
    if (p.done) continue;
    if (t >= p.at) { out.due.push({ uid: u, action: { type: 'cancel' }, planKey: u }); return out; }
    consider(p.at);
  }
  if (t >= r.deadline) out.due.push({ uid: null, action: { type: 'resolve' } });
  else consider(r.deadline);
  return out;
}
export function applyAuto(m, d) {
  if (d.planKey && m.sub?.react?.plan?.[d.planKey]) m.sub.react.plan[d.planKey].done = true;
}

// ---- CPU ----
const GIVE_ORDER = ['ma', 'mb', 'mc', 'md', 'me', 'shuffle', 'search', 'bottom', 'give', 'change', 'mx', 'reverse', 'skip', 'sniper', 'attack', 'cancel', 'revive'];
const ESCAPES = ['skip', 'reverse', 'attack', 'sniper'];
export function cpuAction(m, uid) {
  const s = m.sub, h = s.hands[uid] || [];
  if (s.phase === 'give') {
    const order = h.map((c, i) => ({ c, i })).sort((a, b) => GIVE_ORDER.indexOf(a.c) - GIVE_ORDER.indexOf(b.c) + (Math.random() - 0.5) * 2);
    return { type: 'give', idx: order[0].i };
  }
  if (s.phase === 'revive' || s.phase === 'oplace') {
    const r = Math.random();
    return { type: s.phase === 'revive' ? 'place' : 'oplace', pos: r < 0.35 ? 0 : r < 0.55 ? 1 : rint(0, s.deck.length) };
  }
  if (s.phase === 'change') { // 危ないカードを下へ
    const idx = s.change.cards.map((c, i) => ({ c, i })).sort((a, b) => (LETHAL.has(a.c) ? 1 : 0) - (LETHAL.has(b.c) ? 1 : 0)).map((x) => x.i);
    return { type: 'reorder', order: idx };
  }
  const t = s.turn;
  const others = aliveList(m).filter((u) => u !== uid);
  const richest = others.slice().sort((a, b) => (s.hands[b] || []).length - (s.hands[a] || []).length)[0];
  const lethal = deadsInDeck(s) + (s.deck.includes('odead') ? 1 : 0);
  const risk = lethal / Math.max(1, s.deck.length);
  const peek = s.peek[uid]?.no === t.no ? s.peek[uid].cards : null;
  const odp = openDeadPos(s);
  const topOpenDead = odp === 0;
  const knownDead = topOpenDead || (peek && LETHAL.has(peek[0]));
  const knownSafe = !knownDead && peek && !LETHAL.has(peek[0]);
  const has = (c) => h.indexOf(c);
  if (t.plays < 4) {
    if (knownDead || (!knownSafe && risk > 0.28 && !h.includes('revive'))) {
      for (const c of ESCAPES) {
        if (has(c) < 0) continue;
        if (c === 'sniper') return { type: 'play', idx: [has(c)], target: pick(others) };
        return { type: 'play', idx: [has(c)] };
      }
      if (has('bottom') >= 0 && odp !== s.deck.length - 1) return { type: 'play', idx: [has('bottom')] };
      if (has('change') >= 0) return { type: 'play', idx: [has('change')] };
      if (has('shuffle') >= 0) return { type: 'play', idx: [has('shuffle')] };
    }
    if (!peek && has('search') >= 0 && risk > 0.1 && Math.random() < 0.5) return { type: 'play', idx: [has('search')] };
    if (richest && (s.hands[richest] || []).length && Math.random() < 0.35) {
      for (let i = 0; i < h.length; i++) for (let j = i + 1; j < h.length; j++) if (isPair(h[i], h[j]) && (h[i] !== 'mx' || h[j] !== 'mx' || Math.random() < 0.3)) return { type: 'play', idx: [i, j], target: richest };
      if (has('give') >= 0) return { type: 'play', idx: [has('give')], target: richest };
    }
    if (!knownSafe && risk > 0.2 && has('attack') >= 0 && Math.random() < 0.3) return { type: 'play', idx: [has('attack')] };
  }
  return { type: 'draw' };
}

export function describeEvent(ev, name) {
  const L = (c) => CARD_DEFS[c]?.label ?? c;
  switch (ev.t) {
    case 'rd_setup': return `DEAD ${ev.deads}枚${ev.odead ? '＋OPEN DEAD' : ''} ／ 山札 ${ev.deck}枚 ／ スタート: ${name(ev.start)}`;
    case 'rd_play': return `${name(ev.uid)} ▶ ${ev.kind === 'match' ? `${ev.cards.map(L).join('＋')}` : L(ev.cards[0])}${ev.target ? ` → ${name(ev.target)}` : ''}${ev.kind === 'single' ? '（効果なし）' : ''}`;
    case 'rd_cancel': return `${name(ev.uid)} ▶ CANCEL！`;
    case 'rd_resolve': return ev.effective ? null : '→ 無効化された';
    case 'rd_attack': return `${name(ev.to)} は ${ev.turns}ターン連続`;
    case 'rd_skip': return `${name(ev.uid)} はターンをスキップ`;
    case 'rd_reverse': return 'ターン順が逆になった';
    case 'rd_shuffle': return '山札がシャッフルされた';
    case 'rd_search': return `${name(ev.uid)} が山札の上3枚を確認`;
    case 'rd_change': return `${name(ev.uid)} が山札の上3枚を並べ替えている`;
    case 'rd_changed': return `${name(ev.uid)} が並べ替えを終えた${ev.hidOpen ? '（OPEN DEADが裏向きに）' : ''}`;
    case 'rd_given': return `${name(ev.from)} が ${name(ev.to)} にカードを渡した`;
    case 'rd_give_none': return `${name(ev.to)} は手札がなかった`;
    case 'rd_steal': return ev.card ? `${name(ev.to)} が ${name(ev.from)} から1枚奪った` : `${name(ev.from)} は手札がなかった`;
    case 'rd_draw': return `${name(ev.uid)} が${ev.bottom ? '一番下から' : ''}ドロー（山札 ${ev.deck}枚）`;
    case 'rd_dead': return `${name(ev.uid)} が DEAD を引いた！${ev.revived ? ' → REVIVE' : ''}`;
    case 'rd_odead': return ev.open ? `${name(ev.uid)} が公開中の OPEN DEAD を引いた！` : `${name(ev.uid)} が OPEN DEAD を引いた（初回なのでセーフ）`;
    case 'rd_oplaced': return `OPEN DEAD は山札の上から ${ev.pos + 1}枚目へ（公開）`;
    case 'rd_placed': return `${name(ev.uid)} が DEAD を山札のどこかに戻した`;
    default: return null;
  }
}

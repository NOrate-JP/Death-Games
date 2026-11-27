// RUSSIAN DECK : DEADを引いたら終わり（こねこばくはつベース）
import { pushEvent, aliveList, now } from '../../match.js';

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export const WINDOW_MS = 3000;   // CANCEL の受付時間
export const REVEAL_MS = 1200;   // カード公開の演出ぶん、受付開始を遅らせる

export const CARD_DEFS = {
  dead: { label: 'DEAD', dark: true, desc: '引いた瞬間に全員に公開。REVIVEが無ければ敗者。' },
  revive: { label: 'REVIVE', desc: 'DEADを引いた時に自動で使用。DEADを無効化し、山札の好きな位置に（秘密で）戻す。その後ターン終了。' },
  attack: { label: 'ATTACK 2', desc: 'カードを引かずにターン終了。次のプレイヤーは2ターン連続で行う（ATTACKを受けている時に使うと「残りターン＋2」を押し付ける）。' },
  give: { label: 'GIVE', desc: '他のプレイヤーを1人指名。その人は手札から1枚を選んであなたに渡す。' },
  cancel: { label: 'CANCEL', desc: '他の人がカードをプレイした時、3秒以内に使える。その効果を無効化する（CANCELへのCANCELも可）。' },
  shuffle: { label: 'SHUFFLE', desc: '山札をシャッフルする。' },
  skip: { label: 'SKIP', desc: 'カードを引かずにターンを終了する（ATTACK中なら1ターン分だけ終了）。' },
  search: { label: 'SEARCH 3', desc: '山札の上から3枚を自分だけ確認する（順番は変えない）。' },
  ma: { label: 'MATCH A', desc: '同じ文字の2枚でプレイすると、他のプレイヤー1人からランダムに1枚奪う。1枚だけでは効果なし。' },
  mb: { label: 'MATCH B', desc: '同じ文字の2枚でプレイすると、他のプレイヤー1人からランダムに1枚奪う。1枚だけでは効果なし。' },
  mc: { label: 'MATCH C', desc: '同じ文字の2枚でプレイすると、他のプレイヤー1人からランダムに1枚奪う。1枚だけでは効果なし。' },
  md: { label: 'MATCH D', desc: '同じ文字の2枚でプレイすると、他のプレイヤー1人からランダムに1枚奪う。1枚だけでは効果なし。' },
  me: { label: 'MATCH E', desc: '同じ文字の2枚でプレイすると、他のプレイヤー1人からランダムに1枚奪う。1枚だけでは効果なし。' },
};
const BASE_COUNTS = { attack: 4, give: 4, cancel: 5, shuffle: 4, skip: 4, search: 5, ma: 4, mb: 4, mc: 4, md: 4, me: 4 };
export const isMatch = (c) => /^m[a-e]$/.test(c);
export const TARGETED = ['give', 'match'];

export const meta = {
  id: 'russian-deck',
  name: 'RUSSIAN DECK',
  subtitle: 'ドクロを引いたら、おしまい',
  minPlayers: 2,
  maxPlayers: 6,
  options: [],
  rulesHtml: `
    <p>手番では「カードを好きなだけプレイ（またはパス）」→「山札から1枚ドロー」でターン終了。<b>DEAD</b> を引いて <b>REVIVE</b> が無ければ敗者です。</p>
    <h3>準備（毎ラウンド）</h3>
    <ul>
      <li>全員に REVIVE を1枚。余りの REVIVE を山札へ（2〜3人なら2枚だけ）</li>
      <li>シャッフルして全員に7枚（手札8枚）</li>
      <li>DEAD を「生存者数÷2（切り上げ）」枚入れてシャッフル</li>
    </ul>
    <h3>カード</h3>
    <ul>${Object.entries(CARD_DEFS).filter(([k]) => !/^m[b-e]$/.test(k)).map(([k, d]) => `<li><b>${k === 'ma' ? 'MATCH A〜E' : d.label}</b>：${d.desc}</li>`).join('')}</ul>
    <h3>CANCEL</h3>
    <p>カードがプレイされるたびに3秒のバーが出ます。その間に CANCEL ボタンを押すと無効化できます（自分のプレイには使えないが、自分のプレイへのCANCELにはCANCELし返せる）。CANCELされると、そこからまた3秒。</p>`,
};

function nextAlive(m, uid) {
  const n = m.seats.length; let i = m.seats.indexOf(uid);
  for (let k = 0; k < n; k++) { i = (i + 1) % n; if (m.alive[m.seats[i]]) return m.seats[i]; }
  return uid;
}
export const deadsInDeck = (s) => s.deck.filter((c) => c === 'dead').length;

export function startRound(m) {
  const al = aliveList(m), n = al.length;
  const base = [];
  for (const [k, c] of Object.entries(BASE_COUNTS)) for (let i = 0; i < c; i++) base.push(k);
  const extraRevive = n <= 3 ? 2 : Math.max(0, 6 - n);
  const deck = shuffle([...base, ...Array(extraRevive).fill('revive')]);
  const hands = {};
  for (const u of al) hands[u] = ['revive'];
  for (let k = 0; k < 7; k++) for (const u of al) hands[u].push(deck.pop());
  const deads = Math.ceil(n / 2);
  for (let i = 0; i < deads; i++) deck.push('dead');
  shuffle(deck);
  m.sub = { deck, discard: [], hands, turn: null, turnNo: 0, phase: 'act', react: null, give: null, revive: null, peek: {} };
  let start;
  if (m.prevLoser && m.seats.includes(m.prevLoser)) start = m.alive[m.prevLoser] ? m.prevLoser : nextAlive(m, m.prevLoser);
  else start = pick(al);
  pushEvent(m, { t: 'rd_setup', players: al, start, deads, extraRevive, deck: deck.length });
  beginTurn(m, start, 1, false);
}

function beginTurn(m, uid, left, attacked) {
  const s = m.sub;
  s.turnNo += 1;
  s.turn = { uid, left, attacked, no: s.turnNo, plays: 0 };
  s.phase = 'act';
  pushEvent(m, { t: 'rd_turn', uid, left, attacked });
}
function endTurnOne(m) {
  const s = m.sub, t = s.turn;
  if (t.left > 1) beginTurn(m, t.uid, t.left - 1, t.attacked);
  else beginTurn(m, nextAlive(m, t.uid), 1, false);
}

export function currentActor(m) {
  const s = m.sub;
  if (m.phase !== 'round' || !s) return null;
  if (s.phase === 'act') return s.turn.uid;
  if (s.phase === 'give') return s.give.to;
  if (s.phase === 'revive') return s.revive.uid;
  return null; // CANCEL受付中は全員同時
}

export const canCancel = (m, uid) => {
  const s = m.sub, r = s?.react;
  if (!r || s.phase !== 'react' || !m.alive[uid]) return false;
  if (!(s.hands[uid] || []).includes('cancel')) return false;
  return r.chain[r.chain.length - 1].uid !== uid; // 最後に出したのが自分ならCANCEL不可
};

// CANCEL受付（とCPUの反応予定）を作る
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
    const hurts = (r.kind === 'give' || r.kind === 'match') ? r.target === u : r.kind === 'attack' ? nextAlive(m, by) === u : false;
    if (effective && hurts) want = 0.7;
    if (!effective && u === by) want = 0.6;
    if (Math.random() < want) r.plan[u] = { at: r.start + rint(400, 2300), done: false };
  }
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
    openWindow(m, 900);
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
  if (a.type === 'place') {
    if (s.phase !== 'revive' || s.revive.uid !== uid) throw new Error('not placing');
    const pos = Math.max(0, Math.min(s.deck.length, Math.round(+a.pos)));
    s.deck.splice(pos, 0, 'dead');
    s.revive = null;
    pushEvent(m, { t: 'rd_placed', uid, deck: s.deck.length });
    return endTurnOne(m);
  }
  // ここから手番プレイヤーの行動
  if (s.phase !== 'act' || s.turn.uid !== uid) throw new Error('not your turn');
  const h = s.hands[uid];
  if (a.type === 'draw') {
    const card = s.deck.shift();
    if (card === 'dead') {
      const has = h.indexOf('revive');
      pushEvent(m, { t: 'rd_dead', uid, revived: has >= 0 });
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
    pushEvent(m, { t: 'rd_draw', uid, deck: s.deck.length, left: h.length });
    return endTurnOne(m);
  }
  if (a.type === 'play') {
    const idx = [...new Set((a.idx || []).map(Number))];
    if (!idx.length || idx.length > 2 || idx.some((i) => !(i >= 0 && i < h.length))) throw new Error('bad cards');
    const cards = idx.map((i) => h[i]);
    if (cards.some((c) => c === 'dead' || c === 'revive' || c === 'cancel')) throw new Error('cannot play');
    let kind;
    if (cards.length === 2) {
      if (!(isMatch(cards[0]) && cards[0] === cards[1])) throw new Error('not a pair');
      kind = 'match';
    } else kind = isMatch(cards[0]) ? 'single' : cards[0];
    let target = null;
    if (kind === 'give' || kind === 'match') {
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
  switch (r.kind) {
    case 'attack': {
      const next = nextAlive(m, by);
      const turns = t.attacked ? t.left + 2 : 2;
      pushEvent(m, { t: 'rd_attack', from: by, to: next, turns });
      return beginTurn(m, next, turns, true);
    }
    case 'skip': pushEvent(m, { t: 'rd_skip', uid: by }); return endTurnOne(m);
    case 'shuffle': shuffle(s.deck); pushEvent(m, { t: 'rd_shuffle', uid: by }); return;
    case 'search': s.peek[by] = { no: t.no, cards: s.deck.slice(0, 3) }; pushEvent(m, { t: 'rd_search', uid: by }); return;
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
    if (t >= p.at) { out.due.push({ uid: u, action: { type: 'cancel' }, planKey: u }); return out; } // 1回に1つ
    consider(p.at);
  }
  if (t >= r.deadline) out.due.push({ uid: null, action: { type: 'resolve' } });
  else consider(r.deadline);
  return out;
}
export function applyAuto(m, d) {
  if (d.planKey && m.sub?.react?.plan?.[d.planKey]) m.sub.react.plan[d.planKey].done = true;
}

// ---- CPU（手番・GIVEの受け渡し・DEADの戻し位置） ----
const GIVE_ORDER = ['ma', 'mb', 'mc', 'md', 'me', 'shuffle', 'search', 'give', 'skip', 'attack', 'cancel', 'revive'];
export function cpuAction(m, uid) {
  const s = m.sub, h = s.hands[uid] || [];
  if (s.phase === 'give') {
    // REVIVEはできるだけ渡さない
    const order = h.map((c, i) => ({ c, i })).sort((a, b) => GIVE_ORDER.indexOf(a.c) - GIVE_ORDER.indexOf(b.c) + (Math.random() - 0.5) * 2);
    return { type: 'give', idx: order[0].i };
  }
  if (s.phase === 'revive') {
    const r = Math.random();
    return { type: 'place', pos: r < 0.3 ? 0 : r < 0.5 ? 1 : rint(0, s.deck.length) };
  }
  const t = s.turn;
  const others = aliveList(m).filter((u) => u !== uid);
  const richest = others.slice().sort((a, b) => (s.hands[b] || []).length - (s.hands[a] || []).length)[0];
  const risk = deadsInDeck(s) / Math.max(1, s.deck.length);
  const peek = s.peek[uid]?.no === t.no ? s.peek[uid].cards : null;
  const knownDead = peek && peek[0] === 'dead';
  const knownSafe = peek && peek[0] !== 'dead';
  const has = (c) => h.indexOf(c);
  if (t.plays < 4) {
    if (knownDead || (!knownSafe && risk > 0.28 && !h.includes('revive'))) {
      for (const c of ['skip', 'attack']) if (has(c) >= 0) return { type: 'play', idx: [has(c)] };
      if (has('shuffle') >= 0 && knownDead) return { type: 'play', idx: [has('shuffle')] };
    }
    if (!peek && has('search') >= 0 && risk > 0.1 && Math.random() < 0.5) return { type: 'play', idx: [has('search')] };
    if (richest && (s.hands[richest] || []).length && Math.random() < 0.35) {
      for (const c of ['ma', 'mb', 'mc', 'md', 'me']) {
        const i1 = h.indexOf(c), i2 = h.indexOf(c, i1 + 1);
        if (i1 >= 0 && i2 >= 0) return { type: 'play', idx: [i1, i2], target: richest };
      }
      if (has('give') >= 0) return { type: 'play', idx: [has('give')], target: richest };
    }
    if (!knownSafe && risk > 0.2 && has('attack') >= 0 && Math.random() < 0.3) return { type: 'play', idx: [has('attack')] };
  }
  return { type: 'draw' };
}

export function describeEvent(ev, name) {
  const L = (c) => CARD_DEFS[c]?.label ?? c;
  switch (ev.t) {
    case 'rd_setup': return `DEAD ${ev.deads}枚 ／ 山札 ${ev.deck}枚 ／ スタート: ${name(ev.start)}`;
    case 'rd_play': return `${name(ev.uid)} ▶ ${ev.kind === 'match' ? `${L(ev.cards[0])} ×2` : L(ev.cards[0])}${ev.target ? ` → ${name(ev.target)}` : ''}${ev.kind === 'single' ? '（効果なし）' : ''}`;
    case 'rd_cancel': return `${name(ev.uid)} ▶ CANCEL！`;
    case 'rd_resolve': return ev.effective ? null : '→ 無効化された';
    case 'rd_attack': return `${name(ev.to)} は ${ev.turns}ターン連続`;
    case 'rd_skip': return `${name(ev.uid)} はターンをスキップ`;
    case 'rd_shuffle': return '山札がシャッフルされた';
    case 'rd_search': return `${name(ev.uid)} が山札の上3枚を確認`;
    case 'rd_given': return `${name(ev.from)} が ${name(ev.to)} にカードを渡した`;
    case 'rd_give_none': return `${name(ev.to)} は手札がなかった`;
    case 'rd_steal': return ev.card ? `${name(ev.to)} が ${name(ev.from)} から1枚奪った` : `${name(ev.from)} は手札がなかった`;
    case 'rd_draw': return `${name(ev.uid)} がドロー（山札 ${ev.deck}枚）`;
    case 'rd_dead': return `${name(ev.uid)} が DEAD を引いた！${ev.revived ? ' → REVIVE' : ''}`;
    case 'rd_placed': return `${name(ev.uid)} が DEAD を山札のどこかに戻した`;
    default: return null;
  }
}

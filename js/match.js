// 全ゲーム共通の試合進行
// ラウンド → 敗者決定(警報) → 敗者が自分のタイミングで撃つ → 結果 → 次ラウンド / 決着
import { DAMAGE_MODES } from './damage.js';

// 時計（オンライン時はサーバー時刻に補正したものを app が差し込む）
export let now = () => Date.now();
export function setClock(fn) { now = fn; }

let RULES = null; // games/index.js から注入（循環importを避けるため）
export function bindRules(getter) { RULES = getter; }

export function pushEvent(m, ev) {
  m.eid = (m.eid || 0) + 1;
  ev.id = m.eid;
  m.events.push(ev);
  if (m.events.length > 80) m.events.splice(0, m.events.length - 80);
}

export const aliveList = (m) => m.seats.filter((u) => m.alive[u]);

export function clampSurvivors(n, players) {
  return Math.max(1, Math.min(players - 1, n || 1));
}

export function createMatch({ seats, names, cpu, gameId, gameOpts, damage }) {
  const m = {
    v: 2, gameId, opts: gameOpts, dmg: { ...damage, survivors: clampSurvivors(damage.survivors, seats.length) },
    seats: seats.slice(), names: { ...names }, cpu: { ...cpu },
    alive: {}, life: {}, cyl: {}, deaths: 0, deadOrder: [],
    round: 0, phase: 'round', loser: null, prevLoser: null, winners: null, exec: null,
    eid: 0, events: [], sub: null, gs: null, // gs: ゲームごとのラウンドをまたぐ状態
  };
  const mode = DAMAGE_MODES[damage.mode];
  seats.forEach((u) => { m.alive[u] = true; mode.init(m, u); });
  startRound(m);
  return m;
}

export function startRound(m) {
  m.round += 1;
  m.phase = 'round';
  if (m.loser) m.prevLoser = m.loser.uid;
  m.loser = null;
  m.exec = null;
  pushEvent(m, { t: 'roundStart', round: m.round });
  RULES(m.gameId).startRound(m);
  if (m.loser) declareLoser(m);
}

export function applyAction(m, uid, action) {
  if (action.type === 'shoot') return shoot(m, uid);
  if (m.phase !== 'round') throw new Error('not in round');
  RULES(m.gameId).applyAction(m, uid, action);
  if (m.loser) declareLoser(m);
}

// 敗者決定（全ゲーム共通：警報演出のトリガー）
// m.loser.times … ペナルティ回数（引き金を引く回数）。省略時1
function declareLoser(m) {
  m.phase = 'loser';
  m.loser.times = Math.max(1, m.loser.times || 1);
  m.loser.left = m.loser.times;
  pushEvent(m, { t: 'loser', uid: m.loser.uid, text: m.loser.text || '', mode: m.dmg.mode, round: m.round, times: m.loser.times, left: m.loser.left, fatal: !!m.loser.fatal });
}

// 敗者が自分で引き金を引く
export function shoot(m, uid) {
  if (m.phase !== 'loser' || !m.loser || m.loser.uid !== uid) throw new Error('not your shot');
  const mode = DAMAGE_MODES[m.dmg.mode];
  // m.loser.fatal … 即死（ライフ等に関係なく死亡）
  const res = m.loser.fatal ? { hit: true, dead: true, fatal: true, lifeAfter: 0, prob: 1, dmg: 0 } : mode.apply(m, uid);
  if (m.loser.fatal) m.life[uid] = 0;
  m.loser.left = (m.loser.left ?? 1) - 1;
  m.phase = 'execution';
  m.exec = { uid, ...res };
  pushEvent(m, { t: 'execution', uid, mode: m.dmg.mode, round: m.round, left: m.loser.left, times: m.loser.times, ...res });
  if (res.dead) {
    m.alive[uid] = false;
    m.deaths += 1;
    m.deadOrder.push(uid);
    pushEvent(m, { t: 'death', uid });
  } else if (m.loser.left > 0) {
    // ペナルティが複数回 → もう一度構える
    m.phase = 'loser';
    pushEvent(m, { t: 'loser', uid, again: true, mode: m.dmg.mode, round: m.round, times: m.loser.times, left: m.loser.left });
  }
}

export function isFinished(m) {
  return aliveList(m).length <= (m.dmg.survivors || 1);
}

export function advance(m) {
  if (m.phase !== 'execution') throw new Error('nothing to advance');
  if (isFinished(m)) {
    m.phase = 'over';
    m.winners = aliveList(m);
    pushEvent(m, { t: 'gameOver', winners: m.winners });
    return;
  }
  startRound(m);
}

export function currentActor(m) {
  if (m.phase === 'loser') return m.loser.uid;
  if (m.phase !== 'round') return null;
  return RULES(m.gameId).currentActor(m);
}

export function statusText(m, u) {
  return DAMAGE_MODES[m.dmg.mode].status(m, u);
}

// 全ゲーム共通の試合進行（ラウンド → 敗者決定 → 処刑 → 次ラウンド / 決着）
import { DAMAGE_MODES } from './damage.js';

let RULES = null; // games/index.js から注入（循環importを避けるため）
export function bindRules(getter) { RULES = getter; }

export function pushEvent(m, ev) {
  m.eid = (m.eid || 0) + 1;
  ev.id = m.eid;
  m.events.push(ev);
  if (m.events.length > 80) m.events.splice(0, m.events.length - 80);
}

export const aliveList = (m) => m.seats.filter((u) => m.alive[u]);

export function createMatch({ seats, names, cpu, gameId, gameOpts, damage }) {
  const m = {
    v: 1, gameId, opts: gameOpts, dmg: damage,
    seats: seats.slice(), names: { ...names }, cpu: { ...cpu },
    alive: {}, life: {}, cyl: {}, deaths: 0, deadOrder: [],
    round: 0, phase: 'round', loser: null, winner: null, exec: null,
    eid: 0, events: [], sub: null,
  };
  const mode = DAMAGE_MODES[damage.mode];
  seats.forEach((u) => { m.alive[u] = true; mode.init(m, u); });
  startRound(m);
  return m;
}

export function startRound(m) {
  m.round += 1;
  m.phase = 'round';
  m.loser = null;
  m.exec = null;
  pushEvent(m, { t: 'roundStart', round: m.round });
  RULES(m.gameId).startRound(m);
  if (m.loser) resolveLoss(m);
}

export function applyAction(m, uid, action) {
  if (m.phase !== 'round') throw new Error('not in round');
  RULES(m.gameId).applyAction(m, uid, action);
  if (m.loser) resolveLoss(m);
}

function resolveLoss(m) {
  const u = m.loser.uid;
  const mode = DAMAGE_MODES[m.dmg.mode];
  const res = mode.apply(m, u);
  m.phase = 'execution';
  m.exec = { uid: u, ...res };
  pushEvent(m, { t: 'execution', uid: u, mode: m.dmg.mode, round: m.round, ...res });
  if (res.dead) {
    m.alive[u] = false;
    m.deaths += 1;
    m.deadOrder.push(u);
    pushEvent(m, { t: 'death', uid: u });
    const al = aliveList(m);
    if (al.length <= 1) m.winner = al[0] || null;
  }
}

export function advance(m) {
  if (m.phase !== 'execution') throw new Error('nothing to advance');
  if (m.winner !== null && m.winner !== undefined && aliveList(m).length <= 1) {
    m.phase = 'over';
    pushEvent(m, { t: 'gameOver', winner: m.winner });
    return;
  }
  startRound(m);
}

export function currentActor(m) {
  if (m.phase !== 'round') return null;
  return RULES(m.gameId).currentActor(m);
}

export function statusText(m, u) {
  return DAMAGE_MODES[m.dmg.mode].status(m, u);
}

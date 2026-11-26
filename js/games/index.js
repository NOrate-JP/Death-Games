// ゲーム登録所。新しいゲームはここに追加する。
// 各ゲームモジュールは rules(meta/startRound/applyAction/currentActor/cpuAction/describeEvent) と
// view(createView) を持つ。
import * as countCardsRules from './count-cards/rules.js';
import * as liarDiceRules from './liar-dice/rules.js';
import * as sprintBrainRules from './sprint-brain/rules.js';
import * as luckButtonRules from './luck-button/rules.js';
import { bindRules } from '../match.js';

export const GAMES = {
  'count-cards': { rules: countCardsRules, view: () => import('./count-cards/view.js') },
  'liar-dice': { rules: liarDiceRules, view: () => import('./liar-dice/view.js') },
  'sprint-brain': { rules: sprintBrainRules, view: () => import('./sprint-brain/view.js') },
  'luck-button': { rules: luckButtonRules, view: () => import('./luck-button/view.js') },
};

// ロビーに「COMING SOON」として表示するだけの枠
export const COMING_SOON = [];

export function getRules(id) { return GAMES[id].rules; }
bindRules(getRules);

export function defaultGameOptions(id) {
  const o = {};
  for (const opt of GAMES[id].rules.meta.options) o[opt.key] = opt.default;
  return o;
}

// COUNT CARDS : カード定義
// 画像は assets/cards/count-cards/<id>.png を置くと自動で差し替わります（無い場合は自動生成の仮カード）

export const CARD_DEFS = {
  n1: { type: 'num', value: 1, label: '1' },
  n2: { type: 'num', value: 2, label: '2' },
  n3: { type: 'num', value: 3, label: '3' },
  n4: { type: 'num', value: 4, label: '4' },
  n5: { type: 'num', value: 5, label: '5' },
  n6: { type: 'num', value: 6, label: '6' },
  n7: { type: 'num', value: 7, label: '7' },
  n8: { type: 'num', value: 8, label: '8' },
  n9: { type: 'num', value: 9, label: '9' },
  n0: { type: 'num', value: 0, label: '0' },
  nm1: { type: 'num', value: -1, label: '-1' },
  nm5: { type: 'num', value: -5, label: '-5' },
  eq0: { type: 'sp', label: '=0', desc: '場の数字を0にする' },
  eqmax: { type: 'sp', label: '=MAX', desc: '場の数字を目標値と同じにする' },
  reverse: { type: 'sp', label: 'REVERSE', desc: 'ターン順を逆にし、次の人のターンへ' },
  plus2: { type: 'sp', label: '+2', desc: '次の人は数字カードしか出せず、その数字に+2' },
  shot: { type: 'sp', label: 'SHOT', desc: '好きなプレイヤーを1人選び、その人のターンへ' },
  double: { type: 'sp', label: 'DOUBLE', desc: '次の人は2枚プレイする' },
  random: { type: 'sp', label: 'RANDOM', desc: '次の人は手札からランダムに1枚強制プレイ' },
  shield: { type: 'sp', label: 'SHIELD', desc: '自分への効果を無効にし、次の人のターンへ' },
};

// 出現しやすさ（山札は無限・重み付きランダム）
export const DEFAULT_WEIGHTS = {
  n1: 4, n2: 4, n3: 4, n4: 4, n5: 4, n6: 4, n7: 4, n8: 4, n9: 4,
  n0: 3, nm1: 3, nm5: 2,
  eq0: 2, eqmax: 1, reverse: 3, plus2: 3, shot: 2, double: 2, random: 2, shield: 2,
};

// 手札の表示順
export const CARD_ORDER = ['nm5', 'nm1', 'n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9',
  'plus2', 'double', 'random', 'shot', 'reverse', 'shield', 'eq0', 'eqmax'];

export const isNum = (id) => CARD_DEFS[id] && CARD_DEFS[id].type === 'num';

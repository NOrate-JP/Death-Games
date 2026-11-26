// 全ゲーム共通：敗者へのダメージ方式
export const DAMAGE_MODES = {
  life: {
    name: 'ライフ',
    desc: '敗者は自分にリボルバーを撃ち、ライフが1減る。0で死亡。',
    options: [{ key: 'life', label: '初期ライフ', type: 'number', min: 1, max: 20, default: 3 }],
    init(m, u) { m.life[u] = m.dmg.life ?? 3; },
    apply(m, u) {
      m.life[u] -= 1;
      return { hit: true, dmg: 1, lifeAfter: m.life[u], dead: m.life[u] <= 0 };
    },
    status(m, u) { return `LIFE ${Math.max(0, m.life[u])}`; },
  },
  revolver: {
    name: 'リボルバー',
    desc: '敗者は自分にリボルバーを撃つ。実弾なら死亡。空弾を引くほど次の実弾確率が上がる。',
    options: [
      { key: 'chambers', label: '装弾数', type: 'number', min: 2, max: 12, default: 6 },
      { key: 'live', label: '実弾数', type: 'number', min: 1, max: 11, default: 1 },
    ],
    init(m, u) { m.cyl[u] = 0; },
    chance(m, u) {
      const ch = m.dmg.chambers ?? 6; const live = Math.min(m.dmg.live ?? 1, ch - 1);
      const remain = Math.max(1, ch - m.cyl[u]);
      return Math.min(1, live / remain);
    },
    apply(m, u) {
      const p = this.chance(m, u);
      const hit = Math.random() < p;
      if (!hit) m.cyl[u] += 1;
      return { hit, prob: p, dead: hit, nextProb: hit ? null : this.chance(m, u) };
    },
    status(m, u) {
      const ch = m.dmg.chambers ?? 6; const live = Math.min(m.dmg.live ?? 1, ch - 1);
      const remain = Math.max(1, ch - m.cyl[u]);
      return `実弾 ${Math.min(live, remain)}/${remain}`;
    },
  },
  roundlife: {
    name: 'ラウンドライフ',
    desc: '敗者は自分にリボルバーを撃ち、ライフが「ラウンド数」だけ減る。0で死亡。',
    options: [{ key: 'roundLife', label: '初期ライフ', type: 'number', min: 1, max: 99, default: 7 }],
    init(m, u) { m.life[u] = m.dmg.roundLife ?? 7; },
    apply(m, u) {
      const d = m.round;
      m.life[u] -= d;
      return { hit: true, dmg: d, lifeAfter: m.life[u], dead: m.life[u] <= 0 };
    },
    status(m, u) { return `LIFE ${Math.max(0, m.life[u])}`; },
  },
};

// 全方式共通のペナルティ設定
export const COMMON_PENALTY_OPTIONS = [
  { key: 'survivors', label: '生存人数', type: 'number', min: 1, max: 5, default: 1,
    note: 'この人数まで減ったらゲーム終了（参加人数未満まで）' },
  { key: 'autoShoot', label: '自動で引き金を引く', type: 'bool', default: false, note: 'ONなら敗者の引き金は自動で引かれる' },
];

export function defaultDamageSettings() {
  const out = { mode: 'life', survivors: 1, autoShoot: false };
  for (const k in DAMAGE_MODES) for (const o of DAMAGE_MODES[k].options) out[o.key] = o.default;
  return out;
}

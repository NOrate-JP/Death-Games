// カードゲーム共通：扇形の手札＋マウスオーバー（スマホは1回目のタップ）で拡大＆効果テキスト
// 使い方: makeHandCard({ img, label, tip }) でボタンを作り、box に並べたあと layoutFan(box) を呼ぶ

export function makeHandCard({ img, label, tip, onPlay }) {
  const b = document.createElement('button');
  b.className = 'hand-card';
  b.innerHTML = `<img src="${img}" alt="${label}" draggable="false"><div class="hc-tip"></div>`;
  b.querySelector('.hc-tip').textContent = tip || '';
  b.addEventListener('pointerdown', (e) => { b._touch = e.pointerType !== 'mouse'; });
  b.addEventListener('click', (e) => {
    // タッチ操作：1回目は拡大表示だけ、2回目で使用
    if (b._touch && !b.classList.contains('peek')) {
      e.preventDefault();
      document.querySelectorAll('.hand-card.peek').forEach((x) => x.classList.remove('peek'));
      b.classList.add('peek');
      return;
    }
    if (b.classList.contains('locked')) return;
    onPlay && onPlay(b);
  });
  b.addEventListener('mouseleave', () => b.classList.remove('peek'));
  return b;
}

export function layoutFan(box) {
  const cards = [...box.querySelectorAll('.hand-card')];
  const n = cards.length;
  const spread = Math.min(5, 26 / Math.max(1, n)); // 1枚あたりの角度
  cards.forEach((c, i) => {
    const t = n > 1 ? i - (n - 1) / 2 : 0;
    c.style.setProperty('--rot', `${t * spread}deg`);
    c.style.setProperty('--drop', `${Math.abs(t) * Math.abs(t) * 1.6}px`);
    c.style.zIndex = String(10 + i);
  });
}

// 画面の何もない所をタップしたら拡大を解除
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest?.('.hand-card')) document.querySelectorAll('.hand-card.peek').forEach((x) => x.classList.remove('peek'));
});

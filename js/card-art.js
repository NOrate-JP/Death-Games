// カード画像ローダー：assets/cards/<ゲームID>/<カードID>.png があればそれを使い、無ければ仮カードを描画
export const CARD_W = 200, CARD_H = 300;
const cache = new Map();   // id -> canvas
const urlCache = new Map(); // id -> dataURL

function loadImg(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  });
}

function noise(ctx, w, h, a) {
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (Math.random() - 0.5) * a;
    d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n;
  }
  ctx.putImageData(d, 0, 0);
}

function fitText(ctx, text, maxW, size, font) {
  let s = size;
  do { ctx.font = `${s}px ${font}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 10);
}

function drawFallback(id, def) {
  const c = document.createElement('canvas');
  c.width = CARD_W; c.height = CARD_H;
  const g = c.getContext('2d');
  const font = '"DotGothic16", "Courier New", monospace';
  if (id === 'back') {
    g.fillStyle = '#3a0d0d'; g.fillRect(0, 0, CARD_W, CARD_H);
    g.strokeStyle = '#8a6a3a'; g.lineWidth = 6; g.strokeRect(10, 10, CARD_W - 20, CARD_H - 20);
    g.lineWidth = 2;
    for (let i = -CARD_H; i < CARD_W + CARD_H; i += 16) {
      g.beginPath(); g.moveTo(i, 18); g.lineTo(i + CARD_H, CARD_H - 18); g.strokeStyle = 'rgba(140,100,60,.25)'; g.stroke();
    }
    g.fillStyle = '#1b0505'; g.beginPath(); g.arc(CARD_W / 2, CARD_H / 2, 46, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#b8924e'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#d8b06a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `40px ${font}`; g.fillText('DG', CARD_W / 2, CARD_H / 2 + 2);
    noise(g, CARD_W, CARD_H, 28);
    return c;
  }
  const sp = def.type === 'sp';
  g.fillStyle = sp ? '#cbb994' : '#ddd2b6'; g.fillRect(0, 0, CARD_W, CARD_H);
  // しみ
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(90,60,30,${Math.random() * 0.08})`;
    g.beginPath(); g.arc(Math.random() * CARD_W, Math.random() * CARD_H, 20 + Math.random() * 50, 0, 7); g.fill();
  }
  g.strokeStyle = '#2a1a10'; g.lineWidth = 5; g.strokeRect(9, 9, CARD_W - 18, CARD_H - 18);
  g.lineWidth = 1.5; g.strokeRect(17, 17, CARD_W - 34, CARD_H - 34);
  const ink = sp ? '#7a1010' : '#1e1410';
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  // 角
  g.font = `24px ${font}`;
  const corner = def.label.length > 3 ? def.label.slice(0, 3) : def.label;
  g.textAlign = 'left'; g.fillText(corner, 24, 36);
  g.save(); g.translate(CARD_W - 24, CARD_H - 36); g.rotate(Math.PI); g.fillText(corner, 0, 0); g.restore();
  g.textAlign = 'center';
  // 中央
  if (sp) {
    g.beginPath(); g.arc(CARD_W / 2, CARD_H / 2 - 18, 58, 0, 7); g.lineWidth = 3; g.strokeStyle = ink; g.stroke();
    fitText(g, def.label, 150, 54, font);
    g.fillText(def.label, CARD_W / 2, CARD_H / 2 - 16);
    // 説明
    g.font = `13px ${font}`; g.fillStyle = '#3a2418';
    const words = def.desc || ''; const lines = []; let cur = '';
    for (const ch of words) { cur += ch; if (g.measureText(cur).width > 150) { lines.push(cur.slice(0, -1)); cur = ch; } }
    if (cur) lines.push(cur);
    lines.slice(0, 3).forEach((ln, i) => g.fillText(ln, CARD_W / 2, CARD_H - 82 + i * 17));
  } else {
    fitText(g, def.label, 160, 120, font);
    g.fillText(def.label, CARD_W / 2, CARD_H / 2 + 4);
  }
  noise(g, CARD_W, CARD_H, 22);
  return c;
}

// defs: {id: def}。'back' は自動で追加
export async function preloadCards(gameKey, defs, base = `assets/cards/${gameKey}`) {
  const ids = [...Object.keys(defs), 'back'];
  await (document.fonts?.ready ?? Promise.resolve());
  await Promise.all(ids.map(async (id) => {
    const key = `${gameKey}:${id}`;
    if (cache.has(key)) return;
    const im = await loadImg(`${base}/${id}.png`);
    let c;
    if (im) {
      c = document.createElement('canvas'); c.width = CARD_W; c.height = CARD_H;
      c.getContext('2d').drawImage(im, 0, 0, CARD_W, CARD_H);
    } else c = drawFallback(id, defs[id]);
    cache.set(key, c);
  }));
}

export function cardCanvas(gameKey, id) { return cache.get(`${gameKey}:${id}`); }
export function cardURL(gameKey, id) {
  const key = `${gameKey}:${id}`;
  if (!urlCache.has(key)) urlCache.set(key, cache.get(key).toDataURL());
  return urlCache.get(key);
}

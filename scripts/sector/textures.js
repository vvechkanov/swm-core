/**
 * Текстуры карты: мягкое свечение (как glow() в map.html), луч и радиальные градиенты зоны.
 * Рисуются один раз в 2D-канвасе и переиспользуются.
 */

const cache = new Map();

export function hexA(hex, a) {
  const n = typeof hex === "number" ? hex : parseInt(String(hex).slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

export const toNum = hex => (typeof hex === "number" ? hex : parseInt(String(hex).slice(1), 16));

function make(key, w, h, paint) {
  const old = cache.get(key);
  if (old && !old.destroyed && old.baseTexture && !old.baseTexture.destroyed) return old;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  paint(c.getContext("2d"), w, h);
  const tex = PIXI.Texture.from(c);
  cache.set(key, tex);
  return tex;
}

/** Мягкое свечение 256 px: белая сердцевина, ореол цвета. */
export function glowTexture(color) {
  return make(`glow:${color}`, 256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.06, hexA(color, 0.95));
    gr.addColorStop(0.18, hexA(color, 0.45));
    gr.addColorStop(0.45, hexA(color, 0.12));
    gr.addColorStop(1, hexA(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  });
}

/** Дифракционный луч: горизонтальная полоска, ярче к центру. */
export function rayTexture(color) {
  return make(`ray:${color}`, 256, 4, (g, w, h) => {
    const lg = g.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, hexA(color, 0));
    lg.addColorStop(0.5, hexA(color, 1));
    lg.addColorStop(1, hexA(color, 0));
    g.fillStyle = lg; g.fillRect(0, 1, w, 2);
  });
}

/** Освоенная зона: голубое свечение внутри кольца 10 св. лет (радиус текстуры = 1). */
export function zoneTexture() {
  return make("zone", 512, 512, (g) => {
    const gr = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    gr.addColorStop(0, "rgba(70,160,240,.10)");
    gr.addColorStop(0.75, "rgba(50,130,220,.045)");
    gr.addColorStop(1, "rgba(40,120,210,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  });
}

/**
 * Тьма за рекомендованным пределом: прозрачно до 0.97 R, темнеет к 2.1 R.
 * Текстура покрывает радиус 2.6 R, дальше её край — уже тёмный.
 */
export function darkTexture() {
  return make("dark", 1024, 1024, (g) => {
    const R = 512 / 2.6;
    const gr = g.createRadialGradient(512, 512, R * 0.97, 512, 512, R * 2.1);
    gr.addColorStop(0, "rgba(1,2,6,0)");
    gr.addColorStop(0.18, "rgba(1,2,6,.45)");
    gr.addColorStop(1, "rgba(1,2,6,.78)");
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 1024);
  });
}

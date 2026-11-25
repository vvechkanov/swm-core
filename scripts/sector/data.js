/**
 * Данные карты сектора: системы (журналы с флагами world.*) и маршруты (флаг сцены world.routes).
 * Здесь же — правила видимости и пересчёт координат в пиксели сцены.
 */

/**
 * Сцена: 1 клетка = 1 св. год = 100 px. Ось y — вверх, как в map.html дизайнера
 * (экранная Y = cy − y·sc): система с y = +8 выше станции. Станция (0, 0) — в точке (14, 12) клеток.
 */
export const GRID = { px: 100, ox: 14, oy: 12 };

/** Рекомендованный предел (дальность сенсоров) и абсолютный предел прыжка, св. лет. */
export const RANGE = 10;
export const LIMIT = 15;

export const COLORS = {
  H: "#ffb36b", K: "#ffb36b", M: "#ff7a5c", G: "#fff0c2", F: "#cfe6ff", BD: "#c56bff", Q: "#6f86a6"
};

export const CLASS_NAMES = {
  H: "станция", K: "оранжевый карлик", M: "красный карлик", G: "жёлтая звезда",
  F: "бело-голубая звезда", BD: "коричневый карлик", Q: "неизвестно"
};

export const STATUS_NAMES = {
  home: "дом", known: "маршрут изучен", partial: "маршрут частично изучен",
  unknown: "маршрут не изучен", far: "тёмная зона"
};

export const isSectorScene = scene => !!scene?.getFlag?.("world", "sector");

export const toScene = (x, y) => ({ x: (x + GRID.ox) * GRID.px, y: (GRID.oy - y) * GRID.px });

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const LIMITED = () => CONST.DOCUMENT_OWNERSHIP_LEVELS.LIMITED;
const OBSERVER = () => CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;

/** Видна ли система хоть одному игроку (не мастеру). */
export function visibleToPlayers(journal) {
  return game.users.some(u => !u.isGM && journal.testUserPermission(u, LIMITED()));
}

/**
 * Все системы из журналов, которые видит пользователь (по умолчанию — текущий).
 * Другой пользователь — для проверки «глазами игрока» (см. api.previewAs).
 */
export function readSystems(user = game.user) {
  const out = [];
  for (const j of game.journal) {
    const f = j.flags?.world;
    if (!f?.sys || !Number.isFinite(Number(f.x)) || !Number.isFinite(Number(f.y))) continue;
    const canSee = user.isGM || j.testUserPermission(user, LIMITED());
    if (!canSee) continue; // скрытое игроку не существует вовсе
    const cls = String(f.cls ?? "G");
    const st = String(f.st ?? "unknown");
    const s = {
      id: String(f.sys),
      name: j.name,
      journal: j,
      x: Number(f.x), y: Number(f.y),
      cls, st,
      g: Math.max(1, Math.min(4, Number(f.g) || 2)),
      home: f.sys === "home" || st === "home",
      trap: cls === "BD",
      far: cls === "Q" || st === "far",
      lx: Number.isFinite(f.lx) ? f.lx : null,
      ly: Number.isFinite(f.ly) ? f.ly : null,
      al: f.al ?? null,
      canOpen: user.isGM || j.testUserPermission(user, OBSERVER()) || j.testUserPermission(user, LIMITED()),
      hiddenFromPlayers: user.isGM ? !visibleToPlayers(j) : false
    };
    const p = toScene(s.x, s.y);
    s.px = p.x; s.py = p.y;
    out.push(s);
  }
  return out;
}

/** Маршруты сцены, нормализованные; только между системами, которые видит пользователь. */
export function readRoutes(scene, systems) {
  const by = new Map(systems.map(s => [s.id, s]));
  const raw = scene?.getFlag("world", "routes") ?? [];
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 2) continue;
    const [a, b] = r.map(String);
    const key = [a, b].sort().join("|");
    if (a === b || seen.has(key) || !by.has(a) || !by.has(b)) continue;
    seen.add(key);
    out.push([by.get(a), by.get(b)]);
  }
  return out;
}

export const sameRoute = (r, a, b) => (r[0] === a && r[1] === b) || (r[0] === b && r[1] === a);

/** Сцена-карта сектора: текущая, если это она, иначе первая с флагом. */
export function sectorScene() {
  if (isSectorScene(canvas?.scene)) return canvas.scene;
  return game.scenes.find(s => isSectorScene(s)) ?? null;
}

export function journalBySys(sys) {
  return game.journal.find(j => j.getFlag("world", "sys") === sys) ?? null;
}

export function zoneOf(d) {
  if (d <= RANGE) return { key: "near", label: "в пределах сенсоров", color: 0x8fdcff };
  if (d <= LIMIT) return { key: "edge", label: "за краем сенсоров", color: 0xffb36b };
  return { key: "far", label: "вне досягаемости", color: 0xff6a6a };
}

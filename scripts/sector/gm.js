/**
 * Управление картой сектора (только мастер): маршруты, открытие систем игрокам, миграция.
 * Всё меняется через документы (флаг сцены и права журналов), слой у всех перерисуется сам по хукам.
 */
import { sectorScene, journalBySys, readSystems, sameRoute, visibleToPlayers, dist } from "./data.js";

const DialogV2 = () => foundry.applications.api.DialogV2;

function requireGM() {
  if (!game.user.isGM) {
    ui.notifications.warn("Карта сектора: это может только мастер.");
    return false;
  }
  return true;
}

function requireScene() {
  const scene = sectorScene();
  if (!scene) ui.notifications.warn("Карта сектора: нет сцены с флагом world.sector.");
  return scene;
}

const allSystems = () => game.journal
  .filter(j => j.getFlag("world", "sys"))
  .map(j => ({ id: String(j.getFlag("world", "sys")), name: j.name, journal: j, x: Number(j.flags.world.x), y: Number(j.flags.world.y) }));

const esc = s => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s)) : String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* -------------------------------------------- */
/*  Маршруты                                    */
/* -------------------------------------------- */

export async function setRoutes(routes) {
  const scene = requireScene();
  if (!scene || !requireGM()) return null;
  await scene.setFlag("world", "routes", routes);
  return routes;
}

export function getRoutes() {
  const scene = sectorScene();
  return foundry.utils.deepClone(scene?.getFlag("world", "routes") ?? []);
}

export async function addRoute(a, b) {
  if (!requireGM()) return null;
  if (!a || !b || a === b) return null;
  const routes = getRoutes();
  if (!routes.some(r => sameRoute(r, a, b))) routes.push([a, b]);
  return setRoutes(routes);
}

export async function removeRoute(a, b) {
  if (!requireGM()) return null;
  return setRoutes(getRoutes().filter(r => !sameRoute(r, a, b)));
}

/* -------------------------------------------- */
/*  Видимость                                   */
/* -------------------------------------------- */

/** Открыть систему игрокам: право по умолчанию на журнал (по умолчанию «Наблюдатель»). */
export async function reveal(sys, level = "OBSERVER") {
  if (!requireGM()) return null;
  const j = journalBySys(sys);
  if (!j) return ui.notifications.warn(`Нет журнала системы «${sys}».`);
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const value = typeof level === "number" ? level : L[level] ?? L.OBSERVER;
  return j.update({ "ownership.default": value });
}

/** Скрыть систему от игроков: снять право по умолчанию и личные права игроков. */
export async function hide(sys) {
  if (!requireGM()) return null;
  const j = journalBySys(sys);
  if (!j) return ui.notifications.warn(`Нет журнала системы «${sys}».`);
  const NONE = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  const data = { "ownership.default": NONE };
  for (const uid of Object.keys(j.ownership)) {
    if (uid === "default" || game.users.get(uid)?.isGM) continue;
    data[`ownership.${uid}`] = NONE;
  }
  return j.update(data);
}

/* -------------------------------------------- */
/*  Диалоги                                     */
/* -------------------------------------------- */

/** Порт макроса «Маршруты ближнего пояса»: от / до, добавить / убрать. */
export async function openRoutesDialog() {
  if (!requireGM() || !requireScene()) return;
  const sys = allSystems();
  const by = Object.fromEntries(sys.map(s => [s.id, s]));
  const routes = getRoutes();
  const opts = sys.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
  const list = routes.map(([a, b]) => {
    const A = by[a], B = by[b];
    const d = A && B ? ` · ${dist(A, B).toFixed(1)} св. л.` : "";
    return `<li>${esc(A?.name ?? a)} — ${esc(B?.name ?? b)}${d}</li>`;
  }).join("") || "<li>нет</li>";
  const res = await DialogV2().wait({
    window: { title: "Маршруты ближнего пояса", icon: "fa-solid fa-route" },
    classes: ["swm-dialog"],
    content: `<p><b>Разведанные маршруты</b></p><ul class="swm-route-list">${list}</ul>
      <div class="form-group"><label>От</label><select name="a">${opts}</select></div>
      <div class="form-group"><label>До</label><select name="b">${opts}</select></div>`,
    buttons: [
      { action: "add", label: "Добавить", icon: "fa-solid fa-plus", default: true,
        callback: (e, b) => ["add", b.form.elements.a.value, b.form.elements.b.value] },
      { action: "del", label: "Убрать", icon: "fa-solid fa-minus",
        callback: (e, b) => ["del", b.form.elements.a.value, b.form.elements.b.value] }
    ],
    rejectClose: false
  });
  if (!Array.isArray(res)) return;
  const [act, a, b] = res;
  if (a === b) return ui.notifications.warn("Выберите две разные системы.");
  if (act === "add") await addRoute(a, b);
  if (act === "del") await removeRoute(a, b);
}

/** Меню звезды (правый клик мастера): маршруты отсюда, открыть/скрыть, журнал. */
export async function openSystemDialog(s) {
  if (!requireGM()) return;
  const j = s.journal ?? journalBySys(s.id);
  const others = allSystems().filter(o => o.id !== s.id).sort((a, b) => dist(a, s) - dist(b, s));
  const routes = getRoutes();
  const shown = j ? visibleToPlayers(j) : false;
  const rows = others.map(o => {
    const on = routes.some(r => sameRoute(r, s.id, o.id));
    return `<label class="swm-check"><input type="checkbox" name="r_${esc(o.id)}" ${on ? "checked" : ""}>
      <span>${esc(o.name)}</span><em>${dist(o, s).toFixed(1)} св. л.</em></label>`;
  }).join("");
  const res = await DialogV2().wait({
    window: { title: `${s.name} — карта сектора`, icon: "fa-solid fa-star" },
    classes: ["swm-dialog"],
    position: { width: 420 },
    content: `<p class="swm-kick">${shown ? "игроки видят систему" : "скрыта от игроков"}</p>
      <p><b>Разведанные маршруты отсюда</b></p>
      <div class="swm-checks">${rows}</div>`,
    buttons: [
      { action: "save", label: "Сохранить маршруты", icon: "fa-solid fa-route", default: true,
        callback: (e, b) => ({ act: "save", form: b.form }) },
      shown
        ? { action: "hide", label: "Скрыть от игроков", icon: "fa-solid fa-eye-slash", callback: () => ({ act: "hide" }) }
        : { action: "reveal", label: "Открыть игрокам", icon: "fa-solid fa-eye", callback: () => ({ act: "reveal" }) },
      { action: "open", label: "Журнал", icon: "fa-solid fa-book-open", callback: () => ({ act: "open" }) }
    ],
    rejectClose: false
  });
  if (!res) return;
  if (res.act === "open") return j?.sheet.render(true);
  if (res.act === "reveal") return reveal(s.id);
  if (res.act === "hide") return hide(s.id);
  if (res.act === "save") {
    let next = routes.filter(r => !(r.includes(s.id)));
    for (const o of others) {
      if (res.form.elements[`r_${o.id}`]?.checked) next.push([s.id, o.id]);
    }
    // сохранить исходный порядок для неизменённых маршрутов
    const kept = routes.filter(r => r.includes(s.id) && next.some(n => sameRoute(n, r[0], r[1])));
    next = [...routes.filter(r => !r.includes(s.id)), ...kept,
      ...next.filter(n => n.includes(s.id) && !kept.some(k => sameRoute(k, n[0], n[1])))];
    return setRoutes(next);
  }
}

/* -------------------------------------------- */
/*  Миграция с временного решения               */
/* -------------------------------------------- */

const OLD_RING_TEXTS = ["10 св. лет — край сенсоров", "15 св. лет — предел"];
const OLD_MACROS = ["Звезда: клик и наведение", "Маршруты ближнего пояса"];

/**
 * Убрать временную карту (тайлы звёзд, мишени Monk's, рисунки маршрутов, колец, подписей).
 * @param {object} [o]
 * @param {boolean} [o.dryRun=true]         только показать, что будет сделано
 * @param {boolean} [o.revealVisible=true]  системам, чьи тайлы сейчас видны игрокам, выдать «Наблюдателя»
 *                                          (раньше видимость задавали тайлы, теперь — права на журнал)
 * @param {boolean} [o.deleteMacros=false]  удалить старые макросы (иначе — пометить устаревшими)
 */
export async function migrate({ dryRun = true, revealVisible = true, deleteMacros = false } = {}) {
  if (!requireGM()) return null;
  const scene = requireScene();
  if (!scene) return null;
  const W = t => t.flags?.world ?? {};
  const S = t => t.flags?.swm ?? {};
  const tiles = scene.tiles.filter(t => W(t).role === "art" || W(t).hit || (W(t).sys && /swm\/maps\/sector\//.test(t.texture?.src ?? "")));
  const drawings = scene.drawings.filter(d => W(d).route || W(d).ring || W(d).label || S(d).route || S(d).ring
    || OLD_RING_TEXTS.includes(d.text));
  const visibleSys = new Set(tiles.filter(t => W(t).role === "art" && !t.hidden).map(t => String(W(t).sys)));
  const toReveal = [];
  if (revealVisible) {
    for (const sys of visibleSys) {
      const j = journalBySys(sys);
      if (j && !visibleToPlayers(j)) toReveal.push(j);
    }
  }
  const macros = game.macros.filter(m => OLD_MACROS.includes(m.name));
  const report = {
    scene: scene.name,
    tiles: tiles.length,
    drawings: drawings.length,
    reveal: toReveal.map(j => j.name),
    macros: macros.map(m => `${m.name} → ${deleteMacros ? "удалить" : "пометить устаревшим"}`),
    dryRun
  };
  if (dryRun) {
    console.log("swm-core | миграция (проверка):", report);
    return report;
  }
  if (tiles.length) await scene.deleteEmbeddedDocuments("Tile", tiles.map(t => t.id));
  if (drawings.length) await scene.deleteEmbeddedDocuments("Drawing", drawings.map(d => d.id));
  for (const j of toReveal) await j.update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER });
  for (const m of macros) {
    if (deleteMacros) await m.delete();
    else if (!m.name.startsWith("[устарел]")) {
      await m.update({
        name: `[устарел] ${m.name}`,
        command: `// Устарел: карту сектора рисует модуль swm-core.\n// Маршруты — game.modules.get("swm-core").api.openRoutes() или правый клик по звезде.\nui.notifications.info("Этот макрос устарел: карту рисует модуль swm-core.");\n`
      });
    }
  }
  ui.notifications.info(`Карта сектора: убрано тайлов ${tiles.length}, рисунков ${drawings.length}.`);
  return report;
}

export { readSystems };

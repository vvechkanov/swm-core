/**
 * swm-core — точка входа.
 * Модуль работает только в мирах системы SWADE: модули на сервере общие с другими мирами.
 */
import { MODULE_ID } from "./const.js";
import { SectorLayer } from "./sector/layer.js";
import { isSectorScene } from "./sector/data.js";
import * as gm from "./sector/gm.js";
import { registerJournalHooks } from "./theme/journal.js";

export { MODULE_ID };

const active = () => game.system?.id === "swade";

Hooks.once("init", () => {
  if (!active()) return;

  game.settings.register(MODULE_ID, "theme", {
    name: "SWM.Settings.Theme.Name",
    hint: "SWM.Settings.Theme.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: applyTheme
  });

  game.settings.register(MODULE_ID, "animate", {
    name: "SWM.Settings.Animate.Name",
    hint: "SWM.Settings.Animate.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: v => canvas.swmSector?.setAnimate(v)
  });

  game.settings.register(MODULE_ID, "nebula", {
    name: "SWM.Settings.Nebula.Name",
    hint: "SWM.Settings.Nebula.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => canvas.swmSector?.redraw()
  });

  CONFIG.Canvas.layers.swmSector = { layerClass: SectorLayer, group: "interface" };

  const module = game.modules.get(MODULE_ID);
  module.api = {
    version: module.version,
    /** Добавить разведанный маршрут между системами (id из флага world.sys). */
    addRoute: gm.addRoute,
    /** Убрать маршрут. */
    removeRoute: gm.removeRoute,
    /** Открыть систему игрокам (по умолчанию право «Наблюдатель» на журнал). */
    reveal: gm.reveal,
    /** Скрыть систему от игроков. */
    hide: gm.hide,
    /** Перерисовать карту у себя. У остальных она перерисуется сама при изменении данных. */
    redraw: () => canvas.swmSector?.redraw(),
    /** Окно маршрутов (порт макроса «Маршруты ближнего пояса»). */
    openRoutes: gm.openRoutesDialog,
    /** Убрать временную карту из тайлов и рисунков. По умолчанию только проверка: migrate({dryRun:false}). */
    migrate: gm.migrate,
    /**
     * Мастеру: показать карту у себя так, как её видит игрок (по имени или id). Без аргумента — вернуть свой вид.
     * Меняет только картинку у мастера, документы не трогает.
     */
    previewAs: (user) => {
      const layer = canvas.swmSector;
      if (!layer || !game.user.isGM) return;
      layer.viewAs = user ? (game.users.get(user) ?? game.users.getName(user) ?? null) : null;
      if (user && !layer.viewAs) ui.notifications.warn(`Нет пользователя «${user}».`);
      return layer.redraw();
    }
  };
});

Hooks.once("ready", () => {
  if (!active()) return;
  applyTheme(game.settings.get(MODULE_ID, "theme"));
});

registerJournalHooks();

function applyTheme(on) {
  document.body.classList.toggle("swm-theme", !!on);
}

/* -------------------------------------------- */
/*  Перерисовка карты при изменении данных      */
/* -------------------------------------------- */

const scheduleRedraw = foundry.utils.debounce(() => {
  if (canvas.ready && isSectorScene(canvas.scene)) canvas.swmSector?.redraw();
}, 150);

const isSystemJournal = (doc, changes) => !!(doc?.flags?.world?.sys || doc?.flags?.world?.contract
  || changes?.flags?.world?.sys !== undefined || changes?.flags?.world?.contract !== undefined);

Hooks.on("createJournalEntry", doc => { if (active() && isSystemJournal(doc)) scheduleRedraw(); });
Hooks.on("deleteJournalEntry", doc => { if (active() && isSystemJournal(doc)) scheduleRedraw(); });
Hooks.on("updateJournalEntry", (doc, changes) => {
  if (!active() || !isSystemJournal(doc, changes)) return;
  if ("name" in changes || "ownership" in changes || changes.flags?.world) scheduleRedraw();
});
Hooks.on("updateScene", (scene, changes) => {
  if (!active() || scene !== canvas.scene) return;
  if (changes.flags?.world || changes.flags?.["-=world"] !== undefined) scheduleRedraw();
});
Hooks.on("updateUser", (user, changes) => {
  if (active() && "role" in changes) scheduleRedraw();
});

// при выборе другого корабля — пересчитать табличку наведения
Hooks.on("controlToken", () => {
  const layer = canvas.swmSector;
  if (layer?.hover) { const h = layer.hover; layer._setHover(null); layer._setHover(h); }
});

Hooks.on("swmSectorContext", s => gm.openSystemDialog(s));

/* -------------------------------------------- */
/*  Кнопка мастера в панели сцены               */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", controls => {
  if (!active() || !game.user.isGM) return;
  const tokens = controls.tokens ?? (Array.isArray(controls) ? controls.find(c => c.name === "token") : null);
  if (!tokens) return;
  const tool = {
    name: "swmRoutes",
    title: "Маршруты ближнего пояса",
    icon: "fa-solid fa-route",
    button: true,
    order: 50,
    visible: isSectorScene(canvas?.scene),
    onChange: () => gm.openRoutesDialog()
  };
  if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
  else tokens.tools.swmRoutes = tool;
});

// панель сцены пересобирается при смене сцены — кнопка видна только на карте сектора
Hooks.on("canvasReady", () => { if (active() && game.user.isGM) ui.controls?.render?.(); });

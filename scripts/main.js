/**
 * swm-core — точка входа.
 * Модуль работает только в мирах системы SWADE: модули на сервере общие с другими мирами.
 */
export const MODULE_ID = "swm-core";

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
    default: true
  });

  const module = game.modules.get(MODULE_ID);
  module.api = { version: module.version };
});

Hooks.once("ready", () => {
  if (!active()) return;
  applyTheme(game.settings.get(MODULE_ID, "theme"));
});

function applyTheme(on) {
  document.body.classList.toggle("swm-theme", !!on);
}

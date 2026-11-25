/**
 * Карточка системы в журнале — как боковая панель (aside) в map.html:
 * кикер, заголовок, метки, сетка характеристик, «Одним прыжком отсюда».
 * Строится по флагам world.* журнала. В списке соседей — только системы, которые видит пользователь.
 */
import {
  readSystems, dist, RANGE, COLORS, CLASS_NAMES, STATUS_NAMES, sectorScene, sameRoute,
  readContracts, isActiveContract, contractLine
} from "../sector/data.js";
import { hexA } from "../sector/textures.js";

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LOTSIA = {
  home: ["дом", "#8fdcff"],
  known: ["есть", "#8fdcff"],
  partial: ["частично", "#ffcf6b"],
  unknown: ["нет", "#7fa9cf"],
  far: ["нет", "#7fa9cf"]
};

/** Первая текстовая страница журнала — на ней карточка. */
function cardPage(journal) {
  const pages = journal.pages.contents.filter(p => p.type === "text").sort((a, b) => a.sort - b.sort);
  return pages[0] ?? null;
}

function buildCard(journal) {
  const f = journal.flags?.world;
  const systems = readSystems();
  const s = systems.find(x => x.journal === journal);
  if (!s) return null;
  const home = systems.find(x => x.home) ?? null;
  const col = COLORS[s.cls] ?? COLORS.G;
  const d = home && !s.home ? dist(home, s) : null;
  const scene = sectorScene();
  const routes = scene?.getFlag("world", "routes") ?? [];

  const tags = [];
  if (s.trap) tags.push(`<span class="swm-tag warn">ловушка</span>`);
  if (s.far) tags.push(`<span class="swm-tag far">тёмная зона</span>`);
  else if (d != null) tags.push(d <= RANGE
    ? `<span class="swm-tag">в пределах ${RANGE} св. лет</span>`
    : `<span class="swm-tag far">дальше рекомендованного предела</span>`);
  if (!s.far && s.g >= 4) tags.push(`<span class="swm-tag">легко попасть</span>`);
  if (!s.far && s.g <= 1) tags.push(`<span class="swm-tag far">трудно попасть</span>`);
  if (game.user.isGM && s.hiddenFromPlayers) tags.push(`<span class="swm-tag gm">скрыта от игроков</span>`);

  const art = f.art
    ? `background-image:url("${esc(f.art)}")`
    : `background:radial-gradient(circle at 62% 42%,${hexA(col, 0.55)},${hexA(col, 0.08)} 28%,#05080f 68%)`;

  const [lotsia, lotsiaColor] = LOTSIA[s.st] ?? LOTSIA.unknown;
  const dots = s.far ? "?" : `${"●".repeat(s.g)}<span class="dim">${"●".repeat(4 - s.g)}</span>`;
  const stats = [];
  if (d != null) stats.push(`<div><small>От станции</small><span>${d.toFixed(1)} св. л.</span></div>`);
  stats.push(`<div><small>Притяжение</small><span>${dots}</span></div>`);
  stats.push(`<div><small>Класс</small><span style="font-size:14px">${esc(CLASS_NAMES[s.cls] ?? s.cls)}</span></div>`);
  stats.push(`<div><small>Лоция</small><span style="color:${lotsiaColor}">${lotsia}</span></div>`);

  const near = s.far ? [] : systems
    .filter(o => o !== s && !o.far && dist(o, s) <= RANGE)
    .sort((a, b) => dist(a, s) - dist(b, s));
  const reach = near.map(o => {
    const c = COLORS[o.cls] ?? COLORS.G;
    const known = routes.some(r => sameRoute(r, s.id, o.id));
    const cls = o.canOpen ? "" : "locked";
    return `<a class="${cls}" data-swm-open="${esc(o.journal.id)}">
      <span class="d" style="background:${c};box-shadow:0 0 8px ${c}"></span>
      <span>${esc(o.name)}${known ? ` <em>· лоция</em>` : ""}</span>
      <em>${dist(o, s).toFixed(1)} св. л.</em></a>`;
  }).join("");

  const contracts = readContracts().filter(c => isActiveContract(c) && c.sys === s.id)
    .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1));
  const contractRows = contracts.map(c => `<a class="swm-contract ${c.status}" data-swm-open="${esc(c.journal.id)}">
      <span class="d"></span>
      <span>${esc(c.name)}${c.status === "taken" ? " <em>· в работе</em>" : ""}<small>${esc(contractLine(c))}</small></span>
      <em>${c.threat ? "●".repeat(c.threat) : ""}</em></a>`).join("");

  const el = document.createElement("section");
  el.className = "swm-card";
  el.innerHTML = `
    <div class="swm-art" style='${art}'></div>
    <div class="swm-kick">${esc(CLASS_NAMES[s.cls] ?? "")} · ${esc(STATUS_NAMES[s.st] ?? "")}</div>
    <h2 class="swm-title">${esc(s.far ? "?" : s.name)}</h2>
    ${tags.length ? `<div class="swm-tags">${tags.join("")}</div>` : ""}
    <div class="swm-stats">${stats.join("")}</div>
    ${contracts.length ? `<div class="swm-kick">Заказы здесь</div><div class="swm-reach swm-contracts">${contractRows}</div>` : ""}
    ${s.far ? "" : `<div class="swm-kick">Одним прыжком отсюда</div>
    <div class="swm-reach">${reach || `<p class="none">— никого в пределах ${RANGE} св. лет</p>`}</div>`}`;
  el.querySelectorAll("[data-swm-open]").forEach(a => a.addEventListener("click", ev => {
    ev.preventDefault();
    const j = game.journal.get(a.dataset.swmOpen);
    if (j && (game.user.isGM || j.testUserPermission(game.user, "LIMITED"))) j.sheet.render(true);
  }));
  return el;
}

/** Вставить карточку в отрисованный журнал (идемпотентно). */
export function decorateJournal(journal, root) {
  if (!journal?.flags?.world?.sys || !root) return;
  const page = cardPage(journal);
  if (!page) return;
  const article = root.matches?.(`article.journal-entry-page[data-page-id="${page.id}"]`)
    ? root
    : root.querySelector?.(`article.journal-entry-page[data-page-id="${page.id}"]`);
  if (!article) return;
  const content = article.querySelector(".journal-page-content");
  if (!content) return; // режим правки
  article.querySelector(":scope .swm-card")?.remove();
  const card = buildCard(journal);
  if (!card) return;
  content.parentElement.insertBefore(card, content);
  article.classList.add("swm-has-card");
  // заголовок записи дублирует заголовок карточки (переименовать можно в боковой панели)
  article.closest(".journal-sheet")?.classList.add("swm-system-journal");
}

export function registerJournalHooks() {
  const fromApp = (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
    const doc = app?.document;
    if (!doc || !root) return;
    if (doc.documentName === "JournalEntry") decorateJournal(doc, root);
    else if (doc.documentName === "JournalEntryPage" && doc.parent) {
      // страница рендерится сама — ищем её article выше по дереву
      const art = root.closest?.("article.journal-entry-page") ?? root.querySelector?.("article.journal-entry-page") ?? root;
      decorateJournal(doc.parent, art.closest?.(".journal-entry-pages") ?? art);
    }
  };
  for (const hook of ["renderJournalEntrySheet", "renderJournalEntryPageSheet",
    "renderJournalEntryPageTextSheet", "renderJournalEntryPageProseMirrorSheet"]) {
    Hooks.on(hook, (app, html) => {
      if (game.system.id !== "swade") return;
      try { fromApp(app, html); } catch (e) { console.warn("swm-core | карточка журнала:", e); }
    });
  }
}

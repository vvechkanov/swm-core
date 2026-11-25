/**
 * Слой карты сектора. Рисует «живую» версию map.html поверх сцены с флагом world.sector.
 *
 * Единицы. Размеры из map.html заданы в экранных пикселях при масштабе карты ~30 px на св. год.
 * В Foundry 1 св. год = 100 px сцены, а масштаб сцены s меняется колесом. Поэтому:
 *  - u = 1/s — сколько пикселей сцены в одном экранном пикселе (толщины линий, подписи);
 *  - zz = sqrt(MAPZ * s) — как в map.html, звёзды растут при приближении, но медленнее карты.
 *
 * Звёзды, маршруты и кольца лежат в группе primary (под токенами кораблей),
 * подписи, таблички и наведение — в самом слое (группа interface, над токенами).
 */
import {
  GRID, RANGE, COLORS, readSystems, readRoutes, isSectorScene, dist, zoneOf
} from "./data.js";
import { glowTexture, rayTexture, zoneTexture, darkTexture, scanlineTexture, sweepTexture, toNum, hexA } from "./textures.js";
import { MODULE_ID } from "../const.js";
import { createNebula, nebulaSupported } from "./nebula.js";

/** Масштаб сцены → «зум» map.html (там ~30 px на св. год, здесь 100). */
const MAPZ = 100 / 30;
/** Пикселей сцены на «пиксель макета» у неподвижных надписей (легенда, линейка). */
const HUDK = 3;

const CYAN = 0x6fd6ff;
const SUB = 0x7fa9cf;

function rng(seed) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }
const DEBRIS = (() => {
  const R = rng(31);
  return Array.from({ length: 90 }, () => ({
    a: R() * 6.283, r: 1.8 + R() * 3.2, sp: 0.15 + R() * 0.25, sz: 0.5 + R() * 1.4, gl: R() < 0.12, ph: R() * 6.28
  }));
})();

export async function loadFonts() {
  const specs = ["300 16px Unbounded", "500 16px Unbounded", "700 16px Unbounded",
    "400 16px Onest", "500 16px Onest", "600 16px Onest"];
  try { await Promise.all(specs.map(f => document.fonts.load(f, "АЯ az 09"))); } catch (e) { /* шрифты не критичны */ }
}

function text(str, { family = "Onest", weight = "500", size = 11, fill = "#e6f4ff", spacing = 0, align = "left", shadow = true } = {}) {
  const PT = foundry.canvas.containers.PreciseText ?? PIXI.Text;
  const style = new PIXI.TextStyle({
    fontFamily: [family, "Onest", "Segoe UI", "sans-serif"],
    fontWeight: String(weight),
    fontSize: size,
    fill,
    letterSpacing: spacing,
    align,
    lineHeight: Math.round(size * 1.35),
    dropShadow: shadow,
    dropShadowColor: "#000000",
    dropShadowBlur: shadow ? 6 : 0,
    dropShadowDistance: 0,
    dropShadowAlpha: 0.9,
    padding: 8
  });
  const t = new PT(str, style);
  t.resolution = Math.max(2, window.devicePixelRatio || 1);
  return t;
}

/** Табличка-«таблетка»: строки текста в скруглённой рамке. Центр — в (0,0). */
function pill(lines, { border = "rgba(111,214,255,.5)", radius = 9, padX = 7, padY = 3 } = {}) {
  const c = new PIXI.Container();
  const texts = lines.map(l => text(l.text, { size: 11, weight: "500", fill: "#e6f6ff", shadow: false, ...l }));
  let w = 0, h = 0;
  for (const t of texts) { w = Math.max(w, t.width); h += t.height - 4; }
  w += padX * 2; h += padY * 2;
  const bg = new PIXI.Graphics();
  const m = /rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)/.exec(border);
  const bcol = m ? (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]) : toNum(border);
  const balpha = m?.[4] ? Number(m[4]) : 1;
  bg.lineStyle({ width: 1, color: bcol, alpha: balpha });
  bg.beginFill(0x030914, 0.82);
  bg.drawRoundedRect(-w / 2, -h / 2, w, h, Math.min(radius, h / 2));
  bg.endFill();
  c.addChild(bg);
  let y = -h / 2 + padY - 2;
  for (const t of texts) {
    t.anchor.set(0.5, 0);
    t.position.set(0, y);
    y += t.height - 4;
    c.addChild(t);
  }
  c.pillWidth = w; c.pillHeight = h;
  return c;
}

export class SectorLayer extends foundry.canvas.layers.CanvasLayer {
  constructor() {
    super();
    this.eventMode = "passive";
    this.interactiveChildren = true;
    this.enabled = false;
  }

  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: "swmSector", zIndex: 150 });
  }

  /* -------------------------------------------- */
  /*  Жизненный цикл                              */
  /* -------------------------------------------- */

  async _draw(options) {
    this.enabled = game.system.id === "swade" && isSectorScene(canvas.scene);
    if (!this.enabled) return;
    await loadFonts();
    if (!canvas.scene || !isSectorScene(canvas.scene)) return;

    this.T = 0;
    this.hover = null;
    this.ringAngle = 0;
    this._scale = null;
    try { this.animate = game.settings.get(MODULE_ID, "animate"); } catch (e) { this.animate = true; }

    this.systems = readSystems(this.viewAs ?? game.user);
    this.byId = new Map(this.systems.map(s => [s.id, s]));
    this.routes = readRoutes(canvas.scene, this.systems);
    this.home = this.systems.find(s => s.home) ?? null;

    // Нижняя часть — под токенами (primary), верхняя — над ними (этот слой).
    this.visual = new PIXI.Container();
    this.visual.name = "swmSectorVisual";
    this._attachVisual(this.visual);

    this.zoneLayer = this.visual.addChild(new PIXI.Container());
    this.ringLayer = this.visual.addChild(new PIXI.Container());
    this.routeLayer = this.visual.addChild(new PIXI.Container());
    this.lightLayer = this.visual.addChild(new PIXI.Container());
    this.starLayer = this.visual.addChild(new PIXI.Container());

    this.hudLayer = this.addChild(new PIXI.Container());
    this.labelLayer = this.addChild(new PIXI.Container());
    this.pillLayer = this.addChild(new PIXI.Container());
    this.hoverLayer = this.addChild(new PIXI.Container());
    this.holoLayer = this.addChild(new PIXI.Container());
    this.holoLayer.eventMode = "none";
    this.hitLayer = this.addChild(new PIXI.Container());
    this.hitLayer.eventMode = "passive";

    this._buildNebula();
    this._buildZone();
    this._buildRings();
    this._buildRoutes();
    this._buildStars();
    this._buildLabels();
    this._buildHud();
    this._buildHits();
    this._buildHolo();
    this._rescale(canvas.stage.scale.x);
    this._animateFrame(0);

    canvas.app.ticker.add(this._tick, this);
  }

  async _tearDown(options) {
    canvas.app?.ticker?.remove(this._tick, this);
    if (this.visual && !this.visual.destroyed) {
      this.visual.parent?.removeChild(this.visual);
      this.visual.destroy({ children: true });
    }
    this.visual = null;
    if (this.bgVisual && !this.bgVisual.destroyed) {
      this.bgVisual.parent?.removeChild(this.bgVisual);
      this.bgVisual.destroy({ children: true });
    }
    this.bgVisual = null;
    this.nebula = null;
    this.hover = null;
    this.enabled = false;
    return super._tearDown(options);
  }

  _attachVisual(container) {
    const primary = canvas.primary;
    const layers = primary?.constructor?.SORT_LAYERS ?? foundry.canvas.groups.PrimaryCanvasGroup?.SORT_LAYERS;
    if (primary && layers) {
      // Между тайлами и рисунками/токенами.
      container.elevation = 0;
      container.sortLayer = (layers.TILES ?? 500) + 50;
      container.sort = 0;
      container.zIndex = 0;
      primary.addChild(container);
      primary.sortDirty = true;
    } else {
      this.addChildAt(container, 0);
    }
  }

  /** Живая туманность из map.html поверх фона сцены (настройка клиента «Живая туманность»). */
  _buildNebula() {
    let on = true;
    try { on = game.settings.get(MODULE_ID, "nebula"); } catch (e) { /* настройка не зарегистрирована */ }
    if (!on || !nebulaSupported()) return;
    const d = canvas.dimensions;
    const rect = new PIXI.Rectangle(d.sceneX, d.sceneY, d.sceneWidth, d.sceneHeight);
    const center = this.home ? { x: this.home.px, y: this.home.py } : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    this.nebula = createNebula(rect, center);
    const bg = new PIXI.Container();
    bg.name = "swmSectorNebula";
    bg.addChild(this.nebula);
    const primary = canvas.primary;
    const layers = primary?.constructor?.SORT_LAYERS;
    if (primary && layers) {
      // сразу над картинкой фона сцены, под тайлами
      bg.elevation = 0; bg.sortLayer = (layers.SCENE ?? 0) + 1; bg.sort = 0; bg.zIndex = 0;
      primary.addChild(bg);
      primary.sortDirty = true;
    } else {
      this.addChildAt(bg, 0);
    }
    this.bgVisual = bg;
  }

  /** Перечитать данные и перерисовать (вызывается хуками и API). */
  redraw() {
    if (!canvas.ready) return;
    return this.draw();
  }

  setAnimate(on) {
    this.animate = !!on;
  }

  /* -------------------------------------------- */
  /*  Построение                                  */
  /* -------------------------------------------- */

  _buildZone() {
    if (!this.home) return;
    const R = RANGE * GRID.px;
    const zone = new PIXI.Sprite(zoneTexture());
    zone.anchor.set(0.5);
    zone.position.set(this.home.px, this.home.py);
    zone.width = zone.height = 2 * R;
    const dark = new PIXI.Sprite(darkTexture());
    dark.anchor.set(0.5);
    dark.position.set(this.home.px, this.home.py);
    dark.width = dark.height = 2 * 2.6 * R;
    this.zoneLayer.addChild(zone, dark);
  }

  _buildRings() {
    if (!this.home) return;
    const c = this.ringLayer;
    c.position.set(this.home.px, this.home.py);
    this.ring5 = c.addChild(new PIXI.Graphics());
    this.ring10 = c.addChild(new PIXI.Container());
    this.ring10Glow = this.ring10.addChild(new PIXI.Graphics());
    this.ring10Dash = this.ring10.addChild(new PIXI.Graphics());
    this.ringTicks = c.addChild(new PIXI.Graphics());
    // подписи колец — в верхнем слое, чтобы не темнели под токенами
    this.ringLabel = this.labelLayer.addChild(text("РЕКОМЕНДОВАННЫЙ ПРЕДЕЛ · 10 СВ. ЛЕТ",
      { size: 11, weight: "500", fill: "#9fc3e4", spacing: 3 }));
    this.ringLabel.anchor.set(0.5, 1);
    this.ring5Label = this.labelLayer.addChild(text("5", { size: 10, weight: "400", fill: "rgba(127,169,207,.55)", shadow: false }));
    this.ring5Label.anchor.set(0, 1);
  }

  /** Перестроить то, что зависит от масштаба: толщины линий, пунктир, засечки. */
  _rebuildScaled() {
    const u = this.u, zz = this.zz;
    if (this.holo) this.holo.scan.tileScale.set(u * 0.75);
    if (this.home) {
      const R = RANGE * GRID.px, R5 = 5 * GRID.px;
      this.ring5.clear().lineStyle({ width: 1 * u, color: CYAN, alpha: 0.09 }).drawCircle(0, 0, R5);
      // пунктир 2/7 экранных пикселей со свечением
      const dash = 2 * u, gap = 7 * u, step = (dash + gap) / R, da = dash / R;
      const g = this.ring10Glow.clear(), d = this.ring10Dash.clear();
      g.lineStyle({ width: 7 * u, color: 0x3b8fd1, alpha: 0.16, cap: PIXI.LINE_CAP.ROUND });
      d.lineStyle({ width: 1.3 * u, color: CYAN, alpha: 0.85, cap: PIXI.LINE_CAP.ROUND });
      for (let a = 0; a < Math.PI * 2 - step / 2; a += step) {
        const x1 = Math.cos(a) * R, y1 = Math.sin(a) * R, x2 = Math.cos(a + da) * R, y2 = Math.sin(a + da) * R;
        g.moveTo(x1, y1).lineTo(x2, y2);
        d.moveTo(x1, y1).lineTo(x2, y2);
      }
      const t = this.ringTicks.clear().lineStyle({ width: 1 * u, color: CYAN, alpha: 0.45 });
      for (let a = 0; a < 360; a += 5) {
        const ra = a * Math.PI / 180, l = (a % 30 ? 3 : a % 90 ? 7 : 12) * u;
        t.moveTo(Math.cos(ra) * R, Math.sin(ra) * R).lineTo(Math.cos(ra) * (R + l), Math.sin(ra) * (R + l));
      }
      this.ringLabel.scale.set(u);
      this.ringLabel.position.set(this.home.px, this.home.py - R - 18 * u);
      this.ring5Label.scale.set(u);
      this.ring5Label.position.set(this.home.px + R5 + 4 * u, this.home.py - 4 * u);
    }

    // маршруты: широкий мягкий ореол, свечение и тонкая яркая сердцевина
    const rg = this.routeGfx.clear();
    for (const [w, col, al] of [[7, 0x2aa8ff, 0.18], [3.5, 0x2aa8ff, 0.35], [1.6, CYAN, 0.95]]) {
      rg.lineStyle({ width: w * u, color: col, alpha: al, cap: PIXI.LINE_CAP.ROUND });
      for (const [a, b] of this.routes) rg.moveTo(a.px, a.py).lineTo(b.px, b.py);
    }
    for (const p of this.routePills) p.scale.set(u);

    // звёзды и подписи
    for (const s of this.systems) {
      const v = s.view;
      v.scale.set(zz * u);
      const lab = s.label;
      if (lab) {
        const k = Math.max(1, zz * 0.9) * u;
        lab.position.set(s.px + lab.ox * k, s.py + lab.oy * k);
        lab.scale.set(u);
      }
      if (s.hit) s.hit.hitArea = new PIXI.Circle(0, 0, Math.max(s.hitR * zz, 12) * u);
    }
  }

  _buildRoutes() {
    this.routeGfx = this.routeLayer.addChild(new PIXI.Graphics());
    this.routePills = [];
    this.routeLights = [];
    this.routes.forEach(([a, b], ri) => {
      const d = dist(a, b);
      const p = this.pillLayer.addChild(pill([{ text: `${d.toFixed(1)} св. л.` }]));
      p.position.set((a.px + b.px) / 2, (a.py + b.py) / 2);
      this.routePills.push(p);
      for (let q = 0; q < 2; q++) {
        const sp = new PIXI.Sprite(glowTexture("#9ee6ff"));
        sp.anchor.set(0.5);
        sp.blendMode = PIXI.BLEND_MODES.ADD;
        sp.route = { a, b, q, ri };
        this.lightLayer.addChild(sp);
        this.routeLights.push(sp);
      }
    });
  }

  _starRadius(s) { return (2.2 + s.g * 1.1) * (s.trap ? 1.5 : 1); }

  _buildStars() {
    for (const s of this.systems) {
      const v = new PIXI.Container();
      v.position.set(s.px, s.py);
      if (s.hiddenFromPlayers) v.alpha = 0.45;
      s.view = v;
      const col = COLORS[s.cls] ?? COLORS.G;
      const r = this._starRadius(s);
      s.r = r;
      s.hitR = s.far ? 18 : s.home ? 20 : Math.max(r * 1.5, 9);

      if (s.far) {
        const halo = new PIXI.Sprite(glowTexture("#4a6587"));
        halo.anchor.set(0.5); halo.width = halo.height = 120;
        const q = text("?", { family: "Unbounded", weight: "500", size: 16, fill: "#9fb6d4", shadow: false });
        q.anchor.set(0.5);
        v.addChild(halo, q);
        s.anim = { halo, q };
      } else if (s.trap) {
        const halo = new PIXI.Sprite(glowTexture(col));
        halo.anchor.set(0.5); halo.width = halo.height = r * 9; halo.alpha = 0.55;
        halo.blendMode = PIXI.BLEND_MODES.ADD;
        const disk = new PIXI.Graphics();
        disk.beginFill(0x07030d).drawCircle(0, 0, r * 0.95).endFill();
        disk.lineStyle({ width: 1.2, color: toNum(col), alpha: 0.9 }).drawCircle(0, 0, r * 0.95);
        const pulse = new PIXI.Graphics();
        const tilt = new PIXI.Container();
        tilt.rotation = -0.45;
        const orbit = new PIXI.Graphics();
        orbit.lineStyle({ width: 1, color: toNum(col), alpha: 0.18 }).drawEllipse(0, 0, r * 4.2, r * 1.9);
        const debris = new PIXI.Graphics();
        tilt.addChild(orbit, debris);
        v.addChild(halo, disk, pulse, tilt);
        s.anim = { pulse, debris, col: toNum(col) };
      } else {
        const unknown = s.st === "unknown";
        const halo = new PIXI.Sprite(glowTexture(col));
        halo.anchor.set(0.5);
        halo.blendMode = PIXI.BLEND_MODES.ADD;
        halo.alpha = unknown ? 0.7 : 1;
        const base = r * (unknown ? 7 : 9);
        v.addChild(halo);
        const rays = [];
        if (s.g >= 4) {
          for (const [ang, w] of [[0, 1], [Math.PI / 2, 1], [Math.PI / 4, 0.45], [-Math.PI / 4, 0.45]]) {
            const ray = new PIXI.Sprite(rayTexture(col));
            ray.anchor.set(0.5);
            ray.rotation = ang;
            ray.blendMode = PIXI.BLEND_MODES.ADD;
            ray.alpha = 0.85 * w;
            ray.height = (w > 0.5 ? 1.1 : 0.8) * 2;
            ray.w = w;
            v.addChild(ray);
            rays.push(ray);
          }
        }
        const core = new PIXI.Graphics();
        core.beginFill(0xffffff).drawCircle(0, 0, r * 0.42).endFill();
        v.addChild(core);
        s.anim = { halo, base, rays, r };
      }

      if (s.home) {
        const waves = new PIXI.Graphics();
        const ring = new PIXI.Graphics();
        ring.lineStyle({ width: 1.3, color: 0x7fe3ff }).drawCircle(0, 0, 13);
        const ticks = new PIXI.Graphics();
        ticks.lineStyle({ width: 1.3, color: 0x7fe3ff });
        for (let a = 0; a < 4; a++) {
          const ra = a * Math.PI / 2;
          ticks.moveTo(Math.cos(ra) * 15, Math.sin(ra) * 15).lineTo(Math.cos(ra) * 20, Math.sin(ra) * 20);
        }
        v.addChild(waves, ring, ticks);
        s.station = { waves, ticks };
      }

      // прицел при наведении
      const reticle = new PIXI.Graphics();
      reticle.visible = false;
      v.addChild(reticle);
      s.reticle = reticle;

      this.starLayer.addChild(v);
    }
  }

  _buildLabels() {
    for (const s of this.systems) {
      const c = new PIXI.Container();
      const place = this._labelPlacement(s);
      const right = place.right;
      c.ox = place.ox; c.oy = place.oy;
      const anchorX = right ? 0 : 1;
      if (s.far) {
        const t = text("ТЁМНАЯ ЗОНА", { size: 10.5, weight: "500", fill: "rgba(159,182,212,.75)", spacing: 2 });
        t.anchor.set(anchorX, 0.5);
        c.addChild(t);
        c.main = t;
      } else {
        const name = text(s.name.toUpperCase(), {
          family: "Unbounded", weight: s.home ? "700" : "500", size: 12, spacing: 1.5,
          fill: s.st === "unknown" ? "#b4cbe2" : "#e6f4ff"
        });
        name.anchor.set(anchorX, 0.5);
        c.addChild(name);
        c.main = name;
        let y = 15;
        if (!s.home && this.home) {
          const d = dist(this.home, s);
          const sub = text(`${d.toFixed(1)} св. л.${s.trap ? " · ловушка" : ""}`,
            { size: 11, weight: "400", spacing: 0.5, fill: s.trap ? "#d7b2ff" : "#7fa9cf" });
          sub.anchor.set(anchorX, 0.5);
          sub.y = y; y += 14;
          c.addChild(sub);
        }
        if (s.hiddenFromPlayers) {
          const h = text("скрыта от игроков", { size: 10, weight: "400", fill: "#ffb36b" });
          h.anchor.set(anchorX, 0.5);
          h.y = y;
          c.addChild(h);
        }
      }
      if (s.hiddenFromPlayers) c.alpha = 0.75;
      s.label = c;
      this.labelLayer.addChild(c);
    }
  }

  /**
   * Где поставить подпись: справа или слева от звезды, чуть выше или ниже — туда,
   * где меньше маршрутов (чтобы подпись не легла на линию и табличку расстояния).
   * Флаги журнала world.lx / world.ly / world.al задают место вручную.
   */
  _labelPlacement(s) {
    if (s.lx != null) {
      const right = s.al ? s.al === "left" : s.lx >= 0;
      return { ox: s.lx, oy: s.ly ?? 4, right };
    }
    const d = s.home ? 30 : s.trap ? 30 : 16;
    const dirs = [];
    for (const [a, b] of this.routes) {
      const o = a === s ? b : b === s ? a : null;
      if (o) dirs.push(Math.atan2(o.py - s.py, o.px - s.px));
    }
    // к станции тоже не подписываем — туда смотрит линия наведения
    if (this.home && !s.home) dirs.push(Math.atan2(this.home.py - s.py, this.home.px - s.px));
    // у края сцены — подпись внутрь, иначе по стороне от станции, как в map.html
    const d0 = canvas.dimensions;
    const nearLeft = s.px - d0.sceneX < 600, nearRight = d0.sceneX + d0.sceneWidth - s.px < 600;
    const rightFirst = nearLeft ? true : nearRight ? false : s.x >= 0;
    const pref = rightFirst ? [0, -25, 25, 180, -155, 155] : [180, -155, 155, 0, -25, 25];
    const angDist = (a, b) => { let x = Math.abs(a - b) % (2 * Math.PI); return x > Math.PI ? 2 * Math.PI - x : x; };
    let best = pref[0], bestScore = -1;
    for (const deg of pref) {
      const a = deg * Math.PI / 180;
      const score = dirs.length ? Math.min(...dirs.map(x => angDist(a, x))) : Math.PI;
      if (score > 0.75) { best = deg; bestScore = score; break; }
      if (score > bestScore) { best = deg; bestScore = score; }
    }
    const a = best * Math.PI / 180;
    const right = Math.cos(a) >= 0;
    return { ox: (right ? 1 : -1) * d, oy: Math.sin(a) * (d + 8) + 4, right };
  }

  /** Неподвижное: заголовок, «к Ядру», легенда, шкала. В координатах сцены. */
  _buildHud() {
    const d = canvas.dimensions;
    const W = d.sceneWidth, H = d.sceneHeight, X = d.sceneX, Y = d.sceneY;
    const hud = this.hudLayer;
    const k = HUDK, m = 24 * k;

    const title = new PIXI.Container();
    const t1 = text("БЛИЖНИЙ ПОЯС", { family: "Unbounded", weight: "500", size: 13, spacing: 2.6, fill: "#f2f9ff" });
    const t2 = text("ЛОЦИЯ · КАРТА СЕКТОРА", { size: 12, spacing: 1.7, fill: "#7fa9cf" });
    t2.y = 20;
    title.addChild(t1, t2);
    title.scale.set(k);
    title.position.set(X + m, Y + m);
    hud.addChild(title);

    if (this.home) {
      const core = new PIXI.Container();
      const arrow = text("◀", { size: 12, fill: "#9fc3e4" });
      arrow.anchor.set(0, 0.5);
      const line = new PIXI.Graphics();
      for (let i = 0; i < 34; i++) line.lineStyle({ width: 1, color: CYAN, alpha: 1 - i / 34 }).moveTo(18 + i, 0).lineTo(19 + i, 0);
      const lab = text("К ЯДРУ ИМПЕРИИ · ПО КАТАПУЛЬТЕ", { size: 12, spacing: 1.7, fill: "#9fc3e4" });
      lab.anchor.set(0, 0.5);
      lab.x = 60;
      core.addChild(arrow, line, lab);
      core.scale.set(k);
      core.position.set(X + m, Y + H / 2); // как в map.html — посередине высоты
      hud.addChild(core);
    }

    // легенда
    const leg = new PIXI.Container();
    let x = 0;
    const item = (draw, label) => {
      const g = new PIXI.Graphics();
      draw(g);
      g.x = x;
      const t = text(label, { size: 12.5, spacing: 0.75, fill: "#7fa9cf" });
      t.anchor.set(0, 0.5);
      t.x = x + 34;
      leg.addChild(g, t);
      x += 34 + t.width + 22;
    };
    item(g => g.lineStyle({ width: 2, color: CYAN }).moveTo(0, 0).lineTo(26, 0), "лоция есть");
    item(g => {
      g.lineStyle({ width: 1, color: CYAN, alpha: 0.6 });
      for (let i = 0; i < 26; i += 7) g.moveTo(i, 0).lineTo(Math.min(i + 3, 26), 0);
    }, "слепой прыжок");
    item(g => {
      g.beginFill(0xc56bff).drawCircle(8, 0, 2.5).endFill();
      g.lineStyle({ width: 1, color: 0xc56bff, alpha: 0.6 }).drawCircle(8, 0, 6);
    }, "ловушка");
    item(g => {
      g.beginFill(0xfff1b8, 0.25).drawCircle(8, 0, 7).endFill();
      g.beginFill(0xffffff).drawCircle(8, 0, 3).endFill();
    }, "ярче — легче попасть");
    leg.scale.set(k);
    leg.position.set(X + m, Y + H - m);
    hud.addChild(leg);

    // шкала 5 св. лет — честные 500 px сцены
    const L5 = 5 * GRID.px;
    const bar = new PIXI.Graphics();
    bar.lineStyle({ width: 1 * k, color: 0x9fc3e4, alpha: 0.7 });
    const bx = X + W - m - L5, by = Y + H - m;
    bar.moveTo(bx, by - 4 * k).lineTo(bx, by).lineTo(bx + L5, by).lineTo(bx + L5, by - 4 * k);
    const bl = text("5 св. лет", { size: 11, fill: "#9fc3e4" });
    bl.anchor.set(0.5, 1);
    bl.scale.set(k);
    bl.position.set(bx + L5 / 2, by - 8 * k);
    hud.addChild(bar, bl);
  }

  /**
   * Голограмма «над столом на мостике»: сканлинии (в экранных пикселях), медленная полоса
   * развёртки и лёгкое мерцание всей проекции. Без анимации — только неподвижные сканлинии.
   */
  _buildHolo() {
    const d = canvas.dimensions;
    const r = new PIXI.Rectangle(d.sceneX, d.sceneY, d.sceneWidth, d.sceneHeight);
    this.holoRect = r;
    const scan = new PIXI.TilingSprite(scanlineTexture(), r.width, r.height);
    scan.position.set(r.x, r.y);
    scan.blendMode = PIXI.BLEND_MODES.ADD;
    scan.alpha = 0.05;
    const sweep = new PIXI.Sprite(sweepTexture());
    sweep.blendMode = PIXI.BLEND_MODES.ADD;
    sweep.width = r.width;
    sweep.height = 420;
    sweep.x = r.x;
    sweep.alpha = 0.07;
    const mask = new PIXI.Graphics().beginFill(0xffffff).drawRect(r.x, r.y, r.width, r.height).endFill();
    this.holoLayer.addChild(scan, sweep, mask);
    sweep.mask = mask;
    this.holo = { scan, sweep, mask, glitch: 0, nextGlitch: 4 + Math.random() * 8 };
  }

  _buildHits() {
    for (const s of this.systems) {
      const h = new PIXI.Container();
      h.position.set(s.px, s.py);
      h.eventMode = "static";
      h.cursor = "pointer";
      h.hitArea = new PIXI.Circle(0, 0, 20);
      h.on("pointerover", () => this._setHover(s));
      h.on("pointerout", () => { if (this.hover === s) this._setHover(null); });
      h.on("pointerdown", ev => this._onPointerDown(ev, s));
      s.hit = h;
      this.hitLayer.addChild(h);
    }
  }

  /* -------------------------------------------- */
  /*  Ввод                                        */
  /* -------------------------------------------- */

  _onPointerDown(ev, s) {
    ev.stopPropagation();
    const button = ev.button ?? ev.data?.button ?? 0;
    if (button === 2) {
      if (game.user.isGM) Hooks.callAll("swmSectorContext", s);
      return;
    }
    if (button !== 0) return;
    if (s.canOpen) s.journal.sheet.render(true);
  }

  _setHover(s) {
    if (this.hover === s) return;
    if (this.hover?.reticle) this.hover.reticle.visible = false;
    if (this.hover?.label?.main) this.hover.label.main.style.fill = this.hover.label.baseFill ?? this.hover.label.main.style.fill;
    this.hover = s;
    this.hoverLayer.removeChildren().forEach(c => c.destroy({ children: true }));
    this.hoverLine = null;
    if (!s) return;
    s.reticle.visible = true;
    if (s.label?.main) {
      s.label.baseFill ??= s.label.main.style.fill;
      s.label.main.style.fill = "#ffffff";
    }
    this._buildHoverInfo(s);
    this._animateFrame(0);
  }

  /** Откуда меряем: выбранный токен-корабль или станция. */
  _origin() {
    const tok = canvas.tokens?.controlled?.[0];
    if (tok) {
      const c = tok.center;
      // если токен стоит на системе — считаем, что прыжок оттуда
      let near = null, best = 0.5 * GRID.px;
      for (const s of this.systems) {
        const dd = Math.hypot(s.px - c.x, s.py - c.y);
        if (dd < best) { best = dd; near = s; }
      }
      return { x: c.x, y: c.y, name: tok.name, sys: near };
    }
    if (!this.home) return null;
    return { x: this.home.px, y: this.home.py, name: this.home.name, sys: this.home };
  }

  _buildHoverInfo(s) {
    const o = this._origin();
    if (!o) return;
    const dx = s.px - o.x, dy = s.py - o.y;
    const len = Math.hypot(dx, dy);
    const d = len / GRID.px;
    if (d < 0.3) return;
    const zone = zoneOf(d);
    const known = o.sys && this.routes.some(([a, b]) =>
      (a === o.sys && b === s) || (b === o.sys && a === s));
    const line = new PIXI.Graphics();
    this.hoverLayer.addChild(line);
    const lines = [
      { text: `${o.name} → ${s.far ? "?" : s.name}`, weight: "600", size: 12, fill: "#f2f9ff" },
      { text: `${d.toFixed(1)} св. л. · ${zone.label}`, size: 11, fill: hexA(zone.color, 1) }
    ];
    if (known) lines.push({ text: "маршрут разведан", size: 11, fill: "#6fd6ff" });
    const p = pill(lines, { border: hexA(zone.color, 0.6), radius: 12, padX: 10, padY: 5 });
    this.hoverLayer.addChild(p);
    this.hoverLine = { line, pill: p, o, s, len, ux: dx / len, uy: dy / len, color: zone.color };
  }

  /* -------------------------------------------- */
  /*  Кадр                                        */
  /* -------------------------------------------- */

  _rescale(s) {
    this._scale = s;
    if (this.nebula) this.nebula.shader.uniforms.uS = s;
    this.u = 1 / s;
    this.zz = Math.sqrt(MAPZ * s);
    this._rebuildScaled();
  }

  _tick() {
    if (!this.enabled || !this.visual || this.visual.destroyed) return;
    const s = canvas.stage.scale.x;
    if (!this._scale || Math.abs(s - this._scale) / this._scale > 0.01) this._rescale(s);
    const dt = Math.min(0.05, canvas.app.ticker.deltaMS / 1000);
    if (this.animate) this.T += dt;
    if (this.animate || this.hoverLine) this._animateFrame(dt);
  }

  _animateFrame(dt) {
    const T = this.T, u = this.u ?? 1, zz = this.zz ?? 1;
    this._animateHolo(dt);
    if (this.nebula) this.nebula.shader.uniforms.uT = T;
    if (this.ring10 && this.animate) {
      // пунктир бежит по кольцу ~8 экранных px в секунду
      this.ringAngle += dt * 8 * u / (RANGE * GRID.px);
      this.ring10.rotation = -this.ringAngle;
    }

    for (const sp of this.routeLights ?? []) {
      const { a, b, q, ri } = sp.route;
      const ph = (T * 0.09 + q * 0.5 + ri * 0.23) % 1;
      const p = q === 0 ? ph : 1 - ph;
      sp.position.set(a.px + (b.px - a.px) * p, a.py + (b.py - a.py) * p);
      sp.alpha = this.animate ? Math.sin(Math.PI * ph) : 0;
      sp.width = sp.height = 18 * zz * u;
    }

    for (const s of this.systems ?? []) {
      const A = s.anim;
      if (!A) continue;
      if (s.far) {
        const fl = this.animate ? 0.55 + 0.25 * Math.sin(T * 1.7 + s.x) + 0.1 * Math.sin(T * 5.3 + s.y) : 0.75;
        A.halo.alpha = 0.5 * fl;
        A.q.alpha = fl;
      } else if (s.trap) {
        const r = s.r, g = A.pulse.clear();
        for (let k = 0; k < 3; k++) {
          const ph = ((T * 0.35) + k / 3) % 1;
          g.lineStyle({ width: 1, color: A.col, alpha: 0.45 * (1 - ph) }).drawCircle(0, 0, r * (1.6 + ph * 4.5));
        }
        const db = A.debris.clear();
        for (const d of DEBRIS) {
          const a = d.a + T * d.sp / (d.r * 0.6);
          const x = Math.cos(a) * d.r * r * 1.25, y = Math.sin(a) * d.r * r * 0.55;
          const front = Math.sin(a) > 0;
          const glint = d.gl && Math.sin(T * 3 + d.ph) > 0.6;
          db.beginFill(glint ? 0xffffff : 0xa99bbf, front ? 0.85 : 0.35).drawRect(x, y, d.sz, d.sz).endFill();
        }
      } else {
        const tw = 1 + 0.05 * Math.sin(T * 2.1 + s.x * 3);
        A.halo.width = A.halo.height = A.base * tw;
        for (const ray of A.rays) ray.width = A.r * 7 * tw * 2;
      }
      if (s.station) {
        const w = s.station.waves.clear();
        for (let k = 0; k < 2; k++) {
          const ph = ((T / 2.6) + k * 0.5) % 1;
          w.lineStyle({ width: 1.2, color: 0x7fe3ff, alpha: 0.55 * (1 - ph) }).drawCircle(0, 0, 12 + ph * 58);
        }
        s.station.ticks.rotation = T * 0.25;
      }
    }

    // прицел и линия наведения
    const h = this.hover;
    if (h?.reticle) {
      const rr = h.r + 18 + Math.sin(T * 3) * 1.5;
      const g = h.reticle.clear();
      g.lineStyle({ width: 1.6, color: 0x7fe3ff, alpha: 0.95 });
      for (let q = 0; q < 4; q++) {
        const base = q * Math.PI / 2 + T * 0.5;
        g.moveTo(Math.cos(base - 0.32) * rr, Math.sin(base - 0.32) * rr).arc(0, 0, rr, base - 0.32, base + 0.32);
        g.moveTo(Math.cos(base) * (rr + 3), Math.sin(base) * (rr + 3)).lineTo(Math.cos(base) * (rr + 9), Math.sin(base) * (rr + 9));
      }
    }
    const L = this.hoverLine;
    if (L && !L.line.destroyed) {
      const g = L.line.clear();
      const pad0 = this._padFor(L.o.sys, L.o), pad1 = this._padFor(L.s);
      const dash = 9 * u, gap = 7 * u, off = ((T * 14 * u) % (dash + gap));
      g.lineStyle({ width: 2 * u, color: L.color, alpha: 0.9, cap: PIXI.LINE_CAP.ROUND });
      for (let p = pad0 - (dash + gap) + off; p < L.len - pad1; p += dash + gap) {
        const a = Math.max(p, pad0), b = Math.min(p + dash, L.len - pad1);
        if (b <= a) continue;
        g.moveTo(L.o.x + L.ux * a, L.o.y + L.uy * a).lineTo(L.o.x + L.ux * b, L.o.y + L.uy * b);
      }
      // табличка сбоку от линии, а не на ней
      let nx = -L.uy, ny = L.ux;
      if (nx < 0 || (nx === 0 && ny > 0)) { nx = -nx; ny = -ny; }
      const pw = L.pill.pillWidth, ph = L.pill.pillHeight;
      const off2 = 16 + Math.abs(nx) * pw / 2 + Math.abs(ny) * ph / 2;
      L.pill.scale.set(u);
      // ближе к цели: у станции тесно от табличек маршрутов
      const t = 0.7;
      L.pill.position.set(L.o.x + (L.s.px - L.o.x) * t + nx * off2 * u, L.o.y + (L.s.py - L.o.y) * t + ny * off2 * u);
    }
  }

  _animateHolo(dt) {
    const H = this.holo;
    if (!H) return;
    if (!this.animate) {
      H.sweep.visible = false;
      this.visual.alpha = 0.94;
      this.labelLayer.alpha = this.pillLayer.alpha = 0.94;
      return;
    }
    const T = this.T, r = this.holoRect;
    H.sweep.visible = true;
    // полоса проходит сцену сверху вниз за ~9 с
    const period = 9;
    H.sweep.y = r.y - H.sweep.height + ((T % period) / period) * (r.height + H.sweep.height);
    H.scan.tilePosition.y = (T * 6) % 64;
    // мерцание: ровный фон с редкими короткими сбоями
    let a = 0.93 + 0.025 * Math.sin(T * 7.3) + 0.015 * Math.sin(T * 23.1);
    if (T > H.nextGlitch) { H.glitch = 0.18; H.nextGlitch = T + 5 + Math.random() * 10; }
    if (H.glitch > 0) { a -= 0.12 * Math.abs(Math.sin(H.glitch * 60)); H.glitch -= dt; }
    this.visual.alpha = a;
    this.labelLayer.alpha = this.pillLayer.alpha = Math.min(1, a + 0.03);
  }

  _padFor(sys, origin) {
    if (!sys) return 30 * (this.u ?? 1);
    if (origin && Math.hypot(sys.px - origin.x, sys.py - origin.y) > 5) return 30 * (this.u ?? 1);
    return (sys.r + 14) * (this.zz ?? 1) * (this.u ?? 1);
  }
}

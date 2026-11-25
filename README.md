# swm-core

Модуль Foundry VTT для мира **Space West Marches** (система SWADE):

- **тема «Лоция»** — интерфейс и журналы в стиле вики «Ближний пояс» (шрифты Unbounded и Onest внутри модуля);
- **живая карта сектора** — звёзды, маршруты и кольцо дальности рисуются модулем по данным мира (журналы систем и флаги сцены).

В мирах других систем модуль ничего не делает (и Foundry предлагает его только для SWADE).

Foundry **14** (проверено на 14.368), SWADE 6.

## Установка

Foundry → **Add-on Modules** → **Install Module** → в поле **Manifest URL** вставить:

```
https://github.com/vvechkanov/swm-core/releases/latest/download/module.json
```

Потом включить модуль в мире: **Game Settings → Manage Modules → Space West Marches — ядро**.

Обновления приходят сами: в списке модулей появится кнопка **Update** (или «Check for Updates»).

## Как выпустить версию

1. Поменять код, закоммитить в `main`.
2. Поставить тег с новой версией и запушить:
   ```
   git tag v0.2.0
   git push origin main --tags
   ```
3. GitHub Actions (`.github/workflows/release.yml`) сам:
   - подставит в `module.json` версию из тега, `manifest` и `download`;
   - соберёт `module.zip`;
   - выложит релиз с `module.json` и `module.zip`.

Версию в `module.json` в репозитории руками менять не нужно: там стоит `0.0.0`, настоящая берётся из тега.

## Настройки (у каждого игрока свои)

- **Тема «Лоция»** — включить или выключить оформление.
- **Анимация карты сектора** — огоньки на маршрутах, пульсация. Выключить на слабом компьютере.

## API для макросов

```js
const api = game.modules.get("swm-core").api;
```

Описание функций — в разделе «Карта сектора» ниже (появится с версии 0.2.0).

## Лицензия

Код — MIT. Шрифты Unbounded и Onest — SIL Open Font License 1.1 (`fonts/OFL-*.txt`).

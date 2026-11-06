# Публикация Кубка России U16 LIVE

## Уже настроено в репозитории

- `src/worker.js` — API-шлюз к официальному календарю и карточкам матчей ФХР.
- `public/index.html` — адаптивная мобильная страница со списком матчей и фильтрами.
- `wrangler.toml` — Cloudflare Worker и статические Assets.
- `.github/workflows/deploy.yml` — автоматическая публикация при push в `main`.

## GitHub Secrets

В репозитории открой **Settings → Secrets and variables → Actions**. Должны быть добавлены:

1. `CLOUDFLARE_API_TOKEN` — Cloudflare API Token с правом **Account → Workers Scripts → Edit** для нужного аккаунта.
2. `CLOUDFLARE_ACCOUNT_ID` — Account ID Cloudflare.

Не отправляй API Token в чат и не вставляй его в исходный код. Если оба секрета уже добавлены, больше ничего вводить не нужно.

## Адреса

- Сайт: https://kubok-u16-live.dimasik110111.workers.dev/
- Проверка Worker: https://kubok-u16-live.dimasik110111.workers.dev/health
- Календарь: https://kubok-u16-live.dimasik110111.workers.dev/api/v1/matches
- LIVE-проверка: https://kubok-u16-live.dimasik110111.workers.dev/api/v1/live
- Карточка матча: `/api/v1/matches/{gameId}`

## Как работает LIVE

Календарь ФХР даёт расписание и опубликованный счёт. Для LIVE Worker дополнительно запрашивает карточки матчей текущего игрового дня и предыдущих восьми часов. В ответе `/api/v1/live`:

- `matches` — только матчи со статусом `LIVE` или `LIVE_PAUSED`, подтверждённым страницей ФХР;
- `checkedMatches` — все проверенные карточки, включая запланированные и завершённые;
- `liveVerified` — true, если все карточки из окна проверки удалось получить; это не означает, что сейчас обязательно идёт матч.

Периоды, игровой таймер и события показываются только если ФХР реально отдаёт их в карточке. Протокол, броски и видео не генерируются из счёта календаря.

## Проверка после публикации

GitHub → **Actions** → последний запуск **Deploy Cloudflare Worker**. Успешный запуск должен закончиться зелёным статусом. Затем открой сайт по адресу выше.

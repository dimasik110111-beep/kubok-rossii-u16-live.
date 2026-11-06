# Настройка публикации

## Уже в репозитории
- `src/worker.js` — Cloudflare Worker, который получает публичную страницу календаря ФХР и выдаёт JSON.
- `wrangler.toml` — имя существующего Worker: `kubok-u16-live`.
- `.github/workflows/deploy.yml` — автопубликация при каждом push в main.

## Один раз добавить GitHub Secrets
Открой Settings → Secrets and variables → Actions → New repository secret в репозитории.

Добавь:
1. `CLOUDFLARE_API_TOKEN` — API Token Cloudflare с разрешением **Account / Workers Scripts / Edit** для нужного аккаунта.
2. `CLOUDFLARE_ACCOUNT_ID` — Account ID из Cloudflare Dashboard.

Токен не присылай в чат. После добавления секретов открой Actions и запусти workflow **Deploy Cloudflare Worker** кнопкой Run workflow.

## Проверка
- `https://kubok-u16-live.dimasik110111.workers.dev/health`
- `https://kubok-u16-live.dimasik110111.workers.dev/api/v1/matches`

## Текущее ограничение
Парсер читает таблицу календаря ФХР. Он не доказывает реальное LIVE-состояние матча, если в строке календаря нет явного LIVE-маркера. Счёт без такого маркера помечается `SCORE_AVAILABLE`, а не `LIVE`. Период, таймер, броски и события матча не реализованы/не подтверждены. Перед использованием в приложении нужно проверить ответ во время реального матча и адаптировать парсер под фактический HTML/внутренний публичный endpoint ФХР.

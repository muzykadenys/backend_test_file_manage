# Backend (NestJS)

## Локальний запуск

1. Скопіюй конфіг: `cp .env.example .env`
2. У `.env` заповни **Supabase** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) і **DEMO_BEARER_TOKEN** (довільний секрет для демо-режиму з заголовком `Authorization`).
3. `npm install`
4. `npm run start:dev`

API: **http://localhost:4000** · Документація API (Swagger): **http://localhost:4000/api**

Перевірка: `GET /health`. Для демо-токена клієнт також має слати `X-User-Id` з UUID користувача з Supabase Auth.

Тести: `npm test`

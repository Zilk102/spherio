# Spherio

3D agar.io в браузере: катящиеся сферы с физикой (Rapier на сервере), рендер Babylon.js, мультиплеер Colyseus.

## Запуск (только Docker)

### Разработка (hot reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Откройте http://localhost:8080

### Production-like

```bash
docker compose up --build
```

Клиент: http://localhost:8080 — WebSocket проксируется через nginx на `/colyseus`.

## Управление

- **WASD** / стрелки — качение
- **Пробел** — торможение

## Структура

- `client/` — Babylon.js + Vite
- `server/` — Colyseus + Rapier (авторитетная физика)
- `shared/` — константы и формулы массы/момента

## Переменные (.env)

Скопируйте `.env.example` в `.env` при необходимости:

- `CLIENT_PORT` — порт клиента (по умолчанию 8080)
- `COLYSEUS_PORT` — порт сервера (2567)

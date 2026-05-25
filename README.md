# Sphere3D (Сферы 3D)

Браузерная 3D-арена — [sphere3d.ru](https://sphere3d.ru)

3D agar.io в браузере: катящиеся сферы (Rapier), Babylon.js, Colyseus.

**Статус:** база + **фаза 1** (меню, скины, лобби, API, топ). Дальше — [ROADMAP.md](./ROADMAP.md).

## Запуск (Docker)

**Сборка и фон:**

```bash
docker compose up --build -d
npm run test:smoke
```

- Клиент: http://localhost:8080  
- Сервер: http://localhost:2567  

**Разработка (hot reload):**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

## Меню

| Вкладка | Функция |
|---------|---------|
| **Играть** | Публичная FFA-арена |
| **Лобби** | Создать комнату с кодом / войти по коду |
| **Скины** | 8 бесплатных скинов |
| **Топ** | Глобальная таблица |

## API

| Метод | Путь |
|-------|------|
| GET | `/health` |
| POST | `/api/auth/guest` |
| POST | `/api/lobby/create` |
| GET | `/api/lobby/:code` |
| GET | `/api/leaderboard?period=all\|daily` |

## Управление

- **WASD** / стрелки — относительно экрана  
- **Пробел** — тормоз  

## Структура

- `client/` — Babylon + меню  
- `server/` — Colyseus + API  
- `shared/` — физика, скины, типы  
- `scripts/smoke-test.mjs` — проверка после деплоя  

## Переменные

См. `.env.example`.

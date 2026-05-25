# Архитектура Sphere3D (Сферы 3D)

## Обзор

```
┌─────────────┐     HTTP REST      ┌──────────────────────────────┐
│   Browser   │◄──────────────────►│  server (Express + Colyseus) │
│  Babylon.js │     WebSocket      │  ├─ api/ (auth, lobby, top)  │
│  Menu + HUD │◄──────────────────►│  ├─ rooms/ arena, private    │
└─────────────┘                    │  └─ services/ + Rapier       │
                                   └───────────┬──────────────────┘
                                               │
                                   ┌───────────▼──────────┐
                                   │  Redis (фаза 1+)     │
                                   │  PG (фаза 2+)        │
                                   └──────────────────────┘
```

## Пакеты

| Пакет | Назначение |
|-------|------------|
| `shared` | Константы, физика, типы API, каталог скинов |
| `server` | Авторитетная симуляция, API, персистентность |
| `client` | Рендер, ввод, меню, вызов API |

## Комнаты Colyseus

| Имя | Доступ | Описание |
|-----|--------|----------|
| `arena` | Публичный FFA | `joinOrCreate`, боты, до 50 игроков |
| `private_arena` | Код лобби | `filterBy(['code'])`, создаётся через API |

Общая логика матча вынесена в `ArenaRoom`; приватная комната добавляет проверку кода и метаданные лобби.

## API (HTTP)

Префикс `/api`.

| Метод | Путь | Назначение |
|-------|------|------------|
| POST | `/auth/guest` | Гостевой JWT + userId |
| POST | `/lobby/create` | Создать приватную комнату → `{ code, roomId }` |
| GET | `/lobby/:code` | Статус лобби (есть ли комната) |
| GET | `/leaderboard` | Топ N (daily / all из Redis) |

Фаза 2: `/auth/register`, `/auth/login`, `/profile`, `/friends`.

## Состояние игрока (Schema)

`PlayerState`: позиция, кватернион, `radius`, `name`, `color`, **`skinId`**, `isBot`, `invulnUntil`.

Цвет рендера: из каталога скинов (`shared/skins.ts`), fallback на `color`.

## Скины

Каталог в коде (фаза 1), позже — БД + URL текстур.

```ts
{ id, name, primaryColor, secondaryColor?, pattern: 'solid' | 'stripes' | 'glow' }
```

## Лидерборд

После матча / периодически: `ZADD leaderboard:all score userId`.  
Отображение в меню и post-game overlay (фаза 5).

## Безопасность (целевая)

- JWT в `Authorization` при join приватной комнаты
- Rate limit на API и `input` (уже есть `InputRateLimiter`)
- Серверный clamp скорости (`enforceSpeedLimits`)
- Валидация `JoinOptions` (zod)

## Docker

`docker-compose.yml`: `server`, `client`, `redis`.  
Фаза 2: `postgres`, миграции при старте server.

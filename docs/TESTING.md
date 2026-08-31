# Тестирование

## Уровни

1. Unit: state machine, денежные правила и idempotency fingerprint.
2. Race: реальные API/worker/providers/PostgreSQL, 50 параллельных запросов.
3. Playwright: пять интерактивов, double click, оплата и отображение кода.
4. Build: strict TypeScript, Angular production budgets, Nest builds, Docker image.

## Локальный race run

```bash
docker compose up -d postgres
pnpm db:deploy && pnpm db:seed
pnpm dev
# в другом терминале
ADMIN_TOKEN=change-me-locally pnpm test:race
```

Race-скрипт использует reset и предназначен только для локальной/демо-БД. На production reset защищён токеном и отклоняется, если есть processing jobs.

## Сценарии отказа

- `timeout_after_issue`: первый ответ теряется уже после reservation; следующий request с тем же ID возвращает тот же code.
- `out_of_stock`: A даёт однозначный ответ, после чего допустим B.
- `server_error_before_issue`: ошибка происходит до reservation и допускает fallback.
- persistent timeout: после ограниченного числа безопасных повторов заказ становится `delivery_failed`; ручной retry сохраняет request IDs.

## Visual QA

Reference — страница 2 исходного DOCX/Figma. Проверяются: компактная ширина, белый фон, header/search, чёрный hero, сервисная лента, Steam panel, пять карточек, hover/focus и отсутствие horizontal overflow на 390 px.

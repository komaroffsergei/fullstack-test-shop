# Чек-лист подготовки и передачи тестового задания

Документ нужен для последней проверки перед отправкой работодателю. Каждый пункт должен иметь не обещание, а ссылку или воспроизводимую команду.

## 1. Ссылки, которые отправляются

- Репозиторий: `https://github.com/komaroffsergei/fullstack-test-shop`
- Живой стенд: `https://test-shop.komaroff-dev.ru`
- Swagger: `https://test-shop.komaroff-dev.ru/api/docs`
- Health: `https://test-shop.komaroff-dev.ru/api/health/ready`
- Основной учебник: `docs/tutorial/index.html`
- Автономный учебник с исходниками: `docs/offline/index.html`
- Точный отчёт приемки: `docs/ACCEPTANCE_REPORT.md`

Admin token не отправляется в публичной ссылке, issue, README или архиве. Если проверяющему нужен admin flow, токен передаётся отдельным приватным каналом.

## 2. Короткий текст для сопроводительного сообщения

> Реализованы обязательные этапы и оба бонусных: Angular-витрина, идемпотентные заказы/webhook, PostgreSQL inbox/queue, два поставщика с безопасным timeout replay, recovery и конкурентные промокоды. Однократность обеспечивается не одной проверкой, а UNIQUE/CHECK на уровне PostgreSQL, атомарным claim через `FOR UPDATE SKIP LOCKED`, одним fulfillment на order и стабильным provider `request_id`. `pnpm test:race` воспроизводит 13 сценариев с настоящей PostgreSQL, включая 50 параллельных webhook и LIMIT3; те же ключевые потоки прогнаны через публичный HTTPS. Фактические команды и результаты — в `docs/ACCEPTANCE_REPORT.md`.

## 3. Локальный preflight

```bash
git status --short
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm verify
pnpm dev
pnpm test:race
PLAYWRIGHT_EXTERNAL_SERVER=1 WEB_URL=http://127.0.0.1:4200 pnpm test:e2e
pnpm openapi:generate
pnpm docs:offline
pnpm docs:verify
docker build -t fullstack-test-shop:submission .
```

Ожидание:

- format/lint/typecheck/unit/build — exit 0;
- race — 13/13;
- Playwright — 3/3;
- OpenAPI — все 14 operations;
- offline handbook verifier — exact source snapshot;
- Docker image — успешно собирается;
- `git status` после повторной генерации документации не показывает неожиданный diff.

## 4. Production preflight

1. Проверить DNS и TLS:

   ```bash
   curl -fsS https://test-shop.komaroff-dev.ru/api/health/ready
   ```

2. Запустить production black-box с токеном из серверного secret store:

   ```bash
   PRODUCTION_BASE_URL=https://test-shop.komaroff-dev.ru \
   PRODUCTION_ADMIN_TOKEN='<private>' \
   ALLOW_DEMO_RESET=1 \
   pnpm test:production
   ```

3. Запустить Playwright по HTTPS:

   ```bash
   PLAYWRIGHT_EXTERNAL_SERVER=1 \
   WEB_URL=https://test-shop.komaroff-dev.ru \
   pnpm test:e2e
   ```

4. Выполнить финальный защищённый reset и проверить пустой recovery list.
5. Открыть Browser DevTools/логи: нет console/page errors, failed API или mixed content.
6. Проверить desktop и 390×844 с открытым каталогом.

## 5. GitHub preflight

- `main` содержит финальный commit;
- последний CI workflow зелёный;
- последний production deploy зелёный и использует SHA финального commit;
- `git status --short` пуст;
- секреты отсутствуют по gitleaks;
- repository public;
- README открывает все относительные ссылки;
- release/tag создаются только для реально проверенного commit.

Команды контроля:

```bash
git log -5 --oneline
git status --short
gh run list --limit 10
gh repo view komaroffsergei/fullstack-test-shop --json visibility,url
```

## 6. Чистый архив для офлайн-передачи

После финального commit:

```bash
mkdir -p release
git archive --format=zip --output=release/fullstack-test-shop-v1.0.0.zip HEAD
```

`git archive` берёт только committed файлы, поэтому автоматически не включает `.git`, локальный `.env`, `node_modules`, volumes, `dist`, `.angular`, Playwright traces и build cache. Перед отправкой проверьте список архива и отсутствие secret names.

Архив уже содержит:

- весь исходный код;
- SQL migration и seed;
- все тесты;
- Docker/Compose/CI;
- Markdown-документацию;
- обычный HTML-учебник;
- `docs/offline/index.html`, в который дополнительно встроены все текстовые исходники с SHA-256.

## 7. Ручной визуальный чек

- header пропорционален макету;
- hero чёрный, rounded, arrows/dots доступны;
- service strip использует исходные assets;
- Steam panel состоит из title/login/amount/currency/pay;
- пять cards одинаковой высоты, hover не вызывает layout shift;
- catalog не выходит за viewport на 390 px;
- кнопки имеют focus state и понятные accessible names;
- order status показывает цену, историю и ровно один code;
- admin screen функционален без необходимости pixel-perfect дизайна.

Расхождения и осознанные границы фиксируются в [FIDELITY_LEDGER.md](FIDELITY_LEDGER.md), а исключённый ТЗ объём — в [REQUIREMENTS_MATRIX.md](REQUIREMENTS_MATRIX.md).

## 8. Финальная декларация готовности

Задание готово к отправке, только если одновременно верны все утверждения:

- [ ] 5/5 первичных критериев ТЗ имеют автоматическое доказательство;
- [ ] 13/13 локальных acceptance scenarios зелёные;
- [ ] 9/9 production black-box scenarios зелёные;
- [ ] 3/3 production Playwright tests зелёные;
- [ ] CI и deploy финального SHA зелёные;
- [ ] public health отвечает `200`;
- [ ] demo seed восстановлен;
- [ ] offline handbook актуален и проходит verifier;
- [ ] отчет содержит фактические, а не планируемые результаты;
- [ ] архив не содержит секретов и generated cache;
- [ ] admin token передаётся только отдельно.

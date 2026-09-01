# Отчёт полной приёмки

Этот документ — журнал фактических проверок, а не перечень намерений. Он отвечает на четыре вопроса:

1. какой пункт исходного задания проверялся;
2. каким автоматическим сценарием он воспроизводится;
3. что реально было запущено локально и на публичном HTTPS-стенде;
4. какое состояние оставлено проверяющему после тестов.

Подробная трассировка каждого требования до кода и теста находится в [REQUIREMENTS_MATRIX.md](REQUIREMENTS_MATRIX.md). Команды и устройство assertions объяснены в [TESTING.md](TESTING.md).

## 1. Источник критериев

Проверка построена по всем шести страницам `Тестовое задание Фуллстек разработчик.docx`:

- страница 1 — обязательный объём этапа 1 и исключения;
- страница 2 — утверждённая структура витрины;
- страница 3 — пять UI-интерактивов, этап 2 и пять главных критериев приёмки;
- страница 4 — восстановление и промокоды;
- страница 5 — контракт поставщика, timeout-ловушка и два поставщика;
- страница 6 — статусы, допустимые переходы и комплект сдачи.

Текст вакансии использован только как контекст инженерных ожиданий. Он не подменяет требования тестового задания.

## 2. Проверяемый кандидат

| Поле                | Значение                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Репозиторий         | `https://github.com/komaroffsergei/fullstack-test-shop`                                                                 |
| Ветка               | `main`                                                                                                                  |
| Публичный стенд     | `https://test-shop.komaroff-dev.ru`                                                                                     |
| Локальная ОС        | Windows, PowerShell                                                                                                     |
| Runtime             | Node.js 22.22.2, pnpm 11.7.0                                                                                            |
| База тестов         | настоящий PostgreSQL 17 в Docker                                                                                        |
| Браузер             | Chromium через Playwright и отдельная сессия Browser QA                                                                 |
| Часовой пояс отчёта | Europe/Moscow                                                                                                           |
| Проверенный runtime | [`7e9daeb15095`](https://github.com/komaroffsergei/fullstack-test-shop/commit/7e9daeb150950d51f52493606c60c7dcdc4baac2) |
| Финальный CI        | [`33503939960`](https://github.com/komaroffsergei/fullstack-test-shop/actions/runs/33503939960), `success`              |
| Production deploy   | [`33504299670`](https://github.com/komaroffsergei/fullstack-test-shop/actions/runs/33504299670), `success`              |

Runtime-код в последующем documentation/release commit не меняется: он только фиксирует этот отчёт, обновляет автономный handbook и прикладывает архив. Секреты, admin token и выданные ключи в отчёт и test artifacts не записываются. Публичные `/docs` входят в тот же immutable image, поэтому Markdown и HTML на домене соответствуют исходникам проверенного SHA.

## 3. Статические и сборочные барьеры

Фактический прогон 2026-09-01:

| Проверка                 | Результат                 | Что доказывает                                                               |
| ------------------------ | ------------------------- | ---------------------------------------------------------------------------- |
| `pnpm format:check`      | PASS                      | весь проверяемый текстовый код соответствует Prettier                        |
| `pnpm lint`              | PASS, 0 warnings          | ESLint не обнаружил нарушений                                                |
| `pnpm typecheck`         | PASS                      | strict TypeScript прошёл во всех workspace и root scripts/tests              |
| `pnpm comments:verify`   | PASS, **156/156**         | у каждого TS-метода/функции есть ведущий русский комментарий                 |
| `pnpm test`              | PASS, **9/9**             | 8 domain unit-тестов и 1 Angular component test                              |
| `pnpm docs:verify`       | PASS, **105 exact files** | offline handbook содержит байт-в-байт актуальный разрешённый source snapshot |
| `pnpm build`             | PASS                      | API, worker, provider, Angular и packages собираются                         |
| `pnpm openapi:generate`  | PASS, **14 paths**        | запущенный API публикует все ожидаемые операции                              |
| `docker build`           | PASS                      | production Dockerfile собирается с frozen lockfile                           |
| runtime container smoke  | PASS                      | отдельный image-контейнер вернул health 200, SPA 200 и OpenAPI               |
| production Compose parse | PASS                      | конфигурация корректно разворачивается при наличии server-only env           |

Ни одна из этих проверок не заменяет race или браузерные сценарии: они являются дополнительными слоями защиты.

## 4. Локальная acceptance-матрица с настоящими процессами

Команда:

```bash
pnpm test:race
```

Топология прогона: Angular `:4200`, Nest API `:4000`, worker, Provider A `:4101`, Provider B `:4102`, PostgreSQL `:5432`. HTTP-запросы отправляются в запущенный API, а конечные инварианты независимо читаются из PostgreSQL.

Итог повторного чистого прогона 2026-09-01: **13/13 PASS**.

|   № | Сценарий                                               |   Время | Фактический результат |
| --: | ------------------------------------------------------ | ------: | --------------------- |
|   1 | contracts, seed, health, metrics, admin protection     | 2279 ms | PASS                  |
|   2 | double click, idempotency conflict, server-owned price | 2303 ms | PASS                  |
|   3 | 50 одинаковых webhook + strict replay no-op            | 5232 ms | PASS                  |
|   4 | 50 разных `paid`: одна job, fulfillment и key          |  373 ms | PASS                  |
|   5 | ранние и неупорядоченные события без регрессии         | 1457 ms | PASS                  |
|   6 | проверка snapshot суммы и валюты                       |  204 ms | PASS                  |
|   7 | payment simulator делает настоящий webhook             |  517 ms | PASS                  |
|   8 | пустые пулы, admin recovery, concurrent retry          | 2859 ms | PASS                  |
|   9 | timeout-after-issue: тот же A request, без B           | 1785 ms | PASS                  |
|  10 | явный out-of-stock A безопасно переключает на B        |  473 ms | PASS                  |
|  11 | оба provider дают 5xx, stable-ID recovery              |  751 ms | PASS                  |
|  12 | quote, replay и LIMIT3 под 50 запросами                | 2330 ms | PASS                  |
|  13 | deterministic reset и запрет при processing job        | 2231 ms | PASS                  |

### Прямое соответствие пяти критериям работодателя

| Критерий из задания                                      | Доказательство                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 50 параллельных успешных событий → одна выдача/один ключ | сценарии 3 и 4 считают строки `delivery_jobs`, `fulfillments`, использованные keys и provider requests |
| повтор того же `event_id` ничего не меняет               | сценарий 3 сравнивает status/code/history до и после ещё десяти replay                                 |
| webhook до заказа и события не по порядку                | сценарий 5 сначала создаёт inbox event, затем order; проверяет приоритет `paid` и отсутствие регрессии |
| пустой пул, пополнение, повторная выдача                 | сценарий 8 физически удаляет свободные keys обоих поставщиков, затем делает два concurrent retry       |
| промокод с лимитом N при 50 запросах                     | сценарий 12 требует не больше трёх redemption и точное согласование `used_count`                       |

## 5. Локальная браузерная приёмка

Команда:

```bash
pnpm test:e2e
```

Итог: **3/3 PASS**.

| Playwright test                                 |  Время | Что проверено                                                                                                                                           |
| ----------------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| five required interactions and purchase flow    | 10.1 s | стрелки/dots/auto carousel, catalog/outside, currency, services hover, cards hover, double click, оплата, `delivered`, один code; весь `/docs` комплект |
| all visible storefront images load successfully | 663 ms | 15/15 видимых изображений загружены с ненулевым размером                                                                                                |
| narrow viewport does not overflow horizontally  | 642 ms | 390×844, открытый каталог, нет horizontal overflow, console/page errors                                                                                 |

## 6. Найденные проблемы и исправления

### Mobile overflow открытого каталога

Первый расширенный Playwright-прогон на 390 px получил `scrollWidth = 525`. Причиной была desktop-ширина абсолютного меню каталога. Исправление ограничило ширину выражением `min(270px, calc(100vw - 20px))` и привязало меню к правому краю. Повторный тест: `scrollWidth === clientWidth`, PASS.

### Гонка demo reset с worker claim

Между проверкой `processing=0` и очисткой таблиц worker теоретически мог захватить job. Первый вариант с `ACCESS EXCLUSIVE` locks устранял гонку, но создавал лишнее давление на Prisma pool при долгой локальной watch-сессии. Финальное решение — транзакционный advisory RW-lock: короткие payment/job claims берут shared-lock, а reset берёт exclusive-lock, затем повторно проверяет `processing`. Параллельные worker’ы не блокируют друг друга, чтение таблиц не останавливается, но claim и очистка не пересекаются. Отдельный race-сценарий доказывает отказ reset при processing job и воспроизводимость seed после безопасного reset.

### Чистота локального test harness

Один повторный запуск встретил оставшийся watch-процесс worker после длительной сессии и заказ не сменил `created`. Стенд был полностью остановлен и поднят одним чистым `pnpm dev`; неизменённая acceptance-матрица после этого прошла 13/13. Это различает ошибку тестовой инфраструктуры и ошибку продукта. Для CI каждый run стартует в новом runner, а production использует отдельные Compose containers с `restart: unless-stopped`.

### Готовность PNG на удалённом HTTPS

Первый production Playwright deploy `33499241450` прошёл 9/9 server-side black-box и два браузерных теста, но image-тест дважды прочитал DOM раньше завершения сетевой загрузки PNG. Browser QA показал: сразу после `DOMContentLoaded` часть `img.complete=false`, через 3 секунды все 15/15 имеют ненулевой `naturalWidth`; HTTP-ресурсы не были сломаны. Тест исправлен на `expect.poll` свойств самих изображений с timeout 10 секунд и теперь отличает медленную сеть от настоящего broken asset. Даже при этом падении обязательный `always()` reset завершился успешно.

### Публичная документация и readiness локального E2E

Учебник и автономный source handbook существовали в Git, но не входили в production runtime, поэтому домен не мог отдать их. Docker image теперь явно содержит `docs`, `README.md` и `CODEMAP.md`; NestJS публикует единый `/docs`, а Angular footer ведёт на него. Локальный Playwright первоначально видел уже готовый Vite раньше NestJS, из-за чего каталог мог кратко показать ошибку. `webServer.url` заменён на `/api/health/ready` через Angular proxy: тест начинается только когда одновременно готовы frontend, API и PostgreSQL. Локальный Docker smoke и production scenario 1 проверяют точное содержимое всех четырёх публичных документов.

## 7. Публичная HTTPS-приёмка

Immutable-образ commit `7e9daeb15095` развёрнут workflow [`33504299670`](https://github.com/komaroffsergei/fullstack-test-shop/actions/runs/33504299670). Один и тот же job собрал и отправил образ в GHCR, применил миграции, дождался readiness, выполнил server-side black-box внутри production-сети, затем проверил публичный домен отдельным Chromium и в `always()`-шаге восстановил seed. Все шаги job завершились `success` за 5 мин 10 с.

### 7.1. Server-side black-box через настоящий HTTPS

Команда `pnpm test:production` обращалась к `https://test-shop.komaroff-dev.ru`, а не к локальному API. Admin token подставлялся только на VDS и не передавался runner, в логи или artifacts.

|   № | Production-сценарий                                                    |   Время | Результат |
| --: | ---------------------------------------------------------------------- | ------: | --------- |
|   1 | HTTPS surface/docs, live/ready, catalog, OpenAPI, metrics, admin guard |  512 ms | PASS      |
|   2 | idempotent double click, payload conflict, money tamper                |  151 ms | PASS      |
|   3 | 50 одинаковых + 50 разных paid webhook                                 | 1620 ms | PASS      |
|   4 | ранние и неупорядоченные payment events                                | 1663 ms | PASS      |
|   5 | оба пула пусты, пополнение, два concurrent retry                       | 1012 ms | PASS      |
|   6 | timeout-after-issue и безопасный replay                                | 1607 ms | PASS      |
|   7 | явный out-of-stock A и fallback на B                                   |  421 ms | PASS      |
|   8 | два ответа 5xx и последующее восстановление                            |  711 ms | PASS      |
|   9 | `LIMIT3` под 50 параллельными production-запросами                     |  568 ms | PASS      |

Итог, напечатанный самим runner: **`Production acceptance complete: 9/9 scenarios passed.`**

### 7.2. Production Playwright

Три теста из `tests/e2e/storefront.spec.ts` были повторены отдельным Chromium с `PLAYWRIGHT_EXTERNAL_SERVER=1` на публичном URL. Итог workflow: **3/3 PASS за 17,1 с**.

- пять обязательных интерактивов, двойной клик, настоящий путь оплаты, polling до `delivered`, один видимый код;
- ожидание сетевой готовности всех 15 изображений через `expect.poll`;
- viewport `390×844`, открытое меню каталога, `scrollWidth ≤ clientWidth`, отсутствие `console.error` и `pageerror`.

### 7.3. Независимая ручная Browser QA

После успешного deploy публичная страница повторно открыта в отдельной браузерной сессии:

- `GG Shop — цифровые товары`, 5 карточек и 15/15 загруженных изображений;
- desktop `clientWidth = scrollWidth = 1905`, горизонтального overflow нет;
- footer содержит рабочие `/docs/` и `/docs/offline/`; переход по «Документация» завершился на `/docs/tutorial/`;
- tutorial имеет правильный title, 58 прямых ссылок на GitHub, 17 question/details-блоков и реально переключает `pro`/`kid` объяснения;
- offline handbook показывает **105** раскрываемых файлов, поиск, SHA-256 и точные номера строк;
- публичные README и CODEMAP вернули `200` и содержат актуальные `v1.1.1`/`race main:547`;
- журнал браузера пуст: 0 console warning/error;
- стрелки/каталог/валюта/hover/mobile `390×844` дополнительно подтверждены production Playwright.

Дополнительный read-only HTTPS smoke после reset получил: корень `200`, `live=ok`, `ready=ok`, 12 товаров, 14 OpenAPI paths.

## 8. Финальное состояние данных

После destructive demo-сценариев вызывается защищённый reset. Он:

- удаляет только demo order/event/job/fulfillment/attempt данные;
- возвращает исходные provider keys;
- возвращает режимы A/B в `success`;
- обнуляет счётчики промокодов;
- отказывается работать, если выдача уже `processing`.

Финальный workflow-шаг после production Playwright выполнил reset ещё раз и напечатал: **`Production demo reset verified: recovery=0, ready=ok.`** Ручная проверка после него использовала только GET/UI-интерактивы без покупки. Поэтому проверяющий получает чистый воспроизводимый стенд.

## 9. Осознанные исключения

Не реализованы только явно необязательные части: реальный эквайринг, криптографическая подпись webhook, пользовательская регистрация/авторизация, отзывы, footer, dark mode и самостоятельный mobile-макет. Узкий экран при этом не ломается и покрыт автотестом.

## 10. Вердикт

**READY FOR SUBMISSION.** Подтверждены: **13/13 локальных race-сценариев, 9/9 production black-box, 3/3 локальных и 3/3 production Playwright, 9/9 unit/component, 156/156 русских комментариев, 105 exact offline source files, публичный tutorial/offline/README/CODEMAP, зелёный CI, Docker runtime smoke, immutable deploy и финальный reset**.

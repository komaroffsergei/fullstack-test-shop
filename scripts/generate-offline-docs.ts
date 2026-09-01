import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type SourceFile = {
  path: string;
  content: string;
  hash: string;
  lines: number;
  bytes: number;
  category: string;
  anchor: string;
};

type Concept = {
  title: string;
  path: string;
  needle: string;
  professional: string;
  child: string;
};

const outputPath = 'docs/offline/index.html';
const exactRootFiles = new Set([
  '.dockerignore',
  '.editorconfig',
  '.env.example',
  '.gitignore',
  '.npmrc',
  '.prettierignore',
  '.prettierrc.json',
  'CODEMAP.md',
  'Dockerfile',
  'LICENSE',
  'README.md',
  'compose.production.yaml',
  'compose.yaml',
  'eslint.config.mjs',
  'package.json',
  'playwright.config.ts',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'tsconfig.json',
]);
const textExtensions = new Set([
  '.css',
  '.conf',
  '.example',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.prisma',
  '.ps1',
  '.sql',
  '.toml',
  '.ts',
  '.yaml',
  '.yml',
]);

const concepts: Concept[] = [
  {
    title: 'Покупка в Angular',
    path: 'apps/web/src/app/storefront.component.ts',
    needle: 'buy(sku: string)',
    professional:
      'Компонент создаёт один purchase intent, удерживает UUID и Idempotency-Key между повторами и не отправляет цену.',
    child:
      'Кнопка приклеивает к покупке один номерок. Даже два быстрых клика показывают кассе тот же номерок.',
  },
  {
    title: 'Идемпотентный заказ',
    path: 'apps/api/src/shop.service.ts',
    needle: 'async createOrder',
    professional:
      'API сравнивает fingerprint payload, блокирует промокод и создаёт снимок денег в короткой транзакции.',
    child: 'Касса помнит записку с заказом: одинаковую вернёт снова, а подменённую не примет.',
  },
  {
    title: 'Durable webhook inbox',
    path: 'apps/api/src/shop.service.ts',
    needle: 'async acceptWebhook',
    professional:
      'Событие платежа становится durable до HTTP 200; UNIQUE(event_id) превращает повтор в успешный no-op.',
    child:
      'Письмо об оплате сначала кладут в несгораемый ящик и только потом говорят курьеру «получили».',
  },
  {
    title: 'Ранние и перемешанные события',
    path: 'apps/worker/src/worker.service.ts',
    needle: 'private async processPaymentEvent',
    professional:
      'Worker сериализует события одного заказа row lock, оставляет раннее pending и не позволяет failed откатить paid/delivered.',
    child:
      'Сортировщик ждёт появления нужной коробки и не разрешает старому письму отменить уже выданный подарок.',
  },
  {
    title: 'PostgreSQL-очередь',
    path: 'apps/worker/src/worker.service.ts',
    needle: 'private async processDeliveryJob',
    professional:
      'UPDATE … FOR UPDATE SKIP LOCKED … RETURNING атомарно выдаёт lease одному worker без сетевого вызова внутри транзакции.',
    child:
      'Работники берут разные карточки из стопки и ставят на своей карточке временную подпись «занято мной».',
  },
  {
    title: 'Timeout не равен отказу',
    path: 'apps/worker/src/worker.service.ts',
    needle: "resultA.kind === 'timeout'",
    professional:
      'Неоднозначный timeout A возвращает ту же job в retry; переключение на B запрещено до однозначного ответа.',
    child:
      'Если курьер не ответил по телефону, нельзя сразу посылать второго: первый мог уже оставить подарок.',
  },
  {
    title: 'Идемпотентный поставщик',
    path: 'apps/mock-provider/src/provider.service.ts',
    needle: 'async issue',
    professional:
      'request_id атомарно связывается с одним code до симуляции потери ответа, а replay возвращает то же значение.',
    child:
      'Склад записывает номер просьбы рядом с ключом. Та же просьба всегда получает тот же ключ.',
  },
  {
    title: 'Финальная выдача',
    path: 'apps/worker/src/worker.service.ts',
    needle: 'private async complete',
    professional:
      'Order lock плюс UNIQUE fulfillment(order_id) и UNIQUE(code) дают последний барьер exactly-once.',
    child:
      'Перед финалом коробку запирают, а база не разрешает положить второй ключ или отдать один ключ двум людям.',
  },
  {
    title: 'Лимит промокода',
    path: 'apps/api/src/shop.service.ts',
    needle: 'FOR UPDATE сериализует',
    professional:
      'Row lock защищает check-and-increment used_count, а redemption создаётся только вместе с новым заказом.',
    child: 'У купонов одна очередь: каждый ждёт, пока предыдущий отметит использованный билет.',
  },
  {
    title: 'Ограничения БД',
    path: 'packages/database/prisma/migrations/20260831210000_init/migration.sql',
    needle: 'orders_idempotency_key_key',
    professional:
      'UNIQUE, CHECK, FK и partial indexes превращают критические инварианты в правила самого PostgreSQL.',
    child: 'Даже если программа ошибётся, строгий сторож базы не пустит дубликат через дверь.',
  },
  {
    title: 'Полная race-приемка',
    path: 'tests/race/run.ts',
    needle: 'async function main',
    professional:
      '13 сценариев атакуют живые процессы по HTTP и подтверждают результат независимыми запросами к PostgreSQL.',
    child:
      'Робот-проверяющий много раз быстро нажимает кнопки, ломает склады и считает, не появился ли лишний ключ.',
  },
  {
    title: 'Production black-box',
    path: 'tests/production/run.ts',
    needle: 'async function main',
    professional:
      'Та же бизнес-матрица исполняется через публичный HTTPS без прямого доступа к production-БД.',
    child:
      'Проверяющий стоит снаружи настоящего магазина и пользуется им так же, как обычный человек.',
  },
  {
    title: 'UI-приемка',
    path: 'tests/e2e/storefront.spec.ts',
    needle: "test('five required interactions",
    professional:
      'Playwright проверяет пять интерактивов, стили hover, assets, double click, выдачу и mobile overflow.',
    child:
      'Браузер-робот нажимает, водит мышкой и смотрит, что страница не вылезает за край экрана.',
  },
  {
    title: 'Безопасный deployment',
    path: '.github/workflows/deploy.yml',
    needle: 'Deploy immutable image',
    professional:
      'Workflow публикует immutable SHA image, применяет миграции, ждёт readiness и откатывает стек при ошибке.',
    child:
      'Сервер получает коробку с точным номером версии и возвращает старую коробку, если новая не ожила.',
  },
];

/** Приводит Windows-разделители к единому репозиторному виду. */
function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

/** Возвращает расширение в нижнем регистре, сохраняя поддержку файлов без расширения. */
function extension(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/** Решает, является ли файл учебным текстовым исходником, а не секретом/бинарником/generated output. */
export function shouldEmbed(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized === outputPath || normalized === 'pnpm-lock.yaml') return false;
  if (
    normalized === '.env' ||
    (normalized.includes('/.env') && !normalized.endsWith('.env.example'))
  ) {
    return false;
  }
  if (exactRootFiles.has(normalized)) return true;
  return textExtensions.has(extension(normalized));
}

/** Получает tracked и ещё не закоммиченные source-файлы без ignored build/cache/secret paths. */
export function discoverPaths(): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      encoding: 'utf8',
    },
  );
  return [...new Set(output.split('\0').filter(Boolean).map(normalizePath))]
    .filter(shouldEmbed)
    .sort((left, right) => left.localeCompare(right, 'en'));
}

/** Экранирует произвольный исходник для безопасного помещения внутрь HTML. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** Строит стабильный URL-anchor для файла и всех ссылок code map. */
export function fileAnchor(path: string): string {
  return `file-${normalizePath(path)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Группирует файл по роли, чтобы дерево оставалось понятным даже новичку. */
function category(path: string): string {
  if (path.startsWith('apps/web/')) return 'Angular frontend';
  if (path.startsWith('apps/api/')) return 'NestJS API';
  if (path.startsWith('apps/worker/')) return 'Worker';
  if (path.startsWith('apps/mock-provider/')) return 'Mock providers';
  if (path.startsWith('packages/database/')) return 'PostgreSQL / Prisma';
  if (path.startsWith('packages/domain/')) return 'Domain';
  if (path.startsWith('packages/api-client/')) return 'API types';
  if (path.startsWith('tests/')) return 'Tests';
  if (path.startsWith('.github/')) return 'CI/CD';
  if (path.startsWith('docs/')) return 'Documentation';
  if (path.startsWith('deploy/') || path.includes('compose') || path === 'Dockerfile') {
    return 'Deployment';
  }
  if (path.startsWith('scripts/')) return 'Tooling';
  return 'Project config';
}

/** Читает все разрешённые файлы, считает строки, bytes и SHA-256 для проверки точности snapshot. */
export function readSources(paths = discoverPaths()): SourceFile[] {
  return paths.map((path) => {
    const content = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
    return {
      path,
      content,
      hash: createHash('sha256').update(content).digest('hex'),
      lines: content.split('\n').length,
      bytes: Buffer.byteLength(content, 'utf8'),
      category: category(path),
      anchor: fileAnchor(path),
    };
  });
}

/** Находит реальную строку смыслового маркера, поэтому ссылки не устаревают после форматирования кода. */
function findLine(files: SourceFile[], path: string, needle: string): number {
  const file = files.find((item) => item.path === path);
  if (!file) throw new Error(`Offline concept references missing file: ${path}`);
  const index = file.content.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`Offline concept marker not found in ${path}: ${needle}`);
  return index + 1;
}

/** Рендерит исходник с кликабельным номером и отдельным anchor каждой строки. */
function renderCode(file: SourceFile): string {
  return file.content
    .split('\n')
    .map((line, index) => {
      const number = index + 1;
      const anchor = `${file.anchor}-L${number}`;
      return `<span class="code-line" id="${anchor}"><a class="line-number" href="#${anchor}">${number}</a><span class="line-source">${escapeHtml(line) || ' '}</span></span>`;
    })
    .join('\n');
}

/** Формирует краткое дерево файлов с рабочими переходами к встроенному исходнику. */
function renderFileIndex(files: SourceFile[]): string {
  return files
    .map(
      (file) =>
        `<a class="file-link" href="#${file.anchor}" data-file-link="${escapeHtml(file.path)}"><span>${escapeHtml(file.path)}</span><small>${file.lines} стр.</small></a>`,
    )
    .join('\n');
}

/** Формирует двухуровневую карту ключевых решений с точными offline-ссылками на строки. */
function renderConcepts(files: SourceFile[]): string {
  return concepts
    .map((concept) => {
      const line = findLine(files, concept.path, concept.needle);
      const href = `#${fileAnchor(concept.path)}-L${line}`;
      return `<article class="concept-card">
        <div><span class="pill">важный поток</span><h3>${escapeHtml(concept.title)}</h3></div>
        <p><b>Профессионально:</b> ${escapeHtml(concept.professional)}</p>
        <p class="child"><b>Как для 10 лет:</b> ${escapeHtml(concept.child)}</p>
        <a href="${href}">${escapeHtml(concept.path)}:${line} →</a>
      </article>`;
    })
    .join('\n');
}

/** Формирует раскрываемые карточки всех файлов с копированием, скачиванием и проверочным hash. */
function renderFiles(files: SourceFile[]): string {
  return files
    .map(
      (
        file,
      ) => `<details class="source-file" id="${file.anchor}" data-source-path="${escapeHtml(file.path)}" open>
        <summary>
          <span><b>${escapeHtml(file.path)}</b><small>${escapeHtml(file.category)} · ${file.lines} строк · ${file.bytes} bytes · sha256 ${file.hash.slice(0, 12)}…</small></span>
          <span class="actions"><button type="button" data-copy="${file.anchor}">Копировать</button><button type="button" data-download="${file.anchor}" data-name="${escapeHtml(file.path.split('/').at(-1) ?? 'source.txt')}">Скачать</button></span>
        </summary>
        <pre><code>${renderCode(file)}</code></pre>
      </details>`,
    )
    .join('\n');
}

/** Собирает один автономный HTML без CDN, webfonts, analytics и сетевых зависимостей. */
export function buildHtml(files: SourceFile[]): string {
  const totalLines = files.reduce((sum, file) => sum + file.lines, 0);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const manifest = JSON.stringify(
    files.map(({ path, hash, lines, bytes, category: group }) => ({
      path,
      hash,
      lines,
      bytes,
      group,
    })),
  ).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>fullstack-test-shop — автономный исходный код и code map</title>
  <style>
    :root{color-scheme:dark;--bg:#091019;--panel:#101a27;--panel2:#152234;--text:#eef5ff;--muted:#9eb0c6;--line:#26384e;--accent:#66e3b4;--accent2:#80b7ff;--child:#ffdf8d;--code:#07101a}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:16px}body{margin:0;background:radial-gradient(circle at 80% -10%,#173253 0,transparent 34%),var(--bg);color:var(--text);font:15px/1.55 Inter,Segoe UI,system-ui,sans-serif}.layout{display:grid;grid-template-columns:320px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;overflow:auto;padding:20px;background:#0b141fcc;border-right:1px solid var(--line);backdrop-filter:blur(14px)}.brand{display:flex;align-items:center;gap:10px;font-weight:900;font-size:18px}.brand i{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--accent);color:#07110e;font-style:normal}.search{width:100%;margin:18px 0 12px;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:#08111c;color:var(--text);outline:none}.search:focus{border-color:var(--accent)}.file-index{display:flex;flex-direction:column;gap:2px}.file-link{display:flex;justify-content:space-between;gap:10px;padding:7px 8px;border-radius:7px;color:var(--muted);text-decoration:none;font-size:12px}.file-link:hover{background:var(--panel2);color:var(--text)}.file-link span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-link small{flex:none}.main{min-width:0;padding:36px clamp(18px,4vw,64px) 80px}.hero{max-width:1100px;padding:36px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(135deg,#132238ee,#0e1927ee);box-shadow:0 28px 80px #0006}.eyebrow,.pill{display:inline-flex;padding:4px 9px;border:1px solid #66e3b455;border-radius:99px;background:#66e3b413;color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.hero h1{max-width:900px;margin:18px 0 12px;font-size:clamp(32px,5vw,66px);line-height:1.02;letter-spacing:-.04em}.hero p{max-width:760px;color:var(--muted);font-size:17px}.stats{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.stat{padding:10px 13px;border:1px solid var(--line);border-radius:12px;background:#09131f}.stat b{color:var(--accent);font-size:19px}.quick-links{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.quick-links a,.concept-card a{color:var(--accent2);text-decoration:none}.quick-links a{padding:9px 12px;border-radius:9px;background:#80b7ff16;border:1px solid #80b7ff35}.section{max-width:1200px;margin-top:56px}.section h2{margin:0 0 8px;font-size:30px}.section-intro{max-width:850px;color:var(--muted)}.concepts{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px;margin-top:20px}.concept-card{display:flex;min-width:0;flex-direction:column;gap:8px;padding:20px;border:1px solid var(--line);border-radius:16px;background:var(--panel)}.concept-card h3{margin:10px 0 0;font-size:19px}.concept-card p{margin:0;color:#cbd8e8}.concept-card .child{padding:10px;border-left:3px solid var(--child);border-radius:4px;background:#ffdf8d0d;color:#f4e5bd}.concept-card a{margin-top:auto;overflow-wrap:anywhere;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}.source-file{min-width:0;max-width:100%;margin:12px 0;border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden}.source-file[hidden],.file-link[hidden]{display:none}.source-file summary{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:15px 18px;cursor:pointer;list-style:none}.source-file summary::-webkit-details-marker{display:none}.source-file summary>span:first-child{display:flex;min-width:0;max-width:100%;flex-direction:column}.source-file summary b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 14px ui-monospace,SFMono-Regular,Consolas,monospace}.source-file summary small{color:var(--muted)}.actions{display:flex;gap:6px}.actions button{padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:#0a1420;color:var(--text);cursor:pointer}.actions button:hover{border-color:var(--accent)}pre{width:100%;max-width:100%;max-height:720px;margin:0;overflow:auto;border-top:1px solid var(--line);background:var(--code);tab-size:2}code{display:block;width:max-content;min-width:100%;padding:12px 0;font:12.5px/1.6 ui-monospace,SFMono-Regular,Consolas,Liberation Mono,monospace}.code-line{display:block;min-width:100%;width:max-content}.code-line:target{background:#ffdf8d1f;box-shadow:inset 3px 0 var(--child)}.line-number{display:inline-block;width:62px;padding-right:14px;color:#526a84;text-align:right;text-decoration:none;user-select:none}.line-source{white-space:pre}.note{padding:16px 18px;border:1px solid #ffdf8d44;border-radius:12px;background:#ffdf8d0b;color:#f3dfaa}.footer{margin-top:50px;color:var(--muted)}@media(max-width:900px){.layout{display:block}.sidebar{position:relative;height:auto;border-right:0;border-bottom:1px solid var(--line)}.file-index{max-height:260px;overflow:auto}.main{padding-top:24px}.hero{padding:24px}.source-file summary{align-items:flex-start;flex-direction:column}.actions{width:100%}.actions button{flex:1}}@media print{.sidebar,.actions,.quick-links{display:none}.layout{display:block}.main{padding:0}.source-file{break-inside:avoid}.source-file pre{max-height:none}.hero{box-shadow:none}}
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand"><i>GG</i><span>OFFLINE SOURCE</span></div>
      <input id="search" class="search" type="search" placeholder="Файл или текст кода…" aria-label="Поиск по исходникам" />
      <nav class="file-index" aria-label="Встроенные исходники">${renderFileIndex(files)}</nav>
    </aside>
    <main class="main">
      <header class="hero">
        <span class="eyebrow">полностью автономно · без сети</span>
        <h1>Исходный код, который можно изучать офлайн</h1>
        <p>Это точный учебный snapshot проекта: Angular, NestJS, worker, две заглушки поставщиков, Prisma/SQL, race/production/Playwright-тесты, Docker, CI/CD и вся Markdown-документация. Каждая строка имеет постоянную ссылку.</p>
        <div class="stats"><span class="stat"><b>${files.length}</b> файлов</span><span class="stat"><b>${totalLines}</b> строк</span><span class="stat"><b>${Math.ceil(totalBytes / 1024)}</b> КиБ исходников</span><span class="stat"><b>SHA-256</b> для каждого файла</span></div>
        <div class="quick-links"><a href="../tutorial/index.html">Открыть основной HTML-учебник</a><a href="#concepts">Карта решений</a><a href="#sources">Все исходники</a></div>
      </header>

      <section class="section">
        <h2>Как пользоваться</h2>
        <p class="section-intro">Начните с карты решений ниже. Ссылка откроет точную строку встроенного файла. Клик по номеру строки создаёт deep link. Поиск слева фильтрует и имена, и содержимое. Кнопка «Скачать» создаёт локальную копию выбранного файла прямо из HTML.</p>
        <div class="note"><b>Безопасность snapshot:</b> намеренно исключены <code style="display:inline;padding:0">.env</code>, приватные ключи, токены, <code style="display:inline;padding:0">node_modules</code>, build/cache, Git metadata, lockfile и бинарные PNG. Безопасный <code style="display:inline;padding:0">.env.example</code> включён. Assets остаются в архиве репозитория, но не кодируются внутрь этого HTML.</div>
      </section>

      <section class="section" id="concepts">
        <h2>Code map: два объяснения одного решения</h2>
        <p class="section-intro">Профессиональный слой отвечает «какая гарантия и каким механизмом», детский — «зачем это вообще нужно». Оба ведут в один и тот же реальный код.</p>
        <div class="concepts">${renderConcepts(files)}</div>
      </section>

      <section class="section" id="sources">
        <h2>Полный встроенный исходный код</h2>
        <p class="section-intro">Файлы расположены по имени. Snapshot генерируется скриптом и проверяется отдельным verifier: ручное устаревание документа блокирует CI.</p>
        <div id="source-list">${renderFiles(files)}</div>
      </section>
      <p class="footer">fullstack-test-shop · автономная учебная документация · секреты не встроены</p>
    </main>
  </div>
  <script id="source-manifest" type="application/json">${manifest}</script>
  <script>
    const search = document.querySelector('#search');
    const files = [...document.querySelectorAll('.source-file')];
    const links = [...document.querySelectorAll('[data-file-link]')];
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase('ru');
      for (const file of files) {
        const visible = !query || file.dataset.sourcePath.toLocaleLowerCase('ru').includes(query) || file.textContent.toLocaleLowerCase('ru').includes(query);
        file.hidden = !visible;
      }
      for (const link of links) link.hidden = !query ? false : !link.dataset.fileLink.toLocaleLowerCase('ru').includes(query);
    });
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-copy],button[data-download]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const id = button.dataset.copy || button.dataset.download;
      const source = document.querySelector('#' + CSS.escape(id) + ' code').innerText;
      if (button.dataset.copy) {
        await navigator.clipboard.writeText(source);
        const previous = button.textContent; button.textContent = 'Скопировано'; setTimeout(() => button.textContent = previous, 1200);
      } else {
        const url = URL.createObjectURL(new Blob([source], { type: 'text/plain;charset=utf-8' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = button.dataset.name; anchor.click(); URL.revokeObjectURL(url);
      }
    });
  </script>
</body>
</html>\n`;
}

/** Генерирует детерминированный offline HTML в репозитории. */
function main(): void {
  const files = readSources();
  const html = buildHtml(files);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, 'utf8');
  console.log(`Offline source handbook: ${files.length} files, ${outputPath}`);
}

main();

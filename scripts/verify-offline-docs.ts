import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

type ManifestEntry = {
  path: string;
  hash: string;
  lines: number;
  bytes: number;
  group: string;
};

const handbookPath = 'docs/offline/index.html';
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
  '.conf',
  '.css',
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

/** Нормализует path для точного сравнения Windows и Linux manifests. */
function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

/** Возвращает расширение имени для independent allowlist verifier. */
function extension(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/** Повторяет security allowlist generator; любое расхождение ломает CI. */
function shouldEmbed(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized === handbookPath || normalized === 'pnpm-lock.yaml') return false;
  if (
    normalized === '.env' ||
    (normalized.includes('/.env') && !normalized.endsWith('.env.example'))
  ) {
    return false;
  }
  return exactRootFiles.has(normalized) || textExtensions.has(extension(normalized));
}

/** Независимо открывает список source из Git, не доверяя embedded manifest. */
function discoverPaths(): string[] {
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

/** Повторяет стабильный anchor algorithm для независимой проверки внутренних ссылок. */
function fileAnchor(path: string): string {
  return `file-${normalizePath(path)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Прерывает проверку генератора с конкретной причиной рассинхронизации документации. */
function assertGenerated(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Извлекает JSON manifest из автономного HTML без стороннего DOM parser. */
function readManifest(html: string): ManifestEntry[] {
  const match = html.match(
    /<script id="source-manifest" type="application\/json">([\s\S]*?)<\/script>/,
  );
  assertGenerated(match?.[1], 'Offline handbook has no embedded source manifest');
  return JSON.parse(match[1]) as ManifestEntry[];
}

/** Считает тот же нормализованный SHA-256, который записывает generator. */
function currentHash(path: string): string {
  const content = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
  return createHash('sha256').update(content).digest('hex');
}

/** Проверяет полноту, актуальность, offline-режим, line anchors и отсутствие secret-файлов. */
function main(): void {
  const html = readFileSync(handbookPath, 'utf8');
  const manifest = readManifest(html);
  const expectedPaths = discoverPaths();
  const actualPaths = manifest.map((entry) => entry.path);
  assertGenerated(html.length > 250_000, 'Offline handbook is unexpectedly small');
  assertGenerated(
    JSON.stringify(actualPaths) === JSON.stringify(expectedPaths),
    'Offline source list is stale; run pnpm docs:offline',
  );
  assertGenerated(!actualPaths.includes('.env'), 'Secret .env was embedded');
  assertGenerated(
    actualPaths.every((path) => !path.includes('node_modules') && path !== 'pnpm-lock.yaml'),
    'Dependency/cache file was embedded',
  );

  const required = [
    'apps/web/src/app/storefront.component.ts',
    'apps/api/src/shop.service.ts',
    'apps/worker/src/worker.service.ts',
    'apps/mock-provider/src/provider.service.ts',
    'packages/database/prisma/migrations/20260831210000_init/migration.sql',
    'tests/race/run.ts',
    'tests/production/run.ts',
    'tests/e2e/storefront.spec.ts',
    '.github/workflows/ci.yml',
    'Dockerfile',
    'README.md',
    'CODEMAP.md',
  ];
  for (const path of required) {
    assertGenerated(actualPaths.includes(path), `Required offline source is missing: ${path}`);
    assertGenerated(html.includes(`id="${fileAnchor(path)}"`), `File anchor is missing: ${path}`);
  }

  for (const entry of manifest) {
    assertGenerated(
      entry.hash === currentHash(entry.path),
      `Embedded source is stale: ${entry.path}`,
    );
    assertGenerated(
      entry.lines > 0 && entry.bytes >= 0 && entry.group,
      `Bad manifest: ${entry.path}`,
    );
  }
  assertGenerated(!/<script\s+[^>]*src=/i.test(html), 'Offline handbook loads an external script');
  assertGenerated(
    !/<link\s+[^>]*href=["']https?:/i.test(html),
    'Offline handbook loads external CSS',
  );
  assertGenerated(
    (html.match(/class="source-file"/g) ?? []).length === manifest.length,
    'Not every manifest file has a rendered source card',
  );
  console.log(`Offline handbook verified: ${manifest.length} exact source files.`);
}

main();

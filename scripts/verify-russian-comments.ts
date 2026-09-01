import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Declaration =
  | ts.ConstructorDeclaration
  | ts.FunctionDeclaration
  | ts.GetAccessorDeclaration
  | ts.MethodDeclaration
  | ts.SetAccessorDeclaration;

/** Получает все TypeScript-исходники проекта, исключая dependencies/build/generated code. */
function sourcePaths(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.ts'], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((path) => !path.includes('/dist/') && !path.includes('/node_modules/'))
    .sort();
}

/** Определяет объявления методов/функций, для которых пользователь потребовал русское объяснение. */
function isDocumentedDeclaration(node: ts.Node): node is Declaration {
  return (
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Возвращает читаемое имя объявления для отчёта CI. */
function declarationName(node: Declaration): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  return node.name?.getText() ?? '<anonymous>';
}

/** Рекурсивно собирает объявления и проверяет непосредственно предшествующий русский комментарий. */
function inspectFile(path: string): { checked: number; failures: string[] } {
  const text = readFileSync(path, 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const failures: string[] = [];
  let checked = 0;

  /** Обходит AST, не считая inline callbacks отдельными публичными методами проекта. */
  function visit(node: ts.Node): void {
    if (isDocumentedDeclaration(node)) {
      checked += 1;
      const leading = text.slice(node.getFullStart(), node.getStart(source));
      if (!/\/\*[\s\S]*[А-Яа-яЁё][\s\S]*\*\/|\/\/[^\n]*[А-Яа-яЁё]/.test(leading)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        failures.push(`${path}:${line + 1} ${declarationName(node)}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return { checked, failures };
}

/** Проверяет весь проект и ломает CI, если новый метод появился без русского комментария. */
function main(): void {
  let checked = 0;
  const failures: string[] = [];
  for (const path of sourcePaths()) {
    const result = inspectFile(path);
    checked += result.checked;
    failures.push(...result.failures);
  }
  if (failures.length) {
    throw new Error(`Russian method comments are missing:\n${failures.join('\n')}`);
  }
  console.log(`Russian comments verified for ${checked}/${checked} methods and functions.`);
}

main();

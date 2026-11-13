import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** 어드민 계약 테스트(action-guard·uuid-revalidation)가 소스를 전수 스캔할 때 쓰는 도구. 런타임 코드에서 import하지 않는다. */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export interface ScannedSource { path: string; text: string }

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return name === 'node_modules' ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** 테스트가 아닌 .ts·.tsx 소스 전부. 경로는 저장소 루트 기준이다. */
export function scanSources(dirs: readonly string[]): ScannedSource[] {
  return dirs.flatMap(walk).map((path) => ({ path, text: readFileSync(join(ROOT, path), 'utf8') }));
}

/** 파일 맨 앞(주석 제외)에 'use server' 지시문이 있는 파일. */
export function isServerActionSource(text: string): boolean {
  return /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*(['"])use server\1/.test(text);
}

/* ---------- TypeScript AST 도구 ---------- */

/** 소스를 TS AST로 파싱한다(.tsx 포함). */
export function parseSource(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

function functionOf(init: ts.Expression | undefined): FunctionLike | null {
  let node = init;
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) ? node : null;
}

export interface ModuleFunctions {
  /** 파일 최상위 함수(선언·const 화살표/함수식). 이름 → 함수 */
  locals: Map<string, FunctionLike>;
  /** export된 함수의 export 이름 → 함수. `export { a as b }`·`export default`도 포함한다. */
  exports: Map<string, FunctionLike>;
}

export function moduleFunctions(file: ts.SourceFile): ModuleFunctions {
  const locals = new Map<string, FunctionLike>();
  const exports = new Map<string, FunctionLike>();
  const reexports: Array<[string, string]> = [];
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body) {
      const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      const name = statement.name?.text;
      if (name) locals.set(name, statement);
      if (exported) exports.set(isDefault ? 'default' : (name ?? 'default'), statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const fn = functionOf(declaration.initializer);
        if (!fn) continue;
        locals.set(declaration.name.text, fn);
        if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) exports.set(declaration.name.text, fn);
      }
    } else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) reexports.push([element.name.text, (element.propertyName ?? element.name).text]);
    } else if (ts.isExportAssignment(statement)) {
      const fn = functionOf(statement.expression);
      if (fn) exports.set('default', fn);
      else if (ts.isIdentifier(statement.expression)) reexports.push(['default', statement.expression.text]);
    }
  }
  for (const [exported, local] of reexports) {
    const fn = locals.get(local);
    if (fn) exports.set(exported, fn);
  }
  return { locals, exports };
}

export type FlowEvent =
  | { kind: 'call'; name: string; node: ts.CallExpression; used: boolean }
  | { kind: 'effect'; node: ts.Node; text: string };

/** 호출 결과를 버리는지: 식 문장이거나 `void`로 감싼 호출은 결과를 쓰지 않는다(await·괄호는 투명). */
export function isResultUsed(call: ts.Expression): boolean {
  let node: ts.Node = call;
  for (;;) {
    const parent: ts.Node | undefined = node.parent;
    if (!parent) return true;
    if (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent)) { node = parent; continue; }
    return !(ts.isExpressionStatement(parent) || ts.isVoidExpression(parent));
  }
}

const EFFECT_MEMBERS = new Set(['rpc', 'from', 'storage']);

/**
 * 함수 본문을 소스 순서로 걸어 호출과 부수효과 후보(supabase `.rpc`·`.from`·`.storage`, `fetch`)를 모은다.
 * 같은 파일의 최상위 함수 호출은 그 본문으로 따라 들어간다(재귀·상호 호출은 한 번만). 따라 들어간 호출의 `used`는
 * 안쪽 사용 여부와 바깥 호출 지점의 사용 여부를 모두 만족해야 참이다. 주석과 문자열 안의 이름은 AST에 호출로 없으므로 세지 않는다.
 */
export function flowEvents(fn: FunctionLike, locals: Map<string, FunctionLike>): FlowEvent[] {
  const events: FlowEvent[] = [];
  const visiting = new Set<FunctionLike>([fn]);
  const walk = (node: ts.Node, outerUsed: boolean): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        const used = outerUsed && isResultUsed(node);
        events.push({ kind: 'call', name: callee.text, node, used });
        if (callee.text === 'fetch') events.push({ kind: 'effect', node, text: 'fetch' });
        const local = locals.get(callee.text);
        if (local && !visiting.has(local)) {
          node.arguments.forEach((arg) => walk(arg, outerUsed));
          visiting.add(local);
          if (local.body) walk(local.body, used);
          visiting.delete(local);
          return;
        }
      } else if (ts.isPropertyAccessExpression(callee) && EFFECT_MEMBERS.has(callee.name.text)) {
        walk(callee.expression, outerUsed);
        node.arguments.forEach((arg) => walk(arg, outerUsed));
        events.push({ kind: 'effect', node, text: `.${callee.name.text}` });
        return;
      }
    } else if (ts.isPropertyAccessExpression(node) && node.name.text === 'storage') {
      walk(node.expression, outerUsed);
      events.push({ kind: 'effect', node, text: '.storage' });
      return;
    }
    ts.forEachChild(node, (child) => walk(child, outerUsed));
  };
  if (fn.body) walk(fn.body, true);
  return events;
}

export interface ExportedFunctionInfo { key: string; path: string; name: string; events: FlowEvent[] }

/** 'use server' 파일의 export 함수 전부. key는 `파일:함수` — 예외 목록의 키다. */
export function exportedFunctions(source: ScannedSource): ExportedFunctionInfo[] {
  const file = parseSource(source.path, source.text);
  const { locals, exports } = moduleFunctions(file);
  return [...exports].map(([name, fn]) => ({ key: `${source.path}:${name}`, path: source.path, name, events: flowEvents(fn, locals) }));
}

/** 노드를 감싼 가장 가까운 함수 이름이나 const 변수 이름. 없으면 null. */
function ownerName(node: ts.Node): string | null {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
  }
  return null;
}

export interface PatternLiteral { pattern: string; line: number; owner: string | null }

/** 소스 안의 정규식 리터럴과 문자열·템플릿 리터럴의 텍스트. 주석은 AST에 없어 제외된다. owner는 감싼 함수·상수 이름이다. */
export function patternLiterals(source: ScannedSource): PatternLiteral[] {
  const file = parseSource(source.path, source.text);
  const found: PatternLiteral[] = [];
  const add = (node: ts.Node, pattern: string) => found.push({ pattern, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, owner: ownerName(node) });
  const visit = (node: ts.Node): void => {
    if (ts.isRegularExpressionLiteral(node)) add(node, node.text);
    else if (ts.isStringLiteralLike(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) add(node, node.getText(file));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

export interface RevalidateCall { path: string; type: string | null; line: number; fn: string | null; literal: boolean }

/** `revalidatePath(<경로>, <종류>?)` 호출. 인자는 문자열 리터럴이면 그 값, 아니면 소스 문장이다. */
export function revalidatePathCalls(source: ScannedSource): RevalidateCall[] {
  const file = parseSource(source.path, source.text);
  const out: RevalidateCall[] = [];
  const text = (node: ts.Expression | undefined) => (node ? (ts.isStringLiteralLike(node) ? node.text : node.getText(file)) : null);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'revalidatePath' && node.arguments[0]) {
      out.push({ path: text(node.arguments[0])!, type: text(node.arguments[1]), literal: ts.isStringLiteralLike(node.arguments[0]),
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, fn: ownerName(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

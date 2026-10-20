#!/usr/bin/env node
import assert from 'node:assert/strict';
import ts from 'typescript';

// Read Vite's actual transformed import graph without executing page modules.
const origin = 'http://127.0.0.1:4319';
const pending = ['/main.tsx'];
const visited = new Set();
const failures = [];
const modules = new Map();
for (let index = 0; index < pending.length; index += 1) {
  const path = pending[index];
  if (visited.has(path)) continue;
  visited.add(path);
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) { failures.push(`${response.status}: ${path}`); continue; }
  const code = await response.text();
  if (path.includes('.css') || path.includes('/node_modules/') || path.startsWith('/@vite')) continue;
  const syntax = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = [];
  const exports = new Set();
  let exportAll = false;
  for (const statement of syntax.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const names = clause?.name ? ['default'] : [];
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        names.push(...clause.namedBindings.elements.map(item => (item.propertyName ?? item.name).text));
      }
      imports.push({ target: statement.moduleSpecifier.text, names });
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const item of statement.exportClause.elements) exports.add(item.name.text);
      } else exportAll = true;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
    if (modifiers.some(item => item.kind === ts.SyntaxKind.DefaultKeyword) || ts.isExportAssignment(statement)) exports.add('default');
    if (modifiers.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isVariableStatement(statement)) {
        for (const item of statement.declarationList.declarations) if (ts.isIdentifier(item.name)) exports.add(item.name.text);
      } else if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) exports.add(statement.name.text);
    }
  }
  modules.set(path, { imports, exports, exportAll });
  for (const { target } of imports) {
    if (!target.startsWith('/') || !/\.[cm]?[jt]sx?(?:\?|$)/.test(target) || target.includes('/node_modules/') || target.startsWith('/@vite')) continue;
    if (/\.server\.[cm]?[jt]sx?(?:\?|$)/.test(target) || /\/app\/.*(?:\/actions|[-]actions)\.tsx?(?:\?|$)/.test(target)) {
      failures.push(`Unstubbed server import: ${path} -> ${target}`);
      continue;
    }
    pending.push(target);
  }
}
for (const [path, module] of modules) {
  for (const { target, names } of module.imports) {
    const dependency = modules.get(target);
    if (!dependency || dependency.exportAll) continue;
    for (const name of names) if (!dependency.exports.has(name)) failures.push(`Missing export: ${path} imports ${name} from ${target}`);
  }
}
for (const path of ['/api/fixture-boundary-probe', '/auth/fixture-boundary-probe']) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 503, `${path} must remain blocked`);
  assert.equal((await response.json()).error, 'fixture_boundary_blocked');
}
assert.equal(failures.length, 0, `Fixture import boundary failed:\n${failures.join('\n')}`);
console.log(`PASS: ${visited.size} fixture modules; named exports resolved; no server imports; /api and /auth blocked.`);

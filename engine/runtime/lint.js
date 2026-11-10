// C1: static lint of a scene module with acorn. Scenes must be pure functions of t with no I/O or non-determinism.
import { parse } from './vendor/acorn.mjs';

const ALLOWED_EXPORTS = new Set(['draw', 'markers', 'meta']);
const FORBIDDEN_GLOBALS = new Set([
  'Date', 'performance', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'fetch', 'XMLHttpRequest',
  'WebSocket', 'eval', 'Function', 'localStorage', 'sessionStorage', 'indexedDB', 'document',
]);
const GLOBAL_OBJECTS = new Set(['window', 'self', 'globalThis', 'top', 'parent']);
const WHY = {
  Date: 'wall-clock time is non-deterministic; derive everything from t',
  performance: 'timers are non-deterministic; derive everything from t',
  Function: 'the Function constructor is dynamic code',
  eval: 'eval is dynamic code',
  document: 'scenes draw only through rt.g',
};

const propName = (m) => {
  if (!m.computed && m.property.type === 'Identifier') return m.property.name;
  if (m.computed && m.property.type === 'Literal' && typeof m.property.value === 'string') return m.property.value;
  return null;
};
const keyName = (p) => {
  if (!p.computed && p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'Literal' && typeof p.key.value === 'string') return p.key.value;
  return null;
};

function isReference(node, parent, key) {
  if (!parent) return true;
  switch (parent.type) {
    case 'MemberExpression': return !(key === 'property' && !parent.computed);
    case 'Property': return !(key === 'key' && !parent.computed && !parent.shorthand);
    case 'MethodDefinition': case 'PropertyDefinition': return !(key === 'key' && !parent.computed);
    case 'VariableDeclarator': return key !== 'id';
    case 'FunctionDeclaration': case 'FunctionExpression': case 'ClassDeclaration': case 'ClassExpression':
      return key !== 'id' && key !== 'params';
    case 'ArrowFunctionExpression': return key !== 'params';
    case 'LabeledStatement': case 'BreakStatement': case 'ContinueStatement': return false;
    case 'ExportSpecifier': case 'ImportSpecifier': return false;
    default: return true;
  }
}

export function lintScene(source) {
  const findings = [];
  const add = (node, message) => {
    const loc = node.loc ? node.loc.start : { line: 0, column: 0 };
    findings.push({ id: 'C1', severity: 'error', t: null, message, data: { line: loc.line, column: loc.column + 1 } });
  };
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  } catch (e) {
    const loc = e.loc || { line: 0, column: 0 };
    findings.push({ id: 'C1', severity: 'error', t: null, message: 'parse error: ' + String(e.message).replace(/\s*\(\d+:\d+\)$/, ''),
      data: { line: loc.line, column: loc.column + 1 } });
    return findings;
  }

  const exported = new Set();
  const noteExport = (node, name) => {
    exported.add(name);
    if (!ALLOWED_EXPORTS.has(name)) add(node, `export '${name}' is not allowed: a scene may export only draw, markers and meta`);
  };

  function visit(node, parent, key) {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'Identifier':
        if (FORBIDDEN_GLOBALS.has(node.name) && isReference(node, parent, key)) {
          add(node, `${node.name} is forbidden${WHY[node.name] ? ' (' + WHY[node.name] + ')' : ''}`);
        }
        break;
      case 'MemberExpression': {
        const name = propName(node);
        if (node.object.type === 'Identifier' && node.object.name === 'Math' && name === 'random') {
          add(node, 'Math.random is forbidden (non-deterministic; use rt.rng(seed))');
        } else if (node.object.type === 'Identifier' && GLOBAL_OBJECTS.has(node.object.name) && name &&
                   (FORBIDDEN_GLOBALS.has(name) || name === 'Math')) {
          add(node, `${node.object.name}.${name} is forbidden`);
        }
        if (name === 'shadowBlur') add(node, 'shadowBlur is forbidden (slow and renderer-dependent)');
        break;
      }
      case 'Property':
        if (keyName(node) === 'shadowBlur') add(node, 'shadowBlur is forbidden (slow and renderer-dependent)');
        break;
      case 'AssignmentExpression':
        if (node.left.type === 'MemberExpression' && propName(node.left) === 'filter') {
          add(node, 'assigning .filter is forbidden (slow and renderer-dependent)');
        }
        break;
      case 'ImportExpression': add(node, 'import() is forbidden'); break;
      case 'ImportDeclaration': add(node, 'import is forbidden: scenes have no imports (use rt.core, rt.palette, rt.lib)'); break;
      case 'MetaProperty': add(node, 'import.meta is forbidden'); break;
      case 'ExportAllDeclaration': add(node, 'export * is forbidden'); break;
      case 'ExportDefaultDeclaration': add(node, 'default export is forbidden: export draw, markers and meta by name'); break;
      case 'ExportNamedDeclaration': {
        if (node.source) add(node, 're-exporting from another module is forbidden');
        const d = node.declaration;
        if (d && (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) noteExport(node, d.id.name);
        if (d && d.type === 'VariableDeclaration') {
          for (const decl of d.declarations) {
            if (decl.id.type === 'Identifier') noteExport(node, decl.id.name);
            else add(node, 'destructuring exports are not allowed');
          }
        }
        for (const s of node.specifiers || []) noteExport(s, s.exported.name !== undefined ? s.exported.name : String(s.exported.value));
        break;
      }
      default: break;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => visit(c, node, k));
      else if (v && typeof v === 'object') visit(v, node, k);
    }
  }
  visit(ast, null, null);

  if (!exported.has('draw')) {
    findings.push({ id: 'C1', severity: 'error', t: null, message: 'scene must export function draw(rt, t)', data: { line: 1, column: 1 } });
  }
  return findings;
}

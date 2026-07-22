import ts from 'typescript';

const HOOK_NAMES = new Set(['useEffect', 'useLayoutEffect', 'useMemo', 'useCallback']);
const CONTROL_FLOW_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
]);

function scriptKind(filename) {
  return filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function diagnostic(sourceFile, node, rule, message, severity = 'error') {
  return { file: sourceFile.fileName, line: lineOf(sourceFile, node), rule, message, severity };
}

function callName(call) {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return null;
}

function nearestFunction(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
}

function isConditionalHook(call, owner) {
  let current = call.parent;
  while (current && current !== owner) {
    if (CONTROL_FLOW_KINDS.has(current.kind)) return true;
    current = current.parent;
  }
  return false;
}

function isTopLevelHookOwner(owner) {
  if (!owner) return false;
  if (ts.isFunctionDeclaration(owner)) return Boolean(owner.parent && ts.isSourceFile(owner.parent));
  if (ts.isArrowFunction(owner) || ts.isFunctionExpression(owner)) {
    const declaration = owner.parent;
    return ts.isVariableDeclaration(declaration)
      && declaration.parent?.parent?.parent
      && ts.isSourceFile(declaration.parent.parent.parent);
  }
  return false;
}

function namesFromBindingName(name, out) {
  if (ts.isIdentifier(name)) out.add(name.text);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) namesFromBindingName(element.name, out);
}

function namesDeclaredInside(root) {
  const names = new Set();
  for (const parameter of root.parameters ?? []) namesFromBindingName(parameter.name, names);
  function visit(node) {
    if (node !== root && ts.isFunctionLike(node)) return;
    if (ts.isVariableDeclaration(node)) namesFromBindingName(node.name, names);
    if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    ts.forEachChild(node, visit);
  }
  if (root.body) visit(root.body);
  return names;
}

function namesDeclaredInOwner(owner) {
  const names = new Set();
  if (!owner) return names;
  for (const parameter of owner.parameters ?? []) namesFromBindingName(parameter.name, names);
  function visit(node) {
    if (node !== owner && ts.isFunctionLike(node)) return;
    if (ts.isVariableDeclaration(node)) namesFromBindingName(node.name, names);
    ts.forEachChild(node, visit);
  }
  if (owner.body) visit(owner.body);
  return names;
}

function dependencyRoots(array) {
  const roots = new Set();
  if (!array || !ts.isArrayLiteralExpression(array)) return roots;
  for (const element of array.elements) {
    let current = element;
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = current.expression;
    if (ts.isIdentifier(current)) roots.add(current.text);
  }
  return roots;
}

function referencedOuterNames(callback, owner) {
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return [];
  const outer = namesDeclaredInOwner(owner);
  const local = namesDeclaredInside(callback);
  const referenced = new Set();
  function visit(node) {
    if (node !== callback && ts.isFunctionLike(node)) return;
    if (ts.isIdentifier(node)
      && outer.has(node.text)
      && !local.has(node.text)
      && !ts.isPropertyAccessExpression(node.parent)
      && !ts.isPropertyAssignment(node.parent)) referenced.add(node.text);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && outer.has(node.expression.text) && !local.has(node.expression.text)) {
      referenced.add(node.expression.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(callback.body);
  return [...referenced].sort();
}

function asyncFunctionNames(sourceFile) {
  const names = new Set();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some((item) => item.kind === ts.SyntaxKind.AsyncKeyword)) {
      names.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      && node.initializer.modifiers?.some((item) => item.kind === ts.SyntaxKind.AsyncKeyword)) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

function jsxAttribute(opening, name) {
  return opening.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.text === name);
}

function analyzeJsx(sourceFile, opening, diagnostics) {
  const tag = opening.tagName.getText(sourceFile);
  if (tag === 'img' && !jsxAttribute(opening, 'alt')) {
    diagnostics.push(diagnostic(sourceFile, opening, 'jsx-img-alt', '<img>にはaltが必要です'));
  }
  if (tag === 'button' && !jsxAttribute(opening, 'type')) {
    diagnostics.push(diagnostic(sourceFile, opening, 'jsx-button-type', '<button>にはtypeを明示してください'));
  }
  if ((tag === 'div' || tag === 'span') && jsxAttribute(opening, 'onClick')) {
    const role = jsxAttribute(opening, 'role');
    const tabIndex = jsxAttribute(opening, 'tabIndex');
    const keyboard = jsxAttribute(opening, 'onKeyDown') || jsxAttribute(opening, 'onKeyUp');
    if (!role || !tabIndex || !keyboard) {
      diagnostics.push(diagnostic(
        sourceFile,
        opening,
        'jsx-click-keyboard',
        `クリック可能な<${tag}>にはrole・tabIndex・キーボード操作が必要です`,
      ));
    }
  }
}

export function analyzeSource(filename, source) {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, scriptKind(filename));
  const diagnostics = [];
  const asyncNames = asyncFunctionNames(sourceFile);

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = callName(node);
      if (name && /^use[A-Z]/u.test(name)) {
        const owner = nearestFunction(node);
        if (!isTopLevelHookOwner(owner)) {
          diagnostics.push(diagnostic(sourceFile, node, 'react-hooks-top-level', `${name}はcomponentまたはcustom hookの最上位で呼び出してください`));
        } else if (isConditionalHook(node, owner)) {
          diagnostics.push(diagnostic(sourceFile, node, 'react-hooks-conditional', `${name}を条件分岐・loop内で呼び出さないでください`));
        }
      }
      if (name && HOOK_NAMES.has(name) && node.arguments.length >= 2 && ts.isArrayLiteralExpression(node.arguments[1])) {
        const owner = nearestFunction(node);
        const referenced = referencedOuterNames(node.arguments[0], owner);
        const dependencies = dependencyRoots(node.arguments[1]);
        const missing = referenced.filter((item) => !dependencies.has(item));
        if (missing.length > 0) {
          diagnostics.push(diagnostic(
            sourceFile,
            node,
            'react-hooks-deps',
            `${name}の依存配列に不足があります: ${missing.join(', ')}`,
            'warning',
          ));
        }
      }
    }

    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const name = callName(node.expression);
      if (name && asyncNames.has(name)) {
        diagnostics.push(diagnostic(sourceFile, node, 'no-floating-promise', `${name}()のPromiseをawait・void・catchのいずれかで処理してください`));
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) analyzeJsx(sourceFile, node, diagnostics);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return diagnostics;
}

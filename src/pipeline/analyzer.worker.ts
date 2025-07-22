import type { Node as TSNode, QueryCapture as TSMatch } from 'web-tree-sitter';
import { createParserForLanguage } from '../tree-sitter/languages.js';
import type { LanguageConfig } from '../tree-sitter/language-config.js';
import type { CodeNode, CodeNodeType, CodeNodeVisibility, FileContent, UnresolvedRelation } from '../types.js';

// --- UTILITY FUNCTIONS (mirrored from original analyze.ts) ---

const getNodeText = (node: TSNode, content: string): string => content.slice(node.startIndex, node.endIndex);
const getLineFromIndex = (content: string, index: number): number => content.substring(0, index).split('\n').length;

const extractCodeSnippet = (symbolType: CodeNodeType, node: TSNode): string => {
  const text = node.text;
  switch (symbolType) {
    case 'variable': case 'constant': case 'property': {
      const assignmentMatch = text.match(/=\s*(.+)$/s);
      return (assignmentMatch?.[1] ?? text).trim();
    }
    case 'field': {
      const colonIndex = text.indexOf(':');
      if (colonIndex !== -1) return text.substring(colonIndex).trim();
      const equalsIndex = text.indexOf('=');
      if (equalsIndex !== -1) return text.substring(equalsIndex).trim();
      return text.trim();
    }
    case 'function': case 'method': case 'constructor': {
      const bodyStart = text.indexOf('{');
      return (bodyStart > -1 ? text.slice(0, bodyStart) : text).trim();
    }
    case 'arrow_function': {
      const arrowIndex = text.indexOf('=>');
      return arrowIndex > -1 ? text.slice(0, arrowIndex).trim() : text.trim();
    }
    default: return text.trim();
  }
};

const extractQualifiers = (childCaptures: TSMatch[], fileContent: string, handler: Partial<LanguageHandler>) => {
  const qualifiers: { [key: string]: TSNode } = {};
  for (const capture of childCaptures) qualifiers[capture.name] = capture.node;

  const visibility = (qualifiers['qualifier.visibility'] ? getNodeText(qualifiers['qualifier.visibility'], fileContent) : undefined) as CodeNodeVisibility | undefined;
  const returnType = qualifiers['symbol.returnType'] ? getNodeText(qualifiers['symbol.returnType'], fileContent).replace(/^:\s*/, '') : undefined;
  const parameters = qualifiers['symbol.parameters'] && handler.parseParameters ? handler.parseParameters(qualifiers['symbol.parameters'], fileContent) : undefined;
  const canThrow = childCaptures.some(c => c.name === 'qualifier.throws');

  return { qualifiers, visibility, returnType, parameters, canThrow, isAsync: !!qualifiers['qualifier.async'], isStatic: !!qualifiers['qualifier.static'] };
};

const getCssIntents = (ruleNode: TSNode, content: string): readonly ('layout' | 'typography' | 'appearance')[] => {
  const intents = new Set<'layout' | 'typography' | 'appearance'>();
  const layoutProps = /^(display|position|flex|grid|width|height|margin|padding|transform|align-|justify-)/;
  const typographyProps = /^(font|text-|line-height|letter-spacing|word-spacing)/;
  const appearanceProps = /^(background|border|box-shadow|opacity|color|fill|stroke|cursor)/;
  const block = ruleNode.childForFieldName('body') ?? ruleNode.namedChildren.find(c => c && c.type === 'block');

  if (block) {
    for (const declaration of block.namedChildren) {
      if (declaration && declaration.type === 'declaration') {
        const propNode = declaration.namedChildren.find(c => c && c.type === 'property_name');
        if (propNode) {
          const propName = getNodeText(propNode, content);
          if (layoutProps.test(propName)) intents.add('layout');
          if (typographyProps.test(propName)) intents.add('typography');
          if (appearanceProps.test(propName)) intents.add('appearance');
        }
      }
    }
  }
  return Array.from(intents).sort();
};

// --- LANGUAGE-SPECIFIC LOGIC ---

type LanguageHandler = {
  preProcessFile?: (file: FileContent, captures: TSMatch[]) => Record<string, any>;
  shouldSkipSymbol: (node: TSNode, symbolType: CodeNodeType, langName: string) => boolean;
  getSymbolNameNode: (declarationNode: TSNode, originalNode: TSNode) => TSNode | null;
  processComplexSymbol?: (context: ProcessSymbolContext) => boolean;
  parseParameters?: (paramsNode: TSNode, content: string) => { name: string; type?: string }[];
};

type ProcessSymbolContext = {
  nodes: CodeNode[];
  file: FileContent;
  node: TSNode;
  symbolType: CodeNodeType;
  processedSymbols: Set<string>;
  fileState: Record<string, any>;
  childCaptures: TSMatch[];
};

const pythonHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    if (declarationNode.type === 'expression_statement') {
      const assignmentNode = declarationNode.namedChild(0);
      if (assignmentNode?.type === 'assignment') return assignmentNode.childForFieldName('left');
    }
    return declarationNode.childForFieldName('name');
  },
};

const goLangHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    const nodeType = declarationNode.type;
    if (['type_declaration', 'const_declaration', 'var_declaration'].includes(nodeType)) {
      const spec = declarationNode.namedChild(0);
      if (spec && ['type_spec', 'const_spec', 'var_spec'].includes(spec.type)) return spec.childForFieldName('name');
    }
    return declarationNode.childForFieldName('name');
  },
};

const cLangHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    if (declarationNode.type === 'type_definition') {
      const lastChild = declarationNode.namedChild(declarationNode.namedChildCount - 1);
      if (lastChild?.type === 'type_identifier') return lastChild;
    }
    if (declarationNode.type === 'function_definition') {
      const declarator = declarationNode.childForFieldName('declarator');
      if (declarator?.type === 'function_declarator') {
        const nameNode = declarator.childForFieldName('declarator');
        if (nameNode?.type === 'identifier') return nameNode;
      }
    }
    if (declarationNode.type === 'field_declaration') {
      const declarator = declarationNode.childForFieldName('declarator');
      if (declarator?.type === 'function_declarator') return declarator.childForFieldName('declarator');
      return declarator;
    }
    return declarationNode.childForFieldName('name');
  },
};

const tsLangHandler: Partial<LanguageHandler> = {
  preProcessFile: (_file, captures) => {
    const classNames = new Map<string, number>(); const duplicateClassNames = new Set<string>(); const seenClassNodes = new Set<number>();
    for (const { name, node } of captures) {
      if (name === 'class.definition') {
        let classNode = node.type === 'export_statement' ? (node.namedChildren[0] ?? node) : node;
        if (classNode.type === 'class_declaration' && !seenClassNodes.has(classNode.startIndex)) {
          seenClassNodes.add(classNode.startIndex);
          const nameNode = classNode.childForFieldName('name');
          if (nameNode) {
            const className = nameNode.text; const count = classNames.get(className) || 0;
            classNames.set(className, count + 1);
            if (count + 1 > 1) duplicateClassNames.add(className);
          }
        }
      }
    }
    return { duplicateClassNames };
  },
  shouldSkipSymbol: (node, symbolType, langName) => {
    if (langName !== 'typescript') return false;
    const valueNode = node.childForFieldName('value');
    if (valueNode?.type !== 'arrow_function') return false;
    return (symbolType === 'field' && node.type === 'public_field_definition') || (symbolType === 'variable' && node.type === 'variable_declarator');
  },
  getSymbolNameNode: (declarationNode, originalNode) => {
    if (originalNode.type === 'variable_declarator' || originalNode.type === 'public_field_definition') return originalNode.childForFieldName('name');
    if (declarationNode.type === 'export_statement') {
      const { firstNamedChild } = declarationNode;
      if (firstNamedChild?.type === 'arrow_function') {
        // For export default arrow functions, create a synthetic 'default' name
        return null; // Will be handled by fallback logic below
      }
      // Handle `export default function() {}`
      if (firstNamedChild?.type === 'function_declaration' && !firstNamedChild.childForFieldName('name')) {
        return null; // Will be handled by fallback logic below
      }
      const lexicalDecl = declarationNode.namedChildren[0];
      if (lexicalDecl?.type === 'lexical_declaration') {
        const varDeclarator = lexicalDecl.namedChildren[0];
        if (varDeclarator?.type === 'variable_declarator') return varDeclarator.childForFieldName('name');
      }
    }
    return declarationNode.childForFieldName('name');
  },
  processComplexSymbol: ({ nodes, file, node, symbolType, processedSymbols, fileState, childCaptures }) => {
    if (symbolType !== 'method' && symbolType !== 'field') return false;
    const classParent = node.parent?.parent;
    if (classParent?.type === 'class_declaration') {
      const classNameNode = classParent.childForFieldName('name');
      if (classNameNode) {
        const className = classNameNode.text;
        const nameNode = node.childForFieldName('name');
        if (nameNode && !fileState['duplicateClassNames']?.has(className)) {
          const methodName = nameNode.text;
          const unqualifiedSymbolId = `${file.path}#${methodName}`;
          if (!processedSymbols.has(unqualifiedSymbolId) && !nodes.some(n => n.id === unqualifiedSymbolId)) {
            processedSymbols.add(unqualifiedSymbolId);
            const codeSnippet = extractCodeSnippet(symbolType, node);
            const q = extractQualifiers(childCaptures, file.content, tsLangHandler);
            nodes.push({
              id: unqualifiedSymbolId, type: symbolType, name: methodName, filePath: file.path,
              startLine: getLineFromIndex(file.content, node.startIndex), endLine: getLineFromIndex(file.content, node.endIndex),
              codeSnippet, ...(q.isAsync && { isAsync: true }), ...(q.isStatic && { isStatic: true }),
              ...(q.visibility && { visibility: q.visibility }), ...(q.returnType && { returnType: q.returnType }),
              ...(q.parameters && { parameters: q.parameters }), ...(q.canThrow && { canThrow: true }),
            });
          }
          processedSymbols.add(`${file.path}#${methodName}`);
        }
      }
    }
    return true;
  },
  parseParameters: (paramsNode: TSNode, content: string): { name: string; type?: string }[] => {
    const params: { name: string; type?: string }[] = [];
    // Handle object destructuring in props: `({ prop1, prop2 })`
    if (paramsNode.type === 'object_pattern') {
      for (const child of paramsNode.namedChildren) {
        if (child && (child.type === 'shorthand_property_identifier' || child.type === 'property_identifier')) {
          params.push({ name: getNodeText(child, content), type: '#' });
        }
      }
      return params;
    }

    for (const child of paramsNode.namedChildren) {
      if (child && (child.type === 'required_parameter' || child.type === 'optional_parameter')) {
        const nameNode = child.childForFieldName('pattern');
        const typeNode = child.childForFieldName('type');
        if (nameNode) params.push({ name: getNodeText(nameNode, content), type: typeNode ? getNodeText(typeNode, content).replace(/^:\s*/, '') : undefined });
      }
    }
    return params;
  },
};

const phpHandler: Partial<LanguageHandler> = {
  getSymbolNameNode: (declarationNode: TSNode) => {
    if (declarationNode.type === 'namespace_definition') return declarationNode.childForFieldName('name');
    return declarationNode.childForFieldName('name');
  },
};

const languageHandlers: Record<string, Partial<LanguageHandler>> = {
  default: { shouldSkipSymbol: () => false, getSymbolNameNode: (declarationNode) => declarationNode.childForFieldName('name') },
  typescript: tsLangHandler, tsx: tsLangHandler,
  python: pythonHandler, go: goLangHandler, rust: goLangHandler,
  c: cLangHandler, cpp: cLangHandler, php: phpHandler,
};

const getLangHandler = (langName: string): LanguageHandler => ({ ...languageHandlers['default'], ...languageHandlers[langName] } as LanguageHandler);

function getSymbolTypeFromCapture(captureName: string, type: string): CodeNodeType | null {
  const baseMap = new Map<string, CodeNodeType>([
    ['class', 'class'], ['function', 'function'], ['function.arrow', 'arrow_function'], ['interface', 'interface'],
    ['type', 'type'], ['method', 'method'], ['field', 'field'], ['struct', 'struct'], ['enum', 'enum'],
    ['namespace', 'namespace'], ['trait', 'trait'], ['impl', 'impl'], ['constructor', 'constructor'], ['property', 'property'],
    ['html.element', 'html_element'], ['css.rule', 'css_rule'], ['variable', 'variable'], ['constant', 'constant'],
    ['static', 'static'], ['union', 'union'], ['template', 'template'],
  ]);
  return baseMap.get(captureName) ?? baseMap.get(type) ?? null;
}

function findEnclosingSymbolId(startNode: TSNode, file: FileContent, nodes: readonly CodeNode[]): string | null {
  let current: TSNode | null = startNode.parent;
  while (current) {
    const nodeType = current.type;
    // Prioritize function-like parents for accurate call linking
    if (['function_declaration', 'method_definition', 'arrow_function', 'function_definition'].includes(nodeType)) {
      const nameNode = current.childForFieldName('name');
      if (nameNode) {
        let symbolName = nameNode.text;
        // Handle class methods
        if (nodeType === 'method_definition') {
          const classNode = current.parent?.parent;
          if (classNode?.type === 'class_declaration') {
            const className = classNode.childForFieldName('name')?.text;
            if (className) symbolName = `${className}.${symbolName}`;
          }
        }
        const symbolId = `${file.path}#${symbolName}`;
        if (nodes.some(n => n.id === symbolId)) return symbolId;
      }
    }
    // Fallback for other symbol types
    if (current.type === 'jsx_opening_element') {
      const tagNameNode = current.childForFieldName('name');
      if (tagNameNode) {
        const tagName = tagNameNode.text, lineNumber = tagNameNode.startPosition.row + 1;
        const symbolId = `${file.path}#${tagName}:${lineNumber}`;
        if (nodes.some(n => n.id === symbolId)) return symbolId;
      }
    }
    const nameNode = current.childForFieldName('name');
    if (nameNode) {
      let symbolName = nameNode.text;
      if (current.type === 'method_definition' || (current.type === 'public_field_definition' && !current.text.includes('=>'))) {
        const classNode = current.parent?.parent;
        if (classNode?.type === 'class_declaration') symbolName = `${classNode.childForFieldName('name')?.text}.${symbolName}`;
      }
      const symbolId = `${file.path}#${symbolName}`;
      if (nodes.some(n => n.id === symbolId)) return symbolId;
    }
    current = current.parent;
  }
  return file.path;
}

function processSymbol(context: ProcessSymbolContext, langConfig: LanguageConfig): void {
  const { nodes, file, node, symbolType, processedSymbols, childCaptures } = context;
  const handler = getLangHandler(langConfig.name);

  if (handler.shouldSkipSymbol(node, symbolType, langConfig.name)) return;
  if (handler.processComplexSymbol?.(context)) return;

  // Skip local variable declarations inside functions
  if (symbolType === 'variable') {
    let current = node.parent;
    while (current) {
      if (['function_declaration', 'arrow_function', 'method_definition'].includes(current.type)) {
        return; // Skip this variable as it's inside a function
      }
      current = current.parent;
    }
  }

  let declarationNode = node;
  if (node.type === 'export_statement' && node.namedChildCount > 0) declarationNode = node.namedChildren[0] ?? node;

  const q = extractQualifiers(childCaptures, file.content, handler);
  let nameNode = handler.getSymbolNameNode(declarationNode, node) || q.qualifiers['html.tag'] || q.qualifiers['css.selector'];

  if (symbolType === 'css_rule' && !nameNode) {
    const selectorsNode = node.childForFieldName('selectors') || node.namedChildren.find(c => c && c.type === 'selectors');
    if (selectorsNode) nameNode = selectorsNode.namedChildren[0] ?? undefined;
  }

  let symbolName: string;
  if (!nameNode) {
    // Handle export default anonymous functions
    if (node.type === 'export_statement') {
      const firstChild = node.firstNamedChild;
      if (firstChild?.type === 'arrow_function' ||
        (firstChild?.type === 'function_declaration' && !firstChild.childForFieldName('name'))) {
        symbolName = 'default';
      } else {
        return;
      }
    } else {
      return;
    }
  } else {
    symbolName = nameNode.text;
  }

  let symbolId = `${file.path}#${symbolName}`;
  if (symbolType === 'html_element' && nameNode) symbolId = `${file.path}#${symbolName}:${nameNode.startPosition.row + 1}`;

  if (symbolName && !processedSymbols.has(symbolId) && !nodes.some(n => n.id === symbolId)) {
    processedSymbols.add(symbolId);
    const isHtmlElement = symbolType === 'html_element', isCssRule = symbolType === 'css_rule';
    const cssIntents = isCssRule ? getCssIntents(node, file.content) : undefined;
    const codeSnippet = extractCodeSnippet(symbolType, node);
    nodes.push({
      id: symbolId, type: symbolType, name: symbolName, filePath: file.path,
      startLine: getLineFromIndex(file.content, node.startIndex), endLine: getLineFromIndex(file.content, node.endIndex),
      codeSnippet, ...(q.isAsync && { isAsync: true }), ...(q.isStatic && { isStatic: true }),
      ...(q.visibility && { visibility: q.visibility }), ...(q.returnType && { returnType: q.returnType }),
      ...(q.parameters && { parameters: q.parameters }), ...(q.canThrow && { canThrow: true }),
      ...(isHtmlElement && { htmlTag: symbolName }), ...(isCssRule && { cssSelector: symbolName }),
      ...(cssIntents && { cssIntents }),
    });
  }
}

// --- MAIN WORKER FUNCTION ---

export default async function processFile({ file, langConfig }: { file: FileContent; langConfig: LanguageConfig; }) {
  const nodes: CodeNode[] = [];
  const relations: UnresolvedRelation[] = [];
  const processedSymbols = new Set<string>();

  const parser = await createParserForLanguage(langConfig);
  if (!parser.language) return { nodes, relations };

  const query = new (await import('web-tree-sitter')).Query(parser.language, langConfig.query);
  const tree = parser.parse(file.content);
  if (!tree) return { nodes, relations };
  const captures = query.captures(tree.rootNode);

  // --- Phase 1: Definitions ---
  const handler = getLangHandler(langConfig.name);
  const fileState = handler.preProcessFile?.(file, captures) || {};
  const definitionCaptures = captures.filter(({ name }) => name.endsWith('.definition'));
  const otherCaptures = captures.filter(({ name }) => !name.endsWith('.definition'));

  for (const { name, node } of definitionCaptures) {
    const parts = name.split('.');
    const type = parts.slice(0, -1).join('.');
    const symbolType = getSymbolTypeFromCapture(name, type);
    if (!symbolType) continue;

    const childCaptures = otherCaptures.filter((c) => c.node.startIndex >= node.startIndex && c.node.endIndex <= node.endIndex);
    processSymbol({ nodes, file, node, symbolType, processedSymbols, fileState, childCaptures }, langConfig);
  }

  // --- Phase 2: Relationships ---
  for (const { name, node } of captures) {
    const parts = name.split('.');
    const type = parts.slice(0, -1).join('.');
    const subtype = parts[parts.length - 1];

    if (type === 'import' && subtype === 'source') {
      const importPath = getNodeText(node, file.content).replace(/['"`]/g, '');
      relations.push({ fromId: file.path, toName: importPath, type: 'imports' });

      // Handle re-exports, e.g., `export * from './other';`
      const exportParent = node.parent?.parent;
      if (exportParent?.type === 'export_statement') {
        // This creates a file-level dependency, which is what SCN represents.
        // NOTE: The 'exports' relation type is not defined, causing a TS error.
        // A simple 'imports' relation is already created above, which is sufficient
        // for file-level dependency tracking. Deeper re-export symbol resolution
        // is not yet implemented.
        // relations.push({ fromId: file.path, toName: importPath, type: 'exports' });
      }
      continue;
    }

    if (name === 'css.class.reference' || name === 'css.id.reference') {
      const fromId = findEnclosingSymbolId(node, file, nodes);
      if (!fromId) continue;

      const fromNode = nodes.find(n => n.id === fromId);
      if (fromNode?.type !== 'html_element') continue;

      const text = getNodeText(node, file.content).replace(/['"`]/g, '');
      const prefix = name === 'css.id.reference' ? '#' : '.';
      const selectors = (prefix === '.') ? text.split(' ').filter(Boolean).map(s => '.' + s) : [prefix + text];

      for (const selector of selectors) relations.push({ fromId, toName: selector, type: 'reference' });
      continue;
    }

    if (subtype && ['inheritance', 'implementation', 'call', 'reference'].includes(subtype)) {
      const fromId = findEnclosingSymbolId(node, file, nodes);
      if (!fromId) continue;

      const toName = getNodeText(node, file.content).replace(/<.*>$/, '');
      const edgeType = subtype === 'inheritance' ? 'inherits' : subtype === 'implementation' ? 'implements' : 'reference';
      relations.push({ fromId, toName, type: edgeType });
    }
  }

  return { nodes, relations };
}

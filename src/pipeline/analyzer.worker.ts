import { createParserForLanguage } from '../tree-sitter/languages';
import type { LanguageConfig } from '../tree-sitter/language-config';
import type { CodeNode, FileContent, UnresolvedRelation } from '../types';
import {
  findEnclosingSymbolId,
  getLangHandler,
  getNodeText,
  getSymbolTypeFromCapture,
  processSymbol,
} from './analyzer.util';

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

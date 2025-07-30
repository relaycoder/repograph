import { posix as path } from 'node:path';
import { URL } from 'node:url';
import Tinypool from 'tinypool';
import type { Analyzer, CodeNode, CodeEdge, FileContent, UnresolvedRelation, LanguageConfig } from 'repograph-core';
import { getLanguageConfigForFile, logger, ParserError, SymbolResolver, createLanguageImportResolvers } from 'repograph-core';
import { default as processFileInWorker } from './analyzer.worker.js';

const normalizePath = (p: string) => p.replace(/\\/g, '/');
const { getImportResolver } = createLanguageImportResolvers(path);

export const createTreeSitterAnalyzer = (options: { maxWorkers?: number } = {}): Analyzer => {
  const { maxWorkers = 1 } = options;

  return async (files: readonly FileContent[]) => {
    const nodes = new Map<string, CodeNode>();
    let unresolvedRelations: UnresolvedRelation[] = [];
    const allFilePaths = files.map(f => normalizePath(f.path));

    for (const file of files) {
      const langConfig = getLanguageConfigForFile(normalizePath(file.path));
      nodes.set(file.path, {
        id: file.path, type: 'file', name: path.basename(file.path),
        filePath: file.path, startLine: 1, endLine: file.content.split('\n').length,
        language: langConfig?.name,
      });
    }

    const filesToProcess = files.map(file => ({ file, langConfig: getLanguageConfigForFile(normalizePath(file.path)) }))
      .filter((item): item is { file: FileContent, langConfig: LanguageConfig } => !!item.langConfig);

    if (maxWorkers > 1) {
      logger.debug(`Analyzing files in parallel with ${maxWorkers} workers.`);
      const pool = new Tinypool({
        filename: new URL('analyzer.worker.js', import.meta.url).pathname,
        maxThreads: maxWorkers,
      });

      const tasks = filesToProcess.map(item => pool.run(item));
      const results = await Promise.all(tasks);

      for (const result of results) {
        if (result) {
          result.nodes.forEach((node: CodeNode) => nodes.set(node.id, node));
          unresolvedRelations.push(...result.relations);
        }
      }
    } else {
      logger.debug(`Analyzing files sequentially in the main thread.`);
      for (const item of filesToProcess) {
        try {
          const result = await processFileInWorker(item);
          if (result) {
            result.nodes.forEach(node => nodes.set(node.id, node));
            unresolvedRelations.push(...result.relations);
          }
        } catch(error) {
          logger.warn(new ParserError(`Failed to process ${item.file.path}`, item.langConfig.name, error));
        }
      }
    }

    // --- Phase 3: Resolve all relationships ---
    const edges: CodeEdge[] = [];
    const importEdges: CodeEdge[] = [];

    // Resolve imports first, as they are needed by the SymbolResolver
    for (const rel of unresolvedRelations) {
      if (rel.type === 'imports') {
        const fromNode = nodes.get(rel.fromId);
        if (!fromNode || fromNode.type !== 'file' || !fromNode.language) continue;

        const resolver = getImportResolver(fromNode.language);
        const toId = resolver(rel.fromId, rel.toName, allFilePaths);
        if (toId && nodes.has(toId)) {
          importEdges.push({ fromId: rel.fromId, toId, type: 'imports' });
        }
      }
    }

    const symbolResolver = new SymbolResolver(nodes, importEdges);

    for (const rel of unresolvedRelations) {
        if (rel.type === 'imports') continue; // Already handled

        const fromFile = rel.fromId.split('#')[0]!;
        const toNode = symbolResolver.resolve(rel.toName, fromFile);
        if (toNode && rel.fromId !== toNode.id) {
          const edgeType = (rel.type === 'reference' ? 'calls' : rel.type) as CodeEdge['type'];
          edges.push({ fromId: rel.fromId, toId: toNode.id, type: edgeType });
        }
    }

    const finalEdges = [...importEdges, ...edges];
    // Remove duplicates
    const uniqueEdges = [...new Map(finalEdges.map(e => [`${e.fromId}->${e.toId}->${e.type}`, e])).values()];

    return { nodes: Object.freeze(nodes), edges: Object.freeze(uniqueEdges) };
  };
};
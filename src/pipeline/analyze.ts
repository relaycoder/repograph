import path from 'node:path';
import type { Analyzer, CodeNode, CodeEdge, FileContent, UnresolvedRelation } from '../types';
import { getLanguageConfigForFile, type LanguageConfig } from '../tree-sitter/language-config';
import { logger } from '../utils/logger.util';
import { ParserError } from '../utils/error.util';
import { fileURLToPath } from 'node:url';
import Tinypool from 'tinypool';
import processFileInWorker from './analyzer.worker';

const normalizePath = (p: string) => p.replace(/\\/g, '/');

// --- LANGUAGE-SPECIFIC IMPORT RESOLUTION LOGIC ---
// This part is needed on the main thread to resolve import paths.

const createModuleResolver = (extensions: string[]) => (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
  const basedir = normalizePath(path.dirname(fromFile));
  const importPath = normalizePath(path.join(basedir, sourcePath));

  // First, check if the path as-is (with extension) exists
  if (path.extname(importPath) && allFiles.includes(importPath)) {
    return importPath;
  }

  const parsedPath = path.parse(importPath);
  const basePath = normalizePath(path.join(parsedPath.dir, parsedPath.name));
  for (const ext of extensions) {
      const potentialFile = basePath + ext;
      if (allFiles.includes(potentialFile)) return potentialFile;
  }
  
  for (const ext of extensions) {
      const potentialIndexFile = normalizePath(path.join(importPath, 'index' + ext));
      if (allFiles.includes(potentialIndexFile)) return potentialIndexFile;
  }

  if (allFiles.includes(importPath)) return importPath;
  return null;      
};

const resolveImportFactory = (endings: string[], packageStyle: boolean = false) => (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
  const basedir = normalizePath(path.dirname(fromFile));
  const resolvedPathAsIs = normalizePath(path.join(basedir, sourcePath));
  if (allFiles.includes(resolvedPathAsIs)) return resolvedPathAsIs;

  const parsedSourcePath = path.parse(sourcePath);
  const basePath = normalizePath(path.join(basedir, parsedSourcePath.dir, parsedSourcePath.name));
  for (const end of endings) {
    const potentialPath = basePath + end;
    if (allFiles.includes(potentialPath)) return potentialPath;
  }
  
  if (packageStyle && sourcePath.includes('.')) {
    const packagePath = normalizePath(sourcePath.replace(/\./g, '/'));
    for (const end of endings) {
      const fileFromRoot = packagePath + end;
      if (allFiles.includes(fileFromRoot)) return fileFromRoot;
    }
  }
  return null;
};

type ImportResolver = (fromFile: string, sourcePath: string, allFiles: string[]) => string | null;

const languageImportResolvers: Record<string, ImportResolver> = {
  default: (fromFile, sourcePath, allFiles) => {
    const resolvedPathAsIs = path.normalize(path.join(path.dirname(fromFile), sourcePath));
    return allFiles.includes(resolvedPathAsIs) ? resolvedPathAsIs : null;
  },
  typescript: createModuleResolver(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css']),
  javascript: createModuleResolver(['.js', 'jsx', '.mjs', '.cjs']),
  tsx: createModuleResolver(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css']),
  python: (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
    const basedir = normalizePath(path.dirname(fromFile));
    if (sourcePath.startsWith('.')) {
      const level = sourcePath.match(/^\.+/)?.[0]?.length ?? 0;
      const modulePath = sourcePath.substring(level).replace(/\./g, '/');
      let currentDir = basedir;
      for (let i = 1; i < level; i++) currentDir = path.dirname(currentDir);
      const targetPyFile = normalizePath(path.join(currentDir, modulePath) + '.py');
      if (allFiles.includes(targetPyFile)) return targetPyFile;
      const resolvedPath = normalizePath(path.join(currentDir, modulePath, '__init__.py'));
      if (allFiles.includes(resolvedPath)) return resolvedPath;
    }
    return resolveImportFactory(['.py', '/__init__.py'])(fromFile, sourcePath, allFiles);
  },
  java: resolveImportFactory(['.java'], true),
  csharp: resolveImportFactory(['.cs'], true),
  php: resolveImportFactory(['.php']),
  rust: (fromFile: string, sourcePath: string, allFiles: string[]): string | null => {
    const basedir = normalizePath(path.dirname(fromFile));
    const resolvedPath = normalizePath(path.join(basedir, sourcePath + '.rs'));
    if (allFiles.includes(resolvedPath)) return resolvedPath;
    return resolveImportFactory(['.rs', '/mod.rs'])(fromFile, sourcePath, allFiles);
  },
};

const getImportResolver = (langName: string): ImportResolver => languageImportResolvers[langName] ?? languageImportResolvers['default']!;

class SymbolResolver {
  private fileImports = new Map<string, string[]>();

  constructor(private nodes: ReadonlyMap<string, CodeNode>, edges: readonly CodeEdge[]) {
    for (const edge of edges) {
      if (edge.type === 'imports') {
        if (!this.fileImports.has(edge.fromId)) this.fileImports.set(edge.fromId, []);
        this.fileImports.get(edge.fromId)!.push(edge.toId);
      }
    }
  }

  resolve(symbolName: string, contextFile: string): CodeNode | null {
    // 1. Same file
    const sameFileId = `${contextFile}#${symbolName}`;
    if (this.nodes.has(sameFileId)) return this.nodes.get(sameFileId)!;

    // 2. Imported files
    const importedFiles = this.fileImports.get(contextFile) || [];
    for (const file of importedFiles) {
      const importedId = `${file}#${symbolName}`;
      if (this.nodes.has(importedId)) return this.nodes.get(importedId)!;
    }
    
    // 3. CSS Selector
    for (const node of this.nodes.values()) {
        if (node.type === 'css_rule' && node.cssSelector === symbolName) return node;
    }

    // 4. Global fallback
    for (const node of this.nodes.values()) {
      if (node.name === symbolName && ['class', 'function', 'interface', 'struct', 'type', 'enum'].includes(node.type)) {
        return node;
      }
    }

    return null;
  }
}

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
        filename: fileURLToPath(new URL('analyzer.worker.js', import.meta.url)),
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
        
        const toNode = symbolResolver.resolve(rel.toName, rel.fromId.split('#')[0]!);
        if (toNode && rel.fromId !== toNode.id) {
          const edgeType = rel.type === 'reference' ? 'calls' : rel.type;
          edges.push({ fromId: rel.fromId, toId: toNode.id, type: edgeType });
        }
    }
    
    const finalEdges = [...importEdges, ...edges];
    // Remove duplicates
    const uniqueEdges = [...new Map(finalEdges.map(e => [`${e.fromId}->${e.toId}->${e.type}`, e])).values()];

    return { nodes: Object.freeze(nodes), edges: Object.freeze(uniqueEdges) };
  };
};
import * as Parser from 'web-tree-sitter';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LanguageConfig, LoadedLanguage } from 'repograph-core';
import { logger, ParserError } from 'repograph-core';

const getDirname = () => path.dirname(fileURLToPath(import.meta.url));
const loadedLanguages = new Map<string, LoadedLanguage>();
let isInitialized = false;

export const initializeParser = async (): Promise<void> => {
  if (isInitialized) return;
  await Parser.Parser.init();
  isInitialized = true;
};

const findWasmFile = async (config: LanguageConfig): Promise<string> => {
  // wasmPath is like 'tree-sitter-typescript/tree-sitter-typescript.wasm'
  const wasmFileName = path.basename(config.wasmPath);
  if (!wasmFileName) {
    throw new ParserError(`Invalid wasmPath format for ${config.name}: ${config.wasmPath}.`, config.name);
  }

  const currentDir = getDirname();

  // Path when running from dist (e.g., in a published package)
  const distWasmPath = path.resolve(currentDir, 'wasm', wasmFileName);
  if (fs.existsSync(distWasmPath)) return distWasmPath;
  
  // Path when running tests from src, looking in dist
  const projectDistWasmPath = path.resolve(currentDir, '../../dist/wasm', wasmFileName);
  if (fs.existsSync(projectDistWasmPath)) return projectDistWasmPath;

  // Path for development, resolving from node_modules using robust import.meta.resolve
  try {
    const [pkgName, ...rest] = config.wasmPath.split('/');
    const wasmPathInPkg = rest.join('/');
    const pkgJsonUrl = await import.meta.resolve(`${pkgName}/package.json`);
    const pkgDir = path.dirname(fileURLToPath(pkgJsonUrl));
    const resolvedWasmPath = path.join(pkgDir, wasmPathInPkg);
    if (fs.existsSync(resolvedWasmPath)) {
      return resolvedWasmPath;
    }
  } catch (e) {
    // Could not resolve, proceed to throw
  }

  throw new ParserError(`WASM file for ${config.name} not found. Looked in ${distWasmPath}, ${projectDistWasmPath}, and tried resolving from node_modules.`, config.name);
};

export const loadLanguage = async (config: LanguageConfig): Promise<LoadedLanguage> => {
  if (loadedLanguages.has(config.name)) {
    return loadedLanguages.get(config.name)!;
  }
  await initializeParser();

  try {
    const wasmPath = await findWasmFile(config);
    logger.debug(`Loading WASM for ${config.name} from: ${wasmPath}`);
    const language = await Parser.Language.load(wasmPath);
    const loadedLanguage: LoadedLanguage = { config, language };
    loadedLanguages.set(config.name, loadedLanguage);
    return loadedLanguage;
  } catch (error) {
    const message = `Failed to load Tree-sitter WASM file for ${config.name}.`;
    logger.error(message, error);
    throw new ParserError(message, config.name, error);
  }
};

export const createParserForLanguage = async (config: LanguageConfig): Promise<Parser.Parser> => {
  const { language } = await loadLanguage(config);
  const parser = new Parser.Parser();
  parser.setLanguage(language);
  return parser;
};
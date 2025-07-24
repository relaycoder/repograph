import * as Parser from 'web-tree-sitter';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGE_CONFIGS, type LanguageConfig, type LoadedLanguage } from './language-config';
import { logger } from '../utils/logger.util';
import { ParserError } from '../utils/error.util';

// Helper to get the correct path in different environments
const getDirname = () => path.dirname(fileURLToPath(import.meta.url));

const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

export interface ParserInitializationOptions {
  /**
   * For browser environments, sets the base URL from which to load Tree-sitter WASM files.
   * For example, if your WASM files are in `public/wasm`, you would set this to `/wasm/`.
   * This option is ignored in Node.js environments.
   */
  wasmBaseUrl?: string;
}

let wasmBaseUrl: string | null = null;
let isInitialized = false;
const loadedLanguages = new Map<string, LoadedLanguage>();

/**
 * Initializes the Tree-sitter parser system.
 * This must be called before any other parser functions.
 * This function is idempotent.
 */
export const initializeParser = async (options: ParserInitializationOptions = {}): Promise<void> => {
  if (isInitialized) {
    return;
  }
  if (isBrowser && options.wasmBaseUrl) wasmBaseUrl = options.wasmBaseUrl;

  await Parser.Parser.init();
  isInitialized = true;
};

/**
 * Loads a specific language grammar.
 * @param config The language configuration to load
 * @returns A LoadedLanguage object containing the config and language
 */
export const loadLanguage = async (config: LanguageConfig): Promise<LoadedLanguage> => {
  if (loadedLanguages.has(config.name)) {
    return loadedLanguages.get(config.name)!;
  }

  await initializeParser();

  try {
    let finalWasmPath: string;

    if (isBrowser) {
      if (!wasmBaseUrl) {
        throw new ParserError(
          'In a browser environment, you must call initializeParser({ wasmBaseUrl: "..." }) before loading languages.',
          config.name
        );
      }
      const wasmFileName = config.wasmPath.split('/')[1];
      if (!wasmFileName) {
        throw new ParserError(`Invalid wasmPath for ${config.name}: ${config.wasmPath}`, config.name);
      }
      const baseUrl = wasmBaseUrl.endsWith('/') ? wasmBaseUrl : `${wasmBaseUrl}/`;
      finalWasmPath = new URL(baseUrl + wasmFileName, window.location.href).href;
    } else {
      // Node.js logic
      const wasmFileName = config.wasmPath.split('/')[1];
      if (!wasmFileName) {
        throw new ParserError(`Invalid wasmPath format for ${config.name}: ${config.wasmPath}. Expected 'package/file.wasm'.`, config.name);
      }
      // Try multiple possible paths for WASM files
      const currentDir = getDirname();
      const distWasmPath = path.resolve(currentDir, '..', 'wasm', wasmFileName);
      const nodeModulesWasmPath = path.resolve(currentDir, '..', '..', 'node_modules', config.wasmPath);
      // For published packages, the WASM files should be in the same dist directory
      const publishedWasmPath = path.resolve(currentDir, 'wasm', wasmFileName);
      // When running from source, look in the project's dist/wasm directory
      const projectDistWasmPath = path.resolve(currentDir, '..', '..', 'dist', 'wasm', wasmFileName);

      logger.debug(`Trying WASM paths: dist=${distWasmPath}, published=${publishedWasmPath}, projectDist=${projectDistWasmPath}, nodeModules=${nodeModulesWasmPath}`);

      const fs = await import('node:fs');
      if (fs.existsSync(distWasmPath)) {
        finalWasmPath = distWasmPath;
      } else if (fs.existsSync(publishedWasmPath)) {
        finalWasmPath = publishedWasmPath;
      } else if (fs.existsSync(projectDistWasmPath)) {
        finalWasmPath = projectDistWasmPath;
      } else if (fs.existsSync(nodeModulesWasmPath)) {
        finalWasmPath = nodeModulesWasmPath;
      } else {
        throw new Error(`WASM file not found at any of: ${distWasmPath}, ${publishedWasmPath}, ${projectDistWasmPath}, ${nodeModulesWasmPath}`);
      }
    }

    logger.debug(`Loading WASM from: ${finalWasmPath}`);
    const language = await Parser.Language.load(finalWasmPath);

    const loadedLanguage: LoadedLanguage = {
      config,
      language
    };
    
    loadedLanguages.set(config.name, loadedLanguage);
    return loadedLanguage;
  } catch (error) {
    const message = `Failed to load Tree-sitter WASM file for ${config.name}. Please ensure '${config.wasmPath.split('/')[0]}' is installed.`;
    logger.error(message, error);
    throw new ParserError(message, config.name, error);
  }
};

/**
 * Creates a parser instance for a specific language.
 * @param config The language configuration
 * @returns A parser instance configured for the specified language
 */
export const createParserForLanguage = async (config: LanguageConfig): Promise<Parser.Parser> => {
  const loadedLanguage = await loadLanguage(config);
  const parser = new Parser.Parser();
  parser.setLanguage(loadedLanguage.language);
  return parser;
};

/**
 * Gets all loaded languages.
 * @returns A map of language names to LoadedLanguage objects
 */
export const getLoadedLanguages = (): Map<string, LoadedLanguage> => {
  return new Map(loadedLanguages);
};

/**
 * Preloads all supported languages.
 * This can be called to eagerly load all language parsers.
 */
export const preloadAllLanguages = async (): Promise<void> => {
  await Promise.all(LANGUAGE_CONFIGS.map(config => loadLanguage(config)));
};


// Legacy function for backward compatibility
export const getParser = async (): Promise<Parser.Parser> => {
  const tsConfig = LANGUAGE_CONFIGS.find(config => config.name === 'typescript');
  if (!tsConfig) {
    throw new Error('TypeScript configuration not found');
  }
  return createParserForLanguage(tsConfig);
};
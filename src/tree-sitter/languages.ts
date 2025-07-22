import * as Parser from 'web-tree-sitter';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGE_CONFIGS, type LanguageConfig, type LoadedLanguage } from './language-config';
import { logger } from '../utils/logger.util';
import { ParserError } from '../utils/error.util';

// Helper to get the correct path in different environments
const getDirname = () => path.dirname(fileURLToPath(import.meta.url));

let isInitialized = false;
const loadedLanguages = new Map<string, LoadedLanguage>();

/**
 * Initializes the Tree-sitter parser system.
 * This function is idempotent.
 */
export const initializeParser = async (): Promise<void> => {
  if (isInitialized) {
    return;
  }

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
    const wasmPath = path.resolve(getDirname(), '..', '..', 'node_modules', config.wasmPath);
    const language = await Parser.Language.load(wasmPath);
    
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
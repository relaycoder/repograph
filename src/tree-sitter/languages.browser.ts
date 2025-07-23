import type { Language } from 'web-tree-sitter';
import type { LanguageConfig } from './language-config';
import { logger } from '../utils/logger.util';
import { RepoGraphError } from '../utils/error.util';

// Cache for loaded languages
const languageCache = new Map<string, Language>();

/**
 * Browser-compatible language loader that uses web-tree-sitter
 */
export async function loadLanguage(config: LanguageConfig): Promise<Language> {
  if (languageCache.has(config.name)) {
    return languageCache.get(config.name)!;
  }
  
  try {
    const Parser = (await import('web-tree-sitter')).default;
    
    // Initialize web-tree-sitter if not already done
    await Parser.init();
    
    // Construct WASM path - this will be resolved relative to the public directory
    const wasmPath = `/wasm/${config.wasmPath.split('/').pop()}`;
    
    logger.debug(`Loading language ${config.name} from ${wasmPath}`);
    
    const language = await Parser.Language.load(wasmPath);
    languageCache.set(config.name, language);
    
    logger.debug(`Successfully loaded language ${config.name}`);
    return language;
  } catch (error) {
    throw new RepoGraphError(`Failed to load language ${config.name}: ${error}`);
  }
}

/**
 * Check if a language is supported in the browser environment
 */
export function isLanguageSupported(config: LanguageConfig): boolean {
  // In browser environment, we need to check if the WASM file is available
  // This is a basic check - in practice, you might want to do a HEAD request
  return true; // Assume all languages are supported if WASM files are properly copied
}

/**
 * Get the expected WASM file path for a language config
 */
export function getWasmPath(config: LanguageConfig): string {
  return `/wasm/${config.wasmPath.split('/').pop()}`;
}

/**
 * Preload a language (useful for performance optimization)
 */
export async function preloadLanguage(config: LanguageConfig): Promise<void> {
  try {
    await loadLanguage(config);
    logger.debug(`Preloaded language ${config.name}`);
  } catch (error) {
    logger.warn(`Failed to preload language ${config.name}: ${error}`);
  }
}

/**
 * Clear the language cache (useful for testing or memory management)
 */
export function clearLanguageCache(): void {
  languageCache.clear();
  logger.debug('Language cache cleared');
}
import * as Parser from 'web-tree-sitter';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Helper to get the correct path in different environments
const getDirname = () => path.dirname(fileURLToPath(import.meta.url));

let parser: Parser.Parser | null = null;

/**
 * Initializes the Tree-sitter parser and loads necessary language grammars.
 * This function is idempotent.
 * @returns A fully initialized Tree-sitter parser instance.
 */
export const getParser = async (): Promise<Parser.Parser> => {
  if (parser) {
    return parser;
  }

  await Parser.Parser.init();
  const newParser = new Parser.Parser();

  const wasmDir = path.join(getDirname(), '..', '..', 'wasm');
  
  try {
    const TSLang = await Parser.Language.load(
      path.join(wasmDir, 'tree-sitter-typescript.wasm')
    );
    newParser.setLanguage(TSLang);
    parser = newParser;
    return parser;
  } catch (error) {
    console.error("Failed to load Tree-sitter WASM files.", error);
    console.error(`Please ensure 'tree-sitter-typescript.wasm' is located in a 'wasm' directory at the project root.`);
    throw new Error("Could not initialize parser.");
  }
};
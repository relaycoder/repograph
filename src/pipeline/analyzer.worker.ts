import { createParserForLanguage } from '../tree-sitter/languages';
import type { LanguageConfig, FileContent } from 'repograph-core';
import { analyzeFileContent } from 'repograph-core';

export default async function processFileInWorker({ file, langConfig }: { file: FileContent; langConfig: LanguageConfig; }) {
  const parser = await createParserForLanguage(langConfig);
  return analyzeFileContent({ file, langConfig, parser });
}
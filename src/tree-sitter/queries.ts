import { LANGUAGE_CONFIGS, getLanguageConfigForFile, type LanguageConfig } from './language-config';

/**
 * Tree-sitter query for TypeScript and JavaScript to capture key symbols.
 * This query is designed to find definitions of classes, functions, interfaces,
 * and import statements to build the code graph.
 * 
 * @deprecated Use getQueryForLanguage() instead
 */
export const TS_QUERY = `
(import_statement
  source: (string) @import.source) @import.statement

(class_declaration) @class.definition
(export_statement declaration: (class_declaration)) @class.definition

(function_declaration) @function.definition
(export_statement declaration: (function_declaration)) @function.definition

(variable_declarator value: (arrow_function)) @function.arrow.definition
(public_field_definition value: (arrow_function)) @function.arrow.definition
(export_statement declaration: (lexical_declaration (variable_declarator value: (arrow_function)))) @function.arrow.definition

(interface_declaration) @interface.definition
(export_statement declaration: (interface_declaration)) @interface.definition

(type_alias_declaration) @type.definition
(export_statement declaration: (type_alias_declaration)) @type.definition

(method_definition) @method.definition
(public_field_definition) @field.definition

(call_expression
  function: (identifier) @function.call)
`;

/**
 * Get the Tree-sitter query for a specific language configuration.
 * @param config The language configuration
 * @returns The query string for the language
 */
export function getQueryForLanguage(config: LanguageConfig): string {
  return config.query.trim();
}

/**
 * Get the Tree-sitter query for a file based on its extension.
 * @param filePath The file path
 * @returns The query string for the file's language, or null if not supported
 */
export function getQueryForFile(filePath: string): string | null {
  const config = getLanguageConfigForFile(filePath);
  return config ? getQueryForLanguage(config) : null;
}

/**
 * Get all supported language configurations.
 * @returns Array of all language configurations
 */
export function getAllLanguageConfigs(): LanguageConfig[] {
  return [...LANGUAGE_CONFIGS];
}
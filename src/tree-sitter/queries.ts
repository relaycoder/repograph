/**
 * Tree-sitter query for TypeScript and JavaScript to capture key symbols.
 * This query is designed to find definitions of classes, functions, interfaces,
 * and import statements to build the code graph.
 */
export const TS_QUERY = `
(import_statement
  source: (string) @import.source) @import.statement

(class_declaration
  name: (type_identifier) @class.name) @class.definition

(function_declaration
  name: (identifier) @function.name) @function.definition

(lexical_declaration
  (variable_declarator
    name: (identifier) @function.arrow.name
    value: (arrow_function)
  )
) @function.arrow.definition

(interface_declaration
  name: (type_identifier) @interface.name) @interface.definition

(type_alias_declaration
  name: (type_identifier) @type.name) @type.definition
`;
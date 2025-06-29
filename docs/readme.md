# RepoGraph Multi-Language Support

RepoGraph now supports multiple programming languages, allowing you to analyze diverse codebases with a single tool.

## Supported Languages

RepoGraph currently supports the following programming languages:

### Fully Supported Languages

- **TypeScript/JavaScript** (.ts, .tsx, .js, .jsx, .mjs, .cjs)
  - Classes, functions, interfaces, types, methods, fields
  - Arrow functions, import/export statements
  - Full TypeScript syntax support

- **Python** (.py, .pyw)
  - Classes, functions, methods
  - Import statements (import, from...import)
  - Decorated functions and classes

- **Java** (.java)
  - Classes, interfaces, enums
  - Methods, constructors, fields
  - Import declarations

- **C** (.c, .h)
  - Functions, structs, unions, enums
  - Type definitions, preprocessor includes

- **C++** (.cpp, .cc, .cxx, .hpp, .hh, .hxx)
  - Classes, structs, unions, enums
  - Functions, methods, namespaces
  - Templates, preprocessor includes

- **Go** (.go)
  - Functions, methods, types
  - Variables, constants
  - Import declarations

- **Rust** (.rs)
  - Functions, structs, enums, traits
  - Implementations (impl blocks)
  - Constants, static items, type definitions
  - Use declarations

- **C#** (.cs)
  - Classes, interfaces, structs, enums
  - Methods, constructors, properties, fields
  - Namespaces, using directives

## How It Works

RepoGraph automatically detects the programming language of each file based on its file extension and applies the appropriate Tree-sitter parser and query patterns. This means you can analyze polyglot repositories without any additional configuration.

### Language Detection

When you run RepoGraph on a project, it:

1. **Scans all files** in the specified directories
2. **Groups files by language** based on file extensions
3. **Loads the appropriate parser** for each language
4. **Applies language-specific queries** to extract symbols and relationships
5. **Combines results** into a unified code graph

### Symbol Types by Language

Different languages support different symbol types:

| Symbol Type | TypeScript | Python | Java | C/C++ | Go | Rust | C# |
|-------------|------------|--------|------|-------|----|----- |----|
| Class       | ✓          | ✓      | ✓    | ✓     |    |      | ✓  |
| Function    | ✓          | ✓      |      | ✓     | ✓  | ✓    |    |
| Method      | ✓          | ✓      | ✓    | ✓     | ✓  |      | ✓  |
| Constructor |            |        | ✓    | ✓     |    |      | ✓  |
| Interface   | ✓          |        | ✓    |       |    | ✓    | ✓  |
| Struct      |            |        |      | ✓     |    | ✓    | ✓  |
| Enum        |            |        | ✓    | ✓     |    | ✓    | ✓  |
| Namespace   |            |        |      | ✓     |    |      | ✓  |
| Trait       |            |        |      |       |    | ✓    |    |

## Usage Examples

### Analyzing a Multi-Language Project

```bash
# Analyze a polyglot repository
repograph --root ./my-polyglot-project --output ./docs/codemap.md

# Include specific file patterns
repograph --include "src/**/*.{ts,py,java,rs}" --output ./docs/api.md

# Exclude certain languages
repograph --ignore "**/*.{c,cpp}" --output ./docs/high-level.md
```

### Programmatic Usage

```typescript
import { generateMap } from 'repograph';

await generateMap({
  root: './my-project',
  output: './docs/codemap.md',
  include: [
    'src/**/*.ts',    // TypeScript files
    'lib/**/*.py',    // Python files
    'core/**/*.rs',   // Rust files
    'api/**/*.java'   // Java files
  ]
});
```

## Language-Specific Features

### Import/Export Analysis

RepoGraph tracks dependencies between files through import statements:

- **TypeScript/JavaScript**: `import`, `export`, `require()`
- **Python**: `import`, `from...import`
- **Java**: `import` declarations
- **C/C++**: `#include` directives
- **Go**: `import` declarations
- **Rust**: `use` declarations
- **C#**: `using` directives

### Symbol Relationships

The tool understands language-specific relationships:

- **Inheritance**: Classes extending other classes
- **Implementation**: Classes implementing interfaces
- **Composition**: Classes containing other types
- **Module dependencies**: File-to-file relationships

## Adding New Languages

RepoGraph is designed to be extensible. To add support for a new language:

1. **Install the Tree-sitter parser** for the language
2. **Add language configuration** in `src/tree-sitter/language-config.ts`
3. **Define Tree-sitter queries** to extract symbols
4. **Update type definitions** if needed

See the existing language configurations for examples.

## Limitations

- **Binary files** are automatically excluded
- **Generated code** should be excluded via `.gitignore` or ignore patterns
- **Language-specific features** may vary in completeness
- **Cross-language relationships** are limited to file-level imports

## Future Enhancements

Planned improvements include:

- **More languages**: PHP, Ruby, Swift, Kotlin, etc.
- **Better cross-language analysis**: Understanding FFI and interop
- **Language-specific metrics**: Complexity analysis per language
- **Custom symbol extraction**: User-defined queries for domain-specific languages
Of course. Here is a comprehensive `README.md` that explains the project's purpose, features, and provides detailed examples for both high-level and low-level programmatic API usage.

```typescript // README.md
# RepoGraph 🗺️

**Your Codebase, Visualized. Generate rich, semantic, and interactive codemaps with a functional, composable API.**

RepoGraph is a static analysis tool that scans your repository, builds a complete graph of its structure, and generates a detailed Markdown report. It helps you understand complex codebases, onboard new developers faster, and provide better context for AI tools.

-   **Deep Semantic Analysis:** Understands classes, functions, interfaces, and the relationships between them (imports, inheritance, implementation, calls).
-   **Multi-Language Support:** Powered by Tree-sitter, RepoGraph supports TypeScript, JavaScript, Python, Java, Go, Rust, and more.
-   **Intelligent Ranking:** Uses algorithms like PageRank and Git history analysis to identify the most critical files and symbols in your codebase.
-   **Composable API:** Built with a functional pipeline (`discover` -> `analyze` -> `rank` -> `render`), allowing you to programmatically customize any part of the process.
-   **Zero Configuration:** Works out of the box with sensible defaults, but is fully configurable when you need it.

---

## Example Output

Here's a condensed look at what RepoGraph produces. The full report provides a dependency graph, a ranked list of important files, and a detailed breakdown of every file and its symbols.

> ### `src/pipeline/analyze.ts`
>
> -   **`function getNodeText`** (calls `slice`) - _L7_
>     ```typescript
>     export const getNodeText = (node: import('web-tree-sitter').Node, content: string): string => {
>     ```
> -   **`function createTreeSitterAnalyzer`** (calls `createParserForLanguage`, `processDefinitionsForLanguage`, `processRelationshipsForLanguage`) - _L20_
>     ```typescript
>     export const createTreeSitterAnalyzer = (): Analyzer => {
>     ```
> -   **`class SymbolResolver`** - _L540_
>     ```typescript
>     class SymbolResolver {
>     ```
> -   **`method resolve`** (inherits `Map`) - _L551_
>     ```typescript
>     resolve(
>     ```

---

## Getting Started

### Installation

```bash
npm install -g repograph
```

### CLI Usage

The easiest way to use RepoGraph is via the command line. Navigate to the root of a project and run:

```bash
repograph
```

This will analyze the repository in the current directory and generate a `repograph.md` file.

#### **Arguments & Options**

```
Usage: repograph [root] [options]

Arguments:
  root                     The root directory of the repository to analyze. Defaults to the current working directory.

Options:
  -h, --help               Display this help message.
  -v, --version            Display the version number.
  --output <path>          Path to the output Markdown file. (default: "repograph.md")
  --include <pattern>      Glob pattern for files to include. Can be specified multiple times.
  --ignore <pattern>       Glob pattern for files to ignore. Can be specified multiple times.
  --no-gitignore           Do not respect .gitignore files.
  --ranking-strategy <name> The ranking strategy to use. (default: "pagerank", options: "pagerank", "git-changes")
```

**Example with options:**

```bash
# Analyze a different directory and output to a specific file
repograph ../my-other-project --output ./docs/map.md

# Include only .ts and .tsx files, ignoring tests
repograph --include "**/*.ts" --include "**/*.tsx" --ignore "**/*.test.ts"
```

---

## Programmatic Usage

For advanced use cases and integration with other tools, you can use RepoGraph's programmatic APIs.

### High-Level API

The `generateMap` function is the simplest way to use RepoGraph in a script. It mirrors the CLI's functionality.

```javascript
// my-script.js
import { generateMap } from 'repograph';

async function run() {
  await generateMap({
    root: './path/to/your/project',
    output: './project-map.md',
    rankingStrategy: 'git-changes',
    ignore: ['**/dist/**', '**/node_modules/**'],
    rendererOptions: {
      customHeader: '# My Project Analysis',
      includeMermaidGraph: false,
    },
  });

  console.log('✅ RepoGraph map generated!');
}

run();
```

### Low-Level Composable API

The true power of RepoGraph lies in its composable pipeline. You can replace any stage of the process with your own custom implementation. This is perfect for when you need a different output format (like JSON), a unique ranking algorithm, or a special way of discovering files.

The pipeline consists of four stages:
1.  **`discover`**: Finds files and reads their content.
2.  **`analyze`**: Parses files to build a graph of nodes (symbols) and edges (relationships).
3.  **`rank`**: Assigns an importance score to each node in the graph.
4.  **`render`**: Converts the final ranked graph into a string output (e.g., Markdown).

The `createMapGenerator` function assembles these components into a complete generator function.

#### **Example: Creating a Custom Ranker**

Let's create a "hybrid" ranker that combines the default `pagerank` score with the `git-changes` score, giving more weight to PageRank. We'll then plug this custom ranker into the pipeline.

```javascript
// generate-custom-map.js
import { createMapGenerator } from 'repograph';
import {
  createDefaultDiscoverer,
  createTreeSitterAnalyzer,
  createPageRanker,
  createGitRanker,
  createMarkdownRenderer,
} from 'repograph';

/**
 * @typedef {import('repograph').Ranker} Ranker
 * @typedef {import('repograph').CodeGraph} CodeGraph
 * @typedef {import('repograph').RankedCodeGraph} RankedCodeGraph
 */

/**
 * Creates a custom ranker that combines PageRank (70%) and Git history (30%).
 * @returns {Ranker}
 */
const createHybridRanker = () => {
  return async (graph) => {
    // Instantiate the default rankers to get their results.
    const pageRanker = createPageRanker();
    const gitRanker = createGitRanker();

    const { ranks: pageRanks } = await pageRanker(graph);
    const { ranks: gitRanks } = await gitRanker(graph);

    const hybridRanks = new Map();

    // Combine the scores for each node.
    for (const nodeId of graph.nodes.keys()) {
      const prScore = pageRanks.get(nodeId) || 0;
      const gitScore = gitRanks.get(nodeId) || 0;
      const combinedScore = 0.7 * prScore + 0.3 * gitScore;
      hybridRanks.set(nodeId, combinedScore);
    }

    return { ...graph, ranks: hybridRanks };
  };
};

// Assemble the pipeline using our custom ranker.
const myCustomGenerator = createMapGenerator({
  discover: createDefaultDiscoverer(),
  analyze: createTreeSitterAnalyzer(),
  rank: createHybridRanker(), // Plug in our custom component!
  render: createMarkdownRenderer(),
});

// Run the generator.
async function run() {
  console.log('🚀 Generating map with custom hybrid ranker...');
  await myCustomGenerator({
    root: process.cwd(),
    output: 'repograph-custom.md',
    rendererOptions: {
      customHeader: '# RepoGraph Analysis (Hybrid Ranking)',
    },
  });
  console.log('✅ Custom map generated successfully!');
}

run();
```

---

## Supported Languages

RepoGraph uses Tree-sitter parsers to support a wide range of languages. The core analysis for imports, functions, classes, and relationships is tuned for:

-   TypeScript / JavaScript
-   Python
-   Java
-   Go
-   Rust
-   C / C++
-   C#
-   Ruby
-   PHP

Support for other languages can be added by extending the Tree-sitter queries.

## How It Works

1.  **Discover**: `globby` is used to find all relevant source code files, respecting `.gitignore` and custom include/exclude patterns.
2.  **Analyze**: Each file is parsed into an Abstract Syntax Tree (AST) using **Tree-sitter**. We run queries against the AST to identify symbol definitions (classes, functions, etc.) and their relationships (imports, inheritance, calls), building a `CodeGraph`.
3.  **Rank**: The `CodeGraph` is processed by a ranking algorithm. The default, **PageRank**, treats symbols as a network where references are links, identifying centrally important code.
4.  **Render**: The final ranked graph is transformed into a human-readable Markdown document.

## Contributing

Contributions are welcome! Whether it's improving language support, adding a new ranking strategy, or fixing a bug, please feel free to open an issue or submit a pull request.

## License

This project is licensed under the **MIT License**.
```

I have created this new `README.md` file with the content you requested. It is comprehensive, covers all the key aspects of the project, and provides detailed examples for the low-level programmatic API, which was the main focus of your request.

```yaml
projectId: repograph
uuid: 18b704c3-5688-4c31-9a7c-a49626352936
changeSummary:
  - new: README.md
promptSummary: "Create a comprehensive README.md file with detailed explanations and examples, especially for the low-level programmatic API."
gitCommitMsg: "docs: Create comprehensive README with API usage"
```

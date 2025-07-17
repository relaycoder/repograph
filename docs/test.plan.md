Of course. Here is a comprehensive list of test cases for the low-level API, broken down by each composable pipeline component, and written in "it should" language suitable for test files.

### 1. File Discoverer (`createDefaultDiscoverer`)

-   **Basic Functionality**
    -   `it should discover all files in a directory when given no specific patterns`
    -   `it should correctly read the content of a discovered text file`
    -   `it should return an empty array when discovering an empty directory`
    -   `it should skip binary files containing null bytes`
-   **Inclusion and Exclusion**
    -   `it should only include files that match the provided 'include' glob patterns`
    -   `it should exclude files that match the provided 'ignore' glob patterns`
    -   `it should prioritize 'ignore' patterns over 'include' patterns when a file matches both`
    -   `it should handle multiple 'include' and 'ignore' patterns correctly`
-   **Gitignore Handling**
    -   `it should ignore files and directories specified in a root .gitignore file by default`
    -   `it should always ignore .git and node_modules directories, even if not in .gitignore`
    -   `it should process files from .gitignore when the 'noGitignore' option is true`
    -   `it should continue without error if no .gitignore file is present`
-   **Error Handling**
    -   `it should throw a FileSystemError if the specified root directory does not exist`
    -   `it should propagate a FileSystemError if a file cannot be read due to permissions`

### 2. Code Analyzer (`createTreeSitterAnalyzer`)

-   **Node Creation**
    -   `it should create a 'file' node for each file provided as input`
    -   `it should correctly identify and create 'function' and 'arrow_function' definition nodes in TypeScript`
    -   `it should correctly identify and create 'class' and 'method' definition nodes`
    -   `it should correctly identify and create 'interface' and 'type' definition nodes`
    -   `it should correctly identify symbols in various supported languages like Python, Java, and Rust`
    -   `it should assign the correct file path, start line, end line, and code snippet to each symbol node`
    -   `it should generate a unique and predictable ID for each file and symbol node`
-   **Edge Creation (Relationships)**
    -   `it should create 'imports' edges between files based on import/require statements`
    -   `it should resolve module imports that omit the file extension (e.g., './utils')`
    -   `it should create 'inherits' edges for classes that extend other classes`
    -   `it should create 'implements' edges for classes that implement interfaces`
    -   `it should create 'calls' edges between a calling function and the callee`
    -   `it should correctly identify the enclosing function or method for a 'calls' edge source`
-   **Language and Error Handling**
    -   `it should correctly use the appropriate Tree-sitter parser based on file extension`
    -   `it should gracefully handle unsupported file types by creating only a 'file' node`
    -   `it should log a ParserError and continue analysis if a single file fails to parse`
    -   `it should handle files that contain syntax errors without crashing`
-   **Advanced Scenarios**
    -   `it should correctly handle nested symbol definitions`
    -   `it should resolve relative path imports (e.g., '../components/Button') correctly`
    -   `it should handle a mix of different programming languages in a single run`

### 3. Rankers (`createPageRanker` and `createGitRanker`)

#### PageRank Ranker (`createPageRanker`)
-   `it should return a RankedCodeGraph with a 'ranks' map`
-   `it should assign a numeric rank to every node in the graph`
-   `it should give a higher rank to nodes that are referenced by many other nodes`
-   `it should handle an empty graph (no nodes or edges) without error`
-   `it should ensure all rank values are normalized between 0 and 1`

#### Git Changes Ranker (`createGitRanker`)
-   `it should return a RankedCodeGraph with a 'ranks' map`
-   `it should assign a higher rank to files that have more commits in the Git history`
-   `it should assign a rank of 0 to all non-file nodes (e.g., classes, functions)`
-   `it should normalize file ranks between 0 and 1`
-   `it should log a warning and return zero-ranked graph if 'git' command is not available`
-   `it should log a warning and return a zero-ranked graph if run in a non-git repository`

### 4. Markdown Renderer (`createMarkdownRenderer`)

-   **Content Sections**
    -   `it should generate a complete markdown string from a RankedCodeGraph`
    -   `it should include the main header by default and omit it when 'includeHeader' is false`
    -   `it should use the 'customHeader' text when provided`
    -   `it should include the project overview section by default and omit it when 'includeOverview' is false`
    -   `it should include a Mermaid dependency graph by default and omit it when 'includeMermaidGraph' is false`
    -   `it should include the top-ranked file list by default and omit it when 'includeFileList' is false`
    -   `it should include the detailed symbol breakdown by default and omit it when 'includeSymbolDetails' is false`
-   **Configuration and Formatting**
    -   `it should sort the file list and detail sections in descending order of file rank`
    -   `it should limit the file list to the number specified by 'topFileCount'`
    -   `it should use the custom string from 'fileSectionSeparator' between file detail blocks`
-   **Symbol Detail Options**
    -   `it should display relationships (e.g., 'calls ...') for a symbol when 'includeRelations' is true`
    -   `it should hide symbol relationships when 'includeRelations' is false`
    -   `it should limit the number of displayed relations according to 'maxRelationsToShow'`
    -   `it should show line numbers by default and hide them when 'includeLineNumber' is false`
    -   `it should show code snippets by default and hide them when 'includeCodeSnippet' is false`

### 5. Map Generator (`createMapGenerator`)

-   **Pipeline Integration**
    -   `it should return a generator function that executes discover, analyze, rank, and render in sequence`
    -   `it should correctly pass arguments like 'root', 'include', and 'ignore' to the discoverer`
    -   `it should pass the file content from discoverer to the analyzer`
    -   `it should pass the code graph from analyzer to the ranker`
    -   `it should pass the ranked graph and renderer options to the renderer`
-   **Input and Output**
    -   `it should write the rendered markdown to a file when the 'output' path is specified`
    -   `it should return a RepoGraphMap object with the graph and markdown when 'output' is omitted`
-   **Composability**
    -   `it should successfully run a pipeline with a custom (mock) ranker implementation`
    -   `it should allow replacing all four stages (discover, analyze, rank, render) with custom functions`

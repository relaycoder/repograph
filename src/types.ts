// Core Data Structures

/** Represents a single file read from disk. Immutable. */
export type FileContent = {
  readonly path: string;
  readonly content: string;
};

/** The type of a symbol identified in the code. */
export type CodeNodeType =
  | 'file'
  | 'class'
  | 'function'
  | 'interface'
  | 'variable'
  | 'type'
  | 'arrow_function'
  | 'method'
  | 'field'
  | 'struct'
  | 'enum'
  | 'namespace'
  | 'trait'
  | 'impl'
  | 'constructor'
  | 'property'
  | 'constant'
  | 'static'
  | 'union'
  | 'template';

/** Represents a single, identifiable symbol (or a file) in the code. Immutable. */
export type CodeNode = {
  readonly id: string; // Unique identifier (e.g., 'src/api.ts#MyClass')
  readonly type: CodeNodeType;
  readonly name: string; // e.g., 'MyClass'
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly language?: string; // For file nodes, the detected language
  readonly codeSnippet?: string; // e.g., function signature
};

/** Represents a directed relationship between two CodeNodes. Immutable. */
export type CodeEdge = {
  readonly fromId: string; // ID of the source CodeNode
  readonly toId: string;   // ID of the target CodeNode
  readonly type: 'imports' | 'calls' | 'inherits' | 'implements';
};

/** The complete, raw model of the repository's structure. Immutable. */
export type CodeGraph = {
  readonly nodes: ReadonlyMap<string, CodeNode>;
  readonly edges: readonly CodeEdge[];
};

/** A CodeGraph with an added 'rank' score for each node. Immutable. */
export type RankedCodeGraph = CodeGraph & {
  readonly ranks: ReadonlyMap<string, number>; // Key is CodeNode ID
};

// High-Level API Options

/** Configuration for the final Markdown output. */
export type RendererOptions = {
  /** Include a Mermaid.js dependency graph. @default true */
  readonly includeMermaidGraph?: boolean;
  /** Include detailed breakdowns for each symbol. @default true */
  readonly includeSymbolDetails?: boolean;
  /** Custom text to appear at the top of the Markdown file. */
  readonly customHeader?: string;
};

/** Configuration options for the main `generateMap` function. */
export type RepoGraphOptions = {
  /** Root directory to analyze. @default process.cwd() */
  readonly root?: string;
  /** Output path for the Markdown file. @default './repograph.md' */
  readonly output?: string;
  /** Glob patterns for files to include. */
  readonly include?: readonly string[];
  /** Glob patterns for files to exclude. */
  readonly ignore?: readonly string[];
  /** Disables the use of .gitignore. @default false */
  readonly noGitignore?: boolean;
  /** The ranking strategy to use. @default 'pagerank' */
  readonly rankingStrategy?: 'pagerank' | 'git-changes';
  /** Configuration for the final Markdown output. */
  readonly rendererOptions?: RendererOptions;
};

// Low-Level Functional Pipeline Contracts

/** Discovers files and returns their content. */
export type FileDiscoverer = (config: {
  readonly root: string;
  readonly include?: readonly string[];
  readonly ignore?: readonly string[];
  readonly noGitignore?: boolean;
}) => Promise<readonly FileContent[]>;

/** Analyzes file content and builds the dependency graph. */
export type Analyzer = (files: readonly FileContent[]) => Promise<CodeGraph>;

/** Ranks the nodes in a graph. */
export type Ranker = (graph: CodeGraph) => Promise<RankedCodeGraph>;

/** Renders a ranked graph into a string format. */
export type Renderer = (rankedGraph: RankedCodeGraph, options?: RendererOptions) => string;
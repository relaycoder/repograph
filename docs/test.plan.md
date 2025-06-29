# RepoGraph Test Plan

This document outlines comprehensive testing strategies for RepoGraph, covering End-to-End (E2E), Integration, and Unit test cases. The test plan is organized by testing levels and follows the "should" format for clear test expectations.

## 🎯 Testing Overview

RepoGraph is a functional, immutable TypeScript library that generates semantic codemaps. Testing focuses on:
- **Functional Pipeline**: File discovery → Analysis → Ranking → Rendering
- **Immutability**: All data structures remain unchanged
- **Composability**: Custom pipeline components work correctly
- **Output Quality**: Generated Markdown is accurate and well-formatted

---

## 🔬 Unit Tests

### File Discovery (`src/pipeline/discover.ts`)

#### `createDefaultDiscoverer()`
- Should return a FileDiscoverer function
- Should discover files using default patterns when no include patterns provided
- Should respect custom include patterns when provided
- Should exclude files matching ignore patterns
- Should respect .gitignore by default
- Should ignore .gitignore when noGitignore is true
- Should always exclude node_modules directory
- Should handle non-existent root directory gracefully
- Should filter out binary files that cannot be read
- Should return FileContent objects with correct path and content properties
- Should handle empty directories
- Should handle symbolic links appropriately
- Should normalize file paths consistently across platforms

#### Gitignore Integration
- Should read .gitignore file when present
- Should handle missing .gitignore file gracefully
- Should parse .gitignore patterns correctly
- Should combine .gitignore with custom ignore patterns
- Should handle malformed .gitignore files

### Code Analysis (`src/pipeline/analyze.ts`)

#### `createTreeSitterAnalyzer()`
- Should return an Analyzer function
- Should create a directed graph with multi-edge support
- Should add file nodes for all discovered files
- Should parse TypeScript files using Tree-sitter
- Should identify class declarations and add them as nodes
- Should identify function declarations and add them as nodes
- Should identify arrow function declarations and add them as nodes
- Should identify interface declarations and add them as nodes
- Should identify type alias declarations and add them as nodes
- Should create edges from files to their contained symbols
- Should parse import statements and create import edges
- Should resolve relative import paths correctly
- Should handle malformed or unparseable files gracefully
- Should generate unique IDs for symbols (file#symbolName format)
- Should capture correct line numbers for symbols
- Should extract meaningful code snippets for symbols
- Should handle duplicate symbol names in different files
- Should handle symbols with same name in same file (overloads)

#### Tree-sitter Integration
- Should initialize parser correctly
- Should load TypeScript language grammar
- Should execute queries against parsed syntax trees
- Should handle parsing errors gracefully
- Should capture all query matches correctly

### Ranking (`src/pipeline/rank.ts`)

#### `createPageRanker()`
- Should return a Ranker function
- Should compute PageRank scores for all nodes
- Should handle empty graphs gracefully
- Should return normalized rank scores between 0 and 1
- Should assign higher ranks to heavily referenced nodes
- Should handle disconnected graph components
- Should preserve graph immutability during ranking
- Should return RankedCodeGraph with correct structure

#### `createGitRanker()`
- Should return a Ranker function
- Should execute git log command to get file change history
- Should count file changes from git history
- Should normalize scores based on maximum change count
- Should rank file nodes based on change frequency
- Should assign zero rank to non-file nodes
- Should handle git command failures gracefully
- Should respect maxCommits parameter
- Should handle repositories without git history
- Should handle files not in git history

### Rendering (`src/pipeline/render.ts`)

#### `createMarkdownRenderer()`
- Should return a Renderer function
- Should generate valid Markdown output
- Should include project overview section
- Should include generation timestamp
- Should sort files by rank in descending order
- Should generate Mermaid dependency graph when enabled
- Should include top 10 most important files table
- Should include detailed file and symbol breakdown when enabled
- Should handle custom header when provided
- Should escape special Markdown characters appropriately
- Should generate clickable file links
- Should include symbol type and line number information
- Should include code snippets for symbols
- Should handle files with no identified symbols
- Should handle empty graphs gracefully

#### Mermaid Graph Generation
- Should generate valid Mermaid syntax
- Should include only file nodes in dependency graph
- Should create directed edges between files
- Should avoid duplicate edges
- Should handle circular dependencies
- Should generate readable node labels

### Type System (`src/types.ts`)

#### Core Types
- Should define immutable FileContent type
- Should define comprehensive CodeNodeType enum
- Should define immutable CodeNode type with required fields
- Should define immutable CodeEdge type with relationship types
- Should define CodeGraph as readonly graphology instance
- Should define RankedCodeGraph with graph and ranks
- Should define comprehensive RepoGraphOptions
- Should define RendererOptions with sensible defaults
- Should define functional pipeline contracts correctly

### High-Level API (`src/high-level.ts`)

#### `generateMap()`
- Should use default options when none provided
- Should resolve root path to absolute path
- Should select correct ranker based on rankingStrategy
- Should compose pipeline with default components
- Should pass configuration to pipeline correctly
- Should handle invalid ranking strategy gracefully
- Should create output directory if it doesn't exist

### Composition (`src/composer.ts`)

#### `createMapGenerator()`
- Should return a MapGenerator function
- Should execute pipeline stages in correct order
- Should pass data between pipeline stages correctly
- Should write output to specified file path
- Should create output directory recursively
- Should handle file write errors gracefully
- Should preserve immutability throughout pipeline

### Tree-sitter Integration (`src/tree-sitter/`)

#### Language Loading (`languages.ts`)
- Should initialize Tree-sitter parser once
- Should load TypeScript WASM grammar
- Should return same parser instance on subsequent calls
- Should handle missing WASM files gracefully
- Should provide clear error messages for setup issues

#### Query Definitions (`queries.ts`)
- Should define valid Tree-sitter query syntax
- Should capture import statements with source paths
- Should capture class declarations with names
- Should capture function declarations with names
- Should capture arrow function declarations with names
- Should capture interface declarations with names
- Should capture type alias declarations with names

---

## 🔗 Integration Tests

### Pipeline Integration

#### Full Pipeline Execution
- Should execute complete pipeline from files to Markdown
- Should maintain data integrity between pipeline stages
- Should handle large repositories efficiently
- Should process multiple file types correctly
- Should generate consistent output across runs
- Should handle concurrent pipeline executions

#### Component Composition
- Should allow custom FileDiscoverer implementations
- Should allow custom Analyzer implementations
- Should allow custom Ranker implementations
- Should allow custom Renderer implementations
- Should compose mixed default and custom components
- Should validate component contracts at runtime

### File System Integration

#### File Discovery and Reading
- Should discover files in nested directory structures
- Should handle various file encodings correctly
- Should respect file system permissions
- Should handle very large files appropriately
- Should work across different operating systems
- Should handle special characters in file paths
- Should handle very deep directory nesting

#### Output Generation
- Should create output files with correct permissions
- Should handle output to different directory structures
- Should overwrite existing output files
- Should handle concurrent writes to same output file
- Should preserve file timestamps appropriately

### External Tool Integration

#### Git Integration
- Should work in git repositories
- Should work in non-git directories
- Should handle git repositories with no commits
- Should handle git repositories with complex history
- Should handle git submodules appropriately
- Should work with different git configurations

#### Tree-sitter Integration
- Should parse real TypeScript codebases
- Should handle TypeScript language features correctly
- Should parse JavaScript files when encountered
- Should handle mixed TypeScript/JavaScript projects
- Should handle large files efficiently
- Should handle deeply nested syntax structures

### Graph Processing Integration

#### Graph Construction and Analysis
- Should build graphs from real codebases
- Should handle circular dependencies correctly
- Should process graphs with thousands of nodes efficiently
- Should maintain graph consistency during processing
- Should handle disconnected graph components
- Should preserve node and edge metadata correctly

#### Ranking Algorithm Integration
- Should compute PageRank on real dependency graphs
- Should handle graphs with various topologies
- Should produce stable rankings across runs
- Should handle edge cases in graph structure
- Should integrate git history with graph structure

---

## 🌍 End-to-End (E2E) Tests

### Complete Workflow Tests

#### Basic Repository Analysis
- Should analyze a simple TypeScript project end-to-end
- Should generate complete Markdown output with all sections
- Should create valid Mermaid diagrams for simple projects
- Should rank files appropriately in simple projects
- Should handle projects with no dependencies
- Should process single-file projects correctly

#### Complex Repository Analysis
- Should analyze large, multi-module TypeScript projects
- Should handle projects with complex dependency graphs
- Should process projects with circular dependencies
- Should handle monorepo structures correctly
- Should analyze projects with mixed file types
- Should handle projects with deep nesting

#### Real-World Scenarios
- Should analyze popular open-source TypeScript projects
- Should handle enterprise-scale codebases
- Should process legacy JavaScript projects
- Should analyze React/Vue/Angular projects correctly
- Should handle Node.js backend projects
- Should process library/framework codebases

### Configuration Scenarios

#### Include/Exclude Patterns
- Should respect complex glob patterns for inclusion
- Should respect complex glob patterns for exclusion
- Should handle overlapping include/exclude patterns
- Should process projects with custom file extensions
- Should handle case-sensitive file systems
- Should work with Unicode file names

#### Ranking Strategy Variations
- Should generate different outputs for different ranking strategies
- Should handle pagerank strategy on various graph types
- Should handle git-changes strategy in different git scenarios
- Should fall back gracefully when git is unavailable
- Should produce consistent results for same strategy

#### Output Customization
- Should generate output with custom headers
- Should handle disabled Mermaid graph generation
- Should handle disabled symbol details
- Should customize output file locations correctly
- Should handle relative and absolute output paths

### Error Handling and Edge Cases

#### Malformed Input Handling
- Should handle corrupted TypeScript files gracefully
- Should process projects with syntax errors
- Should handle binary files mixed with source code
- Should process empty files correctly
- Should handle files with unusual encodings

#### System Resource Constraints
- Should handle very large repositories without memory issues
- Should process projects with thousands of files
- Should handle deeply nested directory structures
- Should work with limited file system permissions
- Should handle network file systems appropriately

#### Environment Variations
- Should work consistently across different Node.js versions
- Should work in different operating systems (Windows, macOS, Linux)
- Should handle different file system types
- Should work in containerized environments
- Should handle different locale settings

### Performance and Scalability

#### Large Repository Handling
- Should process repositories with 10,000+ files efficiently
- Should handle repositories with complex dependency graphs
- Should maintain reasonable memory usage on large projects
- Should complete analysis within acceptable time limits
- Should provide progress feedback for long-running operations

#### Concurrent Usage
- Should handle multiple simultaneous analyses
- Should avoid race conditions in file system operations
- Should handle concurrent access to same repository
- Should maintain thread safety in all operations

### Output Quality Validation

#### Markdown Generation
- Should generate syntactically valid Markdown
- Should create properly formatted tables
- Should generate valid Mermaid diagram syntax
- Should include all expected sections in output
- Should create clickable links that resolve correctly
- Should handle special characters in file names and symbols

#### Content Accuracy
- Should accurately represent repository structure
- Should correctly identify all symbols in source files
- Should generate accurate dependency relationships
- Should rank files meaningfully based on importance
- Should provide useful code snippets for symbols
- Should maintain consistency between analysis and output

#### Visual and Usability
- Should generate readable and well-formatted output
- Should create useful navigation within generated documents
- Should provide meaningful descriptions and metadata
- Should handle very long file paths gracefully
- Should create accessible content for screen readers

---

## 🛠️ Test Infrastructure Requirements

### Test Environment Setup
- Should support testing with various TypeScript/JavaScript project structures
- Should provide isolated test environments for each test case
- Should include sample repositories of different sizes and complexities
- Should support mocking external dependencies (git, file system)
- Should provide utilities for validating generated Markdown

### Test Data Management
- Should include representative sample codebases for testing
- Should provide fixtures for various edge cases
- Should maintain test data versioning and consistency
- Should support generating test data programmatically

### Performance Testing
- Should include benchmarks for different repository sizes
- Should measure memory usage during analysis
- Should track performance regressions over time
- Should test scalability limits

### Continuous Integration
- Should run all test suites on multiple Node.js versions
- Should test on different operating systems
- Should validate against real-world repositories
- Should include smoke tests for quick feedback
- Should generate test coverage reports

---

## 📊 Test Metrics and Success Criteria

### Coverage Requirements
- Should achieve >95% line coverage for core pipeline components
- Should achieve >90% branch coverage for error handling paths
- Should achieve >85% integration test coverage for component interactions
- Should include E2E tests covering all major user workflows

### Performance Benchmarks
- Should analyze 1000-file repository in <30 seconds
- Should use <500MB memory for typical repository analysis
- Should generate output file in <5 seconds after analysis complete
- Should handle 10,000+ file repositories without failure

### Quality Metrics
- Should generate valid Markdown in 100% of test cases
- Should create accurate dependency graphs in >99% of cases
- Should identify symbols correctly in >95% of TypeScript files
- Should produce consistent rankings across multiple runs

This comprehensive test plan ensures RepoGraph maintains high quality, reliability, and performance across all supported use cases and environments.
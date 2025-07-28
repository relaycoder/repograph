# RepoGraph Monorepo

This repository contains the RepoGraph library split into three separate npm packages for better modularity and environment-specific usage.

## Packages

### 📦 `repograph-core`
Core types, utilities, and environment-agnostic components.

**Contains:**
- Type definitions (`CodeNode`, `CodeGraph`, etc.)
- Logger utilities
- Error classes
- PageRank algorithm
- Markdown renderer

**Usage:**
```bash
npm install repograph-core
```

### 🌐 `repograph-browser`
Browser-compatible version with Tree-sitter WASM support.

**Contains:**
- Browser-compatible analyzer
- Tree-sitter language parsers for browser
- WASM file management
- Browser-specific high-level API

**Usage:**
```bash
npm install repograph-browser
```

### 🖥️ `repograph`
Full Node.js version with CLI support and file system operations.

**Contains:**
- Complete Node.js API
- CLI interface
- File discovery
- Git-based ranking
- Worker pool support
- File system utilities

**Usage:**
```bash
npm install repograph
```

## Development

### Building All Packages

```bash
# Install dependencies for all packages
npm install

# Build all packages (core -> browser -> main)
npm run build
```

### Building Individual Packages

```bash
# Build core package first (required by others)
npm run build:core

# Build browser package (depends on core)
npm run build:browser

# Build main package (depends on core)
npm run build:main
```

### Package Dependencies

```
repograph-core (standalone)
├── repograph-browser (depends on core)
└── repograph (depends on core)
```

## Migration Guide

If you're migrating from the single `repograph` package:

### For Browser Usage
```javascript
// Before
import { analyzeProject } from 'repograph/browser';

// After
import { analyzeProject } from 'repograph-browser';
```

### For Node.js Usage
```javascript
// Before
import { generateMap, analyzeProject } from 'repograph';

// After - no change needed
import { generateMap, analyzeProject } from 'repograph';
```

### For Core Types Only
```javascript
// Before
import type { CodeNode, CodeGraph } from 'repograph';

// After
import type { CodeNode, CodeGraph } from 'repograph-core';
```

## Publishing

Each package can be published independently:

```bash
# Publish core first
cd packages/repograph-core && npm publish

# Then browser
cd packages/repograph-browser && npm publish

# Finally main
cd packages/repograph && npm publish
```

## License

MIT
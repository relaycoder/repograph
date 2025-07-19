### **Analysis Report: Preparing `repograph` for `scn-ts` Integration**

#### **1. Executive Summary**

The goal is to leverage `repograph`'s robust file discovery and code analysis engine as the core data provider for the `scn-ts` tool. `scn-ts` will consume `repograph`'s programmatic API to generate a `CodeGraph`, which it will then serialize into the Symbolic Context Notation (SCN) format.

This strategy is highly desirable as it prevents reinventing the wheel. `repograph` already solves the complex problems of file discovery, multi-language parsing via Tree-sitter, and building a structural graph of a codebase.

The core architectural principle is a strict **separation of concerns**:
*   **`repograph`'s Responsibility:** To be a language-agnostic **code structure analysis engine**. It discovers files, parses them, and produces a detailed, abstract `CodeGraph` (nodes and edges). It should have **zero knowledge** of SCN syntax or its specific concepts.
*   **`scn-ts`'s Responsibility:** To be a **SCN serializer**. It consumes the generic `CodeGraph` from `repograph` and translates it into the SCN format. It contains all the logic for mapping `repograph`'s abstract types to SCN symbols (e.g., mapping a `CodeNode` of type `'class'` to the `◇` symbol).

Our analysis concludes that `repograph` is an excellent foundation but requires specific, targeted enhancements to its data model (`CodeGraph`) to provide the necessary detail for `scn-ts` to generate a rich and accurate SCN map. The primary area for modification is in capturing **symbol qualifiers** (like visibility and async status) during the analysis phase.

---

#### **2. Analysis of `repograph` Pipeline Components for `scn-ts` Consumption**

We will evaluate each stage of the `repograph` pipeline from the perspective of a programmatic consumer (`scn-ts`).

| Pipeline Stage | Component | `scn-ts` Usage | Readiness | Action Required |
| :--- | :--- | :--- | :--- | :--- |
| **Discover** | `createDefaultDiscoverer` | Will be used directly to find all source files. | ✅ **Ready** | None. The discoverer is generic and its output `FileContent[]` is perfect. |
| **Analyze** | `createTreeSitterAnalyzer` | Will be the core engine for `scn-ts`. It will consume `FileContent[]` and produce the `CodeGraph`. | ⚠️ **Needs Enhancement** | The `CodeGraph` and `CodeNode` types are missing key details required by the SCN spec. |
| **Rank** | `createPageRanker`, `createGitRanker` | Will **not** be used. The SCN spec does not involve ranking. | ✅ **Ready (but unused)** | None. `scn-ts` will simply not call this stage. |
| **Render** | `createMarkdownRenderer` | Will **not** be used. `scn-ts` has its own SCN serializer. | ✅ **Ready (but unused)** | None. This demonstrates the composability of `repograph`. |

---

#### **3. Proposed Changes to `repograph`**

The necessary changes are almost exclusively confined to the **Analyze** stage and its associated data types. The goal is to enrich the `CodeNode` with more metadata, making the `CodeGraph` a more powerful and generic representation of code structure.

##### **Change 1: Enhance the `CodeNode` Type (in `src/types.ts`)**

The `CodeNode` type must be extended to capture symbol qualifiers that are essential for a detailed SCN representation.

**Current `CodeNode`:**
```typescript
export type CodeNode = {
  readonly id: string;
  readonly type: CodeNodeType;
  readonly name: string;
  // ... and other fields
};
```

**Proposed Enhanced `CodeNode`:**
```typescript
// in src/types.ts

// New type for access modifiers
export type CodeNodeVisibility = 'public' | 'private' | 'protected' | 'internal' | 'default';

export type CodeNode = {
  readonly id: string;
  readonly type: CodeNodeType;
  readonly name: string;
  readonly filePath: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly language?: string;
  readonly codeSnippet?: string;

  // --- NEW FIELDS ---
  /** The access modifier of the symbol (e.g., public, private). Maps to SCN '+' or '-'. */
  readonly visibility?: CodeNodeVisibility;
  /** Whether the symbol (e.g., a function or method) is asynchronous. Maps to SCN '...'. */
  readonly isAsync?: boolean;
  /** Whether the symbol is a static member of a class/struct. */
  readonly isStatic?: boolean;
  /** The return type of a function/method, as a string. Maps to SCN '#(type)'. */
  readonly returnType?: string;
  /** An array of parameters for functions/methods. */
  readonly parameters?: { name: string; type?: string }[];
};
```

##### **Change 2: Update the Analyzer to Populate New Fields (in `src/pipeline/analyze.ts`)**

The `createTreeSitterAnalyzer` must be updated to extract this new information from the Tree-sitter AST and populate the new `CodeNode` fields.

*   **Visibility:** The analyzer logic should inspect nodes for keywords like `public`, `private`, `protected`. For languages without explicit keywords (like Python's `_` prefix), heuristics can be added to the language handlers.
*   **Async:** The analyzer should check for the `async` keyword on function and method declarations.
*   **Return Types & Parameters:** The language handlers should be enhanced to parse function signatures to extract parameter names, types, and return types. This is more complex but provides immense value.

This work will primarily be done within the `processSymbol` function and the language-specific handlers (`tsLangHandler`, `pythonHandler`, etc.).

##### **Change 3: (Optional but Recommended) Update Tree-Sitter Queries**

To support the enhanced analyzer, the Tree-sitter queries in `src/tree-sitter/language-config.ts` should be updated to capture more details.

**Example for TypeScript:**
```typescript
// Current query fragment
// (function_declaration) @function.definition

// Proposed enhanced query fragment
(function_declaration
  (async)? @qualifier.async
  name: (identifier) @symbol.name
  return_type: (type_annotation) @symbol.returnType
) @function.definition
```
By capturing nodes with specific names like `@qualifier.async`, the analyzer logic becomes simpler and more declarative.

##### **Change 4: Confirm Clean Programmatic Exports (in `src/index.ts`)**

`repograph`'s `index.ts` already does a good job of exporting the low-level components. We must ensure that all new and existing types and factory functions needed by `scn-ts` are exported.

**Required Exports for `scn-ts`:**
*   `createDefaultDiscoverer`
*   `createTreeSitterAnalyzer`
*   `FileContent`, `CodeGraph`, `CodeNode`, `CodeEdge`, `CodeNodeType`, `CodeNodeVisibility` (new)

The current export structure is sufficient. No changes are needed here, but it's important to be mindful of this as development proceeds.

---

#### **4. How `scn-ts` Will Use the Enhanced `repograph`**

With these changes in place, the core logic of `scn-ts` becomes straightforward. It will act as a composer and a final-stage serializer.

**Pseudo-code for `scn-ts`'s main function:**
```typescript
import {
  createDefaultDiscoverer,
  createTreeSitterAnalyzer,
  CodeGraph, // from repograph
  CodeNode   // from repograph
} from 'repograph';

// Inside scn-ts
class ScnSerializer {
  // Maps repograph's generic node types to SCN symbols
  private mapNodeTypeToScnSymbol(node: CodeNode): string {
    switch (node.type) {
      case 'class':
      case 'struct':
      case 'module':
        return '◇';
      case 'function':
      case 'method':
        return '~';
      case 'variable':
      case 'field':
      case 'property':
        return '@';
      // ... etc.
    }
    return '';
  }

  // Generates SCN qualifier symbols
  private getQualifiers(node: CodeNode): string {
    let qualifiers = '';
    if (node.visibility === 'public') qualifiers += '+ ';
    if (node.visibility === 'private') qualifiers += '- ';
    if (node.isAsync) qualifiers += '...';
    // ... etc.
    return qualifiers;
  }

  public serialize(graph: CodeGraph): string {
    // 1. Group nodes by file path
    // 2. For each file:
    //    a. Print the file header: § (id) path/to/file.js
    //    b. For each node in the file:
    //       i. Get the SCN symbol using mapNodeTypeToScnSymbol()
    //       ii. Get qualifiers using getQualifiers()
    //       iii. Format the line and append to the output string
    //    c. For each edge originating from this file:
    //       i. Format the -> or <- dependency link
    // 3. Return the complete SCN string
    return '... a fully formatted SCN string ...';
  }
}

async function generateScnMap(options: any) {
  // 1. Use repograph's discoverer
  const discoverer = createDefaultDiscoverer();
  const files = await discoverer({ root: options.root });

  // 2. Use repograph's (now enhanced) analyzer
  const analyzer = createTreeSitterAnalyzer();
  const codeGraph = await analyzer(files);

  // 3. Use scn-ts's own serializer
  const serializer = new ScnSerializer();
  const scnOutput = serializer.serialize(codeGraph);

  // 4. Write scnOutput to a file
  await writeFile(options.output, scnOutput);
}
```

---

#### **5. Conclusion**

The path to integrating `repograph` as the engine for `scn-ts` is clear and feasible. The required changes are localized, logical, and enhance `repograph`'s utility as a general-purpose tool without tying it to the specifics of SCN.

By enriching the `CodeNode` with more detailed qualifiers, `repograph` will provide a `CodeGraph` that is a powerful, abstract representation of a codebase, ready to be consumed not only by `scn-ts` but potentially by a wide range of future code analysis and visualization tools. This plan ensures a robust, maintainable, and decoupled architecture for both projects.

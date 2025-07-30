Of course. Moving the tests into their respective packages is a great way to improve project structure and enforce separation of concerns.

Here is the plan for refactoring the test structure.

### The Plan

The goal is to move tests from the top-level `test/` directory into `repograph/test/` and `repograph-core/test/`. A test belongs to a package if it primarily tests the code within that package. Shared utilities and fixtures will be duplicated for simplicity and package independence.

#### 1. Files to move to `repograph/test/`

These tests cover the CLI, high-level APIs, and Node.js-specific implementations (file discovery, git integration, worker-based analysis) that reside in the `repograph` package.

*   `test/e2e/cli.test.ts` -> `repograph/test/e2e/cli.test.ts`
*   `test/integration/multi-language.test.ts` -> `repograph/test/integration/multi-language.test.ts`
*   `test/integration/pipeline.test.ts` -> `repograph/test/integration/pipeline.test.ts`
*   `test/unit/analyze.test.ts` -> `repograph/test/unit/analyze.test.ts`
*   `test/unit/codenode-qualifiers.test.ts` -> `repograph/test/unit/codenode-qualifiers.test.ts`
*   `test/unit/composer.test.ts` -> `repograph/test/unit/composer.test.ts`
*   `test/unit/discover.test.ts` -> `repograph/test/unit/discover.test.ts`
*   `test/unit/high-level.test.ts` -> `repograph/test/unit/high-level.test.ts`
*   `test/unit/scn-ts-integration.test.ts` -> `repograph/test/unit/scn-ts-integration.test.ts`
*   **Split:** The `GitRanker` tests from `test/unit/rank.test.ts` will move to `repograph/test/unit/rank.test.ts`.

#### 2. Files to move to `repograph-core/test/`

These tests cover the core, environment-agnostic components like the PageRank algorithm and the Markdown renderer.

*   `test/unit/render.test.ts` -> `repograph-core/test/unit/render.test.ts`
    *   **Note:** The small "Integration with Real Analysis" section, which depends on the `repograph` analyzer, will be removed from this file to maintain package boundaries.
*   **Split:** The `PageRanker` tests from `test/unit/rank.test.ts` will move to `repograph-core/test/unit/rank.test.ts`.

#### 3. Shared Files to Duplicate

To make each package's test suite self-contained, shared test utilities and fixtures will be duplicated.

*   **Test Utilities:**
    *   `test/test.util.ts` -> `repograph/test/test.util.ts` (full version)
    *   `test/test.util.ts` -> `repograph-core/test/test.util.ts` (a simplified version, removing dependencies on the `repograph` package)
    *   `test/test-utilities.test.ts` -> `repograph/test/test-utilities.test.ts`
    *   `test/test-utilities.test.ts` -> `repograph-core/test/test-utilities.test.ts`
*   **Fixtures:**
    *   `test/fixtures/*.yaml` -> `repograph/test/fixtures/*.yaml` (all fixtures)
    *   `test/fixtures/*.yaml` -> `repograph-core/test/fixtures/*.yaml` (all fixtures, for consistency)

---

I will now provide the complete file structure and content after performing this refactoring, including all necessary import path fixes.

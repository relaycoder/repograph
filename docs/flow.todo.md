just like repograph-web-demo, to showcase and test repograph-browser... please create scn-ts-web-demo of scn-ts-browser.

===

1. repograph has repograph-browser version for specific browser environment. to be used by repograph-web-demo
2. current scn-ts is only for node.js environment
3. please create scn-ts-browser for browser env... to be used by future scn-ts-web-demo
4. but first create scn-ts-core to be implemented to current scn-ts and scn-ts-browser. for separated env concern but consistent features
5. scn-ts-browser should not import from repograph-browser. should pass trough scn-ts-core

do not write any, unknown, casting as types. use HOF, no classes OOP.

===

your cwd is 7378 , not 9948 . 9948 only for working old example for you to fix above problem. scn-ts was works fine with 9948.

1. do not introduce any dynamic import in repograph-core. should env agnostic
2. repograph-browser is for browser env, repograph is for node.js env... do not mix.

===


I want the program scripts/prepare-wasm.cjs to manually write below in package.json

  "tree-sitter-c": "^0.24.1",
    "tree-sitter-c-sharp": "^0.23.1",
    "tree-sitter-cpp": "^0.23.4",
    "tree-sitter-css": "^0.23.2",
    "tree-sitter-go": "^0.23.4",
    "tree-sitter-java": "^0.23.5",
    "tree-sitter-php": "^0.23.12",
    "tree-sitter-python": "^0.23.6",
    "tree-sitter-ruby": "^0.23.1",
    "tree-sitter-rust": "^0.24.0",
    "tree-sitter-solidity": "^1.2.11",
    "tree-sitter-typescript": "^0.23.2",

so that after succesfully wasm copy prepare-wasm.cjs should uninstall them,,, because we need the wasm files only

bun install
bun install v1.2.17 (282dda62)

$ node scripts/prepare-wasm.cjs
Ensuring public/wasm directory exists at: /home/realme-book/Project/code/repograph/repograph-packages/repograph-web-demo/public/wasm
Starting to copy WASM files...
Copied tree-sitter.wasm to public/wasm/
Copied tree-sitter-c.wasm to public/wasm/
Copied tree-sitter-c_sharp.wasm to public/wasm/
Copied tree-sitter-cpp.wasm to public/wasm/
Copied tree-sitter-css.wasm to public/wasm/
Copied tree-sitter-go.wasm to public/wasm/
Copied tree-sitter-java.wasm to public/wasm/
Copied tree-sitter-php.wasm to public/wasm/
Copied tree-sitter-python.wasm to public/wasm/
Copied tree-sitter-ruby.wasm to public/wasm/
Copied tree-sitter-rust.wasm to public/wasm/
Copied tree-sitter-solidity.wasm to public/wasm/
Copied tree-sitter-typescript.wasm to public/wasm/
Copied tree-sitter-tsx.wasm to public/wasm/
WASM file preparation complete.

Checked 380 installs across 414 packages (no changes) [332.00ms]
====

please create single page using react and vite to battle test this lib for browser environment..

the web feature is like demo so there are input, generated output, logger log viewer to see errors and problems.

===

lets ditch
1. fast-glob - Uses Node.js fs, path, stream modules
2 ignore - CommonJS module with export issues in browser
3 globby - Depends on fast-glob and has ES module import issues
4 unicorn-magic - Export resolution problems in browser environment

to use another lib browser compatible version. or create own.

do it without feature regression ...

I want everything to run in browser via vite build.

dont forget final checks yaml

===

- make this lib in-browser friendly especially vite. its very good to make repograph optionally no need to
direct fs dir just via object passing in-memory so that only the end scn-ts lib user manually feed from fs.

- also good if the fs is extensible

- also it so good if there is cli helper that auto Copy WASM files node_modules/repograph/dist/wasm/*.wasm to user public/wasm/ directory

- repograph should smartly understand if the lib programmatic api usage run in browser or not

do it DRYly without adding new files

===

use tsup instead, also I dont like imports with .js

===

bun publish

===

scn-ts which is npm user of this repograph lib complains below. so give the scn-ts advice

===

add bun test cases to verify intention of  .relay/transactions/d669e46a-7204-4171-893f-5ca9b5c2a16d.yml make sure to understand current test pattern

===

please execute the report comprehensively docs/scn-ts-2.report.md

===

update readme for correct url https://www.npmjs.com/package/repograph and https://github.com/relaycoder/repograph

===

publish npm

===

following this changes, please update the readme.md. give me full readme.md content

===

add bun test cases to verify intention of .relay\transactions\bf31f74a-4648-43e4-84d4-20a273180eb6.yml

===

fix `bun test` fail following done refactor, here is the report of the refactor .relay\transactions\bf31f74a-4648-43e4-84d4-20a273180eb6.yml █

-

give me concise report separated in paths... with detailed expected and received

===

please execute the scn-ts.report.md

===

what are needed to be prepare for repograph so that scn-ts can use repograph programmatic api as fundamental building block while to keep repograph out of scn concern. give me the analysis report. do not give me any code

===

if programmer user wants to get only the related path.

===

if programmer user wants to build this format, can he do it with current public programmatic low-level api?

===

update readme to show detailed usage example like input and output both in high level and low level programmatic api

===

the low level api needs tests files and cases. give me the list in `it should` language

===

is the readme.md relevant/aligned with codebase? because I think the programmatic API still not aligned.

===

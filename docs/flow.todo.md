
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

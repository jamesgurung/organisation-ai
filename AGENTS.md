# AGENTS

## Instructions

- Make the smallest reasonable code change that fully solves the task, keeping the diff to a minimum.
- Prefer concise implementations over broad refactors.
- Do not edit or reformat unrelated code. Keep edits local to the relevant files unless a wider change is required.
- Avoid introducing new dependencies unless they are clearly necessary.
- Reuse existing code and patterns in the codebase where possible.
- To avoid interfering with active processes, run validation builds in two separate shell calls using a unique literal path beneath the project's MSBuild-excluded and gitignored `artifacts` directory: first run `dotnet build --artifacts-path 'artifacts/dotnet-build-<unique-token>'` with a timeout of at least 120 seconds, then run `dotnet build --target:Clean --no-restore --artifacts-path '<same path>'` to remove the generated files. Let `dotnet` create the directory; do not use shell variables, pre-create it, use `Remove-Item -Recurse`, or combine the build and cleanup. Empty ignored directories may remain.
- Such builds are only necessary after a significant C# code change, not after every minor edit.
- Do not introduce any test projects.
- Do not access `secrets.json` or inspect the values of live app settings under any circumstances.

## Editing

- Avoid editing more than one file in a single tool call, as a context miss can lead the whole change to be rejected. If multiple files need to be edited, make the changes in separate tool calls.
- When the user sends a follow-up message, assume that they may have edited the codebase. Always check the latest code before making further edits.

## Code Style

- Match the existing codebase style, structure, naming, and patterns.
- Use 2-space indentation, spaces not tabs, and a final newline. Don't worry about line endings as they will be normalized by git.
- Avoid adding small helper methods that are only called once. Prefer inline code when it is clear and concise.
- Use small defensive guards only when essential to prevent errors. Avoid over-engineering.
- When writing C#, prefer:
  - `var` for locals, including built-in and obvious types
  - early returns
  - compact methods
  - LINQ-heavy query composition
  - expression-bodied members when they fit on one line
  - omitting braces for single-line blocks
  - no nullable annotations (`string?`, null-forgiving `!`) as this C# feature is disabled
- When writing JavaScript, prefer:
  - modern ES2025+ syntax
  - semicolons
  - no trailing commas
  - `const` for variables that are not reassigned and `let` for those that are
  - DOM lookups, ideally in an `elements` object near the top

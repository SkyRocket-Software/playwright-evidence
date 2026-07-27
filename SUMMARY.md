# Summary: requirements traceability

One addition to the `EvidenceReporter`, ported in from a `pnpm patch` prototype against a consuming project (`qms-notify-dashboard`).

## `requirements` option — functional requirement traceability

Consumers tag tests with functional requirement IDs (e.g. `test('...', { tag: '@FR-LOGIN-1' }, ...)`). The new `requirements?: Record<string, string>` option maps each ID to its prose description. When set:

- **Per-test list.** `onTestEnd` derives each test's covered requirements via `deriveRequirements()`, which matches the test's `tags` (leading `@` stripped) against the map. Matches render as a "Requirements proven" block (ID + full description) under that test's section heading. No changes needed to individual test files — this reuses tags that already exist for other purposes.
- **Traceability matrix.** A new "Requirements Traceability Matrix" section renders right after the cover, before the table of contents. It lists every requirement — from the map, and/or referenced only by a test's tags — its description, which test(s) cover it, and a rolled-up status:
  - `MISSED` — no test covers it
  - `FAIL` — at least one covering test failed
  - `SKIPPED` — every covering test was skipped
  - `PASS` — otherwise
- **Natural sort.** Requirement IDs are sorted with `compareRequirementIds`, which compares numeric suffixes as numbers when two IDs share a common prefix (`FR-CHANNEL-2` before `FR-CHANNEL-10`), falling back to plain string comparison otherwise.

Default is `undefined`, which is a true no-op: no list, no matrix, byte-for-byte the same report as before this option existed.

## Where the code lives

- `src/html.ts` — `RequirementRecord` type, `TestRecord.requirements`, `renderRequirementsList`, `compareRequirementIds`, `computeRequirementStatus`, `renderTraceabilityMatrix`; wired into `renderTest` and `renderReport` (new optional `requirementsMap` parameter).
- `src/evidence-reporter.ts` — `requirements` option and `deriveRequirements()`.
- `src/html.test.ts` / `src/evidence-reporter.test.ts` — coverage for natural-sort edge cases, status roll-up rules, tag-matching and `@`-stripping, and the no-op-when-omitted guarantee.

# Test writing best practices for using skyrocket-software/playwright-evidence


Using Playwright Evidence, tests written in  (`e2e/`) can double as a software
validation record, using
[`@skyrocket-software/playwright-evidence`](https://github.com/skyrocket-software/playwright-evidence)'s
`setupStep`/`evidenceStep` helpers. A reviewer with no access to this
codebase should be able to open the generated report and understand, from
the step titles and screenshots alone, that each functional requirement is
actually met. This document captures the conventions that make that true.

## Setup vs. evidence

- Wrap preconditions — mocking APIs, signing in, navigating to the
  starting page — in `setupStep`. These produce no screenshot and carry no
  pass/fail badge; they exist to get the test into its starting state.
- Wrap everything a reviewer needs to see proof of in `evidenceStep`. Every
  `evidenceStep` takes a screenshot after its action runs, whether the step
  passes or fails.
- Every test function takes `testInfo` as its second argument
  (`async ({ page, loginAsRole }, testInfo) => { ... }`) — `evidenceStep`
  requires it to attach screenshots.

## What to test without a FUNCTIONAL_REQUIREMENTS.md yet

With no `requirements` map configured, omit the `tag` and `test-id`
annotation entirely rather than adding them speculatively.

## Traceability lives in the test tag, not the step text

Every `test()` carries a `{ tag: "@FR-..." }` (or an array of tags). The
reporter's `requirements` option maps a requirement ID to its prose
description, matched against each test's tags with any leading `@` stripped
— a test tagged `@FR-CHANNEL-1` matches the map key `FR-CHANNEL-1`. A tag
with no matching entry in the map is dropped before the report renders: it
never appears in that test's list of proven requirements, and nothing else
in the report shows it either.

## Give traceability-critical tests a stable ID

A tag maps a test to the requirement it proves; a
`{ type: "test-id", description: "TC-..." }` annotation gives the test itself a
stable identifier, independent of its title or position in the file. The
evidence reporter reads it — never invents or renumbers it — and shows it as
an eyebrow above the test's section heading, in the Test Case Index's ID
column, and ahead of the title everywhere the Requirements Traceability
Matrix lists a covering test.

Add a `test-id` annotation to every test that carries an `@FR-...` tag, so the
Traceability Matrix's "Proven by" list has a reference that survives the test
being renamed, reordered, or resharded:

```typescript
test(
  "submitting the New Channel form with valid values creates the channel",
  {
    tag: "@FR-CHANNEL-1",
    annotation: { type: "test-id", description: "TC-CHANNEL-1" },
  },
  async ({ page, loginAsRole }, testInfo) => {
    // ...
  },
);
```

A tag and a test ID answer different questions: the tag says which
requirement this test proves; the ID says which test this is, regardless of
what it's called today. Don't fold one into the other — a tag isn't a stable
identifier (its requirement can be re-scoped or removed), and a test ID isn't
a filter (`--grep` matches tags, not annotations).

## Group related tests under one `test.describe`

Wrap each spec file's tests in one top-level `test.describe(...)`, named for
the page or feature the file covers:

```typescript
test.describe("The New Channel form", () => {
  test("the form is blank when it first opens", async ({ page, loginAsRole }, testInfo) => {
    // ...
  });

  test(
    "submitting valid values creates the channel",
    {
      tag: "@FR-CHANNEL-1",
      annotation: { type: "test-id", description: "TC-CHANNEL-1" },
    },
    async ({ page, loginAsRole }, testInfo) => {
      // ...
    },
  );
});
```

The report shows the describe title as a label above each test's own heading.
Without it, a leaf test title read on its own can lose its subject — a title
like "shows a required-field error" doesn't say what shows it. The describe
title restores that context without repeating it inside every test's own
title. Only nest a second `test.describe` when a file covers more than one
distinct sub-scenario worth its own label.

## Scroll fields below the fold into view before the screenshot ends

`evidenceStep` takes a viewport screenshot, not a full-page one. If a step
fills a field that isn't visible without scrolling (for example, `Channel
Slug` lives inside the "Advanced Settings" section, well below the Name and
Description fields), the screenshot will silently miss it even though the
assertion passes. Scroll the field into view as the last action in the
step, before the implicit screenshot fires:

```typescript
const slugField = page.getByPlaceholder("Enter Channel Slug");
await slugField.fill("court-reminders-e2e");

// Scrolled into view so the screenshot actually shows the slug value.
await slugField.scrollIntoViewIfNeeded();
await expect(slugField).toHaveValue("court-reminders-e2e");
```

## Skipped tests still need to tell a reviewer something

`test.fixme` never runs its body, so no `evidenceStep` ever executes and
the report shows "No recorded steps" with no context. The evidence
reporter currently only reads a skipped test's title, not its annotations
or surrounding comments.

## Flaky tests report as FLAKY, not a hidden pass

If `playwright.config.ts` sets `retries` (standard for CI —
`retries: process.env.CI ? 2 : 0`), a test that fails once and passes on
retry is marked **FLAKY** in the generated report, not a plain PASS. This is
automatic; nothing needs to be written differently in the test itself.

## Test titles are part of the report too

The Table of Contents and each section heading in the generated report come
from the Playwright `test()` title, not from any `evidenceStep` text.

## Iterate in HTML, ship in PDF

`playwright.config.ts` configures the evidence reporter for
`output: "pdf"` by default — that's the format meant for handing off to a
reviewer. It stays a manageable file size compared to a multi-megabyte
self-contained HTML file with dozens of embedded screenshots.

While actively converting or rewording tests, switch the reporter option
to `output: "html"` / `file: "evidence-report.html"` instead. HTML mode
renders instantly (no headless-browser PDF print step), which makes it
much faster to iterate on step wording and screenshot content. Switch back
to `"pdf"` before generating the report to hand off.

PDF generation launches its own headless Chromium (`chromium.launch()`) to
print the report, independent of whatever browser the tests themselves run
against.

## Feed FUNCTIONAL_REQUIREMENTS.md and ABOUT.md into the reporter, not a hand-maintained copy

The reporter's `requirements` option takes a plain
`Record<string, string | RequirementInput>`; `about` takes a plain
`Record<string, AboutFeature>`. This package ships a generator that parses
`FUNCTIONAL_REQUIREMENTS.md` and `ABOUT.md` and writes the JSON these options
expect. Feed the generated files into `playwright.config.ts` rather than
hand-typing a second copy of either document — a hand-maintained map *will*
drift from the source doc the first time someone edits one and forgets the
other.

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

## Traceability lives in the test tag, not the step text

Every `test()` carries a `{ tag: "@FR-..." }` (or an array of tags) mapping
it to the functional requirement(s) it proves — see
`FUNCTIONAL_REQUIREMENTS.md`. Because that mapping already exists at the
test level:

- `evidenceStep` and `setupStep` descriptions never repeat the FR tag
  (`"FR-CHANNEL-1: ..."`). The tag is metadata for tooling; the step text is
  prose for a human. Repeating the tag in both places adds noise without
  adding information.
- Step descriptions read as complete, capitalized, plain-English
  statements — no jargon, no internal names ("modal", "mutation",
  "dirty field"). Write them for someone who has never seen the code.

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

## Split every fill-then-submit sequence into atomic steps

Do not combine "enter data" and "submit" into a single `evidenceStep`. A
reviewer needs to see the exact data that was entered before it disappears
behind a submit action, not just the end state. The minimum shape for any
form interaction is three steps:

1. The starting state (form blank, or showing the current saved values).
2. The data being entered (its own screenshot, with an assertion that the
   right value landed in the right field).
3. The result of submitting (success message, validation error, redirect,
   etc.).

```typescript
await evidenceStep(page, testInfo, "The New Channel form is blank when it first opens", async () => {
  await expect(page.getByPlaceholder("Enter Channel Name")).toHaveValue("");
});

await evidenceStep(page, testInfo, "Entering the name \"Court Reminders E2E\", description \"A test channel description.\", and slug \"court-reminders-e2e\"", async () => {
  await page.getByPlaceholder("Enter Channel Name").fill("Court Reminders E2E");
  // ...fill the rest...
  await expect(slugField).toHaveValue("court-reminders-e2e");
});

await evidenceStep(page, testInfo, "Clicking Submit creates the new channel and takes you to its page", async () => {
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByText("added successfully")).toBeVisible();
});
```

### Name the actual values, not "some data"

A step description like "filling in a name, description, and slug" tells a
reviewer nothing to check against. Always name the literal values being
entered: `"Entering the name \"Court Reminders E2E\", description \"A test
channel description.\", and slug \"court-reminders-e2e\""`. The reviewer
should be able to read the title, look at the screenshot, and confirm the
right value landed in the right field without reading the test code.

### Never bury two states behind one screenshot

If a step description needs the word "then" to describe what happens
inside it (`"typing X, then erasing it"`), it is two states pretending to
be one. Split it. Each `evidenceStep` should represent one state a reviewer
can look at and confirm — not a sequence of transitions collapsed into a
single end-of-step screenshot.

```typescript
// Wrong: the screenshot only shows the erased end-state; "temp" was
// never actually captured on screen.
await evidenceStep(page, testInfo, "Typing \"temp\" into the Name field, then erasing it", async () => {
  await nameField.fill("temp");
  await nameField.fill("");
});

// Right: each state gets its own screenshot.
await evidenceStep(page, testInfo, "Typing \"temp\" into the Name field", async () => {
  await nameField.fill("temp");
  await expect(nameField).toHaveValue("temp");
});

await evidenceStep(page, testInfo, "Erasing the Name field, leaving it blank", async () => {
  await nameField.fill("");
  await expect(nameField).toHaveValue("");
});
```

## Capture before and after for anything that changes state

For state-changing behavior (archive/restore, enable/disable, publish,
save), show the state before the change and the state after — never just
the end result. A screenshot of a success toast alone doesn't prove
anything changed; pair it with a "before" screenshot of the control in its
starting state (e.g., a checked toggle) so the transition is visible across
the two steps.

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

If a single step fills fields that are far apart on the page (one above the
fold, one below), split it into two steps instead of picking one scroll
position that only proves half the claim.

## Skipped tests still need to tell a reviewer something

`test.fixme` never runs its body, so no `evidenceStep` ever executes and
the report shows "No recorded steps" with no context. Because the evidence
reporter currently only reads a skipped test's title (not its
annotations or surrounding comments), bake the reason directly into the
title:

```typescript
test.fixme(
  "leaving the Name field blank without ever clicking into it shows no visible error — SKIPPED, known bug tracked in TODO.md",
  { tag: "@FR-CHANNEL-4" },
  async ({ page, loginAsRole }, testInfo) => { /* ... */ },
);
```

Also log the underlying bug in `TODO.md` with a cross-reference to the
test, so the gap is tracked in both directions.

## Test titles are part of the report too

The Table of Contents and each section heading in the generated report come
from the Playwright `test()` title, not from any `evidenceStep` text. Write
test titles in the same plain, reviewer-facing language as step
descriptions — avoid internal shorthand ("touched-then-cleared field",
"only changed fields are submitted") in favor of a title that reads like a
sentence describing user-visible behavior ("clearing the Name field after
typing into it shows a required-field error and blocks submission").

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

## Verify the generated report, not just the exit code

A green test run only proves the assertions passed — it does not prove the
report reads well. After converting or changing a spec file, generate the
report and actually look at it:

1. Serve the project directory locally
   (`python3 -m http.server <port>`) and open `evidence-report.html` in a
   browser — Playwright MCP's `browser_navigate` blocks the `file://`
   protocol, so a local HTTP server is required.
2. For large reports, a live browser screenshot can time out. Extract
   individual embedded screenshots instead: find the `<img
   src="data:image/png;base64,...">` tag following a step's `alt` text,
   base64-decode it to a standalone PNG, and view that file directly.
3. Look for the same problems a real reviewer would flag: fields missing
   from the frame, confusing or contradictory UI state caught on camera,
   skipped tests with no context, and technical jargon in titles or step
   text.

### Test the consequence, not the mechanics

This is about whether a whole *test* (and the requirement it's tied to) is worth having — not about trimming individual assertions inside an otherwise-good test. The step-by-step craftsmanship elsewhere in this document (atomic steps, before/after, naming real values) still applies once a test clears this bar.

Before writing a test, look at the functional requirement it's meant to prove in `FUNCTIONAL_REQUIREMENTS.md`. Ask: does this requirement describe something the user actually gets out of the feature, or does it just restate that a UI element exists or behaves the way every such element behaves? A requirement that only describes the *mechanics* of a widget produces a test that can only prove those same mechanics — no amount of good step-writing fixes that, because there's no real consequence underneath to point the steps at.

```text
Banal requirement: "An email template can use one of several visual themes
(Default, Fixed Width, Blue)."
  -> produces a test that just counts <option> tags in a dropdown. It only
     fails if someone deletes an option from the JSX -- a change so drastic
     it would be obvious in any manual check anyway. It proves the dropdown
     exists, not that choosing a theme does anything.

Valuable requirement: "The theme a user selects for a template determines
the CSS used whenever that template is previewed or sent."
  -> produces a test that selects a non-default theme, opens the preview,
     and confirms the preview actually requested/rendered with that theme --
     proving the selection has a real, traceable effect downstream.
```

The same trap shows up when a test verifies internal wiring instead of the
user-visible result it's supposed to produce:

```text
Banal: clicking a column header sends the right sortBy/descending GraphQL
       variables. (Proves the click wired up a network call correctly --
       not that anything the user sees changed.)
Valuable: clicking a column header re-orders the visible rows.
```

When reviewing a test, ask directly: if every assertion in this test
passed, would a reviewer have any real confidence the *feature* works, or
only that a particular DOM element or network call behaved the way it was
always going to? If it's the latter, the fix is at the requirement level,
not the assertion level: rewrite the `FUNCTIONAL_REQUIREMENTS.md` entry to
state the actual consequence, then rebuild the test to prove that. If no
real consequence exists to state, the requirement (and its test) likely
shouldn't exist at all.

If a review pass like this ends with you editing individual `expect()`
calls rather than the test title or the FR wording, you're solving the
wrong problem — the fix belongs one level up, at the requirement or the
title, not inside an otherwise-fine test.

## Keep FUNCTIONAL_REQUIREMENTS.md honest

### Start from existing intentions, not just observed behavior

If the project already has functional requirements — a product spec, a PRD,
prior documentation, even informal stakeholder notes — those are the
source of truth for what the software is *supposed* to do. Build tests to
prove those stated intentions, and don't quietly rewrite a requirement to
match whatever the implementation currently does: a mismatch between
stated intent and observed behavior is exactly what e2e testing exists to
catch. That mismatch is a bug to flag (see the `fixme` + bug-tracking
convention above), not a requirement to "correct" so it matches the bug.

Only when no such requirements exist yet — a genuinely greenfield effort
with nothing written down — does deriving an initial
`FUNCTIONAL_REQUIREMENTS.md` from an already-built, already-observed suite
become the practical starting point. Treat that as a first draft standing
in for a real spec, not as equally authoritative: "this is what the code
currently does" and "this is what the code is supposed to do" are
different claims, and the first draft should be reviewed by someone with
actual product context before it's trusted the way a real requirement is.

Whichever source a requirement comes from, hold it to the same bar as
"Test the consequence, not the mechanics" above: business-facing, plain
English, and discarded if it's too technical to state a clear business
goal for. Group entries against the same business-facing sections a
non-technical reviewer would recognize (an `ABOUT.md`-style feature
breakdown, if the project has one).

### Cross-reference it against test tags

Requirements drift from tests over time — a requirement gets added without
a test, a test's tag gets typo'd, or a feature changes and nobody updates
the FR wording. Periodically cross-reference every `FR-...` ID in the doc
against the actual `{ tag: "@FR-..." }` values present on tests, and call
out anything with no covering test (or only a `fixme`d one) in a dedicated
gaps document (`REQUIREMENT_GAPS.md` in this project). Re-run this check
whenever requirements or tests change, not just once — it's what catches a
requirement that quietly stopped being proven.

### Feed it into the reporter directly, don't hand-maintain a duplicate map

The evidence reporter's `requirements` option takes a plain
`Record<string, string>` mapping requirement ID to prose. Parse it directly
out of `FUNCTIONAL_REQUIREMENTS.md` (or whatever format the source doc
uses) rather than hand-typing a second copy into `playwright.config.ts` — a
hand-maintained map *will* drift from the source doc the first time someone
edits one and forgets the other.

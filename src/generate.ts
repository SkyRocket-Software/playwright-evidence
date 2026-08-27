/**
 * Parses `docs/FUNCTIONAL_REQUIREMENTS.md` and `docs/ABOUT.md`, and writes
 * `requirements.json` and `about.json` into an output directory.
 * `requirements.json` matches the reporter's `requirements` option shape
 * directly; `about.json` holds `{ title, overview, features }` —
 * `features` matches the reporter's `features` option (or its deprecated
 * `about` alias), while `title` and `overview` are meant to be read by the
 * consuming project's own `playwright.config.ts` into the reporter's
 * `title`/`overview` options.
 *
 * Source paths and the output directory default to
 * `docs/FUNCTIONAL_REQUIREMENTS.md`, `docs/ABOUT.md`, and `e2e`, but can be
 * overridden via the CLI's `--requirementsFile`, `--aboutFile`, and
 * `--outputDir` flags for a consuming project that keeps these documents
 * somewhere else.
 */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { lexer } from 'marked';
import type { AboutFeature, RequirementInput } from './html.ts';

const DEFAULT_REQUIREMENTS_FILE = 'docs/FUNCTIONAL_REQUIREMENTS.md';
const DEFAULT_ABOUT_FILE = 'docs/ABOUT.md';
const DEFAULT_OUTPUT_DIR = 'e2e';

/** The parsed shape of `docs/ABOUT.md` — also the shape written to `e2e/about.json`. */
export interface AboutContent {
  title: string;
  overview: string;
  features: Record<string, AboutFeature>;
}

const FEATURE_HEADING = /^FEAT-\S+$/;
const REQUIREMENT_HEADING_PREFIX = 'FR-';
const ARCHIVED_HEADING = 'Archived';

/**
 * Parses the `## FEAT-<AREA>` / `### FR-<AREA>-<n>` heading grammar of
 * `FUNCTIONAL_REQUIREMENTS.md` into a bare requirements map, each entry
 * carrying its enclosing feature as its only feature.
 *
 * An HTML comment (the `<!-- qa-signed: ... -->` signature, wherever it
 * appears) is ignored rather than folded into a requirement's description.
 * Everything under a `## Archived` heading is excluded from the result.
 */
export function parseFunctionalRequirements(markdown: string): Record<string, RequirementInput> {
  // marked's lexer() flattens the document into one ordered list of top-level
  // block tokens (heading, paragraph, list, space, html, ...) — no tree to
  // recurse into. The loop below is a single left-to-right pass over that
  // list, using "## " and "### " headings as the only structural signal:
  // each heading closes out whatever requirement was open and starts the
  // next section. Every other token in between is raw markdown source that
  // gets appended to the currently open requirement, and is discarded if no
  // requirement is open yet (e.g. text before the first heading).
  const tokens = lexer(markdown);
  const requirements: Record<string, RequirementInput> = {};

  let currentFeatureId: string | null = null;
  let archived = false;
  let currentRequirementId: string | null = null;
  let currentRequirementRaw: string[] = [];

  // Finalizes the requirement currently being accumulated (unless it's archived)
  // into `requirements`, then resets the accumulator for whatever comes next.
  const flushRequirement = (): void => {
    if (currentRequirementId === null) return;
    if (!archived) {
      if (requirements[currentRequirementId]) {
        throw new Error(`Duplicate requirement heading "### ${currentRequirementId}"`);
      }
      requirements[currentRequirementId] = {
        // A requirement is one business-facing claim, not a multi-paragraph document — collapse to a single line.
        description: currentRequirementRaw.join('').trim().replace(/\s+/g, ' '),
        features: currentFeatureId ? [currentFeatureId] : [],
      };
    }
    currentRequirementId = null;
    currentRequirementRaw = [];
  };

  for (const token of tokens) {
    // HTML comments (e.g. the qa-signed signature) are dropped unconditionally
    // so they never leak into a requirement's accumulated description.
    if (token.type === 'html') continue;

    // A "## " heading ends the current requirement and opens either an
    // Archived section (features cleared, nothing after it is kept) or a new
    // feature that subsequent "### " requirements will attach to.
    if (token.type === 'heading' && token.depth === 2) {
      flushRequirement();
      const heading = token.text.trim();
      if (heading === ARCHIVED_HEADING) {
        archived = true;
        currentFeatureId = null;
        continue;
      }
      if (!FEATURE_HEADING.test(heading)) {
        throw new Error(`Expected a "## FEAT-<AREA>" heading, found "## ${heading}"`);
      }
      archived = false;
      currentFeatureId = heading;
      continue;
    }

    // A "### " heading ends the current requirement and opens the next one;
    // its body accumulates in currentRequirementRaw until the next heading.
    if (token.type === 'heading' && token.depth === 3) {
      flushRequirement();
      const heading = token.text.trim();
      if (!heading.startsWith(REQUIREMENT_HEADING_PREFIX)) {
        throw new Error(`Expected an "### FR-<AREA>-<n>" heading, found "### ${heading}"`);
      }
      if (!archived && currentFeatureId === null) {
        throw new Error(`"### ${heading}" has no enclosing "## FEAT-" heading`);
      }
      currentRequirementId = heading;
      continue;
    }

    // Blank-line tokens carry no content worth keeping.
    if (token.type === 'space') continue;

    // Anything else (paragraph, list, ...) is part of whichever requirement
    // is currently open — stash its raw markdown source for flushRequirement
    // to join and collapse to a single line.
    if (currentRequirementId !== null) {
      currentRequirementRaw.push(token.raw);
    }
  }
  flushRequirement();

  return requirements;
}

/**
 * Parses `ABOUT.md`'s `# <Title>` / `## FEAT-<AREA>: <Title>` grammar. The
 * document must start with an H1 — its text becomes `title`. The overview is
 * everything between the H1 and the first feature heading. Each feature
 * heading splits on its first colon — the ID before, the title after, both
 * trimmed; a later colon belongs to the title.
 */
export function parseAbout(markdown: string): AboutContent {
  // As in parseFunctionalRequirements, marked's lexer() gives a flat,
  // ordered list of top-level block tokens. The first pass below just walks
  // past any leading blank lines to find the mandatory H1; everything after
  // that is a second, single left-to-right pass using "## FEAT-" headings as
  // the only structural signal.
  const tokens = lexer(markdown);
  const features: Record<string, AboutFeature> = {};

  let index = 0;
  while (index < tokens.length && tokens[index].type === 'space') index++;
  const titleToken = tokens[index];
  if (titleToken?.type !== 'heading' || titleToken.depth !== 1) {
    throw new Error('ABOUT.md must start with a "# <Title>" heading');
  }
  const title = titleToken.text.trim();
  index++;

  // Everything from here until the first feature heading is the overview;
  // seenFirstFeature then flips the destination bucket below to whichever
  // feature is currently open.
  const overviewParts: string[] = [];
  let seenFirstFeature = false;
  let currentFeatureId: string | null = null;
  let currentTitle = '';
  let currentBodyParts: string[] = [];

  // Finalizes the feature currently being accumulated into `features`, then
  // resets the accumulator for whatever feature comes next.
  const flushFeature = (): void => {
    if (currentFeatureId === null) return;
    if (features[currentFeatureId]) {
      throw new Error(`Duplicate feature heading "## ${currentFeatureId}: ${currentTitle}"`);
    }
    features[currentFeatureId] = { title: currentTitle, body: joinAndTrim(currentBodyParts) };
    currentFeatureId = null;
    currentBodyParts = [];
  };

  for (; index < tokens.length; index++) {
    const token = tokens[index];

    // A "## FEAT-...: <title>" heading ends the current feature (or the
    // overview, on the first one) and opens the next feature's body.
    if (token.type === 'heading' && token.depth === 2 && token.text.trim().startsWith('FEAT-')) {
      flushFeature();
      seenFirstFeature = true;
      const heading = token.text.trim();
      const colonIndex = heading.indexOf(':');
      if (colonIndex === -1) {
        throw new Error(`"## ${heading}" has no colon separating its ID from its title`);
      }
      currentFeatureId = heading.slice(0, colonIndex).trim();
      currentTitle = heading.slice(colonIndex + 1).trim();
      continue;
    }

    // Everything else is raw markdown source for whichever bucket is
    // currently open: the overview before the first feature heading, that
    // feature's body afterward — unlike a requirement's description, this
    // is joined back with joinAndTrim() rather than squashed to one line,
    // since a feature's prose is meant to keep its paragraph breaks.
    if (!seenFirstFeature) {
      overviewParts.push(token.raw);
    } else {
      currentBodyParts.push(token.raw);
    }
  }
  flushFeature();

  return { title, overview: joinAndTrim(overviewParts), features };
}

/** Joins raw token source and trims the result, preserving internal blank lines (paragraph breaks). */
function joinAndTrim(rawParts: string[]): string {
  return rawParts.join('').trim();
}

function writeJson(outPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}


export interface CliResult {
  exitCode: number;
  messages: string[];
}

/**
 * Core logic behind the `playwright-evidence-generate` bin. Kept separate
 * from the executable entry point so it can run against a real temp
 * directory in tests without spawning a process.
 */
export function runCli(argv: string[], cwd: string): CliResult {
  let checkOnly: boolean | undefined;
  let requirementsFile: string | undefined;
  let aboutFile: string | undefined;
  let outputDir: string | undefined;

  try {
    ({
      values: { 'check-only': checkOnly, requirementsFile, aboutFile, outputDir },
    } = parseArgs({
      args: argv,
      options: {
        'check-only': { type: "boolean" },
        requirementsFile: { type: "string", default: DEFAULT_REQUIREMENTS_FILE },
        aboutFile: { type: "string", default: DEFAULT_ABOUT_FILE },
        outputDir: { type: "string", default: DEFAULT_OUTPUT_DIR },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    return { exitCode: 1, messages: [err instanceof Error ? err.message : String(err)] };
  }
  const errorMessages: string[] = []

  let requirementsFilePath: string | undefined = path.join(cwd, requirementsFile);
  let aboutFilePath: string | undefined = path.join(cwd, aboutFile);

  if (!fs.existsSync(requirementsFilePath)) {
    if (requirementsFile != DEFAULT_REQUIREMENTS_FILE) {
      errorMessages.push(`${requirementsFile}: file not found`);
    } else {
      requirementsFilePath = undefined;
    }
  }

  if (!fs.existsSync(aboutFilePath)) {
    if (aboutFile != DEFAULT_ABOUT_FILE) {
      errorMessages.push(`${aboutFile}: file not found`);
    } else {
      aboutFilePath = undefined;
    }
  }

  if (errorMessages.length > 0) {
    return { exitCode: 1, messages: errorMessages };
  }

  if (checkOnly) {
    if (aboutFilePath) {
      try {
        parseAbout(fs.readFileSync(aboutFilePath, "utf8"));
      } catch (err) {
        errorMessages.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (requirementsFilePath) {
      try {
        parseFunctionalRequirements(fs.readFileSync(requirementsFilePath, "utf8"));
      } catch (err) {
        errorMessages.push(err instanceof Error ? err.message : String(err));
      }
    }
    return { exitCode: errorMessages.length > 0 ? 1 : 0, messages: errorMessages };
  }

  const requirementsJsonFile = path.join(outputDir, 'requirements.json');
  const aboutJsonFile = path.join(outputDir, 'about.json');
  const messages: string[] = [];

  try {
    if (requirementsFilePath) {
      const requirements = parseFunctionalRequirements(
        fs.readFileSync(requirementsFilePath, "utf8")
      );
      writeJson(path.join(cwd, requirementsJsonFile), requirements);
      messages.push(`Wrote ${requirementsJsonFile}`);
    } else {
      messages.push(`Skipped ${requirementsJsonFile}: source document not found`);
    }

    if (aboutFilePath) {
      const about = parseAbout(fs.readFileSync(aboutFilePath, "utf8"));
      writeJson(path.join(cwd, aboutJsonFile), about);
      messages.push(`Wrote ${aboutJsonFile}`);
    } else {
      messages.push(`Skipped ${aboutJsonFile}: source document not found`);
    }

    return { exitCode: 0, messages };
  } catch (err) {
    return { exitCode: 1, messages: [err instanceof Error ? err.message : String(err)] };
  }
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseAbout, parseFunctionalRequirements, runCli } from './generate.ts';

// ── parseFunctionalRequirements ──────────────────────────────────────────────

describe('parseFunctionalRequirements', () => {
  it('maps a requirement to its description and enclosing feature', () => {
    const markdown = `
## FEAT-SCHEDULING

### FR-SCHEDULING-1

A visitor can book an appointment by choosing an available date, time, and
reason, and receives a confirmation showing exactly what they booked.
`;
    expect(parseFunctionalRequirements(markdown)).toEqual({
      'FR-SCHEDULING-1': {
        description:
          'A visitor can book an appointment by choosing an available date, time, and reason, and receives a confirmation showing exactly what they booked.',
        features: ['FEAT-SCHEDULING'],
      },
    });
  });

  it('gives every requirement under one feature the same feature id', () => {
    const markdown = `
## FEAT-SCHEDULING

### FR-SCHEDULING-1

First requirement.

### FR-SCHEDULING-2

Second requirement.
`;
    const result = parseFunctionalRequirements(markdown);
    expect(result['FR-SCHEDULING-1'].features).toEqual(['FEAT-SCHEDULING']);
    expect(result['FR-SCHEDULING-2'].features).toEqual(['FEAT-SCHEDULING']);
  });

  it('scopes requirements to the feature heading immediately above them', () => {
    const markdown = `
## FEAT-SCHEDULING

### FR-SCHEDULING-1

Scheduling requirement.

## FEAT-BILLING

### FR-BILLING-1

Billing requirement.
`;
    const result = parseFunctionalRequirements(markdown);
    expect(result['FR-SCHEDULING-1'].features).toEqual(['FEAT-SCHEDULING']);
    expect(result['FR-BILLING-1'].features).toEqual(['FEAT-BILLING']);
  });

  it('ignores an HTML comment at the top of the document, such as the qa-signed signature', () => {
    const markdown = `<!-- qa-signed: 2026-08-21 -->

## FEAT-SCHEDULING

### FR-SCHEDULING-1

A requirement.
`;
    expect(parseFunctionalRequirements(markdown)).toEqual({
      'FR-SCHEDULING-1': { description: 'A requirement.', features: ['FEAT-SCHEDULING'] },
    });
  });

  it('ignores an HTML comment interleaved with a requirement body', () => {
    const markdown = `
## FEAT-SCHEDULING

### FR-SCHEDULING-1

A requirement.

<!-- reviewer note: revisit wording -->
`;
    expect(parseFunctionalRequirements(markdown)['FR-SCHEDULING-1'].description).toBe('A requirement.');
  });

  it('collapses a multi-line paragraph into a single-line description', () => {
    const markdown = `
## FEAT-SCHEDULING

### FR-SCHEDULING-1

A visitor can book an appointment
by choosing an available date.
`;
    expect(parseFunctionalRequirements(markdown)['FR-SCHEDULING-1'].description).toBe(
      'A visitor can book an appointment by choosing an available date.',
    );
  });

  it('excludes everything under a ## Archived heading', () => {
    const markdown = `
## FEAT-SCHEDULING

### FR-SCHEDULING-1

An active requirement.

## Archived

### FR-SCHEDULING-2

Not provable by e2e evidence.
`;
    const result = parseFunctionalRequirements(markdown);
    expect(result).toHaveProperty('FR-SCHEDULING-1');
    expect(result).not.toHaveProperty('FR-SCHEDULING-2');
  });

  it('allows an archived requirement with no enclosing feature heading', () => {
    const markdown = `
## Archived

### FR-SCHEDULING-2

Not provable by e2e evidence.
`;
    expect(parseFunctionalRequirements(markdown)).toEqual({});
  });

  it('throws when a requirement heading has no enclosing feature heading', () => {
    const markdown = `
### FR-SCHEDULING-1

An orphaned requirement.
`;
    expect(() => parseFunctionalRequirements(markdown)).toThrow(/no enclosing/);
  });

  it('throws when a level-2 heading is neither a FEAT- id nor Archived', () => {
    const markdown = `
## Something else entirely

### FR-SCHEDULING-1

A requirement.
`;
    expect(() => parseFunctionalRequirements(markdown)).toThrow(/FEAT-/);
  });

  it('throws when a level-3 heading is not an FR- id', () => {
    const markdown = `
## FEAT-SCHEDULING

### Not a requirement heading

Some text.
`;
    expect(() => parseFunctionalRequirements(markdown)).toThrow(/FR-/);
  });

  it('throws on a duplicate active requirement id', () => {
    const markdown = `
## FEAT-SCHEDULING

### FR-SCHEDULING-1

First.

### FR-SCHEDULING-1

Second.
`;
    expect(() => parseFunctionalRequirements(markdown)).toThrow(/Duplicate/);
  });
});

// ── parseAbout ────────────────────────────────────────────────────────────────

describe('parseAbout', () => {
  it('takes the H1 text as the title', () => {
    const markdown = `# The application

A short summary of what the application is for.

## FEAT-SCHEDULING: Scheduling

Prose about scheduling.
`;
    expect(parseAbout(markdown).title).toBe('The application');
  });

  it('takes everything between the H1 and the first feature heading as the overview', () => {
    const markdown = `# The application

A short summary of what the application is for.

## FEAT-SCHEDULING: Scheduling

Prose about scheduling.
`;
    const result = parseAbout(markdown);
    expect(result.overview).toBe('A short summary of what the application is for.');
  });

  it('finds the H1 even behind a leading blank line', () => {
    const markdown = `
# The application

A short summary.

## FEAT-SCHEDULING: Scheduling

Prose.
`;
    const result = parseAbout(markdown);
    expect(result.title).toBe('The application');
    expect(result.overview).toBe('A short summary.');
  });

  it('throws when the document does not start with an H1', () => {
    const markdown = `A short summary.

## FEAT-SCHEDULING: Scheduling

Prose.
`;
    expect(() => parseAbout(markdown)).toThrow(/"# <Title>"/);
  });

  it('splits a feature heading on its first colon into id and title', () => {
    const markdown = `# App

## FEAT-SCHEDULING: Scheduling appointments

Prose.
`;
    const result = parseAbout(markdown);
    expect(result.features['FEAT-SCHEDULING']).toEqual({ title: 'Scheduling appointments', body: 'Prose.' });
  });

  it('gives every colon after the first to the title', () => {
    const markdown = `# App

## FEAT-SCHEDULING: Scheduling: the full story

Prose.
`;
    expect(parseAbout(markdown).features['FEAT-SCHEDULING'].title).toBe('Scheduling: the full story');
  });

  it('throws when a feature heading has no colon', () => {
    const markdown = `# App

## FEAT-SCHEDULING

Prose.
`;
    expect(() => parseAbout(markdown)).toThrow(/colon/);
  });

  it('gives each feature its own title and body', () => {
    const markdown = `# App

## FEAT-SCHEDULING: Scheduling

Scheduling prose.

## FEAT-BILLING: Billing

Billing prose.
`;
    const result = parseAbout(markdown);
    expect(result.features['FEAT-SCHEDULING']).toEqual({ title: 'Scheduling', body: 'Scheduling prose.' });
    expect(result.features['FEAT-BILLING']).toEqual({ title: 'Billing', body: 'Billing prose.' });
  });

  it('preserves blank-line-separated paragraphs in a feature body', () => {
    const markdown = `# App

## FEAT-SCHEDULING: Scheduling

First paragraph.

Second paragraph.
`;
    expect(parseAbout(markdown).features['FEAT-SCHEDULING'].body).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('throws on a duplicate feature id', () => {
    const markdown = `# App

## FEAT-SCHEDULING: Scheduling

First.

## FEAT-SCHEDULING: Scheduling again

Second.
`;
    expect(() => parseAbout(markdown)).toThrow(/Duplicate/);
  });
});

// ── runCli ────────────────────────────────────────────────────────────────────

describe('runCli', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-generate-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSource(relativePath: string, content: string): void {
    const fullPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  describe('argument validation', () => {
    it('fails on an unrecognized argument', () => {
      const result = runCli(['--bogus'], tmpDir);
      expect(result.exitCode).toBe(1);
      expect(result.messages[0]).toContain('--bogus');
    });

    it('fails on an unexpected positional argument', () => {
      const result = runCli(['positional'], tmpDir);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('writing generated files', () => {
    it('writes both files and reports them on success', () => {
      writeSource(
        'docs/FUNCTIONAL_REQUIREMENTS.md',
        '## FEAT-SCHEDULING\n\n### FR-SCHEDULING-1\n\nA requirement.\n',
      );
      writeSource('docs/ABOUT.md', '# App\n\nOverview.\n\n## FEAT-SCHEDULING: Scheduling\n\nBody.\n');

      const result = runCli([], tmpDir);

      expect(result.exitCode).toBe(0);
      expect(result.messages).toEqual(['Wrote e2e/requirements.json', 'Wrote e2e/about.json']);
      const requirements = JSON.parse(fs.readFileSync(path.join(tmpDir, 'e2e/requirements.json'), 'utf8'));
      expect(requirements).toEqual({
        'FR-SCHEDULING-1': { description: 'A requirement.', features: ['FEAT-SCHEDULING'] },
      });
      const about = JSON.parse(fs.readFileSync(path.join(tmpDir, 'e2e/about.json'), 'utf8'));
      expect(about).toEqual({
        title: 'App',
        overview: 'Overview.',
        features: { 'FEAT-SCHEDULING': { title: 'Scheduling', body: 'Body.' } },
      });
    });

    it('skips requirements.json, without failing, when FUNCTIONAL_REQUIREMENTS.md does not exist yet', () => {
      writeSource('docs/ABOUT.md', '# App\n\nOverview.\n\n## FEAT-SCHEDULING: Scheduling\n\nBody.\n');

      const result = runCli([], tmpDir);

      expect(result.exitCode).toBe(0);
      expect(result.messages).toEqual(['Skipped e2e/requirements.json: source document not found', 'Wrote e2e/about.json']);
      expect(fs.existsSync(path.join(tmpDir, 'e2e/requirements.json'))).toBe(false);
    });

    it('skips about.json, without failing, when ABOUT.md does not exist yet', () => {
      writeSource(
        'docs/FUNCTIONAL_REQUIREMENTS.md',
        '## FEAT-SCHEDULING\n\n### FR-SCHEDULING-1\n\nA requirement.\n',
      );

      const result = runCli([], tmpDir);

      expect(result.exitCode).toBe(0);
      expect(result.messages).toEqual(['Wrote e2e/requirements.json', 'Skipped e2e/about.json: source document not found']);
      expect(fs.existsSync(path.join(tmpDir, 'e2e/about.json'))).toBe(false);
    });

    it('skips both files, without failing, when neither source document exists', () => {
      const result = runCli([], tmpDir);

      expect(result.exitCode).toBe(0);
      expect(result.messages).toEqual([
        'Skipped e2e/requirements.json: source document not found',
        'Skipped e2e/about.json: source document not found',
      ]);
      expect(fs.existsSync(path.join(tmpDir, 'e2e'))).toBe(false);
    });

    it('creates the output directory when it does not already exist', () => {
      writeSource(
        'docs/FUNCTIONAL_REQUIREMENTS.md',
        '## FEAT-SCHEDULING\n\n### FR-SCHEDULING-1\n\nA requirement.\n',
      );
      expect(fs.existsSync(path.join(tmpDir, 'e2e'))).toBe(false);

      runCli([], tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'e2e/requirements.json'))).toBe(true);
    });

    it('reports a parse error with exit code 1 instead of throwing, and writes nothing', () => {
      writeSource('docs/FUNCTIONAL_REQUIREMENTS.md', '## Not a feature heading\n');

      const result = runCli([], tmpDir);

      expect(result.exitCode).toBe(1);
      expect(result.messages).toEqual([expect.stringMatching(/FEAT-/)]);
      expect(fs.existsSync(path.join(tmpDir, 'e2e'))).toBe(false);
    });

    it('treats a source document at a custom path that does not exist as a hard error', () => {
      const result = runCli(['--requirementsFile', 'reqs.md'], tmpDir);

      expect(result.exitCode).toBe(1);
      expect(result.messages).toEqual(['reqs.md: file not found']);
    });

    it('reads source documents from custom paths when requirementsFile/aboutFile are given', () => {
      writeSource('reqs.md', '## FEAT-SCHEDULING\n\n### FR-SCHEDULING-1\n\nA requirement.\n');
      writeSource('about.md', '# App\n\nOverview.\n\n## FEAT-SCHEDULING: Scheduling\n\nBody.\n');

      const result = runCli(['--requirementsFile', 'reqs.md', '--aboutFile', 'about.md'], tmpDir);

      expect(result.exitCode).toBe(0);
      expect(result.messages).toEqual(['Wrote e2e/requirements.json', 'Wrote e2e/about.json']);
    });

    it('writes generated files under a custom outputDir', () => {
      writeSource(
        'docs/FUNCTIONAL_REQUIREMENTS.md',
        '## FEAT-SCHEDULING\n\n### FR-SCHEDULING-1\n\nA requirement.\n',
      );
      writeSource('docs/ABOUT.md', '# App\n\nOverview.\n\n## FEAT-SCHEDULING: Scheduling\n\nBody.\n');

      const result = runCli(['--outputDir', 'generated'], tmpDir);

      expect(result.exitCode).toBe(0);
      expect(result.messages).toEqual(['Wrote generated/requirements.json', 'Wrote generated/about.json']);
      expect(fs.existsSync(path.join(tmpDir, 'generated/requirements.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'generated/about.json'))).toBe(true);
    });

    it('writes generated files when --check-only is not passed', () => {
      writeSource(
        'docs/FUNCTIONAL_REQUIREMENTS.md',
        '## FEAT-SCHEDULING\n\n### FR-SCHEDULING-1\n\nA requirement.\n',
      );

      const result = runCli([], tmpDir);

      expect(result.exitCode).toBe(0);
      expect(result.messages).toEqual(['Wrote e2e/requirements.json', 'Skipped e2e/about.json: source document not found']);
    });
  });

  describe('checking without writing', () => {
    it('reports no problems and writes nothing for well-formed documents', () => {
      writeSource(
        'docs/FUNCTIONAL_REQUIREMENTS.md',
        '## FEAT-SCHEDULING\n\n### FR-SCHEDULING-1\n\nA requirement.\n',
      );
      writeSource('docs/ABOUT.md', '# App\n\nOverview.\n\n## FEAT-SCHEDULING: Scheduling\n\nBody.\n');

      const result = runCli(['--check-only'], tmpDir);

      expect(result).toEqual({ exitCode: 0, messages: [] });
      expect(fs.existsSync(path.join(tmpDir, 'e2e'))).toBe(false);
    });

    it('reports no problems, without failing, when neither default source document exists', () => {
      const result = runCli(['--check-only'], tmpDir);

      expect(result).toEqual({ exitCode: 0, messages: [] });
    });

    it('reports a parse error for a malformed document instead of throwing', () => {
      writeSource('docs/FUNCTIONAL_REQUIREMENTS.md', '## Not a feature heading\n');

      const result = runCli(['--check-only'], tmpDir);

      expect(result.exitCode).toBe(1);
      expect(result.messages).toEqual([expect.stringMatching(/FEAT-/)]);
    });

    it('reports problems from both documents when both are malformed', () => {
      writeSource('docs/FUNCTIONAL_REQUIREMENTS.md', '## Not a feature heading\n');
      writeSource('docs/ABOUT.md', '## FEAT-SCHEDULING: Scheduling\n\nBody.\n');

      const result = runCli(['--check-only'], tmpDir);

      expect(result.exitCode).toBe(1);
      expect(result.messages).toEqual([
        expect.stringMatching(/"# <Title>"/),
        expect.stringMatching(/FEAT-/),
      ]);
    });

    it('treats a source document at a custom path that does not exist as a hard error', () => {
      const result = runCli(['--check-only', '--aboutFile', 'about.md'], tmpDir);

      expect(result.exitCode).toBe(1);
      expect(result.messages).toEqual(['about.md: file not found']);
    });
  });
});

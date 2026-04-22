/**
 * Shared HTML primitives for evidence reports.
 */

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function badge(text: string, variant: 'pass' | 'fail' | 'skipped' | 'missed'): string {
  return `<span class="badge badge-${variant}">${text}</span>`;
}

export function sharedStyles(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 14px;
      line-height: 1.6;
      color: #111;
      background: #fff;
      padding: 0;
    }

    /* ── Cover ───────────────────────────────────────────── */
    .cover {
      padding: 80px 60px;
      border-bottom: 3px solid #111;
      min-height: 260px;
    }
    .cover h1 {
      font-size: 28px;
      font-weight: bold;
      letter-spacing: 0.02em;
      margin-bottom: 8px;
    }
    .cover .meta {
      font-size: 13px;
      color: #555;
      margin-bottom: 32px;
    }
    .cover .summary-box {
      display: inline-block;
      border: 2px solid #111;
      padding: 16px 28px;
      font-size: 16px;
      font-weight: bold;
    }
    .cover .summary-box .overall {
      font-size: 22px;
      margin-bottom: 4px;
    }
    .cover .summary-box.overall-pass { border-color: #1a6b2a; }
    .cover .summary-box.overall-fail { border-color: #a01010; }
    .cover .summary-box .overall.pass-text { color: #1a6b2a; }
    .cover .summary-box .overall.fail-text { color: #a01010; }

    /* ── Sections ────────────────────────────────────────── */
    .body {
      padding: 40px 60px;
    }
    .section {
      margin-bottom: 48px;
      border-top: 2px solid #ddd;
      padding-top: 24px;
    }
    .section-header {
      display: flex;
      align-items: baseline;
      gap: 14px;
      margin-bottom: 16px;
    }
    .section-header h2 {
      font-size: 18px;
      font-weight: bold;
    }

    /* ── Badges ──────────────────────────────────────────── */
    .badge {
      font-family: 'Courier New', monospace;
      font-size: 11px;
      font-weight: bold;
      padding: 2px 8px;
      border: 1.5px solid currentColor;
      border-radius: 2px;
      white-space: nowrap;
      letter-spacing: 0.08em;
    }
    .badge-pass    { color: #1a6b2a; }
    .badge-fail    { color: #a01010; }
    .badge-skipped { color: #666; }
    .badge-missed  { color: #a01010; }

    /* ── Tables ──────────────────────────────────────────── */
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th {
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #555;
      border-bottom: 1px solid #ccc;
      padding: 4px 8px;
    }
    .data-table td {
      padding: 10px 8px;
      vertical-align: top;
      border-bottom: 1px solid #eee;
    }
    .col-num    { color: #888; font-size: 12px; width: 32px; }
    .col-status { width: 80px; text-align: center; }

    /* ── Screenshots ─────────────────────────────────────── */
    .screenshot-row td {
      padding: 0 8px 16px 40px;
      border-bottom: none;
    }
    .screenshot-row img {
      max-width: 100%;
      border: 1px solid #ccc;
      display: block;
    }
    .screenshot-caption {
      font-size: 11px;
      color: #777;
      margin-top: 4px;
      font-style: italic;
    }

    /* ── Error block ─────────────────────────────────────── */
    .error-block {
      background: #fff8f8;
      border-left: 3px solid #a01010;
      padding: 10px 14px;
      margin-top: 12px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      white-space: pre-wrap;
      color: #a01010;
    }

    /* ── Detail label ────────────────────────────────────── */
    .detail-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #888;
      margin-bottom: 2px;
    }
    .detail-value {
      font-size: 13px;
      margin-bottom: 12px;
    }

    /* ── Print ───────────────────────────────────────────── */
    @media print {
      body { font-size: 12px; }
      .cover {
        page-break-after: always;
        padding: 60px 40px;
      }
      .body { padding: 20px 40px; }
      .section { page-break-inside: avoid; }
      .screenshot-row { page-break-inside: avoid; }
      .screenshot-row img {
        max-width: 100%;
        max-height: 600px;
        object-fit: contain;
      }
      .cover .summary-box { background: none !important; }
      .error-block { background: none !important; }
    }
  `;
}

export function htmlDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>${sharedStyles()}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function runDate(date: Date): string {
  return date.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });
}

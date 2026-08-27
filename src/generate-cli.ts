#!/usr/bin/env node
// Shebang: lets the OS run this compiled file directly as `playwright-evidence-generate`.
import { runCli } from './generate.ts';

// process.argv[0] is node, [1] is this script's path — slice(2) leaves just the flags,
// e.g. ['--check-only'] for `playwright-evidence-generate --check-only`.
const { exitCode, messages } = runCli(process.argv.slice(2), process.cwd());

for (const message of messages) {
  console.log(message);
}

// process.exitCode (not process.exit()) lets pending output flush before Node exits.
process.exitCode = exitCode;

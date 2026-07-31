// package.json is the one place a version is set. This mirrors it into
// src/version.ts, which is what the server announces on stderr and reports to
// the MCP client. Hardcoded, the two drift silently: 0.1.1 shipped calling
// itself 0.1.0, and nothing failed, because a wrong version number is not a
// crash. Runs from `version` so it lands in the release commit.
import { readFileSync, writeFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
writeFileSync('src/version.ts', `export const VERSION = '${version}';\n`);

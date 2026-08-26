/**
 * CLI entry for the gameplay self-check.
 *
 *   npx esbuild src/gameplay/selfcheck.main.ts --bundle --platform=node --format=esm \
 *     --outfile=/tmp/gameplay-selfcheck.mjs && node /tmp/gameplay-selfcheck.mjs
 *
 * or, with a TS runner installed:  npx vite-node src/gameplay/selfcheck.main.ts
 */

import { formatSelfCheckReport, runGameplaySelfCheck } from './selfcheck';

const report = runGameplaySelfCheck();
console.log(formatSelfCheckReport(report));
if (!report.ok) process.exitCode = 1;

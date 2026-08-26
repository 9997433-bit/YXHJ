/**
 * Headless entry point for the combat self-check.
 *
 *   npx vite-node src/combat/selfcheck.run.ts
 *
 * Exits non-zero on the first failing invariant so CI can gate on it.
 */

import { formatSelfCheckReport, runCombatSelfCheck } from './selfcheck';

const report = runCombatSelfCheck();
console.log(formatSelfCheckReport(report));
process.exitCode = report.ok ? 0 : 1;

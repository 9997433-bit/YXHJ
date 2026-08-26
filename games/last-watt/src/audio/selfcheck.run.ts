import { formatReport, runSelfCheck } from './selfcheck';

/**
 * CLI 入口：`npm run selfcheck:audio`。
 *
 * 全程不碰声卡（`headlessContext.ts` 顶上），可直接进 CI；
 * 有任何一项失败就以非零码退出。
 */
const results = runSelfCheck();
console.log(formatReport(results));

if (results.some((result) => !result.ok)) process.exit(1);

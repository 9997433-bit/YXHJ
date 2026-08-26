#!/usr/bin/env node
/**
 * 无头跑冰碎可读性探针，并把 Round 2 参数与当前参数并排出表。
 *
 *   node src/vfx/demo/readability.probe.mjs [--png] [--out <dir>]
 *
 * 它自己拉起 vite、自己开无头 Chrome、自己收报告、自己收摊。之所以不用
 * `--screenshot` / `--virtual-time-budget`：那两个开关会跟页面里的 rAF 重绘循环
 * 打架，在 SwiftShader 上一挂就是几分钟。这里改成页面算完主动 POST 回来，
 * 拿到即收工，整轮 A/B 在软件光栅化下也只要几十秒。
 *
 * 判定（两组同机同帧对照，退化即失败）：
 * - 糊白占比必须降；
 * - 边缘能量必须升（碎片的硬边回来了）；
 * - 「认得出是冰」的像素必须变多，且它们仍然偏蓝（不是把效果调没了换来的干净）。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PAGE = '/src/vfx/demo/shatter-readability.html';
// 端口一律临时分配：这个仓库常常有好几个代理在同一台机器上并行跑探针，
// 写死端口就会变成「谁先跑谁赢」。
const VITE_PORT = 5200 + (process.pid % 300);

const args = process.argv.slice(2);
const wantPng = args.includes('--png');
const outDir = path.resolve(
  ROOT,
  args.includes('--out') ? args[args.indexOf('--out') + 1] : '.probe',
);

const CHROME =
  process.env.CHROME_PATH ??
  ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(Boolean);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`server never came up: ${url}`);
}

/** 收报告的小服务：一个 POST 一个 resolve，顺带放行跨源。 */
function startCollector() {
  let resolveReport = null;
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.writeHead(204, { 'access-control-allow-origin': '*' });
      res.end();
      try {
        resolveReport?.(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        resolveReport?.({ error: String(error) });
      }
    });
  });

  return {
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)),
    get port() {
      return server.address().port;
    },
    next: () =>
      new Promise((resolve, reject) => {
        resolveReport = resolve;
        setTimeout(() => reject(new Error('probe timed out after 240s')), 240_000);
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function runTuning(collector, tuning) {
  const post = encodeURIComponent(`http://127.0.0.1:${collector.port}/report`);
  const url = `http://localhost:${VITE_PORT}${PAGE}?tuning=${tuning}&post=${post}${wantPng ? '&png=1' : ''}`;

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,720',
      `--user-data-dir=/tmp/lw-probe-${tuning}-${process.pid}`,
      url,
    ],
    { stdio: 'ignore' },
  );

  try {
    return await collector.next();
  } finally {
    chrome.kill('SIGKILL');
  }
}

function row(label, before, after, unit = '', digits = 3) {
  const delta = after - before;
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '=';
  return `${label.padEnd(14)} ${before.toFixed(digits).padStart(8)}${unit} → ${after
    .toFixed(digits)
    .padStart(8)}${unit}  ${arrow} ${Math.abs(delta).toFixed(digits)}${unit}`;
}

async function main() {
  if (!CHROME) throw new Error('no chrome binary; set CHROME_PATH');

  const collector = startCollector();
  await collector.listen();

  // detached：npx 会再套一层 sh，只杀 npx 会把 vite 留成孤儿占着端口
  const vite = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });

  let failed = false;
  try {
    await waitForServer(`http://localhost:${VITE_PORT}${PAGE}`);

    const r2 = await runTuning(collector, 'r2');
    const current = await runTuning(collector, 'current');

    await mkdir(outDir, { recursive: true });
    await writeFile(
      path.join(outDir, 'shatter-readability.json'),
      JSON.stringify({ r2, current }, null, 2),
    );

    if (wantPng) {
      for (const report of [r2, current]) {
        for (const frame of report.frames ?? []) {
          const file = path.join(outDir, `shatter-${report.tuning}-${frame.atMs}ms.png`);
          await writeFile(file, Buffer.from(frame.png.split(',')[1], 'base64'));
        }
      }
    }

    console.log(`GPU  ${current.gpu}`);
    console.log(`窗口 ${current.window.size}px @ ${current.viewport.width}x${current.viewport.height}\n`);

    for (let i = 0; i < current.samples.length; i++) {
      const a = r2.samples[i];
      const b = current.samples[i];
      console.log(`+${a.atMs}ms`);
      console.log(`  ${row('糊白占比', a.blownFraction * 100, b.blownFraction * 100, '%', 2)}`);
      console.log(`  ${row('边缘能量', a.edgeEnergy, b.edgeEnergy)}`);
      console.log(`  ${row('平均亮度', a.meanLuma, b.meanLuma)}`);
      console.log(`  ${row('冰像素占比', a.coldFraction * 100, b.coldFraction * 100, '%', 2)}`);
      console.log(`  ${row('冰像素蓝调', a.coldChroma, b.coldChroma)}`);
      console.log(`  ${row('冰像素边缘', a.coldEdgeEnergy, b.coldEdgeEnergy)}`);
    }

    const peak = (report, key) => Math.max(...report.samples.map((s) => s[key]));
    const worst = (report, key) => Math.min(...report.samples.map((s) => s[key]));

    // 只在「R2 真的糊了」的那几帧上判分。后面几帧 R2 本来就已经清晰，
    // 把它们算进来只会让一次真实的修复被自己的对照组稀释掉。
    const washed = r2.samples
      .map((s, i) => (s.blownFraction > 0.01 ? i : -1))
      .filter((i) => i >= 0);
    const inWash = (fn) => washed.length > 0 && washed.every(fn);

    const verdicts = [
      [
        `糊白帧 (${washed.map((i) => `+${r2.samples[i].atMs}ms`).join(' ')}) 不再糊白`,
        inWash((i) => current.samples[i].blownFraction < 0.01),
      ],
      [
        '糊白帧的碎片长出了轮廓',
        inWash((i) => current.samples[i].coldEdgeEnergy > r2.samples[i].coldEdgeEnergy),
      ],
      ['整窗边缘能量峰值上升', peak(current, 'edgeEnergy') > peak(r2, 'edgeEnergy')],
      ['冰没被调没 (逐帧占比 ≥ 3%)', worst(current, 'coldFraction') >= 0.03],
      ['冰像素仍偏蓝 (逐帧 b-r > 0.06)', worst(current, 'coldChroma') > 0.06],
    ];
    console.log('');
    for (const [name, ok] of verdicts) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
      if (!ok) failed = true;
    }
    console.log(`\n报告：${path.relative(ROOT, outDir)}/shatter-readability.json`);
  } finally {
    try {
      process.kill(-vite.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    await collector.close();
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

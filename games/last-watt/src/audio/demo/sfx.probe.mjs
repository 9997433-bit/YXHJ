#!/usr/bin/env node
/**
 * 在无头 Chrome 里离线渲染四条 M1 音效并判定读数。
 *
 *   node src/audio/demo/sfx.probe.mjs
 *
 * 判定：
 * - 每条都出声（RMS > 0），且不削波（峰值 < 1）；
 * - 冰碎最短最锐、开波最长最闷 —— 四条的频谱重心必须拉得开，
 *   否则「关画面仅听声音能确认碎裂」（VISUAL_BIBLE 10.1）不成立；
 * - 渲染期间零异常。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PAGE = '/src/audio/demo/sfx-render.html';
const VITE_PORT = 5600 + (process.pid % 300);

const CHROME =
  process.env.CHROME_PATH ??
  ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`server never came up: ${url}`);
}

function startCollector() {
  let resolveReport = null;
  const server = createServer((req, res) => {
    // `content-type: application/json` 触发预检；预检没有 body，别把它当成报告
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
        setTimeout(() => reject(new Error('probe timed out after 180s')), 180_000);
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
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
    const post = encodeURIComponent(`http://127.0.0.1:${collector.port}/report`);
    const chrome = spawn(
      CHROME,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--user-data-dir=/tmp/lw-sfx-${process.pid}`,
        `http://localhost:${VITE_PORT}${PAGE}?post=${post}`,
      ],
      { stdio: 'ignore' },
    );

    let report;
    try {
      report = await collector.next();
    } finally {
      chrome.kill('SIGKILL');
    }

    const by = Object.fromEntries(report.measurements.map((m) => [m.id, m]));
    for (const m of report.measurements) {
      console.log(
        `${m.id.padEnd(18)} 峰值 ${m.peak.toFixed(3)} (裸 ${m.rawPeak.toFixed(3)} / 仅增益 ${m.gainOnlyPeak.toFixed(3)})` +
          `  RMS ${m.rms.toFixed(4)}  时长 ${m.durationSec.toFixed(2)}s  重心 ${Math.round(m.centroidHz)}Hz`,
      );
    }
    console.log('');

    const shatter = by.sfx_shatter_glass;
    const wave = by.sfx_wave_start;
    const verdicts = [
      ['四条音效全部渲染成功', report.measurements.length === 4],
      ['渲染期间零异常', report.errors.length === 0],
      ['全部出声 (RMS > 0.001)', report.measurements.every((m) => m.rms > 0.001)],
      ['全部不削波 (峰值 < 1)', report.measurements.every((m) => m.peak < 1)],
      // 下限挡的是总线压限器把动态压没了这类回归（默认 30dB knee 就会）
      ['留足响度 (峰值 > 0.12)', report.measurements.every((m) => m.peak > 0.12)],
      ['冰碎是最亮的一条', report.measurements.every((m) => m === shatter || m.centroidHz < shatter.centroidHz)],
      ['开波比冰碎闷至少 3 倍', shatter.centroidHz > wave.centroidHz * 3],
      ['冰碎在 0.6s 内收干净', shatter.durationSec < 0.6],
    ];
    for (const [name, ok] of verdicts) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
      if (!ok) failed = true;
    }
    if (report.errors.length > 0) console.log('\n' + report.errors.join('\n'));
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

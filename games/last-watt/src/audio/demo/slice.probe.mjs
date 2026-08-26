#!/usr/bin/env node
/**
 * 在真浏览器里开一局真游戏，确认音频这条线真的接上了。
 *
 *   node src/audio/demo/slice.probe.mjs
 *
 * 自检用的是 `FakeCombatBus` 与 `AudioContext` 替身，`sfx.probe.mjs` 用的是
 * `OfflineAudioContext`。两者都绕开了同一件事：**`src/main.ts` 那几行组装代码**。
 * `connectGameAudio({ combat: game.combat.bus, ... })` 里传错一个对象、
 * 或者 `AudioEngine` 在真页面上构造失败，上面两层测试全都照样绿。
 *
 * 这一页因此只问四个问题，全部对着 `window.__lastWattGame`：
 * 1. 音频引擎真的建起来了吗（`available`）；
 * 2. 手势之后真的解锁了吗（`unlocked`）；
 * 3. 真的开一波，开波音效会不会响（`played.sfx_wave_start`）；
 * 4. 整局跑下来页面有没有报错。
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const VITE_PORT = 5900 + (process.pid % 90);
const CDP_PORT = VITE_PORT + 100;

const CHROME = process.env.CHROME_PATH ?? '/usr/local/bin/google-chrome';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, what, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(250);
  }
  throw new Error(`${what} never happened${last ? `: ${last.message}` : ''}`);
}

/** 极简 CDP 客户端：一条 WebSocket，id 自增，按 id 兑现 promise。 */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) entry?.reject(new Error(message.error.message));
        else entry?.resolve(message.result);
      } else {
        this.events.push(message);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('cdp socket failed')), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  /** 求值并把结果按值取回；页面里抛出来的异常在这里变成 Node 的异常。 */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'page threw');
    }
    return result.result.value;
  }
}

async function main() {
  const vite = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // 没有这条，AudioContext 会一直停在 suspended，第 2 问永远失败
      '--autoplay-policy=no-user-gesture-required',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=/tmp/lw-slice-${process.pid}`,
      'about:blank',
    ],
    { stdio: 'ignore', detached: true },
  );

  let failed = false;
  try {
    await waitFor(async () => (await fetch(`http://localhost:${VITE_PORT}/`)).ok, 'vite 起来');
    const targets = await waitFor(async () => {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      return list.find((t) => t.type === 'page') ?? null;
    }, 'chrome 的调试端口打开');

    const cdp = await Cdp.connect(targets.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: `http://localhost:${VITE_PORT}/` });

    await waitFor(
      () => cdp.evaluate('Boolean(window.__lastWattGame)'),
      '游戏切片起来（window.__lastWattGame）',
    );

    // 真手势：解锁 autoplay 走的是 main.ts 挂的那个 keydown 监听，不是直接调 unlock()
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Shift',
      code: 'ShiftLeft',
      windowsVirtualKeyCode: 16,
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft' });

    const wired = await cdp.evaluate(`(() => {
      const a = window.__lastWattGame.audio;
      return { available: a.available, unlocked: a.isUnlocked, muted: a.isMuted };
    })()`);

    // 建造：数字键 1 选图纸，再往棋盘上真点一下。落点不写死——视口尺寸、
    // 相机档位一变就会点空——改成在画面中段扫几个点，落成一座就停。
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: '1',
      code: 'Digit1',
      windowsVirtualKeyCode: 49,
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Digit1' });

    const { width, height } = await cdp.evaluate(
      '({ width: innerWidth, height: innerHeight })',
    );
    let built = 0;
    for (const fy of [0.55, 0.62, 0.48, 0.7]) {
      for (const fx of [0.5, 0.42, 0.58]) {
        const x = Math.round(width * fx);
        const y = Math.round(height * fy);
        for (const type of ['mousePressed', 'mouseReleased']) {
          await cdp.send('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: 'left',
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: 1,
            pointerType: 'mouse',
          });
        }
        await sleep(120);
        built = await cdp.evaluate(
          'window.__lastWattGame.audio.diagnostics.played.sfx_build_place',
        );
        if (built > 0) break;
      }
      if (built > 0) break;
    }

    // 空格 = 提前开波，走 InputController → 真命令 → 真 gameplay 事件
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: ' ',
      code: 'Space',
      windowsVirtualKeyCode: 32,
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space' });
    await sleep(2500);

    const after = await cdp.evaluate(`(() => {
      const g = window.__lastWattGame;
      return { diagnostics: g.audio.diagnostics, wave: g.game.session.snapshot().wave };
    })()`);

    // 静音这条路径只在真页面上跑得到：M 键 → main.ts 的 onMuteKey → setMuted
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'm',
      code: 'KeyM',
      windowsVirtualKeyCode: 77,
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'm', code: 'KeyM' });
    const muted = await cdp.evaluate('window.__lastWattGame.audio.isMuted');

    const pageErrors = cdp.events
      .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
      .map((e) => e.params.entry.text);

    const played = after.diagnostics.played;
    console.log(`音频引擎    available=${wired.available}  unlocked=${wired.unlocked}`);
    console.log(`开波后      wave=${JSON.stringify(after.wave)}`);
    console.log(`发声计数    ${JSON.stringify(played)}`);
    console.log(`静音键      ${muted}`);
    console.log('');

    const verdicts = [
      ['真页面上 AudioEngine 建起来了', wired.available === true],
      ['手势之后解锁了 autoplay', wired.unlocked === true],
      ['默认不静音', wired.muted === false],
      ['棋盘上真放一座塔，落位音效响了', played.sfx_build_place >= 1],
      ['空格开波，开波音效响了', played.sfx_wave_start >= 1],
      ['M 键真的切了静音', muted === true],
      ['页面零报错', pageErrors.length === 0],
    ];
    for (const [name, ok] of verdicts) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
      if (!ok) failed = true;
    }
    if (pageErrors.length > 0) console.log('\n' + pageErrors.join('\n'));
  } finally {
    for (const child of [vite, chrome]) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

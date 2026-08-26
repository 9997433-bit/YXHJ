import { DebugHud } from './debug/DebugHud';
import { Engine } from './Engine';

declare global {
  interface Window {
    /** Handy console handle during development: `__lastWatt.engine.cameraRig`. */
    __lastWatt?: { engine: Engine; hud: DebugHud };
  }
}

function showFatal(error: unknown): void {
  const panel = document.getElementById('lw-fatal');
  const body = document.getElementById('lw-fatal-body');
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  if (body) {
    body.textContent = [
      message,
      '',
      '排查 / troubleshooting:',
      '  1. 确认浏览器启用了硬件加速（chrome://gpu）。',
      '  2. 访问 https://webglreport.com/?v=2 确认 WebGL2 可用。',
      '  3. 更新显卡驱动或换用 Chrome / Edge / Firefox 最新版。',
    ].join('\n');
  }
  if (panel) panel.dataset.visible = 'true';

  document.getElementById('lw-boot')?.setAttribute('data-hidden', 'true');
  console.error('[last-watt] boot failed', error);
}

function boot(): void {
  const container = document.getElementById('lw-app');
  if (!container) throw new Error('Mount point #lw-app is missing from index.html');

  const engine = new Engine(container);
  const hud = new DebugHud(engine);
  engine.start();

  // Only dismiss the boot screen once a real frame has been presented, so a
  // shader compile failure is never hidden behind a blank canvas.
  engine.loop.onPresent.once(() => {
    document.getElementById('lw-boot')?.setAttribute('data-hidden', 'true');
  });

  window.__lastWatt = { engine, hud };
  console.info(`[last-watt] WebGL2 online · ${engine.gpu} · ${engine.describe()}`);

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      hud.dispose();
      engine.dispose();
      delete window.__lastWatt;
    });
  }
}

try {
  boot();
} catch (error) {
  showFatal(error);
}

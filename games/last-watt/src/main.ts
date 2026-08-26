/**
 * Application entry point.
 *
 * Thin on purpose: mount, boot, report. Everything with an opinion lives in
 * `src/app`. `src/engine/boot.ts` is still the engine's own standalone harness
 * and is left alone so the renderer can be brought up without the game.
 */

import { DevOverlay } from './app/devOverlay';
import { Game } from './app/game';

declare global {
  interface Window {
    /**
     * Console handle for playtesting and the headless probe. Distinct from the
     * engine harness's `__lastWatt` so both entry points can coexist.
     */
    __lastWattGame?: { game: Game; overlay: DevOverlay };
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
      error instanceof Error && error.stack ? error.stack : '',
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

  const game = new Game({ container });
  const overlay = new DevOverlay(game);

  // Hold the boot screen until a frame has actually been presented, so a shader
  // compile failure never hides behind a blank canvas.
  const dismiss = window.setInterval(() => {
    if (game.frames === 0) return;
    window.clearInterval(dismiss);
    document.getElementById('lw-boot')?.setAttribute('data-hidden', 'true');
  }, 50);

  window.__lastWattGame = { game, overlay };
  console.info(
    `[last-watt] M1 slice online · ${game.engine.gpu} · ${game.engine.describe()}`,
  );

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.clearInterval(dismiss);
      overlay.dispose();
      game.dispose();
      delete window.__lastWattGame;
    });
  }
}

try {
  boot();
} catch (error) {
  showFatal(error);
}

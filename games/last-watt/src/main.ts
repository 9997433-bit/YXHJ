/**
 * Application entry point.
 *
 * Thin on purpose: mount, boot, report. Everything with an opinion lives in
 * `src/app`. `src/engine/boot.ts` is still the engine's own standalone harness
 * and is left alone so the renderer can be brought up without the game.
 */

import { DevOverlay } from './app/devOverlay';
import { Game } from './app/game';
import { AudioEngine, connectGameAudio } from './audio';

declare global {
  interface Window {
    /**
     * Console handle for playtesting and the headless probe. Distinct from the
     * engine harness's `__lastWatt` so both entry points can coexist.
     */
    __lastWattGame?: { game: Game; overlay: DevOverlay; audio: AudioEngine };
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

  // Deferred: the request arrives from a click or a key handler that the frame
  // callback is still unwinding, and disposing the engine underneath it takes
  // the renderer down mid-draw.
  const game = new Game({ container, onRestart: () => window.setTimeout(restart, 0) });
  const overlay = new DevOverlay(game);

  // Audio subscribes to the same two synchronous buses the VFX bridge does, so
  // a shatter's "咔嚓" is scheduled inside the same event dispatch that emits
  // its shards — the ≤1 frame the visual bible asks for is 0 frames here.
  // Nothing is audible until the first gesture; the engine resumes itself on
  // the first pointerdown or keydown.
  const audio = new AudioEngine();
  const audioBridge = connectGameAudio({
    combat: game.combat.bus,
    gameplay: game.session.events,
    audio,
  });

  function teardown(): void {
    window.clearInterval(dismiss);
    window.removeEventListener('keydown', onMuteKey);
    audioBridge.detach();
    audio.dispose();
    overlay.dispose();
    game.dispose();
    delete window.__lastWattGame;
  }

  /**
   * `M` mutes. It lives here rather than in `InputController` because there is
   * no settings panel yet and the assembly layer is the only place that owns
   * the audio engine; move it into the input map when one exists.
   */
  function onMuteKey(event: KeyboardEvent): void {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() !== 'm') return;
    audio.setMuted(!audio.isMuted);
    console.info(`[last-watt] 音效${audio.isMuted ? '已静音' : '已开启'}`);
  }
  window.addEventListener('keydown', onMuteKey);

  function restart(): void {
    teardown();
    try {
      boot();
    } catch (error) {
      showFatal(error);
    }
  }

  // Hold the boot screen until a frame has actually been presented, so a shader
  // compile failure never hides behind a blank canvas.
  const dismiss = window.setInterval(() => {
    if (game.frames === 0) return;
    window.clearInterval(dismiss);
    document.getElementById('lw-boot')?.setAttribute('data-hidden', 'true');
  }, 50);

  window.__lastWattGame = { game, overlay, audio };
  console.info(
    `[last-watt] M1 slice online · ${game.engine.gpu} · ${game.engine.describe()}`,
  );

  if (import.meta.hot) {
    import.meta.hot.dispose(teardown);
  }
}

try {
  boot();
} catch (error) {
  showFatal(error);
}

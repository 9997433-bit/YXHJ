/**
 * `src/audio` 对外出口。
 *
 * 装配层（`src/main.ts`）拿 `AudioEngine` + `connectGameAudio` 两件即可；
 * 其余导出给自检与后续的音量设置面板用。
 */

export {
  AudioEngine,
  SFX_IDS,
  type AudioDiagnostics,
  type AudioEngineOptions,
  type SfxCue,
  type SfxId,
} from './AudioEngine';
export {
  connectGameAudio,
  type CombatAudioSource,
  type GameAudioBridge,
  type GameAudioOptions,
  type GameplayAudioSource,
} from './bridge';
export { VOICES, type VoiceContext } from './voices';
export { createHeadlessAudioContext, type HeadlessAudioLog } from './headlessContext';

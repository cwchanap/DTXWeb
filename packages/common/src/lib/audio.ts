// Audio module re-exports.
// Separated from the main barrel so that importing `@dtx/common` for DTXFile /
// SimFile / notation utilities does not eagerly evaluate `audioDecoder`, whose
// top-level `XAaudioContext` singleton constructs an AudioContext at module
// load. Import from `@dtx/common/audio` only on routes that actually need audio.
export { PreviewAudioEngine, type AudioEngineLoadParams } from './audio/previewAudioEngine';

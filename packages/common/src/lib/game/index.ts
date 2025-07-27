// Export game scenes
export { BaseGame } from './scenes/BaseGame.js';
export { Editor } from './scenes/Editor.js';
export { MainMenu } from './scenes/MainMenu.js';
export { Preview } from './scenes/Preview.js';

// Export game types and interfaces
export type { LaneConfig } from './interface.js';
export { AssetName } from './interface.js';

// Export game utilities
export { calculateHighResolutionPosition, HIGH_RESOLUTION_CELLS } from './utils/notePositioning.js';

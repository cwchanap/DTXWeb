// Export game components that require browser/renderer environment
// These should only be imported in the renderer process, not in Node.js/main process

// Export game scenes (require Phaser/browser environment)
export { BaseGame } from './game/scenes/BaseGame.js';
export { Editor } from './game/scenes/Editor.js';
export { MainMenu } from './game/scenes/MainMenu.js';
export { Preview } from './game/scenes/Preview.js';

// Export game types and interfaces
export type { LaneConfig } from './game/interface.js';
export { AssetName } from './game/interface.js';

// Export game utilities
export {
	calculateHighResolutionPosition,
	HIGH_RESOLUTION_CELLS
} from './game/utils/notePositioning.js';

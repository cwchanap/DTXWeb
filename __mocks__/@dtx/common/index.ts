import { vi } from 'vitest';
import { UploadedAssetFiles } from './components';

// Export the mocked components
export { UploadedAssetFiles };

// Mock the Tables type
export type Tables<T extends string> = Record<string, any>;

import { join } from 'node:path';

/**
 * Cross-platform path joining utility using Node.js path.join
 * @param parts - Path parts to join
 * @returns Properly joined path for the current platform
 */
export function joinPath(...parts: string[]): string {
	return join(...parts);
}

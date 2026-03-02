#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function fixImportExtensions(dir) {
	try {
		const files = await readdir(dir, { withFileTypes: true });

		for (const file of files) {
			const fullPath = join(dir, file.name);

			if (file.isDirectory()) {
				await fixImportExtensions(fullPath);
			} else if (file.name.endsWith('.js')) {
				const content = await readFile(fullPath, 'utf-8');

				// Fix relative imports without extensions (handles ./ and any levels of ../)
				const fixedContent = content.replace(
					/from\s+['"]((\.\/|\.\.\/)+.+?)['"];?/g,
					(match, importPath) => {
						// Don't add .js if already has a known file extension
						if (/\.(js|ts|jsx|tsx|css|json|svelte|html)$/.test(importPath)) {
							return match;
						}
						// Replace the import path with .js extension
						return match.replace(importPath, `${importPath}.js`);
					}
				);

				if (fixedContent !== content) {
					await writeFile(fullPath, fixedContent, 'utf-8');
					console.log(`Fixed extensions in: ${fullPath}`);
				}
			}
		}
	} catch (error) {
		console.error(`Error processing directory ${dir}:`, error);
	}
}

// Run the fix
const distDir = new URL('../dist', import.meta.url).pathname;
await fixImportExtensions(distDir);
console.log('✅ Import extensions fixed!');

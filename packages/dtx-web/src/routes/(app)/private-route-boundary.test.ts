import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoutesDirectory = path.resolve(process.cwd(), 'src/routes/(app)');

const findRouteFiles = (directory: string): string[] => {
	const routeFiles: string[] = [];

	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);

		if (entry.isDirectory()) {
			routeFiles.push(...findRouteFiles(entryPath));
			continue;
		}

		if (entry.name.startsWith('+page') || entry.name.startsWith('+server')) {
			routeFiles.push(entryPath);
		}
	}

	return routeFiles;
};

const emittedRouteForFile = (filePath: string): string => {
	const relativeDirectory = path.dirname(path.relative(appRoutesDirectory, filePath));
	const directorySegments = relativeDirectory === '.' ? [] : relativeDirectory.split(path.sep);
	const routeSegments = directorySegments.filter(
		(segment) => !(segment.startsWith('(') && segment.endsWith(')'))
	);

	return routeSegments.length === 0 ? '/' : `/${routeSegments.join('/')}`;
};

describe('private route boundary', () => {
	it('keeps every page and server route under /app', () => {
		const routeFiles = findRouteFiles(appRoutesDirectory);

		expect(routeFiles).not.toHaveLength(0);

		for (const routeFile of routeFiles) {
			const route = emittedRouteForFile(routeFile);
			const isPrivateRoute = route === '/app' || route.startsWith('/app/');

			expect(
				isPrivateRoute,
				`${path.relative(process.cwd(), routeFile)} emits ${route}`
			).toBe(true);
		}
	});
});

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const findRepoRoot = (): string => {
	let current = process.cwd();
	while (current !== path.dirname(current)) {
		const packageJsonPath = path.join(current, 'package.json');
		if (existsSync(packageJsonPath)) {
			const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
				name?: string;
			};
			if (packageJson.name === 'drumery') return current;
		}
		current = path.dirname(current);
	}
	throw new Error('Unable to find drumery repo root');
};

const repoRoot = findRepoRoot();

const readJson = <T>(filePath: string): T =>
	JSON.parse(readFileSync(path.resolve(repoRoot, filePath), 'utf8')) as T;

type PackageJson = {
	scripts: Record<string, string>;
};

type TurboConfig = {
	tasks: Record<string, unknown>;
};

type WranglerConfig = {
	env?: Record<string, { vars?: Record<string, string> }>;
};

describe('desktop local dev topology', () => {
	it('starts local api, local web, and tauri with local service URLs from root dev', () => {
		const rootPackage = readJson<PackageJson>('package.json');
		const apiPackage = readJson<PackageJson>('packages/dtx-api/package.json');
		const webPackage = readJson<PackageJson>('packages/dtx-web/package.json');
		const desktopPackage = readJson<PackageJson>('packages/dtx-desktop/package.json');
		const turboConfig = readJson<TurboConfig>('turbo.json');
		const apiWrangler = readJson<WranglerConfig>('packages/dtx-api/wrangler.jsonc');

		expect(rootPackage.scripts.dev).toBe(
			'turbo run dtx-api#dev:local dtx-web#dev:local-api dtx-desktop#dev:local-web'
		);
		expect(rootPackage.scripts['dev:all']).toBe(
			'turbo run dtx-api#dev:local dtx-web#dev:local-api dtx-desktop#dev:local-web @dtx/common#dev'
		);
		expect(apiPackage.scripts['dev:local']).toBe('wrangler dev --env pre-prod --port 8787');
		expect(webPackage.scripts['dev:local-api']).toBe(
			'PUBLIC_DTX_API_URL=http://localhost:8787 vite dev --port 5173'
		);
		expect(desktopPackage.scripts['dev:local-web']).toBe(
			'VITE_DTX_SERVER_URL=http://localhost:5173 VITE_DTX_API_URL=http://localhost:8787 tauri dev'
		);
		expect(turboConfig.tasks).toHaveProperty('dtx-api#dev:local');
		expect(turboConfig.tasks).toHaveProperty('dtx-web#dev:local-api');
		expect(apiWrangler.env?.['pre-prod']?.vars?.CORS_ALLOWED_ORIGINS).toContain(
			'http://localhost:5173'
		);
	});
});

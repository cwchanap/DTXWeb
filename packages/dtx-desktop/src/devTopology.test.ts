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
	tasks: Record<string, { env?: string[] }>;
};

type WranglerConfig = {
	env?: Record<
		string,
		{
			d1_databases?: Array<Record<string, unknown>>;
			r2_buckets?: Array<Record<string, unknown>>;
			vars?: Record<string, string>;
		}
	>;
};

type TauriConfig = {
	bundle?: {
		icon?: string[];
	};
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
		expect(apiPackage.scripts['dev:local']).toBe(
			'wrangler dev --env pre-prod --env-file ../../.env --var MAGIC_LINK_HOURLY_LIMIT:1000 --port 8787'
		);
		expect(desktopPackage.scripts.dev).toBe('bun --env-file ../../.env tauri dev');
		expect(webPackage.scripts['dev:local-api']).toBe(
			'PUBLIC_DTX_API_URL=http://localhost:8787 PUBLIC_DTX_DESKTOP_AUTH_CALLBACK_URL=http://127.0.0.1:47931/auth-callback vite dev --port 5173'
		);
		expect(desktopPackage.scripts['dev:local-web']).toBe(
			'VITE_DTX_SERVER_URL=http://localhost:5173 VITE_DTX_API_URL=http://localhost:8787 DTX_DESKTOP_AUTH_CALLBACK_PORT=47931 bun --env-file ../../.env tauri dev'
		);
		expect(turboConfig.tasks).toHaveProperty('dtx-api#dev:local');
		expect(turboConfig.tasks).toHaveProperty('dtx-web#dev:local-api');
		expect(apiWrangler.env?.['pre-prod']?.vars?.CORS_ALLOWED_ORIGINS).toContain(
			'http://localhost:5173'
		);
		expect(apiWrangler.env?.['pre-prod']?.d1_databases?.[0]).toMatchObject({
			binding: 'DB',
			database_name: 'dtx-web-preprod',
			remote: true
		});
		expect(apiWrangler.env?.['pre-prod']?.r2_buckets?.[0]).toMatchObject({
			binding: 'DTXFILE_BUCKET',
			bucket_name: 'simfile-dtx-preprod',
			remote: true
		});
		expect(turboConfig.tasks['dtx-desktop#dev:local-web']?.env).toEqual(
			expect.arrayContaining(['PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_ANON_KEY'])
		);
	});

	it('bundles the generated Drumery desktop app icon', () => {
		const tauriConfig = readJson<TauriConfig>('packages/dtx-desktop/src-tauri/tauri.conf.json');

		expect(tauriConfig.bundle?.icon).toEqual([
			'icons/32x32.png',
			'icons/128x128.png',
			'icons/128x128@2x.png',
			'icons/icon.icns',
			'icons/icon.ico'
		]);
	});
});

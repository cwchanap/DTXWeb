import { describe, expect, it, vi } from 'vitest';
import {
	BGM_TRANSCODE_PROFILE,
	BGM_TRANSCODE_WORST_CASE_MS,
	buildBgmWorkflowInstanceId
} from '../services/bgmM4a';
import {
	DEFAULT_MAX_POLL_ATTEMPTS,
	DEFAULT_POLL_DELAY_MS,
	auditCatalog,
	formatAuditReport,
	parseWorkflowRunOutput,
	runBackfill,
	runCli,
	withFetchTimeout,
	type CatalogSimfile,
	type FetchLike
} from './backfill-bgm-m4a';

const SOURCE_UPLOADED = '2026-08-27T05:00:00.123Z';
const OLDER_UPLOADED = '2026-08-27T04:00:00.000Z';
const NEWER_UPLOADED = '2026-08-27T06:00:00.000Z';
const GRAPHQL_URL = 'https://graphql.test/graphql';
const ACCOUNT_ID = 'acc-1';
const API_TOKEN = 'tok-1';
const WORKFLOW_NAME = 'dtx-api-bgm-m4a';

const catalogFixture = (): CatalogSimfile[] => [
	{
		id: '1',
		files: [
			{ key: '1/song.flac', uploaded: SOURCE_UPLOADED },
			{ key: '1/chart.dtx', uploaded: SOURCE_UPLOADED },
			{ key: '1/preview.mp3', uploaded: SOURCE_UPLOADED }
		]
	},
	{
		id: '2',
		files: [
			{ key: '2/MUSIC.M4A', uploaded: SOURCE_UPLOADED },
			{ key: '2/bgm.m4a', uploaded: NEWER_UPLOADED }
		]
	},
	{
		id: '3',
		files: [
			{ key: '3/track.wav', uploaded: SOURCE_UPLOADED },
			{ key: '3/bgm.m4a', uploaded: OLDER_UPLOADED }
		]
	},
	{ id: '4', files: [{ key: '4/audio.mp3', uploaded: SOURCE_UPLOADED }] },
	{
		id: '5',
		files: [
			{ key: '5/assets/kick.ogg', uploaded: SOURCE_UPLOADED },
			{ key: '5/chart.dtx', uploaded: SOURCE_UPLOADED }
		]
	},
	{ id: '6', files: [{ key: '6/bgm.m4a', uploaded: SOURCE_UPLOADED }] },
	{
		id: '7',
		files: [
			{ key: '7/z-song.ogg', uploaded: SOURCE_UPLOADED },
			{ key: '7/a-song.ogg', uploaded: SOURCE_UPLOADED }
		]
	},
	{ id: '8', files: [{ key: '8/chart.dtx', uploaded: SOURCE_UPLOADED }] }
];

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

const cfOk = (result: unknown, status = 200): Response =>
	jsonResponse({ success: true, errors: [], messages: [], result }, status);

const cfFail = (message: string, status = 400): Response =>
	jsonResponse(
		{ success: false, errors: [{ code: 1, message }], messages: [], result: null },
		status
	);

const graphqlFetch =
	(pages: Array<{ count: number; data: CatalogSimfile[] }>): FetchLike =>
	async (input, init) => {
		const url = String(input);
		if (!url.startsWith(GRAPHQL_URL)) {
			throw new Error(`unexpected URL ${url}`);
		}
		const body = JSON.parse(String(init?.body));
		expect(body.query).toContain(
			'simfiles(scope: PUBLISHED, page: $page, pageSize: $pageSize)'
		);
		expect(body.query).toContain('data { id files { key uploaded } }');
		const page = body.variables.page as number;
		const pageData = pages[page - 1] ?? { count: pages[0]?.count ?? 0, data: [] };
		return jsonResponse({ data: { simfiles: pageData } });
	};

const instancesUrl = (workflowName = WORKFLOW_NAME): string =>
	`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workflows/${workflowName}/instances`;

const executeConfig = (fetchImpl: FetchLike, sleep = vi.fn(async () => undefined)) => ({
	mode: 'execute' as const,
	graphqlUrl: GRAPHQL_URL,
	cloudflareAccountId: ACCOUNT_ID,
	cloudflareApiToken: API_TOKEN,
	workflowName: WORKFLOW_NAME,
	fetch: fetchImpl,
	sleep,
	pollDelayMs: 10,
	maxPollAttempts: 8,
	graphqlPageSize: 100
});

describe('auditCatalog', () => {
	it('selects arbitrary top-level codecs, excludes canonical bgm.m4a, and ignores nested-only rows', () => {
		const audit = auditCatalog(catalogFixture());

		expect(audit.publishedTotal).toBe(8);
		expect(audit.audioBearingRows).toBe(7);
		expect(audit.selectedAuthoredSources).toBe(5);
		expect(audit.canonicalBgmM4aRows).toBe(3);
		expect(audit.selectedSourcesMissingOrOlder).toBe(4);
		expect(audit.selected.map((row) => row.source.key)).toEqual([
			'1/song.flac',
			'2/MUSIC.M4A',
			'3/track.wav',
			'4/audio.mp3',
			'7/a-song.ogg'
		]);
		expect(Object.keys(audit.filenameHistogram)).not.toContain('bgm.m4a');
		expect(Object.keys(audit.filenameHistogram)).not.toContain('kick.ogg');
		expect(Object.keys(audit.filenameHistogram)).not.toContain('preview.mp3');
		expect(audit.filenameHistogram).toMatchObject({
			'song.flac': 1,
			'MUSIC.M4A': 1,
			'track.wav': 1,
			'audio.mp3': 1,
			'a-song.ogg': 1,
			'z-song.ogg': 1
		});
		expect(catalogFixture().some((row) => JSON.stringify(row).includes('bgm.ogg'))).toBe(false);
	});

	it('treats unparseable source or derivative timestamps as missing/older', () => {
		const rows: CatalogSimfile[] = [
			{
				id: '1',
				files: [
					{ key: '1/song.flac', uploaded: SOURCE_UPLOADED },
					{ key: '1/bgm.m4a', uploaded: 'not-a-date' }
				]
			},
			{
				id: '2',
				files: [
					{ key: '2/song.flac', uploaded: 'not-a-date' },
					{ key: '2/bgm.m4a', uploaded: NEWER_UPLOADED }
				]
			}
		];

		const audit = auditCatalog(rows);

		expect(audit.selected.map((row) => row.missingOrOlder)).toEqual([true, true]);
	});
});

describe('formatAuditReport', () => {
	it('prints the operator audit lines with counts and mode', () => {
		const report = formatAuditReport(auditCatalog(catalogFixture()), 'dry-run');

		expect(report).toBe(
			[
				'published total: 8',
				'audio-bearing rows: 7',
				'selected authored sources: 5',
				'canonical bgm.m4a rows: 3',
				'selected sources missing/older bgm.m4a: 4',
				'filename histogram: a-song.ogg: 1, audio.mp3: 1, MUSIC.M4A: 1, song.flac: 1, track.wav: 1, z-song.ogg: 1',
				'mode: dry-run'
			].join('\n')
		);
	});
});

describe('parseWorkflowRunOutput', () => {
	it('accepts a JSON string of the Workflow return object', () => {
		expect(parseWorkflowRunOutput('{"status":"ready"}')).toBe('ready');
		expect(parseWorkflowRunOutput('{"status":"cached"}')).toBe('cached');
		expect(parseWorkflowRunOutput('{"status":"superseded"}')).toBe('superseded');
	});

	it('accepts an already-parsed Workflow return object', () => {
		expect(parseWorkflowRunOutput({ status: 'ready' })).toBe('ready');
		expect(parseWorkflowRunOutput({ status: 'cached' })).toBe('cached');
		expect(parseWorkflowRunOutput({ status: 'superseded' })).toBe('superseded');
	});

	it('rejects undocumented encodings', () => {
		expect(parseWorkflowRunOutput(1)).toBeNull();
		expect(parseWorkflowRunOutput('ready')).toBeNull();
		expect(parseWorkflowRunOutput({ status: 'generate' })).toBeNull();
	});
});

describe('runCli flags', () => {
	it('defaults to dry-run and rejects combining --execute with --check', async () => {
		const fetchImpl = graphqlFetch([{ count: 0, data: [] }]);
		const dry = await runCli([], { DTX_GRAPHQL_URL: GRAPHQL_URL }, { fetch: fetchImpl });
		expect(dry.exitCode).toBe(0);
		expect(dry.stdout).toContain('mode: dry-run');

		const both = await runCli(
			['--execute', '--check'],
			{ DTX_GRAPHQL_URL: GRAPHQL_URL },
			{ fetch: fetchImpl }
		);
		expect(both.exitCode).toBe(1);
		expect(both.stderr).toMatch(/mutually exclusive/);
	});
});

describe('dry-run and check', () => {
	it('prints the audit and exits zero in dry-run even when derivatives are missing', async () => {
		const result = await runBackfill({
			mode: 'dry-run',
			graphqlUrl: GRAPHQL_URL,
			workflowName: WORKFLOW_NAME,
			fetch: graphqlFetch([{ count: 8, data: catalogFixture() }]),
			sleep: vi.fn(async () => undefined),
			pollDelayMs: 10,
			maxPollAttempts: 8,
			graphqlPageSize: 100
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('selected sources missing/older bgm.m4a: 4');
		expect(result.stdout).toContain('mode: dry-run');
	});

	it('pages public GraphQL until the published catalog is complete', async () => {
		const pages = [
			{ count: 3, data: catalogFixture().slice(0, 2) },
			{ count: 3, data: catalogFixture().slice(2, 3) }
		];
		const fetchImpl = graphqlFetch(pages);
		const result = await runBackfill({
			mode: 'dry-run',
			graphqlUrl: GRAPHQL_URL,
			workflowName: WORKFLOW_NAME,
			fetch: fetchImpl,
			sleep: vi.fn(async () => undefined),
			pollDelayMs: 10,
			maxPollAttempts: 8,
			graphqlPageSize: 2
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('published total: 3');
		expect(result.stdout).toContain('selected authored sources: 3');
	});

	it('exits nonzero in --check unless every selected source has a current bgm.m4a', async () => {
		const missing = await runBackfill({
			mode: 'check',
			graphqlUrl: GRAPHQL_URL,
			workflowName: WORKFLOW_NAME,
			fetch: graphqlFetch([{ count: 8, data: catalogFixture() }]),
			sleep: vi.fn(async () => undefined),
			pollDelayMs: 10,
			maxPollAttempts: 8,
			graphqlPageSize: 100
		});
		expect(missing.exitCode).toBe(1);
		expect(missing.stdout).toContain('selected sources missing/older bgm.m4a: 4');
		expect(missing.stdout).toContain('mode: check');

		const currentOnly: CatalogSimfile[] = [
			{
				id: '2',
				files: [
					{ key: '2/MUSIC.M4A', uploaded: SOURCE_UPLOADED },
					{ key: '2/bgm.m4a', uploaded: NEWER_UPLOADED }
				]
			},
			{ id: '5', files: [{ key: '5/assets/kick.ogg', uploaded: SOURCE_UPLOADED }] }
		];
		const passing = await runBackfill({
			mode: 'check',
			graphqlUrl: GRAPHQL_URL,
			workflowName: WORKFLOW_NAME,
			fetch: graphqlFetch([{ count: 2, data: currentOnly }]),
			sleep: vi.fn(async () => undefined),
			pollDelayMs: 10,
			maxPollAttempts: 8,
			graphqlPageSize: 100
		});
		expect(passing.exitCode).toBe(0);
		expect(passing.stdout).toContain('selected sources missing/older bgm.m4a: 0');
	});
});

describe('execute REST lifecycle', () => {
	const sourceRow = (files: CatalogSimfile['files'], id = '42'): CatalogSimfile[] => [
		{ id, files }
	];

	const expectedId = (id = 42): string => buildBgmWorkflowInstanceId(id, SOURCE_UPLOADED);

	const combineFetch = (
		rows: CatalogSimfile[],
		rest: (call: {
			method: string;
			url: string;
			body: {
				instance_id?: string;
				params?: string;
				status?: string;
				instance_retention?: {
					success_retention?: string;
					error_retention?: string;
				};
			};
			headers: Headers;
		}) => Response
	): FetchLike => {
		const gql = graphqlFetch([{ count: rows.length, data: rows }]);
		return async (input, init) => {
			const url = String(input);
			if (url.startsWith(GRAPHQL_URL)) return gql(input, init);
			const method = (init?.method ?? 'GET').toUpperCase();
			const headers = new Headers(init?.headers);
			const body = init?.body
				? (JSON.parse(String(init.body)) as {
						instance_id?: string;
						params?: string;
						status?: string;
						instance_retention?: {
							success_retention?: string;
							error_retention?: string;
						};
					})
				: {};
			expect(headers.get('Authorization')).toBe(`Bearer ${API_TOKEN}`);
			return rest({ method, url, body, headers });
		};
	};

	it('creates a new instance, polls GET until terminal, and accepts ready output', async () => {
		const rows = sourceRow([{ key: '42/song.flac', uploaded: SOURCE_UPLOADED }]);
		const id = expectedId();
		const sleep = vi.fn(async () => undefined);
		let gets = 0;
		const methods: string[] = [];

		const result = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method, url, body }) => {
					methods.push(method);
					if (method === 'POST' && url === instancesUrl()) {
						expect(body.instance_id).toBe(id);
						expect(typeof body.params).toBe('string');
						const params = JSON.parse(body.params as string);
						expect(params).toEqual({
							simfileId: 42,
							sourceKey: '42/song.flac',
							sourceUploaded: SOURCE_UPLOADED,
							profile: BGM_TRANSCODE_PROFILE
						});
						expect(body.params).not.toContain('ETag');
						expect(params.expectedSourceEtag).toBeUndefined();
						expect(params.expectedSourceVersion).toBeUndefined();
						expect(body.instance_retention).toEqual({
							success_retention: '1 day',
							error_retention: '7 days'
						});
						return cfOk({ id, status: 'queued' });
					}
					if (method === 'GET' && url.startsWith(`${instancesUrl()}/${id}`)) {
						expect(url).toContain('simple=true');
						gets += 1;
						if (gets === 1) return cfOk({ status: 'running', output: null });
						return cfOk({ status: 'complete', output: '{"status":"ready"}' });
					}
					throw new Error(`${method} ${url}`);
				}),
				sleep
			)
		);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('mode: execute');
		expect(methods).toEqual(['POST', 'GET', 'GET']);
		expect(sleep).toHaveBeenCalledWith(10);
	});

	it.each(['queued', 'running', 'waiting', 'paused', 'waitingForPause', 'rollingBack'])(
		'polls a retained %s instance without restarting',
		async (status) => {
			const rows = sourceRow([{ key: '42/song.flac', uploaded: SOURCE_UPLOADED }]);
			const id = expectedId();
			let gets = 0;
			const methods: string[] = [];

			const result = await runBackfill(
				executeConfig(
					combineFetch(rows, ({ method, url }) => {
						methods.push(method);
						if (method === 'POST') return new Response(null, { status: 409 });
						if (method === 'GET' && url.startsWith(`${instancesUrl()}/${id}`)) {
							gets += 1;
							if (gets === 1) return cfOk({ status, output: null });
							return cfOk({ status: 'complete', output: { status: 'cached' } });
						}
						throw new Error(`${method} ${url}`);
					})
				)
			);

			expect(result.exitCode).toBe(0);
			expect(methods).toEqual(['POST', 'GET', 'GET']);
		}
	);

	it('treats an already-exists 400 (code 10405) create response as a duplicate', async () => {
		const rows = sourceRow([
			{ key: '42/song.flac', uploaded: SOURCE_UPLOADED },
			{ key: '42/bgm.m4a', uploaded: '2026-08-27T06:00:00.000Z' }
		]);
		const id = expectedId();
		const methods: string[] = [];

		const result = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method, url }) => {
					methods.push(method);
					if (method === 'POST')
						return jsonResponse(
							{
								success: false,
								errors: [
									{
										code: 10405,
										message: 'workflows.api.error.instance.already_exists'
									}
								],
								messages: [],
								result: null
							},
							400
						);
					if (method === 'GET')
						return cfOk({ status: 'complete', output: { status: 'cached' } });
					throw new Error(`${method} ${url}`);
				})
			)
		);

		expect(result.exitCode).toBe(0);
		expect(methods).toEqual(['POST', 'GET']);
	});

	it.each(['errored', 'terminated'])(
		'restarts a retained %s instance then polls the same ID',
		async (status) => {
			const rows = sourceRow([{ key: '42/song.flac', uploaded: SOURCE_UPLOADED }]);
			const id = expectedId();
			const methods: string[] = [];
			let gets = 0;

			const result = await runBackfill(
				executeConfig(
					combineFetch(rows, ({ method, url, body }) => {
						methods.push(method);
						if (method === 'POST') return cfFail('already exists', 409);
						if (method === 'PATCH') {
							expect(url).toBe(`${instancesUrl()}/${id}/status`);
							expect(body).toEqual({ status: 'restart' });
							return cfOk({ status: 'queued' });
						}
						if (method === 'GET') {
							gets += 1;
							if (gets === 1) return cfOk({ status, output: null });
							if (gets === 2) return cfOk({ status, output: null });
							if (gets === 3) return cfOk({ status: 'running', output: null });
							return cfOk({ status: 'complete', output: '{"status":"ready"}' });
						}
						throw new Error(`${method} ${url}`);
					})
				)
			);

			expect(result.exitCode).toBe(0);
			expect(methods).toEqual(['POST', 'GET', 'PATCH', 'GET', 'GET', 'GET']);
			expect(methods.filter((method) => method === 'POST')).toHaveLength(1);
		}
	);

	it('reuses retained complete ready/cached when the visible derivative is current', async () => {
		const rows = sourceRow([
			{ key: '42/MUSIC.M4A', uploaded: SOURCE_UPLOADED },
			{ key: '42/bgm.m4a', uploaded: NEWER_UPLOADED }
		]);
		const methods: string[] = [];

		const result = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method }) => {
					methods.push(method);
					if (method === 'POST') return new Response(null, { status: 409 });
					if (method === 'GET') {
						return cfOk({ status: 'complete', output: { status: 'cached' } });
					}
					throw new Error(method);
				})
			)
		);

		expect(result.exitCode).toBe(0);
		expect(methods).toEqual(['POST', 'GET']);
	});

	it.each([null, 'not-json', 1] as const)(
		'restarts a retained complete instance with unparseable output %j when the derivative is missing or older',
		async (output) => {
			const rows = sourceRow([
				{ key: '42/track.wav', uploaded: SOURCE_UPLOADED },
				{ key: '42/bgm.m4a', uploaded: OLDER_UPLOADED }
			]);
			const id = expectedId();
			const methods: string[] = [];
			let gets = 0;

			const result = await runBackfill(
				executeConfig(
					combineFetch(rows, ({ method, url, body }) => {
						methods.push(method);
						if (method === 'POST') return new Response(null, { status: 409 });
						if (method === 'PATCH') {
							expect(url).toBe(`${instancesUrl()}/${id}/status`);
							expect(body).toEqual({ status: 'restart' });
							return cfOk({ status: 'queued' });
						}
						if (method === 'GET') {
							gets += 1;
							if (gets === 1) {
								return cfOk({ status: 'complete', output });
							}
							if (gets === 2) return cfOk({ status: 'running', output: null });
							return cfOk({ status: 'complete', output: '{"status":"ready"}' });
						}
						throw new Error(`${method} ${url}`);
					})
				)
			);

			expect(result.exitCode).toBe(0);
			expect(methods).toEqual(['POST', 'GET', 'PATCH', 'GET', 'GET']);
		}
	);

	it('fails retained complete superseded output without restarting even when the derivative is missing or older', async () => {
		const rows = sourceRow([
			{ key: '42/track.wav', uploaded: SOURCE_UPLOADED },
			{ key: '42/bgm.m4a', uploaded: OLDER_UPLOADED }
		]);
		const methods: string[] = [];

		const result = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method }) => {
					methods.push(method);
					if (method === 'POST') return new Response(null, { status: 409 });
					if (method === 'GET') {
						return cfOk({ status: 'complete', output: { status: 'superseded' } });
					}
					throw new Error(method);
				})
			)
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toMatch(/superseded/);
		expect(methods).toEqual(['POST', 'GET']);
	});

	it('restarts a retained complete instance when the visible derivative is missing or older', async () => {
		const rows = sourceRow([
			{ key: '42/track.wav', uploaded: SOURCE_UPLOADED },
			{ key: '42/bgm.m4a', uploaded: OLDER_UPLOADED }
		]);
		const id = expectedId();
		const methods: string[] = [];
		let gets = 0;

		const result = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method, url, body }) => {
					methods.push(method);
					if (method === 'POST') return new Response(null, { status: 409 });
					if (method === 'PATCH') {
						expect(url).toBe(`${instancesUrl()}/${id}/status`);
						expect(body).toEqual({ status: 'restart' });
						return cfOk({ status: 'queued' });
					}
					if (method === 'GET') {
						gets += 1;
						if (gets === 1) {
							return cfOk({ status: 'complete', output: '{"status":"ready"}' });
						}
						if (gets === 2) return cfOk({ status: 'running', output: null });
						return cfOk({ status: 'complete', output: '{"status":"ready"}' });
					}
					throw new Error(`${method} ${url}`);
				})
			)
		);

		expect(result.exitCode).toBe(0);
		expect(methods).toEqual(['POST', 'GET', 'PATCH', 'GET', 'GET']);
	});

	it('does not treat a stale complete after repair PATCH as success', async () => {
		const rows = sourceRow([
			{ key: '42/track.wav', uploaded: SOURCE_UPLOADED },
			{ key: '42/bgm.m4a', uploaded: OLDER_UPLOADED }
		]);
		const id = expectedId();
		const sleep = vi.fn(async () => undefined);
		const methods: string[] = [];
		const statuses: string[] = [];
		let gets = 0;

		const result = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method, url, body }) => {
					methods.push(method);
					if (method === 'POST') return new Response(null, { status: 409 });
					if (method === 'PATCH') {
						expect(url).toBe(`${instancesUrl()}/${id}/status`);
						expect(body).toEqual({ status: 'restart' });
						return cfOk({ status: 'queued' });
					}
					if (method === 'GET') {
						gets += 1;
						if (gets === 1) {
							statuses.push('complete');
							return cfOk({ status: 'complete', output: '{"status":"ready"}' });
						}
						if (gets === 2) {
							statuses.push('complete');
							return cfOk({ status: 'complete', output: { status: 'cached' } });
						}
						if (gets === 3) {
							statuses.push('running');
							return cfOk({ status: 'running', output: null });
						}
						statuses.push('complete');
						return cfOk({ status: 'complete', output: '{"status":"ready"}' });
					}
					throw new Error(`${method} ${url}`);
				}),
				sleep
			)
		);

		expect(result.exitCode).toBe(0);
		expect(methods).toEqual(['POST', 'GET', 'PATCH', 'GET', 'GET', 'GET']);
		expect(statuses).toEqual(['complete', 'complete', 'running', 'complete']);
		expect(sleep).toHaveBeenCalled();
	});

	it('fails execute when a repaired complete instance never leaves complete', async () => {
		const rows = sourceRow([
			{ key: '42/track.wav', uploaded: SOURCE_UPLOADED },
			{ key: '42/bgm.m4a', uploaded: OLDER_UPLOADED }
		]);
		const sleep = vi.fn(async () => undefined);
		let gets = 0;
		let patches = 0;

		const result = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method, body }) => {
					if (method === 'POST') return new Response(null, { status: 409 });
					if (method === 'PATCH') {
						patches += 1;
						expect(body).toEqual({ status: 'restart' });
						return cfOk({ status: 'queued' });
					}
					if (method === 'GET') {
						gets += 1;
						return cfOk({ status: 'complete', output: '{"status":"ready"}' });
					}
					throw new Error(method);
				}),
				sleep
			)
		);

		expect(result.exitCode).toBe(1);
		expect(patches).toBe(1);
		expect(result.stderr).toMatch(/did not reach a terminal status/);
		expect(gets).toBeGreaterThan(2);
		expect(sleep).toHaveBeenCalled();
	});

	it('treats complete after failed-instance restart as the new successful run', async () => {
		const rows = sourceRow([{ key: '42/song.flac', uploaded: SOURCE_UPLOADED }]);
		const methods: string[] = [];
		let gets = 0;

		const result = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method, body }) => {
					methods.push(method);
					if (method === 'POST') return new Response(null, { status: 409 });
					if (method === 'PATCH') {
						expect(body).toEqual({ status: 'restart' });
						return cfOk({ status: 'queued' });
					}
					if (method === 'GET') {
						gets += 1;
						if (gets === 1) return cfOk({ status: 'errored', output: null });
						return cfOk({ status: 'complete', output: '{"status":"ready"}' });
					}
					throw new Error(method);
				})
			)
		);

		expect(result.exitCode).toBe(0);
		expect(methods).toEqual(['POST', 'GET', 'PATCH', 'GET']);
	});

	it('fails execute on superseded output without treating it as ready or cached', async () => {
		const rows = sourceRow([{ key: '42/song.flac', uploaded: SOURCE_UPLOADED }]);
		const methods: string[] = [];

		const result = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method }) => {
					methods.push(method);
					if (method === 'POST') return cfOk({ id: expectedId(), status: 'queued' });
					if (method === 'GET') {
						return cfOk({ status: 'complete', output: '{"status":"superseded"}' });
					}
					throw new Error(method);
				})
			)
		);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toMatch(/superseded/);
		expect(methods).toEqual(['POST', 'GET']);
	});

	it('exits nonzero when restart, create, or GET fails after repair', async () => {
		const rows = sourceRow([{ key: '42/song.flac', uploaded: SOURCE_UPLOADED }]);

		const createFail = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method }) => {
					if (method === 'POST') return cfFail('boom', 500);
					throw new Error(method);
				})
			)
		);
		expect(createFail.exitCode).toBe(1);

		const restartFail = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method }) => {
					if (method === 'POST') return new Response(null, { status: 409 });
					if (method === 'GET') return cfOk({ status: 'errored', output: null });
					if (method === 'PATCH') return cfFail('cannot restart', 500);
					throw new Error(method);
				})
			)
		);
		expect(restartFail.exitCode).toBe(1);
		expect(restartFail.stderr).toMatch(/restart/i);

		let gets = 0;
		const getFail = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method }) => {
					if (method === 'POST') return new Response(null, { status: 409 });
					if (method === 'PATCH') return cfOk({ status: 'queued' });
					if (method === 'GET') {
						gets += 1;
						if (gets === 1) return cfOk({ status: 'terminated', output: null });
						return cfFail('gone', 500);
					}
					throw new Error(method);
				})
			)
		);
		expect(getFail.exitCode).toBe(1);
	});

	it('reconciles every selected authored source sequentially and waits for terminal before the next', async () => {
		const rows: CatalogSimfile[] = [
			{ id: '10', files: [{ key: '10/song.flac', uploaded: SOURCE_UPLOADED }] },
			{ id: '11', files: [{ key: '11/track.wav', uploaded: SOURCE_UPLOADED }] }
		];
		const firstId = buildBgmWorkflowInstanceId(10, SOURCE_UPLOADED);
		const secondId = buildBgmWorkflowInstanceId(11, SOURCE_UPLOADED);
		const events: string[] = [];
		const firstGets = { count: 0 };

		const result = await runBackfill(
			executeConfig(
				combineFetch(rows, ({ method, url, body }) => {
					if (method === 'POST') {
						events.push('POST');
						if (events.filter((event) => event === 'POST').length === 1) {
							expect(body.instance_id).toBe(firstId);
							expect(events).not.toContain(`GET:${secondId}`);
							return cfOk({ id: firstId, status: 'queued' });
						}
						expect(body.instance_id).toBe(secondId);
						expect(events).toContain(`GET:${firstId}:complete`);
						return cfOk({ id: secondId, status: 'queued' });
					}
					if (method === 'GET' && url.includes(firstId)) {
						firstGets.count += 1;
						if (firstGets.count === 1) {
							events.push(`GET:${firstId}:running`);
							return cfOk({ status: 'running', output: null });
						}
						events.push(`GET:${firstId}:complete`);
						return cfOk({ status: 'complete', output: '{"status":"ready"}' });
					}
					if (method === 'GET' && url.includes(secondId)) {
						events.push(`GET:${secondId}`);
						return cfOk({ status: 'complete', output: '{"status":"cached"}' });
					}
					throw new Error(`${method} ${url}`);
				})
			)
		);

		expect(result.exitCode).toBe(0);
		expect(events.filter((event) => event === 'POST')).toHaveLength(2);
		const firstCompleteAt = events.indexOf(`GET:${firstId}:complete`);
		const secondPostAt = events.lastIndexOf('POST');
		expect(firstCompleteAt).toBeGreaterThan(-1);
		expect(secondPostAt).toBeGreaterThan(firstCompleteAt);
	});

	it('caps polling with the injected sleeper instead of wall-clock delays', async () => {
		const rows = sourceRow([{ key: '42/song.flac', uploaded: SOURCE_UPLOADED }]);
		const sleep = vi.fn(async () => undefined);
		let gets = 0;

		const result = await runBackfill({
			...executeConfig(
				combineFetch(rows, ({ method }) => {
					if (method === 'POST') return cfOk({ id: expectedId(), status: 'queued' });
					if (method === 'GET') {
						gets += 1;
						return cfOk({ status: 'running', output: null });
					}
					throw new Error(method);
				}),
				sleep
			),
			maxPollAttempts: 3
		});

		expect(result.exitCode).toBe(1);
		expect(gets).toBe(3);
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledWith(10);
	});

	it('does not create Workflow instances for nested-only or canonical-only rows', async () => {
		const rows: CatalogSimfile[] = [
			{ id: '5', files: [{ key: '5/assets/kick.ogg', uploaded: SOURCE_UPLOADED }] },
			{ id: '6', files: [{ key: '6/bgm.m4a', uploaded: SOURCE_UPLOADED }] }
		];
		const rest = vi.fn();
		const result = await runBackfill(
			executeConfig(async (input, init) => {
				const url = String(input);
				if (url.startsWith(GRAPHQL_URL)) {
					return graphqlFetch([{ count: 2, data: rows }])(input, init);
				}
				rest();
				throw new Error(`unexpected REST ${url}`);
			})
		);

		expect(result.exitCode).toBe(0);
		expect(rest).not.toHaveBeenCalled();
		expect(result.stdout).toContain('selected authored sources: 0');
	});
});

describe('withFetchTimeout', () => {
	it('aborts a stalled request instead of wedging the run', async () => {
		const hungFetch: FetchLike = () => new Promise(() => {});

		await expect(withFetchTimeout(hungFetch, 10)('https://example.test')).rejects.toThrow();
	});
});

describe('polling horizon', () => {
	it('defaults to a horizon longer than the Workflow retry worst-case window', () => {
		// Pins the relationship between the operator polling horizon and the
		// Workflow transcode retry contract so --execute cannot give up while
		// Cloudflare is still running a legitimate retrying instance. Both
		// values derive from the shared constants in services/bgmM4a.ts.
		expect(DEFAULT_MAX_POLL_ATTEMPTS * DEFAULT_POLL_DELAY_MS).toBeGreaterThan(
			BGM_TRANSCODE_WORST_CASE_MS
		);
	});
});

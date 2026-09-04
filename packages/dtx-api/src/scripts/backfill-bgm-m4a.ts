import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	FULL_TRACK_AUDIO_EXTENSIONS,
	r2FileName,
	selectTopLevelFullTrackObject
} from '../lib/r2Files';
import {
	BGM_TRANSCODE_PROFILE,
	BGM_TRANSCODE_WORST_CASE_MS,
	buildBgmWorkflowInstanceId,
	isCanonicalBgmDerivativeKey
} from '../services/bgmM4a';

export type CatalogFile = { key: string; uploaded: string };
export type CatalogSimfile = { id: string | number; files?: CatalogFile[] | null };
export type BackfillMode = 'dry-run' | 'execute' | 'check';
export type WorkflowRunOutcome = 'ready' | 'cached' | 'superseded';

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SelectedSource = {
	simfileId: number;
	source: CatalogFile;
	missingOrOlder: boolean;
};

export type CatalogAudit = {
	publishedTotal: number;
	audioBearingRows: number;
	selectedAuthoredSources: number;
	canonicalBgmM4aRows: number;
	selectedSourcesMissingOrOlder: number;
	filenameHistogram: Record<string, number>;
	selected: SelectedSource[];
};

export type BackfillConfig = {
	mode: BackfillMode;
	graphqlUrl: string;
	cloudflareAccountId?: string;
	cloudflareApiToken?: string;
	workflowName: string;
	fetch: FetchLike;
	sleep: (ms: number) => Promise<void>;
	pollDelayMs: number;
	maxPollAttempts: number;
	graphqlPageSize: number;
};

export type BackfillResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type BackfillIo = {
	fetch?: FetchLike;
	sleep?: (ms: number) => Promise<void>;
	pollDelayMs?: number;
	maxPollAttempts?: number;
	graphqlPageSize?: number;
};

type InstanceSnapshot = {
	status: string;
	output: unknown;
};

// Production Workflow name. Pre-prod `--execute` must set
// BGM_WORKFLOW_NAME=dtx-api-bgm-m4a-preprod
const DEFAULT_WORKFLOW_NAME = 'dtx-api-bgm-m4a';
export const DEFAULT_POLL_DELAY_MS = 2000;
// Polling horizon must exceed the Workflow's worst-case retry window
// (BGM_TRANSCODE_WORST_CASE_MS) so --execute never reports failure while
// Cloudflare is still running a legitimate retrying instance. Derived from the
// shared retry contract plus a safety margin, divided by the poll interval.
// Pinned by the "polling horizon" test in backfill-bgm-m4a.test.ts.
const BGM_BACKFILL_POLL_SAFETY_MARGIN_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_POLL_ATTEMPTS = Math.ceil(
	(BGM_TRANSCODE_WORST_CASE_MS + BGM_BACKFILL_POLL_SAFETY_MARGIN_MS) / DEFAULT_POLL_DELAY_MS
);
const DEFAULT_GRAPHQL_PAGE_SIZE = 100;
const IN_PROGRESS_STATUSES = new Set([
	'queued',
	'running',
	'paused',
	'waitingForPause',
	'waiting',
	'rollingBack'
]);
const TERMINAL_STATUSES = new Set(['complete', 'errored', 'terminated']);
const FAILED_STATUSES = new Set(['errored', 'terminated']);
const COMPLETE_STATUSES = new Set(['complete']);

export const PUBLISHED_SIMFILES_QUERY = `query PublishedSimfiles($page: Int!, $pageSize: Int!) {
  simfiles(scope: PUBLISHED, page: $page, pageSize: $pageSize) {
    count
    data { id files { key uploaded } }
  }
}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

const isAudioKey = (key: string): boolean => {
	const lowerKey = key.toLowerCase();
	return FULL_TRACK_AUDIO_EXTENSIONS.some((extension) => lowerKey.endsWith(extension));
};

const catalogFiles = (row: CatalogSimfile): CatalogFile[] =>
	(row.files ?? []).filter(
		(file): file is CatalogFile =>
			!!file && typeof file.key === 'string' && typeof file.uploaded === 'string'
	);

const isMissingOrOlder = (source: CatalogFile, derivative: CatalogFile | undefined): boolean => {
	if (!derivative) return true;
	const sourceUploaded = Date.parse(source.uploaded);
	const derivativeUploaded = Date.parse(derivative.uploaded);
	if (Number.isNaN(sourceUploaded) || Number.isNaN(derivativeUploaded)) return true;
	return derivativeUploaded < sourceUploaded;
};

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const parseWorkflowRunOutput = (output: unknown): WorkflowRunOutcome | null => {
	let value: unknown = output;
	if (typeof output === 'string') {
		try {
			value = JSON.parse(output);
		} catch {
			return null;
		}
	}
	if (!isRecord(value)) return null;
	const status = value.status;
	if (status === 'ready' || status === 'cached' || status === 'superseded') return status;
	return null;
};

export const auditCatalog = (rows: readonly CatalogSimfile[]): CatalogAudit => {
	const filenameHistogram: Record<string, number> = {};
	const selected: SelectedSource[] = [];
	let audioBearingRows = 0;
	let canonicalBgmM4aRows = 0;

	for (const row of rows) {
		const simfileId = Number(row.id);
		const files = catalogFiles(row);
		if (files.some((file) => isAudioKey(file.key))) audioBearingRows += 1;
		if (
			Number.isFinite(simfileId) &&
			files.some((file) => isCanonicalBgmDerivativeKey(file.key, simfileId))
		) {
			canonicalBgmM4aRows += 1;
		}
		if (!Number.isFinite(simfileId)) continue;

		const prefix = `${simfileId}/`;
		const excludeCanonical = (object: CatalogFile): boolean =>
			isCanonicalBgmDerivativeKey(object.key, simfileId);

		for (const file of files) {
			if (!selectTopLevelFullTrackObject([file], prefix, excludeCanonical)) continue;
			const basename = r2FileName(file.key);
			filenameHistogram[basename] = (filenameHistogram[basename] ?? 0) + 1;
		}

		const source = selectTopLevelFullTrackObject(files, prefix, excludeCanonical);
		if (!source) continue;
		const derivative = files.find((file) => isCanonicalBgmDerivativeKey(file.key, simfileId));
		selected.push({
			simfileId,
			source,
			missingOrOlder: isMissingOrOlder(source, derivative)
		});
	}

	return {
		publishedTotal: rows.length,
		audioBearingRows,
		selectedAuthoredSources: selected.length,
		canonicalBgmM4aRows,
		selectedSourcesMissingOrOlder: selected.filter((row) => row.missingOrOlder).length,
		filenameHistogram,
		selected
	};
};

const formatHistogram = (histogram: Record<string, number>): string =>
	Object.entries(histogram)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, count]) => `${name}: ${count}`)
		.join(', ');

export const formatAuditReport = (audit: CatalogAudit, mode: BackfillMode): string => {
	const histogram = formatHistogram(audit.filenameHistogram);
	return [
		`published total: ${audit.publishedTotal}`,
		`audio-bearing rows: ${audit.audioBearingRows}`,
		`selected authored sources: ${audit.selectedAuthoredSources}`,
		`canonical bgm.m4a rows: ${audit.canonicalBgmM4aRows}`,
		`selected sources missing/older bgm.m4a: ${audit.selectedSourcesMissingOrOlder}`,
		`filename histogram:${histogram ? ` ${histogram}` : ''}`,
		`mode: ${mode}`
	].join('\n');
};

const parseArgs = (args: string[]): BackfillMode => {
	let mode: BackfillMode = 'dry-run';
	for (const arg of args) {
		if (arg === '--execute') {
			if (mode === 'check') {
				throw new Error('--execute and --check are mutually exclusive');
			}
			mode = 'execute';
			continue;
		}
		if (arg === '--check') {
			if (mode === 'execute') {
				throw new Error('--execute and --check are mutually exclusive');
			}
			mode = 'check';
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return mode;
};

const readJson = async (response: Response): Promise<unknown> => {
	const text = await response.text();
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
};

const fetchPublishedCatalog = async (config: BackfillConfig): Promise<CatalogSimfile[]> => {
	const rows: CatalogSimfile[] = [];
	let page = 1;
	let total = Number.POSITIVE_INFINITY;

	while (page < 10_000) {
		const response = await config.fetch(config.graphqlUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query: PUBLISHED_SIMFILES_QUERY,
				variables: { page, pageSize: config.graphqlPageSize }
			})
		});
		const payload = await readJson(response);
		if (!response.ok || !isRecord(payload)) {
			throw new Error(`GraphQL catalog request failed (${response.status})`);
		}
		const errors = payload.errors;
		if (Array.isArray(errors) && errors.length > 0) {
			const first = errors[0];
			throw new Error(
				isRecord(first) && typeof first.message === 'string'
					? first.message
					: 'GraphQL catalog request failed'
			);
		}
		const connection = isRecord(payload.data) ? payload.data.simfiles : undefined;
		if (!isRecord(connection) || !Array.isArray(connection.data)) {
			throw new Error('GraphQL catalog missing simfiles');
		}
		if (typeof connection.count === 'number' && Number.isFinite(connection.count)) {
			total = connection.count;
		}
		const pageRows = connection.data as CatalogSimfile[];
		rows.push(...pageRows);
		if (
			pageRows.length === 0 ||
			pageRows.length < config.graphqlPageSize ||
			rows.length >= total
		) {
			break;
		}
		page += 1;
	}

	return rows;
};

const workflowInstancesUrl = (config: BackfillConfig): string =>
	`https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/workflows/${config.workflowName}/instances`;

const cloudflareHeaders = (apiToken: string): HeadersInit => ({
	Authorization: `Bearer ${apiToken}`,
	'Content-Type': 'application/json'
});

const isDuplicateCreate = (httpStatus: number): boolean => httpStatus === 409;

const createErrorMessage = (body: unknown): string => {
	if (!isRecord(body) || !Array.isArray(body.errors)) return '';
	const first = body.errors[0];
	return isRecord(first) && typeof first.message === 'string' ? first.message : '';
};

const createInstance = async (
	config: BackfillConfig,
	instanceId: string,
	selected: SelectedSource
): Promise<'created' | 'duplicate'> => {
	const response = await config.fetch(workflowInstancesUrl(config), {
		method: 'POST',
		headers: cloudflareHeaders(config.cloudflareApiToken!),
		body: JSON.stringify({
			instance_id: instanceId,
			params: JSON.stringify({
				simfileId: selected.simfileId,
				sourceKey: selected.source.key,
				sourceUploaded: selected.source.uploaded,
				profile: BGM_TRANSCODE_PROFILE
			}),
			instance_retention: {
				success_retention: '1 day',
				error_retention: '7 days'
			}
		})
	});
	const body = await readJson(response);
	if (isDuplicateCreate(response.status)) return 'duplicate';
	if (!response.ok || (isRecord(body) && body.success === false)) {
		const detail = createErrorMessage(body);
		throw new Error(
			`Create Workflow instance ${instanceId} failed${detail ? `: ${detail}` : ''}`
		);
	}
	return 'created';
};

const getInstance = async (
	config: BackfillConfig,
	instanceId: string
): Promise<InstanceSnapshot> => {
	const response = await config.fetch(
		`${workflowInstancesUrl(config)}/${encodeURIComponent(instanceId)}?simple=true`,
		{
			method: 'GET',
			headers: cloudflareHeaders(config.cloudflareApiToken!)
		}
	);
	const body = await readJson(response);
	if (!response.ok || !isRecord(body) || body.success === false) {
		throw new Error(`GET Workflow instance ${instanceId} failed`);
	}
	const result = body.result;
	if (!isRecord(result) || typeof result.status !== 'string') {
		throw new Error(`GET Workflow instance ${instanceId} failed`);
	}
	return { status: result.status, output: result.output };
};

const restartInstance = async (config: BackfillConfig, instanceId: string): Promise<void> => {
	const response = await config.fetch(
		`${workflowInstancesUrl(config)}/${encodeURIComponent(instanceId)}/status`,
		{
			method: 'PATCH',
			headers: cloudflareHeaders(config.cloudflareApiToken!),
			body: JSON.stringify({ status: 'restart' })
		}
	);
	const body = await readJson(response);
	if (!response.ok || (isRecord(body) && body.success === false)) {
		throw new Error(`Failed to restart Workflow instance ${instanceId}`);
	}
};

const isTerminalStatus = (status: string): boolean => TERMINAL_STATUSES.has(status);

const waitForTerminalFrom = async (
	config: BackfillConfig,
	instanceId: string,
	snapshot: InstanceSnapshot,
	ignoreWhile?: Set<string>
): Promise<InstanceSnapshot> => {
	let ignore = ignoreWhile;
	for (let attempt = 0; attempt < config.maxPollAttempts; attempt += 1) {
		if (IN_PROGRESS_STATUSES.has(snapshot.status)) ignore = undefined;
		const ignored = ignore?.has(snapshot.status) === true;
		if (!ignored && isTerminalStatus(snapshot.status)) return snapshot;
		if (attempt === config.maxPollAttempts - 1) {
			throw new Error(`Workflow instance ${instanceId} did not reach a terminal status`);
		}
		await config.sleep(config.pollDelayMs);
		snapshot = await getInstance(config, instanceId);
	}
	throw new Error(`Workflow instance ${instanceId} did not reach a terminal status`);
};

const requireReadyOrCached = (
	snapshot: InstanceSnapshot,
	simfileId: number
): WorkflowRunOutcome => {
	if (snapshot.status !== 'complete') {
		throw new Error(`simfile ${simfileId}: Workflow ended ${snapshot.status}`);
	}
	const outcome = parseWorkflowRunOutput(snapshot.output);
	if (outcome === 'superseded') {
		throw new Error(
			`simfile ${simfileId}: Workflow output superseded; rerun after fresh catalog`
		);
	}
	if (outcome !== 'ready' && outcome !== 'cached') {
		throw new Error(`simfile ${simfileId}: unexpected Workflow output`);
	}
	return outcome;
};

const reconcileSelected = async (
	config: BackfillConfig,
	selected: SelectedSource
): Promise<void> => {
	const instanceId = buildBgmWorkflowInstanceId(selected.simfileId, selected.source.uploaded);
	const created = await createInstance(config, instanceId, selected);
	if (created === 'created') {
		const terminal = await waitForTerminalFrom(
			config,
			instanceId,
			await getInstance(config, instanceId)
		);
		requireReadyOrCached(terminal, selected.simfileId);
		return;
	}

	const snapshot = await getInstance(config, instanceId);
	if (IN_PROGRESS_STATUSES.has(snapshot.status)) {
		const terminal = await waitForTerminalFrom(config, instanceId, snapshot);
		requireReadyOrCached(terminal, selected.simfileId);
		return;
	}
	if (FAILED_STATUSES.has(snapshot.status)) {
		await restartInstance(config, instanceId);
		const terminal = await waitForTerminalFrom(
			config,
			instanceId,
			await getInstance(config, instanceId),
			FAILED_STATUSES
		);
		requireReadyOrCached(terminal, selected.simfileId);
		return;
	}
	if (snapshot.status === 'complete') {
		const outcome = parseWorkflowRunOutput(snapshot.output);
		if (outcome === 'superseded') {
			throw new Error(
				`simfile ${selected.simfileId}: Workflow output superseded; rerun after fresh catalog`
			);
		}
		if (!selected.missingOrOlder) {
			if (outcome === 'ready' || outcome === 'cached') {
				return;
			}
			throw new Error(`simfile ${selected.simfileId}: unexpected Workflow output`);
		}
		await restartInstance(config, instanceId);
		const terminal = await waitForTerminalFrom(
			config,
			instanceId,
			await getInstance(config, instanceId),
			COMPLETE_STATUSES
		);
		requireReadyOrCached(terminal, selected.simfileId);
		return;
	}
	throw new Error(`simfile ${selected.simfileId}: unexpected Workflow status ${snapshot.status}`);
};

export const runBackfill = async (config: BackfillConfig): Promise<BackfillResult> => {
	try {
		const rows = await fetchPublishedCatalog(config);
		const audit = auditCatalog(rows);
		const stdout = formatAuditReport(audit, config.mode);

		if (config.mode === 'check') {
			return {
				exitCode: audit.selectedSourcesMissingOrOlder === 0 ? 0 : 1,
				stdout,
				stderr: ''
			};
		}
		if (config.mode !== 'execute') {
			return { exitCode: 0, stdout, stderr: '' };
		}
		if (audit.selected.length === 0) {
			return { exitCode: 0, stdout, stderr: '' };
		}
		if (!config.cloudflareAccountId || !config.cloudflareApiToken) {
			return {
				exitCode: 1,
				stdout,
				stderr: 'CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for --execute'
			};
		}

		const errors: string[] = [];
		for (const selected of audit.selected) {
			try {
				await reconcileSelected(config, selected);
			} catch (error) {
				errors.push(errorMessage(error));
			}
		}
		return {
			exitCode: errors.length === 0 ? 0 : 1,
			stdout,
			stderr: errors.join('\n')
		};
	} catch (error) {
		return { exitCode: 1, stdout: '', stderr: errorMessage(error) };
	}
};

export const runCli = async (
	args: string[],
	env: Record<string, string | undefined> = process.env,
	io: BackfillIo = {}
): Promise<BackfillResult> => {
	try {
		const mode = parseArgs(args);
		const graphqlUrl = env.DTX_GRAPHQL_URL;
		if (!graphqlUrl) {
			return { exitCode: 1, stdout: '', stderr: 'DTX_GRAPHQL_URL is required' };
		}
		return runBackfill({
			mode,
			graphqlUrl,
			cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID,
			cloudflareApiToken: env.CLOUDFLARE_API_TOKEN,
			workflowName: env.BGM_WORKFLOW_NAME || DEFAULT_WORKFLOW_NAME,
			fetch: io.fetch ?? fetch,
			sleep: io.sleep ?? defaultSleep,
			pollDelayMs: io.pollDelayMs ?? DEFAULT_POLL_DELAY_MS,
			maxPollAttempts: io.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS,
			graphqlPageSize: io.graphqlPageSize ?? DEFAULT_GRAPHQL_PAGE_SIZE
		});
	} catch (error) {
		return { exitCode: 1, stdout: '', stderr: errorMessage(error) };
	}
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const result = await runCli(process.argv.slice(2));
	if (result.stdout) console.log(result.stdout);
	if (result.stderr) console.error(result.stderr);
	process.exit(result.exitCode);
}

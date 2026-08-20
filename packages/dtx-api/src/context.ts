import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types';
import {
	workerLogger,
	type WorkerLogger,
	type ChartScoreRow,
	type ScoreRow
} from '@dtx/common/server';
import { resolveAuthSession, type ApiAuthSession, type ApiAuthUser } from './auth/session';
import type { Env } from './env';
import type { CatalogFileDiscovery, R2FileEntry } from './services/r2Enrichment';

export type OwnerCacheEntry = {
	userId: string | null;
	isPublished: boolean;
};

export type Ctx = {
	user: ApiAuthUser | null;
	session: ApiAuthSession['session'] | null;
	env: Env;
	db: D1Database;
	r2: R2Bucket;
	kv: KVNamespace;
	request: Request;
	logger: WorkerLogger;
	ownerByIdCache: Map<string, OwnerCacheEntry | null>;
	hasUploadedFilesCache: Map<number, Promise<boolean>>;
	filesCache: Map<number, Promise<R2FileEntry[]>>;
	catalogFilesCache?: Map<number, Promise<CatalogFileDiscovery>>;
	chartScoresCache?: Map<
		number,
		Promise<{ chartScore: ChartScoreRow; scores: ScoreRow[] } | null>
	>;
};

export const createContext = async (request: Request, env: Env): Promise<Ctx> => {
	const auth = await resolveAuthSession(request, env);
	return {
		user: auth?.user ?? null,
		session: auth?.session ?? null,
		env,
		db: env.DB,
		r2: env.DTXFILE_BUCKET,
		kv: env.RATE_LIMIT_API,
		request,
		logger: workerLogger,
		ownerByIdCache: new Map(),
		hasUploadedFilesCache: new Map(),
		filesCache: new Map(),
		catalogFilesCache: new Map(),
		chartScoresCache: new Map()
	};
};

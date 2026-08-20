import { createAuth } from './auth';
import type { Env } from '../env';

export type ApiAuthUser = {
	id: string;
};

export type ApiAuthSession = {
	user: ApiAuthUser;
	session: {
		id: string;
		userId: string;
		expiresAt: Date;
		[key: string]: unknown;
	};
};

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const resolveAuthSession = async (
	request: Request,
	env: Env
): Promise<ApiAuthSession | null> => {
	const trustedWebOrigin = new URL(env.DTX_WEB_URL).origin;
	const authorization = request.headers.get('authorization');
	const hasBearer =
		authorization !== null &&
		authorization.slice(0, 7).toLowerCase() === 'bearer ' &&
		authorization.slice(7).trim().length > 0;
	const hasCookie = request.headers.has('cookie');

	if (
		!hasBearer &&
		hasCookie &&
		UNSAFE_METHODS.has(request.method) &&
		request.headers.get('origin') !== trustedWebOrigin
	) {
		return null;
	}

	let authHeaders = request.headers;
	if (hasBearer && hasCookie) {
		// An invalid Bearer token must not fall back to a valid browser cookie.
		authHeaders = new Headers(request.headers);
		authHeaders.delete('cookie');
	}

	let authSession: Awaited<ReturnType<ReturnType<typeof createAuth>['api']['getSession']>>;
	try {
		authSession = await createAuth(env).api.getSession({ headers: authHeaders });
	} catch {
		return null;
	}

	if (!authSession) return null;

	return {
		user: { id: authSession.user.id },
		session: { ...authSession.session }
	};
};

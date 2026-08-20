import type { Fetcher } from '@cloudflare/workers-types';

import { PUBLIC_DTX_API_URL } from '$env/static/public';

export type AuthUser = {
	id: string;
	[key: string]: unknown;
};

export type AuthSession = {
	id: string;
	userId: string;
	expiresAt: string | Date;
	[key: string]: unknown;
};

export type AuthSessionResult = {
	session: AuthSession | null;
	user: AuthUser | null;
	setCookies: string[];
};

export type AuthSessionEvent = {
	request: Request;
	url: URL;
	platform?: App.Platform;
	fetch?: typeof fetch;
};

type MultiCookieHeaders = Headers & {
	getSetCookie?: () => string[];
};

const getSetCookies = (headers: Headers): string[] =>
	(headers as MultiCookieHeaders).getSetCookie?.() ?? [];

const isLoopbackApiUrl = (value: string): boolean => {
	try {
		const hostname = new URL(value).hostname;
		return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
	} catch {
		return false;
	}
};

const buildSessionRequest = (event: AuthSessionEvent, url: string): Request => {
	const headers = new Headers();
	const cookie = event.request.headers.get('cookie');
	if (cookie) headers.set('cookie', cookie);
	return new Request(url, { method: 'GET', headers });
};

const fetchSessionResponse = async (event: AuthSessionEvent): Promise<Response> => {
	const api = isLoopbackApiUrl(PUBLIC_DTX_API_URL) ? undefined : event.platform?.env?.API;
	if (api) {
		const url = new URL('/api/auth/get-session', event.url).toString();
		return (await api.fetch(
			buildSessionRequest(event, url) as unknown as Parameters<Fetcher['fetch']>[0]
		)) as unknown as Response;
	}

	const apiBase = PUBLIC_DTX_API_URL.replace(/\/$/, '');
	const url = `${apiBase}/api/auth/get-session`;
	const requestFetch = event.fetch ?? fetch;
	return requestFetch(url, {
		method: 'GET',
		headers: buildSessionRequest(event, url).headers
	});
};

const readSession = (value: unknown): { session: AuthSession; user: AuthUser } | null => {
	if (!value || typeof value !== 'object') return null;
	const payload = value as { session?: unknown; user?: unknown };
	if (!payload.session || typeof payload.session !== 'object') return null;
	if (!payload.user || typeof payload.user !== 'object') return null;
	const session = payload.session as Partial<AuthSession>;
	const user = payload.user as Partial<AuthUser>;
	if (typeof session.id !== 'string' || typeof user.id !== 'string') return null;
	return { session: session as AuthSession, user: user as AuthUser };
};

export const fetchAuthSession = async (event: AuthSessionEvent): Promise<AuthSessionResult> => {
	let response: Response;
	try {
		response = await fetchSessionResponse(event);
	} catch {
		return { session: null, user: null, setCookies: [] };
	}

	const setCookies = getSetCookies(response.headers);
	if (!response.ok) return { session: null, user: null, setCookies };

	try {
		const parsed = readSession(await response.json());
		return parsed ? { ...parsed, setCookies } : { session: null, user: null, setCookies };
	} catch {
		return { session: null, user: null, setCookies };
	}
};

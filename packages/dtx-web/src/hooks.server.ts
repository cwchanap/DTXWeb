import { json, text, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';

import { safeAppRedirectPath } from '$lib/auth/google';
import { fetchAuthSession } from '$lib/auth/session';

const isFormContentType = (request: Request): boolean => {
	const contentType = request.headers.get('content-type');
	return (
		(contentType?.includes('application/x-www-form-urlencoded') ||
			contentType?.includes('multipart/form-data')) ??
		false
	);
};

export const csrf: Handle = async ({ event, resolve }) => {
	const { request, url } = event;
	const requestOrigin = request.headers.get('origin');
	const isSameOrigin = requestOrigin === url.origin;

	const forbidden =
		isFormContentType(request) &&
		['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
		!isSameOrigin;

	if (forbidden) {
		const message = `Cross-site ${request.method} form submissions are forbidden`;
		if (request.headers.get('accept') === 'application/json') {
			return json({ message }, { status: 403 });
		}
		return text(message, { status: 403 });
	}

	return resolve(event);
};

export const authSession: Handle = async ({ event, resolve }) => {
	const { session, user, setCookies } = await fetchAuthSession(event);
	event.locals.session = session;
	event.locals.user = user;

	const response = await resolve(event);
	for (const setCookie of setCookies) response.headers.append('set-cookie', setCookie);
	return response;
};

export const authGuard: Handle = async ({ event, resolve }) => {
	const session = event.locals.session;

	if (!session && event.url.pathname.startsWith('/app')) {
		const next = safeAppRedirectPath(`${event.url.pathname}${event.url.search}`);
		return new Response(null, {
			status: 303,
			headers: { location: `/login?next=${encodeURIComponent(next)}` }
		});
	}

	if (session && event.url.pathname === '/login') {
		return new Response(null, { status: 303, headers: { location: '/app' } });
	}

	return resolve(event);
};

export const handle: Handle = sequence(csrf, authSession, authGuard);

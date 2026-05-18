import { createClient, type Session, type User } from '@supabase/supabase-js';
import type { Env } from '../env';

const decodeJwtPayload = (token: string): { exp?: number } | null => {
	try {
		const base64Url = token.split('.')[1];
		if (!base64Url) return null;
		let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
		while (base64.length % 4 !== 0) base64 += '=';
		return JSON.parse(atob(base64));
	} catch {
		return null;
	}
};

export const verifyToken = async (
	request: Request,
	env: Env
): Promise<{ user: User; session: Session } | null> => {
	const authHeader = request.headers.get('Authorization') ?? request.headers.get('authorization');
	if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
		return null;
	}
	const token = authHeader.slice(7).trim();
	if (!token) return null;

	const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
	});

	const { data, error } = await supabase.auth.getUser(token);
	if (error || !data.user) return null;

	const payload = decodeJwtPayload(token);
	if (!payload) return null;

	const nowSeconds = Math.floor(Date.now() / 1000);
	const expiresIn = Math.max(0, payload.exp ? payload.exp - nowSeconds : 3600);
	const expiresAt = nowSeconds + expiresIn;

	const session: Session = {
		access_token: token,
		refresh_token: '',
		expires_in: expiresIn,
		expires_at: expiresAt,
		token_type: 'bearer',
		user: data.user
	};

	return { user: data.user, session };
};

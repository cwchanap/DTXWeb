import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BrowserWindow } from 'electron';

// Initialize Supabase client for main process
let supabaseClient: SupabaseClient | null = null;
let currentSession: any = null;

export function initializeSupabase() {
	// Get environment variables from import.meta.env (main process)
	const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL;
	const SUPABASE_ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

	if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
		console.error('Missing Supabase environment variables in main process');
		return null;
	}

	supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
	return supabaseClient;
}

// Function to verify magic link in main process
export async function verifyMagicLink(magicLinkUrl: string) {
	try {
		if (!supabaseClient) {
			supabaseClient = initializeSupabase();
			if (!supabaseClient) {
				throw new Error('Failed to initialize Supabase client');
			}
		}

		// Extract the token from the magic link URL
		const url = new URL(magicLinkUrl);
		const token = url.searchParams.get('token');
		const tokenHash = url.searchParams.get('token_hash');

		if (!token && !tokenHash) {
			throw new Error('No token found in magic link');
		}

		// Use token_hash if available, otherwise use token
		const authToken = tokenHash || token;
		if (!authToken) {
			throw new Error('Invalid token in magic link');
		}

		console.log('Verifying magic link token in main process...');

		// Verify the OTP token with Supabase
		const { data, error } = await supabaseClient.auth.verifyOtp({
			token_hash: authToken,
			type: 'magiclink'
		});

		if (error) {
			console.error('Failed to verify magic link token:', error);
			throw error;
		}

		if (!data.session) {
			throw new Error('No session created from magic link');
		}

		console.log('Magic link authentication successful in main process');

		// Store session in main process
		currentSession = data.session;

		return {
			success: true,
			session: data.session,
			user: data.user
		};
	} catch (error) {
		console.error('Failed to authenticate with magic link in main process:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Unknown error'
		};
	}
}

export async function ensureSupabaseAuth(): Promise<boolean> {
	if (!supabaseClient) {
		supabaseClient = initializeSupabase();
		if (!supabaseClient) {
			return false;
		}
	}

	if (!currentSession) {
		return false;
	}

	return true;
}

export async function validateSession(sessionData: any): Promise<boolean> {
	try {
		if (!supabaseClient) {
			supabaseClient = initializeSupabase();
			if (!supabaseClient) {
				return false;
			}
		}

		// Set the session and check if it's valid
		const { error } = await supabaseClient.auth.setSession({
			access_token: sessionData.accessToken,
			refresh_token: sessionData.refreshToken
		});

		if (error) {
			console.error('Session validation failed:', error);
			return false;
		}

		// Get current session to verify it's still valid
		const {
			data: { session },
			error: sessionError
		} = await supabaseClient.auth.getSession();

		if (sessionError || !session) {
			console.error('Session is invalid:', sessionError);
			return false;
		}

		// Update stored session
		currentSession = session;
		return true;
	} catch (error) {
		console.error('Failed to validate session:', error);
		return false;
	}
}

export function getCurrentSession() {
	return currentSession;
}

export async function logoutSession(): Promise<boolean> {
	try {
		if (supabaseClient && currentSession) {
			await supabaseClient.auth.signOut();
		}
		currentSession = null;
		console.log('Session logged out in main process');
		return true;
	} catch (error) {
		console.error('Failed to logout session in main process:', error);
		currentSession = null; // Clear it anyway
		return false;
	}
}

export function getSupabaseClient(): SupabaseClient | null {
	return supabaseClient;
}

// Helper function to handle protocol URLs
export async function handleProtocolUrl(url: string) {
	try {
		const parsedUrl = new URL(url);

		if (parsedUrl.hostname === 'auth-callback') {
			// Check for magic link first (new approach)
			const magicLink = parsedUrl.searchParams.get('magic_link');

			if (magicLink && BrowserWindow.getAllWindows().length > 0) {
				// Get main window
				const mainWindow = BrowserWindow.getAllWindows()[0];

				// Verify magic link in main process
				const result = await verifyMagicLink(decodeURIComponent(magicLink));

				// Send result to renderer process
				mainWindow.webContents.send('magic-link-result', result);
				return;
			}

			// Fallback to legacy token approach
			const accessToken = parsedUrl.searchParams.get('access_token');
			const refreshToken = parsedUrl.searchParams.get('refresh_token');

			if (accessToken && refreshToken && BrowserWindow.getAllWindows().length > 0) {
				// Get main window
				const mainWindow = BrowserWindow.getAllWindows()[0];

				// Send both tokens to the renderer process
				mainWindow.webContents.send('auth-callback', { accessToken, refreshToken });
			}
		}
	} catch (error) {
		console.error('Failed to parse protocol URL:', error);
	}
}

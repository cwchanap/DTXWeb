import { writable } from 'svelte/store';

export interface User {
	id: string;
	email: string;
	name?: string;
}

interface AuthState {
	isAuthenticated: boolean;
	isLoading: boolean;
	user: User | null;
	error: string | null;
}

const initialState: AuthState = {
	isAuthenticated: false,
	isLoading: false,
	user: null,
	error: null
};

function createAuthStore() {
	const { subscribe, set, update } = writable<AuthState>(initialState);

	return {
		subscribe,
		setUser: (user: User) =>
			update((state) => ({ ...state, user, isAuthenticated: true, error: null })),
		setLoading: (isLoading: boolean) => update((state) => ({ ...state, isLoading })),
		setError: (error: string) => update((state) => ({ ...state, error })),
		logout: () => update((state) => ({ ...state, user: null, isAuthenticated: false })),
		reset: () => set(initialState)
	};
}

export const authStore = createAuthStore();

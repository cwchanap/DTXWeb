import { writable } from 'svelte/store';

export interface User {
	id: string;
	email: string;
	name?: string;
}

export interface DeviceAuthorizationInfo {
	verificationUri: string;
	userCode: string;
}

interface AuthState {
	isAuthenticated: boolean;
	isLoading: boolean;
	user: User | null;
	error: string | null;
	isLoginVisible: boolean;
	deviceAuthorization: DeviceAuthorizationInfo | null;
}

const initialState: AuthState = {
	isAuthenticated: false,
	isLoading: false,
	user: null,
	error: null,
	isLoginVisible: false,
	deviceAuthorization: null
};

function createAuthStore() {
	const { subscribe, set, update } = writable<AuthState>(initialState);

	return {
		subscribe,
		setUser: (user: User) =>
			update((state) => ({
				...state,
				user,
				isAuthenticated: true,
				error: null,
				isLoginVisible: false,
				deviceAuthorization: null
			})),
		setLoading: (isLoading: boolean) => update((state) => ({ ...state, isLoading })),
		setError: (error: string) => update((state) => ({ ...state, error })),
		startLogin: () =>
			update((state) => ({
				...state,
				isLoginVisible: true,
				deviceAuthorization: null,
				error: null
			})),
		setDeviceAuthorization: (deviceAuthorization: DeviceAuthorizationInfo | null) =>
			update((state) => ({ ...state, isLoginVisible: true, deviceAuthorization })),
		logout: () =>
			update((state) => ({
				...state,
				user: null,
				isAuthenticated: false,
				isLoginVisible: false,
				deviceAuthorization: null
			})),
		reset: () => set(initialState)
	};
}

export const authStore = createAuthStore();

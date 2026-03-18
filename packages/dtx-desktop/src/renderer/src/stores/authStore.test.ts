import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { authStore } from './authStore';
import type { User } from './authStore';

describe('authStore', () => {
	beforeEach(() => {
		authStore.reset();
	});

	it('should initialize with default state', () => {
		const state = get(authStore);
		expect(state.isAuthenticated).toBe(false);
		expect(state.isLoading).toBe(false);
		expect(state.user).toBeNull();
		expect(state.error).toBeNull();
	});

	describe('setUser', () => {
		it('should set the user and mark as authenticated', () => {
			const user: User = { id: 'user-1', email: 'test@example.com', name: 'Test User' };
			authStore.setUser(user);

			const state = get(authStore);
			expect(state.user).toEqual(user);
			expect(state.isAuthenticated).toBe(true);
			expect(state.error).toBeNull();
		});

		it('should clear error when setting user', () => {
			authStore.setError('some error');
			authStore.setUser({ id: 'user-1', email: 'test@example.com' });

			const state = get(authStore);
			expect(state.error).toBeNull();
			expect(state.isAuthenticated).toBe(true);
		});

		it('should set user without name field', () => {
			const user: User = { id: 'user-2', email: 'other@example.com' };
			authStore.setUser(user);

			const state = get(authStore);
			expect(state.user).toEqual(user);
			expect(state.user?.name).toBeUndefined();
		});
	});

	describe('setLoading', () => {
		it('should set isLoading to true', () => {
			authStore.setLoading(true);
			expect(get(authStore).isLoading).toBe(true);
		});

		it('should set isLoading to false', () => {
			authStore.setLoading(true);
			authStore.setLoading(false);
			expect(get(authStore).isLoading).toBe(false);
		});

		it('should not affect other state when setting loading', () => {
			authStore.setUser({ id: 'user-1', email: 'test@example.com' });
			authStore.setLoading(true);

			const state = get(authStore);
			expect(state.isLoading).toBe(true);
			expect(state.isAuthenticated).toBe(true);
			expect(state.user?.id).toBe('user-1');
		});
	});

	describe('setError', () => {
		it('should set error message', () => {
			authStore.setError('Authentication failed');
			expect(get(authStore).error).toBe('Authentication failed');
		});

		it('should not clear other state when setting error', () => {
			authStore.setUser({ id: 'user-1', email: 'test@example.com' });
			authStore.setError('Some error');

			const state = get(authStore);
			expect(state.error).toBe('Some error');
			expect(state.isAuthenticated).toBe(true);
			expect(state.user?.id).toBe('user-1');
		});
	});

	describe('logout', () => {
		it('should clear user and set isAuthenticated to false', () => {
			authStore.setUser({ id: 'user-1', email: 'test@example.com' });
			authStore.logout();

			const state = get(authStore);
			expect(state.user).toBeNull();
			expect(state.isAuthenticated).toBe(false);
		});

		it('should preserve other state fields on logout', () => {
			authStore.setError('some error');
			authStore.logout();

			const state = get(authStore);
			expect(state.error).toBe('some error');
		});
	});

	describe('reset', () => {
		it('should return to initial state', () => {
			authStore.setUser({ id: 'user-1', email: 'test@example.com' });
			authStore.setLoading(true);
			authStore.setError('some error');
			authStore.reset();

			const state = get(authStore);
			expect(state.isAuthenticated).toBe(false);
			expect(state.isLoading).toBe(false);
			expect(state.user).toBeNull();
			expect(state.error).toBeNull();
		});
	});

	describe('subscribe', () => {
		it('should emit updates when state changes', () => {
			const states: boolean[] = [];
			const unsubscribe = authStore.subscribe((state) => {
				states.push(state.isAuthenticated);
			});

			authStore.setUser({ id: 'user-1', email: 'test@example.com' });
			authStore.logout();

			unsubscribe();
			expect(states).toContain(true);
			expect(states).toContain(false);
		});
	});
});

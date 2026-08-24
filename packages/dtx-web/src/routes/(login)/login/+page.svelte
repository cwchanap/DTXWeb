<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { Loader } from '@lucide/svelte';
	import { authClient } from '$lib/auth/client';
	import {
		GOOGLE_AUTH_GENERIC_MESSAGE,
		safeAppRedirectPath,
		sanitizeGoogleAuthError
	} from '$lib/auth/google';

	let email = $state('');
	let password = $state('');
	let isLoading = $state(false);
	let isCheckingAuthState = $state(true);
	let nextPath = $state('');
	let error = $state('');

	const callbackPath = () => safeAppRedirectPath(nextPath || '/app');

	const socialCallbackPath = () => new URL(callbackPath(), window.location.origin).toString();

	const errorCallbackPath = () => {
		const callback = new URL('/login', window.location.origin);
		if (nextPath) {
			callback.searchParams.set('next', nextPath);
		}
		return callback.toString();
	};

	const handleLogin = async (event: SubmitEvent) => {
		event.preventDefault();
		isLoading = true;
		error = '';

		try {
			const { error: signInError } = await authClient.signIn.email({ email, password });
			if (signInError) {
				error = signInError.message || GOOGLE_AUTH_GENERIC_MESSAGE;
				return;
			}

			window.location.assign(callbackPath());
		} catch (caughtError) {
			console.error('Login failed:', caughtError);
			error = sanitizeGoogleAuthError(
				caughtError instanceof Error ? caughtError.message : undefined
			);
		} finally {
			isLoading = false;
		}
	};

	const handleGoogleLogin = async (event: SubmitEvent) => {
		event.preventDefault();
		isLoading = true;
		error = '';

		try {
			const { error: socialError } = await authClient.signIn.social({
				provider: 'google',
				callbackURL: socialCallbackPath(),
				errorCallbackURL: errorCallbackPath()
			});

			if (socialError) {
				error = sanitizeGoogleAuthError(socialError.message);
			}
		} catch (caughtError) {
			console.error('Google login failed:', caughtError);
			error = sanitizeGoogleAuthError(
				caughtError instanceof Error ? caughtError.message : undefined
			);
		} finally {
			isLoading = false;
		}
	};

	onMount(() => {
		if (!browser) return;

		const params = $page.url.searchParams;
		const rawError = params.get('error_description') ?? params.get('error');
		error = rawError ? sanitizeGoogleAuthError(rawError) : '';

		if (params.has('error') || params.has('error_description')) {
			const cleanUrl = new URL($page.url);
			cleanUrl.searchParams.delete('error');
			cleanUrl.searchParams.delete('error_description');
			replaceState(cleanUrl, {});
		}

		const rawNext = params.get('next');
		nextPath = rawNext ? safeAppRedirectPath(rawNext) : '';

		isCheckingAuthState = false;
	});
</script>

<div class="mt-16 flex justify-center">
	<div class="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
		{#if isCheckingAuthState}
			<div class="flex flex-col items-center py-8">
				<Loader size={32} class="mb-4 animate-spin text-indigo-500" />
				<p>Checking login status...</p>
			</div>
		{:else}
			<h1 class="mb-6 text-center text-2xl font-bold">Login</h1>

			{#if error}
				<div
					class="mb-6 border-l-4 border-red-500 bg-red-100 p-4 text-red-700"
					role="alert"
				>
					<p>{error}</p>
				</div>
			{/if}

			<form class="space-y-4" onsubmit={handleLogin}>
				<div>
					<label for="email" class="mb-1 block text-sm font-medium text-gray-700"
						>Email</label
					>
					<input
						type="email"
						id="email"
						name="email"
						bind:value={email}
						required
						class="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 focus:outline-none"
					/>
				</div>

				<div>
					<label for="password" class="mb-1 block text-sm font-medium text-gray-700"
						>Password</label
					>
					<input
						type="password"
						id="password"
						name="password"
						bind:value={password}
						required
						class="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-indigo-500 focus:outline-none"
					/>
				</div>

				<div>
					<button
						type="submit"
						disabled={isLoading}
						class="w-full rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
					>
						{#if isLoading}
							<span class="flex items-center justify-center">
								<Loader size={16} class="mr-2 animate-spin" />
								Processing...
							</span>
						{:else}
							Login
						{/if}
					</button>
				</div>
			</form>

			<div class="my-6 flex items-center gap-3">
				<div class="h-px flex-1 bg-gray-200"></div>
				<span class="text-xs font-medium text-gray-500 uppercase">or</span>
				<div class="h-px flex-1 bg-gray-200"></div>
			</div>

			<form onsubmit={handleGoogleLogin}>
				<button
					type="submit"
					disabled={isLoading}
					class="w-full rounded-md border border-gray-300 bg-white px-4 py-2 font-medium text-gray-800 hover:bg-gray-50 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
				>
					Continue with Google
				</button>
			</form>
			<p class="mt-3 text-center text-xs text-gray-500">
				Google sign-in is only available for existing linked accounts.
			</p>
		{/if}
	</div>
</div>

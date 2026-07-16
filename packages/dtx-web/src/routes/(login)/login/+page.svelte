<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { Loader } from '@lucide/svelte';
	import { GOOGLE_AUTH_ERROR_MESSAGES } from '$lib/auth/google';

	// Get form action data which may contain error messages
	let { form } = $props();

	let email = $state('');
	let password = $state('');
	let isLoading = $state(false);
	let redirectToDesktop = $state(false);
	let isCheckingAuthState = $state(true);

	// Capture the allow-listed URL error once on mount so we can clear the
	// query param (preventing it from persisting on refresh) without losing
	// the message. Server action errors still flow through `form?.error`.
	let urlError = $state('');
	let error = $derived(form?.error || urlError);

	// Check for desktop redirect parameter
	onMount(() => {
		if (browser) {
			const params = $page.url.searchParams;

			// Only display trusted, allow-listed messages from the error query param.
			urlError = GOOGLE_AUTH_ERROR_MESSAGES.find((m) => m === params.get('error')) || '';

			// Clear callback error param so the banner does not persist on refresh.
			if (params.has('error')) {
				const cleanUrl = new URL($page.url);
				cleanUrl.searchParams.delete('error');
				replaceState(cleanUrl, {});
			}

			// Check if we're redirecting from desktop app
			const redirectParam = params.get('redirect');
			redirectToDesktop = redirectParam === 'desktop';

			// The desktop app declares where it wants the magic link sent back
			// (a loopback URL under `tauri dev`, or its `dtx://` deep link when
			// bundled). Stash it so the /app page can honor it after login — this
			// survives both the password POST redirect and the Google OAuth
			// round-trip within this browser tab. The /app page validates it
			// before use, so storing the raw value here is safe.
			//
			// On a failed/cancelled Google OAuth round-trip the error redirect
			// is `/login?redirect=desktop&error=...` without `desktop_callback`.
			// Keep the already-stashed loopback URL in that case so a retry
			// still reaches the running `tauri dev` app. Only clear the stash
			// on a fresh desktop login that intentionally omits the param
			// (bundled app falling back to `dtx://`).
			if (redirectToDesktop) {
				const desktopCallback = params.get('desktop_callback');
				try {
					if (desktopCallback) {
						sessionStorage.setItem('dtx_desktop_auth_callback', desktopCallback);
					} else if (!params.has('error')) {
						sessionStorage.removeItem('dtx_desktop_auth_callback');
					}
				} catch {
					// sessionStorage may be unavailable (private mode); the /app
					// page falls back to the configured/default deep-link callback.
				}
			}

			isCheckingAuthState = false;
		}
	});

	// Handle form submission
	const handleSubmit = () => {
		isLoading = true;
	};
</script>

<div class="mt-16 flex justify-center">
	<div class="w-full max-w-md rounded-lg bg-white p-6 shadow-md">
		{#if isCheckingAuthState}
			<!-- Show loading state while checking auth -->
			<div class="flex flex-col items-center py-8">
				<Loader size={32} class="mb-4 animate-spin text-indigo-500" />
				<p>Checking login status...</p>
			</div>
		{:else}
			<h1 class="mb-6 text-center text-2xl font-bold">
				{redirectToDesktop ? 'Login to Desktop App' : 'Login'}
			</h1>

			{#if error}
				<div
					class="mb-6 border-l-4 border-red-500 bg-red-100 p-4 text-red-700"
					role="alert"
				>
					<p>{error}</p>
				</div>
			{/if}

			<form action="?/login" method="POST" class="space-y-4" onsubmit={handleSubmit}>
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

				{#if redirectToDesktop}
					<input type="hidden" name="redirect" value="desktop" />
				{/if}

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

			<form action="?/google" method="POST" onsubmit={handleSubmit}>
				{#if redirectToDesktop}
					<input type="hidden" name="redirect" value="desktop" />
				{/if}
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

			{#if redirectToDesktop}
				<div class="mt-6 text-center text-sm text-gray-500">
					<p>You'll be redirected back to the desktop app after login.</p>
				</div>
			{/if}
		{/if}
	</div>
</div>

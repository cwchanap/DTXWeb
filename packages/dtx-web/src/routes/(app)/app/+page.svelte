<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { env } from '$env/dynamic/public';
	import { onMount } from 'svelte';
	import { Loader } from '@lucide/svelte';
	import { generateMagicLink } from '$lib/api';

	let redirectToDesktop = $state(false);
	let isRedirecting = $state(false);
	let redirectError = $state('');
	let redirectAttempted = $state(false);

	const buildDesktopAuthCallbackUrl = (magicLinkUrl: string) => {
		const configuredCallbackUrl = env.PUBLIC_DTX_DESKTOP_AUTH_CALLBACK_URL?.trim();
		const callbackUrl = configuredCallbackUrl || 'dtx://auth-callback';
		const separator = callbackUrl.includes('?') ? '&' : '?';
		return `${callbackUrl}${separator}magic_link=${encodeURIComponent(magicLinkUrl)}`;
	};

	onMount(() => {
		if (browser) {
			// Check if we're redirecting from desktop app
			redirectToDesktop = $page.url.searchParams.get('redirect') === 'desktop';

			if (redirectToDesktop) {
				isRedirecting = true;
				redirectToDesktopWithSession();
			}
		}
	});

	// Function to redirect to desktop with magic link
	async function redirectToDesktopWithSession() {
		if (!browser) return;

		try {
			// Generate magic link for desktop authentication
			const { magicLinkUrl } = await generateMagicLink();

			if (!magicLinkUrl) {
				throw new Error('No magic link received');
			}

			console.log('Generated magic link for desktop authentication');

			// Redirect to desktop app with magic link
			const redirectUrl = buildDesktopAuthCallbackUrl(magicLinkUrl);

			// Try to redirect
			redirectAttempted = true;
			window.location.href = redirectUrl;

			// Set a timeout to check if redirect succeeded
			setTimeout(() => {
				if (redirectAttempted && document.visibilityState !== 'hidden') {
					// We're still here, so the redirect likely failed
					redirectError =
						'Desktop app redirect failed. Please make sure the app is installed and registered.';
					isRedirecting = false;
				}
			}, 2000);
		} catch (err) {
			console.error('Error redirecting to desktop:', err);
			redirectError = err instanceof Error ? err.message : 'Unknown error';
			isRedirecting = false;
		}
	}
</script>

{#if isRedirecting}
	<section class="flex min-h-[calc(100vh-10rem)] w-full items-center justify-center px-4">
		<div class="w-full max-w-2xl text-center">
			<Loader size={48} class="mx-auto mb-6 animate-spin text-cyan-300" />
			<h2 class="text-2xl font-semibold text-white">Redirecting to desktop app...</h2>
			<p class="mx-auto mt-3 max-w-lg text-slate-300">
				Keep this tab open while Drumery prepares a secure sign-in link for the desktop app.
			</p>
			{#if redirectAttempted}
				<p class="mx-auto mt-8 max-w-md text-sm text-slate-400">
					If the desktop app does not open automatically, your browser may be blocking the
					redirect or the desktop app may not be registered to handle Drumery sign-in
					links.
				</p>
			{/if}
		</div>
	</section>
{:else if redirectError}
	<section class="flex min-h-[calc(100vh-10rem)] w-full items-center justify-center px-4">
		<div
			class="w-full max-w-lg rounded-lg border border-red-400/30 bg-red-950/30 p-6 text-center shadow-xl shadow-red-950/20"
		>
			<h2 class="mb-3 text-xl font-semibold text-red-200">Redirection Failed</h2>
			<p class="text-red-100">{redirectError}</p>
			<p class="mt-4 text-sm text-slate-300">
				Please try signing in again from the Drumery desktop app.
			</p>
		</div>
	</section>
{:else}
	<div class="container mx-auto p-6">
		<h1 class="mb-6 text-3xl font-bold">Welcome to Drumery</h1>
		<p>Your app dashboard content goes here.</p>
	</div>
{/if}

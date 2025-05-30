<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { Loader } from '@lucide/svelte';

	let { data } = $props();
	let redirectToDesktop = $state(false);
	let isRedirecting = $state(false);
	let redirectError = $state('');
	let redirectAttempted = $state(false);

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
			const response = await fetch('/api/auth/generate-magic-link', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.error || 'Failed to generate magic link');
			}

			const { magicLinkUrl } = await response.json();

			if (!magicLinkUrl) {
				throw new Error('No magic link received');
			}

			console.log('Generated magic link for desktop authentication');

			// Redirect to desktop app with magic link
			const redirectUrl = `dtx://auth-callback?magic_link=${encodeURIComponent(magicLinkUrl)}`;

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
	<div class="flex h-screen w-full flex-col items-center justify-center">
		<Loader size={48} class="text-primary mb-6 animate-spin" />
		<h2 class="text-2xl font-semibold">Redirecting to desktop app...</h2>
		<p class="text-muted-foreground mt-2">
			You'll be returned to the desktop application shortly.
		</p>
		{#if redirectAttempted}
			<div class="mt-8 max-w-md rounded p-4 text-center">
				<p class="text-sm text-slate-600">
					If you're not automatically redirected, your browser may be blocking the
					redirect or the desktop app is not properly registered to handle the protocol.
				</p>
			</div>
		{/if}
	</div>
{:else if redirectError}
	<div class="flex h-screen w-full flex-col items-center justify-center">
		<div class="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
			<h2 class="mb-2 text-xl font-semibold text-red-700">Redirection Failed</h2>
			<p class="text-red-600">{redirectError}</p>
			<p class="mt-4 text-sm text-gray-700">
				Please try logging in again from the desktop app.
			</p>
		</div>
	</div>
{:else}
	<div class="container mx-auto p-6">
		<h1 class="mb-6 text-3xl font-bold">Welcome to Drumery</h1>
		<p>Your app dashboard content goes here.</p>
	</div>
{/if}

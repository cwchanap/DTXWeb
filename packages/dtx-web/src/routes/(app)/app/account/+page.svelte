<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { replaceState } from '$app/navigation';
	import { AlertCircle, CheckCircle2, Loader } from '@lucide/svelte';
	import { authClient } from '$lib/auth/client';
	import { safeAppRedirectPath, sanitizeGoogleAuthError } from '$lib/auth/google';

	type ListAccountsResult = Awaited<ReturnType<typeof authClient.listAccounts>>;
	type LinkedAccount = NonNullable<ListAccountsResult['data']>[number];

	let { data } = $props();
	let { user } = $derived(data);

	let accounts = $state<LinkedAccount[]>([]);
	let isLoading = $state(true);
	let isConnecting = $state(false);
	let error = $state('');
	let message = $state('');

	let googleAccount = $derived(
		accounts.find((account) => account.providerId === 'google') ?? null
	);

	const accountCallbackUrl = (path: string): string =>
		new URL(safeAppRedirectPath(path), window.location.origin).toString();

	const loadAccounts = async (): Promise<void> => {
		isLoading = true;
		try {
			const { data: accountData, error: accountError } = await authClient.listAccounts();

			if (accountError) {
				error = 'Unable to load linked account providers.';
				accounts = [];
			} else {
				accounts = accountData ?? [];
			}
		} catch (caughtError) {
			console.error('Failed to load account providers:', caughtError);
			error = 'Unable to load linked account providers.';
			accounts = [];
		} finally {
			isLoading = false;
		}
	};

	const handleConnectGoogle = async (): Promise<void> => {
		isConnecting = true;
		error = '';
		message = '';

		try {
			const { error: linkError } = await authClient.linkSocial({
				provider: 'google',
				callbackURL: accountCallbackUrl('/app/account?linked=google'),
				errorCallbackURL: accountCallbackUrl('/app/account')
			});

			if (linkError) {
				error = sanitizeGoogleAuthError(linkError.message);
			}
		} catch (caughtError) {
			console.error('Google account linking failed:', caughtError);
			error = sanitizeGoogleAuthError(
				caughtError instanceof Error ? caughtError.message : undefined
			);
		} finally {
			isConnecting = false;
		}
	};

	onMount(() => {
		const params = $page.url.searchParams;
		if (params.get('linked') === 'google') {
			message = 'Google account connected.';
		} else {
			const callbackError = params.get('error_description') ?? params.get('error');
			if (callbackError) {
				error = sanitizeGoogleAuthError(callbackError);
			}
		}

		if (params.has('linked') || params.has('error') || params.has('error_description')) {
			const cleanUrl = new URL($page.url);
			cleanUrl.searchParams.delete('linked');
			cleanUrl.searchParams.delete('error');
			cleanUrl.searchParams.delete('error_description');
			replaceState(cleanUrl, {});
		}

		loadAccounts();
	});
</script>

<section class="container mx-auto max-w-3xl p-6 text-white">
	<h1 class="mb-6 text-3xl font-bold">Account</h1>

	{#if message}
		<div
			class="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-950/30 p-4 text-emerald-100"
			role="status"
		>
			<div class="flex items-center gap-2">
				<CheckCircle2 size={18} />
				<p>{message}</p>
			</div>
		</div>
	{/if}

	{#if error}
		<div
			class="mb-4 rounded-lg border border-red-400/30 bg-red-950/30 p-4 text-red-100"
			role="alert"
		>
			<div class="flex items-center gap-2">
				<AlertCircle size={18} />
				<p>{error}</p>
			</div>
		</div>
	{/if}

	<div class="rounded-lg border border-purple-500/20 bg-slate-950/60 p-6">
		<div class="mb-6">
			<h2 class="mb-2 text-xl font-semibold">Profile</h2>
			<p class="text-sm text-slate-400">Primary account email</p>
			<p class="mt-1 text-slate-100">{user?.email ?? 'Unknown email'}</p>
		</div>

		<div>
			<h2 class="mb-4 text-xl font-semibold">Connected providers</h2>

			{#if isLoading}
				<div class="flex items-center gap-3 text-slate-300">
					<Loader size={18} class="animate-spin" />
					<span>Loading providers...</span>
				</div>
			{:else}
				<div class="rounded-md border border-slate-700 bg-slate-900/80 p-4">
					<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<p class="font-medium">Google</p>
							{#if googleAccount}
								<p class="text-sm text-emerald-300">Google is connected</p>
							{:else}
								<p class="text-sm text-slate-400">Google is not connected</p>
							{/if}
						</div>

						{#if !googleAccount}
							<button
								type="button"
								onclick={handleConnectGoogle}
								disabled={isConnecting}
								class="connect-google-btn"
							>
								{isConnecting ? 'Connecting...' : 'Connect Google'}
							</button>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
</section>

<style>
	@reference 'tailwindcss';

	.connect-google-btn {
		@apply rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none disabled:opacity-50;
	}
</style>

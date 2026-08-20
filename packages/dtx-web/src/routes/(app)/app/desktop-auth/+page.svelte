<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { authClient, DESKTOP_DEVICE_CLIENT_ID } from '$lib/auth/client';

	type DeviceStatus = 'idle' | 'pending' | 'approved' | 'denied';
	type DeviceError =
		| {
				code?: string;
				error?: string;
				message?: string;
				error_description?: string;
				status?: number;
				statusText?: string;
		  }
		| null
		| undefined;

	let userCode = $state('');
	let normalizedCode = $state('');
	let status = $state<DeviceStatus>('idle');
	let error = $state('');
	let isProcessing = $state(false);

	const normalizeUserCode = (value: string): string =>
		value.trim().replace(/-/g, '').toUpperCase();

	const messageForError = (deviceError: DeviceError, fallback: string): string => {
		const code = (deviceError?.code ?? deviceError?.error ?? '').toUpperCase();
		const message = deviceError?.message ?? deviceError?.error_description ?? '';

		if (code.includes('EXPIRED') || /expired/i.test(message)) {
			return 'That authorization code has expired.';
		}
		if (code.includes('INVALID') || code === 'INVALID_REQUEST' || /invalid/i.test(message)) {
			return 'That authorization code is invalid.';
		}
		return fallback;
	};

	const handleClaim = async (event: SubmitEvent): Promise<void> => {
		event.preventDefault();
		if (isProcessing) return;

		const code = normalizeUserCode(userCode);
		if (!code) {
			error = 'Enter the authorization code shown in the desktop app.';
			return;
		}

		isProcessing = true;
		error = '';

		try {
			const result = await authClient.device({ query: { user_code: code } });
			if (result.error || !result.data) {
				status = 'idle';
				error = messageForError(
					result.error,
					'We could not verify that authorization code.'
				);
				return;
			}

			normalizedCode = normalizeUserCode(result.data.user_code || code);
			userCode = normalizedCode;
			if (result.data.status === 'pending') {
				status = 'pending';
			} else if (result.data.status === 'approved') {
				status = 'approved';
			} else if (result.data.status === 'denied') {
				status = 'denied';
			} else {
				status = 'idle';
				error = 'That authorization request is no longer available.';
			}
		} catch (caughtError) {
			status = 'idle';
			error = messageForError(
				caughtError instanceof Error ? { message: caughtError.message } : undefined,
				'We could not verify that authorization code.'
			);
		} finally {
			isProcessing = false;
		}
	};

	const handleDecision = async (decision: 'approve' | 'deny'): Promise<void> => {
		if (isProcessing || status !== 'pending' || !normalizedCode) return;

		isProcessing = true;
		error = '';

		try {
			const result =
				decision === 'approve'
					? await authClient.device.approve({ userCode: normalizedCode })
					: await authClient.device.deny({ userCode: normalizedCode });

			if (result.error || !result.data?.success) {
				error = messageForError(
					result.error,
					'We could not update this authorization request.'
				);
				return;
			}

			status = decision === 'approve' ? 'approved' : 'denied';
		} catch (caughtError) {
			error = messageForError(
				caughtError instanceof Error ? { message: caughtError.message } : undefined,
				'We could not update this authorization request.'
			);
		} finally {
			isProcessing = false;
		}
	};

	onMount(() => {
		const queryCode = $page.url.searchParams.get('user_code');
		if (queryCode) userCode = queryCode;
	});
</script>

<svelte:head>
	<title>Desktop authorization | Drumery</title>
</svelte:head>

<div class="flex min-h-full items-center justify-center px-4 py-12">
	<section
		class="music-card w-full max-w-lg p-8 text-slate-100"
		aria-labelledby="desktop-auth-title"
	>
		<h1 id="desktop-auth-title" class="mb-3 text-2xl font-semibold">Desktop authorization</h1>
		<p class="mb-6 text-sm text-slate-300">
			Authorize the Drumery desktop app to sign in to your account.
		</p>

		<div class="mb-6 rounded-lg border border-purple-400/30 bg-slate-950/40 p-4 text-sm">
			<p class="text-slate-400">Client</p>
			<p class="font-mono text-slate-100">{DESKTOP_DEVICE_CLIENT_ID}</p>
		</div>

		{#if error}
			<div
				class="mb-6 rounded-lg border border-red-400/40 bg-red-950/30 p-4 text-sm text-red-200"
				role="alert"
			>
				{error}
			</div>
		{/if}

		{#if status === 'idle'}
			<form class="space-y-4" onsubmit={handleClaim}>
				<div>
					<label
						for="authorization-code"
						class="mb-2 block text-sm font-medium text-slate-200"
					>
						Authorization code
					</label>
					<input
						id="authorization-code"
						name="user_code"
						bind:value={userCode}
						autocomplete="one-time-code"
						placeholder="Enter the code from Drumery"
						required
						class="w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 font-mono tracking-wider text-slate-100 placeholder:text-slate-500 focus:border-purple-400 focus:outline-none disabled:opacity-50"
						disabled={isProcessing}
					/>
				</div>
				<button
					type="submit"
					disabled={isProcessing}
					class="w-full rounded-md bg-purple-600 px-4 py-2 font-medium text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isProcessing ? 'Checking…' : 'Continue'}
				</button>
			</form>
		{:else if status === 'pending'}
			<div class="space-y-5">
				<div>
					<h2 class="text-lg font-medium">Desktop authorization request</h2>
					<p class="mt-2 text-sm text-slate-300">
						The desktop app is requesting access to this account. Confirm the code
						before continuing.
					</p>
				</div>
				<div class="rounded-lg border border-slate-600 bg-slate-950/40 p-4">
					<p class="text-xs tracking-wider text-slate-400 uppercase">
						Authorization code
					</p>
					<p class="mt-1 font-mono text-lg tracking-widest text-slate-100">
						{normalizedCode}
					</p>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<button
						type="button"
						onclick={() => handleDecision('deny')}
						disabled={isProcessing}
						class="rounded-md border border-slate-600 px-4 py-2 font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Deny
					</button>
					<button
						type="button"
						onclick={() => handleDecision('approve')}
						disabled={isProcessing}
						class="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
					>
						Approve
					</button>
				</div>
			</div>
		{:else if status === 'approved'}
			<p
				class="rounded-lg border border-emerald-400/40 bg-emerald-950/30 p-4 text-emerald-200"
				role="status"
			>
				Desktop access approved.
			</p>
		{:else}
			<p
				class="rounded-lg border border-slate-500/40 bg-slate-950/30 p-4 text-slate-200"
				role="status"
			>
				Desktop access denied.
			</p>
		{/if}
	</section>
</div>

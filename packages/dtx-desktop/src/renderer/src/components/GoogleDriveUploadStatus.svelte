<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { googleDriveService, type SongSaveOutcome } from '../services/googleDriveService';
	import { googleDriveStore } from '../stores/googleDriveStore';

	let {
		outcome,
		onRetry,
		onCreateReplacement
	}: {
		outcome?: SongSaveOutcome['driveUpload'];
		onRetry?: () => void;
		onCreateReplacement?: () => void;
	} = $props();

	const stageKey: Record<string, string> = {
		'waiting-for-upload-slot': 'googleDrive.upload.queued',
		'preparing-zip': 'googleDrive.upload.preparing',
		'connecting-to-google-drive': 'googleDrive.upload.connecting',
		uploading: 'googleDrive.upload.uploading',
		finalizing: 'googleDrive.upload.finalizing',
		'synchronizing-download-metadata': 'googleDrive.upload.synchronizing',
		'upload-complete': 'googleDrive.upload.complete',
		'upload-failed-save-succeeded': 'googleDrive.upload.failedSaveSucceeded'
	};

	const needsExplicitReplacement = (errorCode: string | undefined) =>
		errorCode === 'FILE_NOT_FOUND' || errorCode === 'FILE_PERMISSION_DENIED';
	const supportedErrorCodes = new Set([
		'FILE_NOT_FOUND',
		'FILE_PERMISSION_DENIED',
		'CANCELED',
		'INVALID_RESPONSE'
	]);

	const errorMessageKey = (errorCode: string | undefined): string => {
		return `googleDrive.error.${supportedErrorCodes.has(errorCode ?? '') ? errorCode : 'UNKNOWN'}`;
	};

	const handleCancel = async () => {
		const operationId = $googleDriveStore.operation?.operationId;
		if (operationId) await googleDriveService.cancelUpload(operationId);
	};
</script>

{#if $googleDriveStore.operation}
	<section
		class="border-hairline bg-surface-1 space-y-2 rounded-lg border p-4"
		aria-live="polite"
	>
		<p class="text-base-text text-sm">{$_(stageKey[$googleDriveStore.operation.stage])}</p>
		{#if $googleDriveStore.operation.percentage !== undefined}
			<p class="text-dim text-sm">{$googleDriveStore.operation.percentage}%</p>
		{/if}
		{#if $googleDriveStore.operation.stage !== 'upload-complete' && $googleDriveStore.operation.stage !== 'upload-failed-save-succeeded'}
			<button class="text-dim text-sm" onclick={handleCancel}
				>{$_('googleDrive.upload.cancel')}</button
			>
		{/if}
	</section>
{/if}

{#if outcome?.status === 'success'}
	<section class="border-green/40 bg-green/10 space-y-2 rounded-lg border p-4" aria-live="polite">
		<p class="text-green text-sm">{$_('googleDrive.upload.complete')}</p>
		{#if outcome.downloadUrl}
			<a
				class="text-cyan text-sm underline"
				href={outcome.downloadUrl}
				target="_blank"
				rel="noreferrer">{$_('googleDrive.upload.openLink')}</a
			>
			<p class="text-dim text-sm">{$_('googleDrive.upload.browserLink')}</p>
		{/if}
	</section>
{:else if outcome?.status === 'failed'}
	<section
		class="border-yellow/40 bg-yellow/10 space-y-2 rounded-lg border p-4"
		aria-live="polite"
	>
		<p class="text-yellow text-sm">{$_(errorMessageKey(outcome.errorCode))}</p>
		{#if needsExplicitReplacement(outcome.errorCode)}
			<button class="text-dim text-sm" onclick={onCreateReplacement}
				>{$_('googleDrive.upload.replace')}</button
			>
		{:else}
			<button class="text-dim text-sm" onclick={onRetry}
				>{$_('googleDrive.upload.retry')}</button
			>
		{/if}
	</section>
{/if}

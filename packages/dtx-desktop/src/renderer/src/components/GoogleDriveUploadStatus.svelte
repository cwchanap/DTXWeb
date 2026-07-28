<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { googleDriveService, type SongSaveOutcome } from '../services/googleDriveService';
	import { googleDriveStore, type GoogleDriveOperation } from '../stores/googleDriveStore';
	import { authStore } from '../stores/authStore';

	let {
		simfileId,
		outcome,
		onRetry,
		onCreateReplacement
	}: {
		simfileId?: string;
		outcome?: { simfileId: string; result: SongSaveOutcome['driveUpload'] };
		onRetry?: () => void;
		onCreateReplacement?: () => void;
	} = $props();

	const visibleOperations = $derived(
		Object.values($googleDriveStore.operations).filter(
			(operation) => simfileId === undefined || operation.simfileId === simfileId
		)
	);
	const visibleOutcome = $derived.by(() => {
		if (!outcome) return undefined;
		return simfileId === undefined || outcome.simfileId === simfileId
			? outcome.result
			: undefined;
	});

	const stageKey: Record<GoogleDriveOperation['stage'], string> = {
		'waiting-for-upload-slot': 'googleDrive.upload.queued',
		'preparing-zip': 'googleDrive.upload.preparing',
		'connecting-to-google-drive': 'googleDrive.upload.connecting',
		uploading: 'googleDrive.upload.uploading',
		finalizing: 'googleDrive.upload.finalizing',
		'synchronizing-download-metadata': 'googleDrive.upload.synchronizing',
		'upload-complete': 'googleDrive.upload.complete',
		'upload-failed-save-succeeded': 'googleDrive.upload.failedSaveSucceeded'
	};

	const cancelableStages = new Set<GoogleDriveOperation['stage']>([
		'waiting-for-upload-slot',
		'preparing-zip',
		'connecting-to-google-drive',
		'uploading'
	]);

	type NativeErrorCode =
		| 'WORKSPACE_REQUIRED'
		| 'NOT_CONNECTED'
		| 'RECONNECT_REQUIRED'
		| 'FOLDER_REQUIRED'
		| 'FOLDER_UNAVAILABLE'
		| 'SHARING_CHECK_UNAVAILABLE'
		| 'DOWNLOAD_NOT_PUBLIC'
		| 'SIMFILE_UNAVAILABLE'
		| 'FILE_NOT_FOUND'
		| 'FILE_PERMISSION_DENIED'
		| 'UPLOAD_IN_PROGRESS'
		| 'CANCELED'
		| 'NO_VALID_SONG_FILES'
		| 'INSUFFICIENT_DISK_SPACE'
		| 'LOCAL_STATE'
		| 'METADATA_SYNC_FAILED'
		| 'RATE_LIMITED'
		| 'QUOTA_EXCEEDED'
		| 'NETWORK'
		| 'CREDENTIAL_STORE'
		| 'INVALID_RESPONSE'
		| 'UNKNOWN';

	type Remediation =
		| 'retry'
		| 'reconnect'
		| 'refreshConnection'
		| 'changeFolder'
		| 'recheckSharing'
		| 'none'
		| 'replace';

	const errorRemediation: Record<NativeErrorCode, Remediation[]> = {
		WORKSPACE_REQUIRED: ['none'],
		NOT_CONNECTED: ['reconnect'],
		RECONNECT_REQUIRED: ['reconnect'],
		FOLDER_REQUIRED: ['changeFolder'],
		FOLDER_UNAVAILABLE: ['changeFolder'],
		SHARING_CHECK_UNAVAILABLE: ['recheckSharing'],
		DOWNLOAD_NOT_PUBLIC: ['recheckSharing'],
		SIMFILE_UNAVAILABLE: ['none'],
		FILE_NOT_FOUND: ['reconnect', 'replace'],
		FILE_PERMISSION_DENIED: ['reconnect', 'replace'],
		UPLOAD_IN_PROGRESS: ['retry'],
		CANCELED: ['retry'],
		NO_VALID_SONG_FILES: ['none'],
		INSUFFICIENT_DISK_SPACE: ['none'],
		LOCAL_STATE: ['retry'],
		METADATA_SYNC_FAILED: ['retry'],
		RATE_LIMITED: ['retry'],
		QUOTA_EXCEEDED: ['retry'],
		NETWORK: ['retry'],
		CREDENTIAL_STORE: ['refreshConnection'],
		INVALID_RESPONSE: ['none'],
		UNKNOWN: ['none']
	};

	const isNativeErrorCode = (value: string | undefined): value is NativeErrorCode =>
		value !== undefined && value in errorRemediation;
	const errorCodeFor = (value: string | undefined): NativeErrorCode =>
		isNativeErrorCode(value) ? value : 'UNKNOWN';
	const actionsFor = (value: string | undefined): Remediation[] =>
		errorRemediation[errorCodeFor(value)];
	const errorMessageKey = (value: string | undefined): string =>
		`googleDrive.error.${errorCodeFor(value)}`;

	const handleCancel = async (operationId: string) => {
		await googleDriveService.cancelUpload(operationId);
	};
	const handleReconnect = async () => {
		if (!visibleOutcome) return;
		await googleDriveService.connectAndChooseFolder();
	};
	const handleRefreshConnection = async () => {
		if (!visibleOutcome) return;
		await googleDriveService.refreshConnection();
	};
	const handleChangeFolder = async () => {
		if (!visibleOutcome) return;
		await googleDriveService.changeFolder();
	};
	const handleRecheckSharing = async () => {
		if (!visibleOutcome) return;
		await googleDriveService.recheckSharing();
	};
</script>

{#if $authStore.isAuthenticated}
	{#each visibleOperations as operation (operation.operationId)}
		<section
			class="border-hairline bg-surface-1 space-y-2 rounded-lg border p-4"
			aria-live="polite"
		>
			<p class="text-base-text text-sm">
				{$_(stageKey[operation.stage] ?? 'googleDrive.upload.unknown')}
			</p>
			{#if operation.percentage !== undefined}
				<p class="text-dim text-sm">{operation.percentage}%</p>
			{/if}
			{#if operation.errorCode}
				<p class="text-yellow text-sm">{$_(errorMessageKey(operation.errorCode))}</p>
			{/if}
			{#if cancelableStages.has(operation.stage)}
				<button class="text-dim text-sm" onclick={() => handleCancel(operation.operationId)}
					>{$_('googleDrive.upload.cancel')}</button
				>
			{/if}
		</section>
	{/each}

	{#if visibleOutcome?.status === 'success'}
		<section
			class="border-green/40 bg-green/10 space-y-2 rounded-lg border p-4"
			aria-live="polite"
		>
			<p class="text-green text-sm">{$_('googleDrive.upload.complete')}</p>
			{#if visibleOutcome.downloadUrl}
				<a
					class="text-cyan text-sm underline"
					href={visibleOutcome.downloadUrl}
					target="_blank"
					rel="noopener noreferrer">{$_('googleDrive.upload.openLink')}</a
				>
				<p class="text-dim text-sm">{$_('googleDrive.upload.browserLink')}</p>
			{/if}
		</section>
	{:else if visibleOutcome?.status === 'failed'}
		<section
			class="border-yellow/40 bg-yellow/10 space-y-2 rounded-lg border p-4"
			aria-live="polite"
		>
			<p class="text-yellow text-sm">{$_(errorMessageKey(visibleOutcome.errorCode))}</p>
			{#each actionsFor(visibleOutcome.errorCode) as action}
				{#if action === 'retry' && onRetry}
					<button class="text-dim text-sm" onclick={onRetry}
						>{$_('googleDrive.upload.retry')}</button
					>
				{:else if action === 'reconnect'}
					<button class="text-dim text-sm" onclick={handleReconnect}
						>{$_('googleDrive.action.reconnect')}</button
					>
				{:else if action === 'refreshConnection'}
					<button class="text-dim text-sm" onclick={handleRefreshConnection}
						>{$_('googleDrive.action.refresh')}</button
					>
				{:else if action === 'changeFolder'}
					<button class="text-dim text-sm" onclick={handleChangeFolder}
						>{$_('googleDrive.changeFolder')}</button
					>
				{:else if action === 'recheckSharing'}
					<button class="text-dim text-sm" onclick={handleRecheckSharing}
						>{$_('googleDrive.recheckSharing')}</button
					>
				{:else if action === 'replace' && onCreateReplacement}
					<button class="text-dim text-sm" onclick={onCreateReplacement}
						>{$_('googleDrive.upload.replace')}</button
					>
				{/if}
			{/each}
		</section>
	{/if}
{/if}

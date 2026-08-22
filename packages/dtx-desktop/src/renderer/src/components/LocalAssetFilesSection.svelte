<script lang="ts">
	import { UploadedAssetFiles } from '@dtx/common/components';

	type AssetFile = {
		fileName: string;
		size: number;
		lastModified: string;
		key: string;
	};

	interface Props {
		isLoadingFiles: boolean;
		fileLoadError: string | null;
		onRetry: () => void;
		simfileId: string;
		userFiles: File[];
		loadAssetFiles: (simfileId: string) => Promise<AssetFile[]>;
		uploadFile: (
			fileName: string,
			songFolderPath: string,
			simfileId: string
		) => Promise<{ success: boolean; error?: string }>;
		songFolderPath: string;
		disableUploads: boolean;
	}

	let {
		isLoadingFiles,
		fileLoadError,
		onRetry,
		simfileId,
		userFiles,
		loadAssetFiles,
		uploadFile,
		songFolderPath,
		disableUploads
	}: Props = $props();
</script>

<!-- Local Asset Files Section -->
<div class="bg-surface-2 rounded-lg">
	{#if isLoadingFiles}
		<div class="flex justify-center p-4">
			<p class="text-dim">Loading files...</p>
		</div>
	{:else if fileLoadError}
		<div class="text-red p-4">
			<p>{fileLoadError}</p>
			<button
				class="bg-magenta mt-2 rounded-sm px-3 py-1 text-sm text-[#16001a] hover:opacity-90"
				onclick={onRetry}
			>
				Retry
			</button>
		</div>
	{:else}
		<!-- Use UploadedAssetFiles component for local files display -->
		<UploadedAssetFiles
			{simfileId}
			{userFiles}
			simfileBucketUrl=""
			{loadAssetFiles}
			{uploadFile}
			isDesktop={true}
			{songFolderPath}
			{disableUploads}
		/>
	{/if}
</div>

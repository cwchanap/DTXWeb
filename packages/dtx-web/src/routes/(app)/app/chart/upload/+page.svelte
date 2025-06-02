<!-- src/routes/new-page/+page.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { SimFile, type DTXFile } from '@dtx/common';
	import { UploadedAssetFiles } from '@dtx/common/components';
	import { v4 as uuidv4 } from 'uuid';
	import { PREVIEW_BUCKET_NAME, SOUND_PREVIEW_BUCKET_NAME } from '@/constant';
	import ChartFolderUpload from '$lib/components/ChartFolderUpload.svelte';
	import ChartDetail from '$lib/components/ChartDetail.svelte';
	import ImageAudio from '$lib/components/ImageAudio.svelte';
	import { filterFiles } from '$lib/utils';
	import { PUBLIC_SIMFILE_BUCKET_URL, PUBLIC_CLOUDFARE_WORKER_URL } from '$env/static/public';
	import { loadAssetFiles } from '$lib/services/assetFileService';

	let { data } = $props();
	let { supabase } = $derived(data);

	let simfile: SimFile | undefined = $state(undefined);
	let highestDtx: DTXFile | undefined = $state(undefined);
	let simfileId: string | null = $state(null);
	let uploadedAssetFilesRef: UploadedAssetFiles | undefined = $state(undefined);
	let shouldUploadFiles = $state(false);

	async function uploadFile(
		displayId: number,
		isPublished: boolean,
		publishDate: string,
		downloadUrl: string,
		videoPreviewUrl: string
	) {
		if (!simfile) return;
		const dtx = simfile.getHighestLevel();
		const previewFile = simfile.getPreviewFile();
		const soundPreviewFile = simfile.getSoundPreviewFile();
		const {
			data: { user }
		} = await supabase.auth.getUser();

		if (!user) {
			console.error('User not found');
			return;
		}

		// Upload preview image to Supabase storage
		let previewUrl = '';
		const previewHash = uuidv4();
		if (previewFile) {
			previewUrl = `${user.id}/${previewHash}.jpg`;

			const { data, error: uploadError } = await supabase.storage
				.from(PREVIEW_BUCKET_NAME)
				.upload(previewUrl, previewFile, {
					contentType: 'image/jpeg'
				});

			if (uploadError) {
				console.error('Error uploading preview image:', uploadError.message);
				return;
			}
		}

		let soundPreviewUrl = '';
		if (soundPreviewFile) {
			soundPreviewUrl = `${user.id}/${previewHash}.mp3`;
			const { data, error: uploadError } = await supabase.storage
				.from(SOUND_PREVIEW_BUCKET_NAME)
				.upload(soundPreviewUrl, soundPreviewFile, {
					contentType: 'audio/mp3'
				});

			if (uploadError) {
				console.error('Error uploading sound preview file:', uploadError.message);
				return;
			}
		}

		// Insert simfile data into the database
		const { data: simFileData, error } = await supabase
			.from('simfiles')
			.insert({
				title: simfile.title,
				artist: dtx.artist,
				bpm: dtx.bpm,
				preview_url: previewUrl,
				sound_preview_url: soundPreviewUrl,
				user_id: user.id,
				display_id: displayId,
				is_published: isPublished,
				publish_date: publishDate,
				download_url: downloadUrl,
				video_preview_url: videoPreviewUrl
			})
			.select()
			.single();

		if (error) {
			console.error('Error creating simfiles:', error.message);
			return;
		}

		if (simFileData) {
			// Insert dtx_files data into the database
			const { error } = await supabase.from('dtx_files').insert(
				Object.values(simfile.levels)
					.filter((value): value is NonNullable<typeof value> => value !== undefined)
					.map((value) => ({
						level: value.file.level,
						simfile_id: simFileData.id,
						label: value.file.difficulty
					}))
			);

			if (error) {
				console.error('Error creating dtx_files:', error.message);
				return;
			}

			// Set the simfileId to trigger file uploads
			simfileId = simFileData.id.toString();

			// Trigger the file upload in the UploadedAssetFiles component
			shouldUploadFiles = true;
		}
	}

	function onFileUpload(newSimfile: SimFile, newHighestDtx: DTXFile) {
		simfile = newSimfile;
		highestDtx = newHighestDtx;
	}

	// Use a regular effect to avoid infinite loops
	$effect(() => {
		// Only run this once when shouldUploadFiles becomes true
		if (shouldUploadFiles && uploadedAssetFilesRef && simfileId) {
			// Immediately set shouldUploadFiles to false to prevent multiple triggers
			shouldUploadFiles = false;

			if (uploadedAssetFilesRef) {
				uploadedAssetFilesRef.uploadSelectedFiles().then(() => {
					goto('/app/chart');
				});
			}
		}
	});
</script>

<div class="container mx-auto flex flex-col p-4" style="height: 90vh;">
	{#if !simfile || !highestDtx}
		<h1 class="mb-4 text-2xl font-bold">Upload Folders</h1>
		<ChartFolderUpload large={true} {onFileUpload} />
	{:else}
		<h1 class="mb-4 text-2xl font-bold">Uploaded Folders</h1>
		<ChartDetail
			simfile={{
				bpm: highestDtx.bpm,
				artist: highestDtx.artist,
				title: simfile.title,
				dtx_files: Object.values(simfile.levels).map((value) => ({
					level: value?.file.level,
					label: value?.label
				}))
			}}
			on:onSave={(e) =>
				uploadFile(
					e.detail.displayId,
					e.detail.isPublished,
					e.detail.publishDate,
					e.detail.downloadUrl,
					e.detail.videoPreviewUrl
				)}
		>
			{#snippet preview()}
				<div class="col-span-2 items-center justify-center">
					{#if simfile}
						<ImageAudio
							previewUrl={simfile.getPreview()}
							soundPreviewUrl={simfile.getSoundPreview()}
						/>
					{/if}
				</div>
				<div class="col-span-6"></div>
			{/snippet}
			{#snippet folder_upload()}
				<div class="col-span-8">
					<div class="mt-4">
						<button
							class="rounded-sm bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
							onclick={() => (simfile = undefined)}
						>
							Clear Files
						</button>
					</div>
					<div class="mt-4">
						<button
							class="rounded-sm bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
							onclick={async () => {
								if (!simfile) return;
								const zip = simfile.getZip();
								const blob = await zip.generateAsync({ type: 'blob' });
								const url = URL.createObjectURL(blob);
								const a = document.createElement('a');
								a.href = url;
								a.download = simfile.title + '.zip';
								a.click();
								URL.revokeObjectURL(url);
							}}
						>
							Download zip
						</button>
					</div>
				</div>
			{/snippet}
			{#snippet asset_files()}
				{#if simfile}
					<UploadedAssetFiles
						bind:this={uploadedAssetFilesRef}
						simfileId={simfileId || ''}
						userFiles={simfile.files}
						supabaseClient={supabase}
						simfileBucketUrl={PUBLIC_SIMFILE_BUCKET_URL}
						cloudflareWorkerUrl={PUBLIC_CLOUDFARE_WORKER_URL}
						{loadAssetFiles}
					/>
				{/if}
			{/snippet}
			{#snippet save()}
				Upload
			{/snippet}
		</ChartDetail>
	{/if}
</div>

<!-- src/routes/new-page/+page.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import type { DTXFile } from '@/lib/chart/dtx';
	import { SimFile } from '@/lib/chart/simFile';
	import { supabase } from '@/lib/supabase';
	import { v4 as uuidv4 } from 'uuid';
	import { PREVIEW_BUCKET_NAME, SOUND_PREVIEW_BUCKET_NAME } from '@/constant';
	import ChartFolderUpload from '@/lib/components/ChartFolderUpload.svelte';
	import ChartDetail from '@/lib/components/ChartDetail.svelte';
	import { PlaySolid } from 'flowbite-svelte-icons';
	import ImageAudio from '@/lib/components/ImageAudio.svelte';

	let simfile: SimFile | undefined = undefined;
	let isCollapsed = true;
	let highestDtx: DTXFile | undefined = undefined;

	function toggleCollapse() {
		isCollapsed = !isCollapsed;
	}

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
		}

		goto('/app/chart');
	}

	function onFileUpload(newSimfile: SimFile, newHighestDtx: DTXFile) {
		simfile = newSimfile;
		highestDtx = newHighestDtx;
	}
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
			<svelte:fragment slot="preview">
				<div class="col-span-2 items-center justify-center">
					<ImageAudio
						previewUrl={simfile.getPreview()}
						soundPreviewUrl={simfile.getSoundPreview()}
					/>
				</div>
				<div class="col-span-6"/>
			</svelte:fragment>
			<svelte:fragment slot="folder_upload">
				<div class="col-span-8">
					<div class="mt-4">
						<button
							class="rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
							on:click={() => (simfile = undefined)}
						>
							Clear Files
						</button>
					</div>
					<div class="mt-4">
						<button
							class="rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
							on:click={async () => {
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
					<div class="mt-4">
						<button
							on:click={toggleCollapse}
							class="focus:shadow-outline mb-4 transform rounded bg-blue-500 px-4 py-2 font-bold text-white transition-colors duration-150 ease-in-out hover:bg-blue-700 focus:outline-none"
						>
							{#if isCollapsed}
								Show Uploaded Files
							{:else}
								Hide Uploaded Files
							{/if}
						</button>
					</div>
				</div>

				{#if !isCollapsed}
					<table class="col-span-8 min-w-full leading-normal">
						<thead>
							<tr>
								<th
									class="border-b-2 border-gray-200 bg-gray-100 px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700"
								>
									File Name
								</th>
							</tr>
						</thead>
						<tbody>
							{#each simfile.files as file}
								<tr>
									<td class="border-b border-gray-200 bg-white px-5 py-5 text-sm">
										{file.name}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</svelte:fragment>
			<svelte:fragment slot="save">Upload</svelte:fragment>
		</ChartDetail>
	{/if}
</div>

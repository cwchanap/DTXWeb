<!-- src/routes/new-page/+page.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import type { DTXFile } from '@/lib/chart/dtx';
	import { SimFile } from '@/lib/chart/simFile';
	import { supabase } from '@/lib/supabase';
	import { v4 as uuidv4 } from 'uuid';
	import { PREVIEW_BUCKET_NAME } from '@/constant';
	import ChartFolderUpload from '@/lib/components/ChartFolderUpload.svelte';

	let simfile: SimFile | undefined = undefined;
	let isCollapsed = true;
	let highestDtx: DTXFile | undefined = undefined;

	function toggleCollapse() {
		isCollapsed = !isCollapsed;
	}

	async function uploadFile() {
		if (!simfile) return;
		const dtx = simfile.getHighestLevel();
		const previewFile = simfile.getPreviewFile();
		const {
			data: { user }
		} = await supabase.auth.getUser();

		if (!user) {
			console.error('User not found');
			return;
		}

		// Upload preview image to Supabase storage
		let previewUrl = '';
		if (previewFile) {
			const previewHash = uuidv4();
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

		const { data: countData, error: _ } = await supabase
			.from('simfiles')
			.select('id.count()')
			.eq('user_id', user.id);

		// Insert simfile data into the database
		const { data: simFileData, error } = await supabase
			.from('simfiles')
			.insert({
				title: simfile.title,
				artist: dtx.artist,
				bpm: dtx.bpm,
				preview_url: previewUrl, // Add the preview URL to the simfile record
				user_id: user.id,
				display_id: countData ? countData[0].count + 1 : null
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
		console.log(simfile, highestDtx);
	}
</script>

<div class="container mx-auto flex flex-col p-4" style="height: 90vh;">
	{#if !simfile || !highestDtx}
		<h1 class="mb-4 text-2xl font-bold">Upload Folders</h1>
		<ChartFolderUpload large={true} {onFileUpload} />
	{:else}
		<h1 class="mb-4 text-2xl font-bold">Uploaded Folders</h1>
		<div class="card rounded-lg bg-white p-4 shadow-lg">
			<h3 class="mb-2 text-xl font-bold">Song Title: {simfile.title}</h3>
			<h4 class="mb-2 text-lg font-bold">Artist: {highestDtx.artist}</h4>
			<h4 class="mb-2 text-lg font-bold">BPM: {highestDtx.bpm}</h4>
			<div class="mb-4 flex items-center justify-center">
				<img src={simfile.getPreview()} alt="Uploaded Image" class="mb-4" />
			</div>
			<div class="levels mb-4">
				<div class="level">
					{#each Object.values(simfile.levels) as level}
						{#if level}
							<div class="level-item">
								<div class="card mb-4 rounded-lg bg-gray-100 p-2">
									<h4 class="text-sm font-bold">{level.file.difficulty}</h4>
									<p class="text-xs">{level.file.level}</p>
								</div>
							</div>
						{/if}
					{/each}
				</div>
			</div>
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
			{#if !isCollapsed}
				<table class="min-w-full leading-normal">
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
		</div>
		<div class="mt-4 flex justify-center">
			<button
				class="rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
				on:click={() => (simfile = undefined)}
			>
				Clear Files
			</button>
		</div>
		<div class="mt-4 flex justify-center">
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
		<div class="mt-4 flex justify-center">
			<button
				class="rounded bg-blue-500 px-4 py-2 font-bold text-white hover:bg-blue-700"
				on:click={uploadFile}
			>
				Upload
			</button>
		</div>
	{/if}
</div>

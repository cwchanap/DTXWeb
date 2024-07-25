<!-- src/routes/new-page/+page.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import type { DTXFile } from '@/lib/chart/dtx';
	import { SimFile } from '@/lib/chart/simFile';
	import { supabase } from '@/lib/supabase';

	let dropzoneActive = false;
	let simfile: SimFile | undefined = undefined;
	let isCollapsed = true;
	let highestDtx: DTXFile | undefined = undefined;

	function toggleCollapse() {
		isCollapsed = !isCollapsed;
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		dropzoneActive = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		dropzoneActive = false;
	}

	function filterFiles(files: FileList) {
		return Array.from(files).filter((file) =>
			new Set(['.ogg', '.dtx', '.def', '.jpg', '.avi', '.mp4', '.mp3', '.xa']).has(
				file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
			)
		);
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		dropzoneActive = false;

		if (event.dataTransfer?.files) {
			simfile = new SimFile(filterFiles(event.dataTransfer.files));
			await simfile.parse();
		}
	}

	async function handleFileInput(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files) {
			simfile = new SimFile(filterFiles(input.files));
			await simfile.parse();
			simfile = simfile;
			highestDtx = simfile.getHighestLevel();
		}
	}

	async function uploadFile() {
		if (!simfile) return;
		const dtx = simfile.getHighestLevel();
		const { data: simFileData, error } = await supabase
			.from('simfiles')
			.insert({ title: simfile.title, author: dtx.artist, bpm: dtx.bpm })
			.select()
			.single();
		if (error) {
			console.error('Error creating simfiles:', error.message);
			return;
		}
		if (simFileData) {
			const { error } = await supabase.from('dtx_file').insert(
				Object.values(simfile.levels).map((value, index, array) => {
					return {
						level: value.file.level,
						simfile_id: simFileData.id
					};
				})
			);
			if (error) {
				console.error('Error creating dtx_file:', error.message);
				return;
			}
		}
		goto('/app/chart');
	}
</script>

<div class="container mx-auto flex flex-col p-4" style="height: 90vh;">
	{#if !simfile || !highestDtx}
		<h1 class="mb-4 text-2xl font-bold">Upload Folders</h1>

		<div
			class="dropzone flex flex-1 items-center justify-center {dropzoneActive
				? 'active'
				: ''}"
			on:dragover={handleDragOver}
			on:dragleave={handleDragLeave}
			on:drop={handleDrop}
			on:click={() => document.getElementById('fileInput').click()}
			role="region"
			aria-label="Drop zone"
		>
			<p>Drag and drop zip files here, or click to select files</p>
			<input
				id="fileInput"
				type="file"
				webkitdirectory
				directory
				multiple
				on:change={handleFileInput}
				class="hidden"
			/>
		</div>
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
						<div class="level-item">
							<div class="card mb-4 rounded-lg bg-gray-100 p-2">
								<h4 class="text-sm font-bold">{level.file.difficulty}</h4>
								<p class="text-xs">{level.file.level}</p>
							</div>
						</div>
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

<style>
	.dropzone {
		border: 2px dashed #ccc;
		padding: 20px;
		text-align: center;
		transition: background-color 0.3s;
		height: calc(100vh - 64px); /* Adjust 64px to the height of your navbar */
	}
	.dropzone.active {
		background-color: #e0f7fa;
	}
</style>

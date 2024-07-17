<!-- src/routes/new-page/+page.svelte -->
<script lang="ts">
	import { SimFile } from "@/lib/chart/simFile";

	let dropzoneActive = false;
	let simfile: SimFile | undefined  = undefined;

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
			new Set(['.ogg', '.dtx', '.def', 'jpg', 'avi', 'mp4', 'mp3', 'xa']).has(
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
		}
	}
</script>

<div class="container mx-auto flex flex-col p-4" style="height: 90vh;">
	{#if !simfile}
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
		<h2 class="mb-4 text-xl font-bold">Uploaded Files</h2>
        <div class="card bg-white shadow-lg rounded-lg p-4">
            <h3 class="text-xl font-bold mb-2">{simfile.title}</h3>
            <div class="levels mb-4">
                <div class="level">
                    <span class="font-semibold">Level 1:</span> {simfile.level_1}
                </div>
            </div>
            <div class="file-info mb-2">
                <span class="font-semibold">Uploaded File:</span> 
                {#each simfile.files as file}
                    <div class="file">
                        <span>{file.name}</span>
                    </div>
                {/each}
            </div>
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

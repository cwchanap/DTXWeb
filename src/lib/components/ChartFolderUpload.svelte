<script lang="ts">
	import type { DTXFile } from '../chart/dtx';
	import { SimFile } from '../chart/simFile';

	export let large = false;
	export let hidden = false;
	let simfile: SimFile;
	let dropzoneActive = false;
	let highestDtx: DTXFile;
	export let onFileUpload: (simfile: SimFile, highestDtx: DTXFile) => void; // Add this

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
			onFileUpload(simfile, highestDtx);
		}
	}
</script>


{#if large}
	<div
		class="dropzone flex flex-1 items-center justify-center {dropzoneActive ? 'active' : ''}"
		on:dragover={handleDragOver}
		on:dragleave={handleDragLeave}
		on:drop={handleDrop}
		on:click={() => document.getElementById('fileInput')?.click()}
		on:keydown={(e) => e.key === 'Enter' && document.getElementById('fileInput')?.click()}
		role="button"
		tabindex="0"
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
	<input
		id="folder_upload"
		type="file"
		webkitdirectory
		directory
		class="mb-4 w-full rounded border p-2 {hidden ? 'hidden' : ''}"
		on:change={handleFileInput}
	/>
{/if}

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

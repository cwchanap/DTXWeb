<script lang="ts">
	import type { DTXFile } from '../chart/dtx';
	import { SimFile } from '../chart/simFile';
	import { filterFiles } from '../utils';

	let simfile: SimFile;
	let dropzoneActive = $state(false);
	let highestDtx: DTXFile;
	interface Props {
		large?: boolean;
		hidden?: boolean;
		onFileUpload: (simfile: SimFile, highestDtx: DTXFile) => void; // Add this
	}

	let { large = false, hidden = false, onFileUpload }: Props = $props();

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		dropzoneActive = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		dropzoneActive = false;
	}

	function filterSimFiles(files: FileList) {
		return filterFiles(files, ['.ogg', '.dtx', '.def', '.jpg', '.avi', '.mp4', '.mp3', '.xa']);
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		dropzoneActive = false;

		if (event.dataTransfer?.files) {
			simfile = new SimFile(filterSimFiles(event.dataTransfer.files));
			await simfile.parse();
		}
	}

	async function handleFileInput(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files) {
			simfile = new SimFile(filterSimFiles(input.files));
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
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		onclick={() => document.getElementById('fileInput')?.click()}
		onkeydown={(e) => e.key === 'Enter' && document.getElementById('fileInput')?.click()}
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
			onchange={handleFileInput}
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
		onchange={handleFileInput}
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

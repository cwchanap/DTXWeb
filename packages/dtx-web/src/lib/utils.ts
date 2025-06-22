import type { Tables } from '@dtx/common';

export function formatLevelDisplay(dtx_files: Tables<'dtx_files'>[]) {
	return (
		dtx_files
			?.sort((a, b) => (a.level || 0) - (b.level || 0))
			.map((file) => (file.level > 100 ? file.level / 100 : file.level / 10).toFixed(2))
			.join(' / ') || 'N/A'
	);
}

export function filterFiles(files: FileList | File[], filters: string[]) {
	return Array.from(files).filter((file) =>
		new Set(filters).has(file.name.toLowerCase().slice(file.name.lastIndexOf('.')))
	);
}

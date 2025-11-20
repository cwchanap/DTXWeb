export function formatLevelDisplay(dtx_files: Array<{ level?: string | number }>) {
	return (
		dtx_files
			?.slice()
			.sort((a, b) => {
				const parsedA = typeof a.level === 'string' ? parseFloat(a.level) : a.level || 0;
				const parsedB = typeof b.level === 'string' ? parseFloat(b.level) : b.level || 0;
				const levelA = Number.isFinite(parsedA) ? parsedA : 0;
				const levelB = Number.isFinite(parsedB) ? parsedB : 0;
				return levelA - levelB;
			})
			.map((file) => {
				const level =
					typeof file.level === 'string' ? parseFloat(file.level) : file.level || 0;
				return (level > 100 ? level / 100 : level / 10).toFixed(2);
			})
			.join(' / ') || 'N/A'
	);
}

export function filterFiles(files: FileList | File[], filters: string[]) {
	return Array.from(files).filter((file) =>
		new Set(filters).has(file.name.toLowerCase().slice(file.name.lastIndexOf('.')))
	);
}

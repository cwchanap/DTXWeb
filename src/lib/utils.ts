import type { Tables } from '@/types/supabase.types';

export function formatLevelDisplay(dtx_files: Tables<'dtx_files'>[]) {
    return (
        dtx_files
            ?.map((file) => (file.level > 100 ? file.level / 100 : file.level / 10).toFixed(2))
            .join(' / ') || 'N/A'
    );
}

export function filterFiles(files: FileList | File[], filters: string[]) {
    return Array.from(files).filter((file) =>
        new Set(filters).has(file.name.toLowerCase().slice(file.name.lastIndexOf('.')))
    );
}

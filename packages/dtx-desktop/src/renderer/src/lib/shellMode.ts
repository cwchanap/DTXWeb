export type ShellMode = 'wide' | 'medium' | 'narrow';

export const resolveShellMode = (width: number): ShellMode => {
	if (width >= 1100) return 'wide';
	if (width >= 760) return 'medium';
	return 'narrow';
};

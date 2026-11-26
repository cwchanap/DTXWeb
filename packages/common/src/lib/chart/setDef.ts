export interface SetDefLevel {
	level: number;
	label: string;
	fileName: string;
}

export interface ParsedSetDef {
	title: string;
	levels: SetDefLevel[];
}

const titlePattern = /^#TITLE(?:\s*:\s*|\s+|$)/i;
// The space-only separator must not retry a colon that the colon branch
// already rejected (e.g. `#L1FILE :   `): `\s+` would otherwise consume the
// spaces before ':' and capture the colon itself as the value.
const levelPattern = /^#L(\d+)(LABEL|FILE)(?:\s*:\s*|\s+(?!:))(\S.*)$/i;

/**
 * Pure SET.def parser shared by the local SimFile parser, the web editor's
 * server-side metadata load, and the dtx-api R2 catalog matcher. Accepts both
 * space and colon directive separators, case-insensitive keys, LF or CRLF
 * line endings, and leading whitespace before a directive — the desktop
 * uploader's parse_set_def_labels trims each line before matching, so an
 * indented directive still produced a row label at upload time. Labels and
 * file names are captured whole (multiword values, subdirectories); path
 * normalization is left to consumers.
 *
 * Only complete label+file pairs on positive numeric slots are returned,
 * sorted by level — slots above the conventional L1–L5 range are kept.
 */
export const parseSetDef = (text: string): ParsedSetDef => {
	const lines = text.split(/\r?\n/).map((line) => line.trimStart());
	const titleIndexes = lines
		.map((line, index) => (titlePattern.test(line) ? index : -1))
		.filter((index) => index >= 0);
	// SET.def can concatenate multiple songs. This single-song shape describes
	// the first #TITLE section only; files with no #TITLE keep their legacy
	// flat parsing behavior.
	const sectionLines = titleIndexes.length
		? lines.slice(titleIndexes[0], titleIndexes[1] ?? lines.length)
		: lines;

	const titleLine = sectionLines.find((line) => titlePattern.test(line));
	const title = titleLine ? titleLine.replace(/^#TITLE\s*:?\s*/i, '').trim() : '';

	const entries = new Map<number, { label?: string; fileName?: string }>();
	for (const line of sectionLines) {
		const match = line.match(levelPattern);
		if (!match) continue;
		const level = parseInt(match[1], 10);
		if (!Number.isSafeInteger(level) || level <= 0) continue;
		const entry = entries.get(level) ?? {};
		const value = match[3].trim();
		if (match[2].toUpperCase() === 'LABEL') {
			entry.label = value;
		} else {
			entry.fileName = value;
		}
		entries.set(level, entry);
	}

	const levels: SetDefLevel[] = [];
	for (const [level, entry] of entries) {
		if (entry.label && entry.fileName) {
			levels.push({ level, label: entry.label, fileName: entry.fileName });
		}
	}
	levels.sort((a, b) => a.level - b.level);

	return { title, levels };
};

/**
 * Resolve an #LxFILE reference to the form File names and R2 object keys
 * use: SET.def files written on Windows carry `\` separators and `.\` /
 * `./` prefixes, which must be stripped before key or filename matching.
 */
export const normalizeSetDefFileName = (fileName: string): string =>
	fileName.replaceAll('\\', '/').replace(/^(\.\/)+/, '');

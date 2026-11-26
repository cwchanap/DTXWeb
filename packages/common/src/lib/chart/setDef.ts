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
const levelPrefixPattern = /^#L(\d+)(LABEL|FILE)/i;

// Parse separators imperatively: a regex that can divide a whitespace run
// between the separator and value capture is a polynomial-regex risk.
const parseLevelDirective = (
	line: string
): { level: number; directive: 'LABEL' | 'FILE'; value: string } | null => {
	const match = line.match(levelPrefixPattern);
	if (!match) return null;
	const level = parseInt(match[1], 10);
	if (!Number.isSafeInteger(level) || level <= 0) return null;

	const rest = line.slice(match[0].length);
	let rawValue: string;
	if (rest.startsWith(':')) {
		rawValue = rest.slice(1);
	} else {
		if (!/^\s/.test(rest)) return null;
		const afterWhitespace = rest.trimStart();
		rawValue = afterWhitespace.startsWith(':') ? afterWhitespace.slice(1) : afterWhitespace;
	}

	return {
		level,
		directive: match[2].toUpperCase() === 'LABEL' ? 'LABEL' : 'FILE',
		value: rawValue.trim()
	};
};

const collectLevels = (lines: string[], foldBlankValues = false): SetDefLevel[] => {
	const entries = new Map<number, { label?: string; fileName?: string }>();
	for (const line of lines) {
		const directive = parseLevelDirective(line);
		if (!directive) continue;
		if (!foldBlankValues && !directive.value) continue;
		const entry = entries.get(directive.level) ?? {};
		if (directive.directive === 'LABEL') {
			entry.label = directive.value;
		} else {
			entry.fileName = directive.value;
		}
		entries.set(directive.level, entry);
	}

	const levels: SetDefLevel[] = [];
	for (const [level, entry] of entries) {
		if (entry.label && entry.fileName) {
			levels.push({ level, label: entry.label, fileName: entry.fileName });
		}
	}
	return levels.sort((a, b) => a.level - b.level);
};

const splitSetDefLines = (text: string): string[] =>
	text.split(/\r?\n/).map((line) => line.trimStart());

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
	const lines = splitSetDefLines(text);
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

	return { title, levels: collectLevels(sectionLines) };
};

/**
 * Whole-document slot view of a SET.def, ignoring #TITLE section boundaries.
 * The desktop uploader's parse_set_def_labels scans every line into one
 * slot map (a later section's slot overwrites an earlier one), so catalog
 * matching must see the same slots the uploader catalogued rows from —
 * unlike parseSetDef, which describes only the first song for the editor.
 */
export const parseSetDefDocumentLevels = (text: string): SetDefLevel[] =>
	collectLevels(splitSetDefLines(text), true);

/**
 * Resolve an #LxFILE reference to the form File names and R2 object keys
 * use: SET.def files written on Windows carry `\` separators and `.\` /
 * `./` prefixes, which must be stripped before key or filename matching.
 */
export const normalizeSetDefFileName = (fileName: string): string =>
	fileName.replaceAll('\\', '/').replace(/^(\.\/)+/, '');

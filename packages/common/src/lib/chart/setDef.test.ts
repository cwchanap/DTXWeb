import { describe, it, expect } from 'vitest';
import { parseSetDef, normalizeSetDefFileName } from './setDef';

describe('parseSetDef', () => {
	it('parses title and levels from space-separated directives', () => {
		const result = parseSetDef('#TITLE My Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n');

		expect(result.title).toBe('My Song');
		expect(result.levels).toEqual([{ level: 1, label: 'BASIC', fileName: 'bas.dtx' }]);
	});

	it('parses colon-separated directives', () => {
		const result = parseSetDef('#TITLE: My Song\n#L1LABEL: BASIC\n#L1FILE: bas.dtx\n');

		expect(result.title).toBe('My Song');
		expect(result.levels).toEqual([{ level: 1, label: 'BASIC', fileName: 'bas.dtx' }]);
	});

	it('parses mixed space and colon separators', () => {
		const result = parseSetDef('#L1LABEL: BASIC\n#L1FILE bas.dtx\n');

		expect(result.levels).toEqual([{ level: 1, label: 'BASIC', fileName: 'bas.dtx' }]);
	});

	it('is case-insensitive on directive keys', () => {
		const result = parseSetDef('#title lower\n#l1label basic\n#L1File bas.dtx\n');

		expect(result.title).toBe('lower');
		expect(result.levels).toEqual([{ level: 1, label: 'basic', fileName: 'bas.dtx' }]);
	});

	it('produces identical results for LF and CRLF input', () => {
		const body =
			'#TITLE Song\n#L1LABEL BASIC\n#L1FILE bas.dtx\n#L2LABEL ADVANCED\n#L2FILE adv.dtx\n';
		const lf = parseSetDef(body);
		const crlf = parseSetDef(body.replaceAll('\n', '\r\n'));

		expect(crlf).toEqual(lf);
	});

	it('parses levels beyond L5', () => {
		const result = parseSetDef('#L6LABEL MANIAC\n#L6FILE maniac.dtx\n');

		expect(result.levels).toEqual([{ level: 6, label: 'MANIAC', fileName: 'maniac.dtx' }]);
	});

	it('preserves multiword labels and file paths with spaces', () => {
		const result = parseSetDef(
			'#L1LABEL Basic Plus\n#L1FILE sub dir/my chart.dtx\n#L2LABEL ADV\n#L2FILE adv.dtx\n'
		);

		expect(result.levels[0]).toEqual({
			level: 1,
			label: 'Basic Plus',
			fileName: 'sub dir/my chart.dtx'
		});
	});

	it('returns slots sorted by numeric level regardless of file order', () => {
		const result = parseSetDef(
			'#L3LABEL EXTREME\n#L3FILE ext.dtx\n#L1LABEL BASIC\n#L1FILE bas.dtx\n'
		);

		expect(result.levels.map((slot) => slot.level)).toEqual([1, 3]);
	});

	it('keeps only complete label+file pairs', () => {
		const result = parseSetDef(
			'#L1LABEL BASIC\n#L1FILE bas.dtx\n#L2LABEL ADVANCED\n#L3FILE ext.dtx\n'
		);

		expect(result.levels).toEqual([{ level: 1, label: 'BASIC', fileName: 'bas.dtx' }]);
	});

	it('skips pairs whose label or file is only whitespace', () => {
		const result = parseSetDef('#L1LABEL   \n#L1FILE bas.dtx\n#L2LABEL ADV\n#L2FILE   \n');

		expect(result.levels).toEqual([]);
	});

	it('treats a colon surrounded by whitespace as blank, not as the value', () => {
		// `#L1FILE :   ` must not capture ':' as the filename — a bogus claimed
		// filename makes catalog discovery skip its fallback for the row.
		const result = parseSetDef('#L1LABEL BASIC\n#L1FILE :   \n#L2LABEL ADV\n#L2FILE:adv.dtx\n');

		expect(result.levels).toEqual([{ level: 2, label: 'ADV', fileName: 'adv.dtx' }]);
	});

	it('keeps a populated value when a blank colon duplicate follows', () => {
		const result = parseSetDef('#L1LABEL BASIC\n#L1FILE bas.dtx\n#L1FILE : \n');

		expect(result.levels).toEqual([{ level: 1, label: 'BASIC', fileName: 'bas.dtx' }]);
	});

	it('ignores non-positive level slots', () => {
		const result = parseSetDef(
			'#L0LABEL GHOST\n#L0FILE ghost.dtx\n#L1LABEL BASIC\n#L1FILE bas.dtx\n'
		);

		expect(result.levels).toEqual([{ level: 1, label: 'BASIC', fileName: 'bas.dtx' }]);
	});

	it('returns an empty title when #TITLE is absent', () => {
		expect(parseSetDef('#L1LABEL BASIC\n#L1FILE bas.dtx\n').title).toBe('');
	});

	it('leaves file path normalization to consumers', () => {
		const result = parseSetDef('#L1LABEL BASIC\n#L1FILE .\\dir\\bas.dtx\n');

		expect(result.levels[0]?.fileName).toBe('.\\dir\\bas.dtx');
	});
});

describe('normalizeSetDefFileName', () => {
	it('converts backslash separators and strips leading ./ and .\\ prefixes', () => {
		expect(normalizeSetDefFileName('.\\dir\\bas.dtx')).toBe('dir/bas.dtx');
		expect(normalizeSetDefFileName('.\\bas.dtx')).toBe('bas.dtx');
		expect(normalizeSetDefFileName('./bas.dtx')).toBe('bas.dtx');
		expect(normalizeSetDefFileName('././bas.dtx')).toBe('bas.dtx');
		expect(normalizeSetDefFileName('dir/sub/bas.dtx')).toBe('dir/sub/bas.dtx');
	});
});

export const fuzzyScore = (query: string, text: string): number => {
	// Iterate by Unicode code point (not UTF-16 code unit) so astral characters
	// rendered as surrogate pairs (e.g. emoji in song titles) score as one unit.
	const q = [...query.toLowerCase()];
	const t = [...text.toLowerCase()];
	if (q.length === 0) return 1;
	let score = 0;
	let ti = 0;
	let streak = 0;
	for (let qi = 0; qi < q.length; qi++) {
		const ch = q[qi];
		let found = -1;
		for (let j = ti; j < t.length; j++) {
			if (t[j] === ch) {
				found = j;
				break;
			}
		}
		if (found === -1) return 0;
		// contiguity bonus; prefix bonus
		streak = found === ti ? streak + 1 : 0;
		score += 1 + streak + (found === 0 ? 2 : 0);
		ti = found + 1;
	}
	return score;
};

export const searchItems = <T>(query: string, items: T[], key: (t: T) => string): T[] => {
	if (query.trim().length === 0) return items;
	return items
		.map((item) => ({ item, score: fuzzyScore(query, key(item)) }))
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((r) => r.item);
};

import { describe, it, expect } from 'vitest';
import { exportNotationChartToMusicXml } from './musicxml';
import type { NotationChart, NotationMeasure, NotationTempoEvent } from './model';

const measure = (overrides: Partial<NotationMeasure>): NotationMeasure => ({
	index: 0,
	measureTicks: 192,
	beatsPerMeasure: 4,
	entries: [],
	tuplets: [],
	...overrides
});

const chart = (
	measures: NotationMeasure[],
	tempoEvents: NotationTempoEvent[] = [{ measure: 0, fraction: 0, bpm: 120 }]
): NotationChart => ({ measures, tempoEvents });

const exportChart = (c: NotationChart, title = 'Test Title', artist?: string) =>
	exportNotationChartToMusicXml(c, { title, artist });

const parse = (xml: string): Document => {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	expect(doc.querySelector('parsererror')).toBeNull();
	return doc;
};

const children = (el: Element): Element[] => Array.from(el.children);

const directChild = (el: Element, tag: string): Element | undefined =>
	children(el).find((c) => c.tagName === tag);

const requiredChild = (el: Element, tag: string): Element => {
	const found = directChild(el, tag);
	expect(found, `expected <${tag}> inside <${el.tagName}>`).toBeDefined();
	return found!;
};

const measuresOf = (doc: Document): Element[] => Array.from(doc.querySelectorAll('part > measure'));

interface WalkedEvent {
	kind: 'note' | 'rest' | 'forward' | 'direction';
	tick: number;
	advance: number;
	instruments: string[];
	bpm?: number;
}

const walkMeasure = (measureEl: Element): { events: WalkedEvent[]; endTick: number } => {
	let cursor = 0;
	let lastOnset = 0;
	const events: WalkedEvent[] = [];
	for (const child of children(measureEl)) {
		if (child.tagName === 'forward') {
			const dur = Number(requiredChild(child, 'duration').textContent);
			events.push({ kind: 'forward', tick: cursor, advance: dur, instruments: [] });
			cursor += dur;
			continue;
		}
		if (child.tagName === 'direction') {
			const offsetEl = directChild(child, 'offset');
			const offset = offsetEl ? Number(offsetEl.textContent) : 0;
			const sound = requiredChild(child, 'sound');
			events.push({
				kind: 'direction',
				tick: cursor + offset,
				advance: 0,
				instruments: [],
				bpm: Number(sound.getAttribute('tempo'))
			});
			continue;
		}
		if (child.tagName !== 'note') continue;
		const dur = Number(requiredChild(child, 'duration').textContent);
		const isChord = Boolean(directChild(child, 'chord'));
		const isRest = Boolean(directChild(child, 'rest'));
		if (!isChord) lastOnset = cursor;
		const instrument = directChild(child, 'instrument');
		events.push({
			kind: isRest ? 'rest' : 'note',
			tick: isChord ? lastOnset : cursor,
			advance: isChord ? 0 : dur,
			instruments: instrument ? [instrument.getAttribute('id')!] : []
		});
		if (!isChord) cursor += dur;
	}
	return { events, endTick: cursor };
};

const advancingTotal = (events: WalkedEvent[]): number =>
	events.reduce((sum, e) => sum + e.advance, 0);

const simpleChart = (): NotationChart =>
	chart([
		measure({
			entries: [
				{ kind: 'note', startTick: 0, durTicks: 48, laneIds: ['13', '1C'] },
				{ kind: 'note', startTick: 48, durTicks: 48, laneIds: ['12'] },
				{ kind: 'rest', startTick: 96, durTicks: 48 },
				{ kind: 'note', startTick: 144, durTicks: 48, laneIds: ['13'] }
			]
		})
	]);

const threeMeasureChart = (): NotationChart =>
	chart(
		[
			measure({
				index: 0,
				measureTicks: 192,
				beatsPerMeasure: 4,
				entries: [
					{ kind: 'note', startTick: 0, durTicks: 48, laneIds: ['11', '13'] },
					{ kind: 'note', startTick: 48, durTicks: 48, laneIds: ['12'] },
					{ kind: 'rest', startTick: 96, durTicks: 48 },
					{ kind: 'note', startTick: 144, durTicks: 48, laneIds: ['13'] }
				]
			}),
			measure({
				index: 1,
				measureTicks: 144,
				beatsPerMeasure: 3,
				entries: [
					{ kind: 'note', startTick: 0, durTicks: 16, laneIds: ['11'] },
					{ kind: 'rest', startTick: 16, durTicks: 16 },
					{ kind: 'note', startTick: 32, durTicks: 16, laneIds: ['12'] },
					{ kind: 'rest', startTick: 48, durTicks: 48 },
					{ kind: 'note', startTick: 96, durTicks: 48, laneIds: ['13'] }
				],
				tuplets: [{ startIndex: 0, count: 3, slotTicks: 16 }]
			}),
			measure({
				index: 2,
				measureTicks: 168,
				beatsPerMeasure: 4,
				entries: [
					{ kind: 'note', startTick: 0, durTicks: 24, laneIds: ['13'] },
					{ kind: 'note', startTick: 24, durTicks: 24, laneIds: ['12'] },
					{ kind: 'note', startTick: 48, durTicks: 24, laneIds: ['11'] },
					{ kind: 'note', startTick: 72, durTicks: 24, laneIds: ['13'] },
					{ kind: 'note', startTick: 96, durTicks: 24, laneIds: ['12'] },
					{ kind: 'note', startTick: 120, durTicks: 24, laneIds: ['11'] },
					{ kind: 'note', startTick: 144, durTicks: 24, laneIds: ['13'] }
				]
			})
		],
		[
			{ measure: 0, fraction: 0, bpm: 120 },
			{ measure: 1, fraction: 0.5, bpm: 150 }
		]
	);

describe('exportNotationChartToMusicXml', () => {
	it('produces a score-partwise document with one drum part and divisions 48', () => {
		const doc = parse(exportChart(simpleChart()));
		const root = doc.documentElement;
		expect(root.tagName).toBe('score-partwise');
		expect(root.getAttribute('version')).toBe('4.0');
		expect(doc.querySelectorAll('part-list score-part')).toHaveLength(1);
		expect(doc.querySelectorAll('part')).toHaveLength(1);
		const scorePart = doc.querySelector('score-part')!;
		expect(scorePart.getAttribute('id')).toBe('P1');
		expect(requiredChild(scorePart, 'part-name').textContent).toBe('Drum Kit');
		const firstMeasure = measuresOf(doc)[0];
		const attributes = requiredChild(firstMeasure, 'attributes');
		expect(requiredChild(attributes, 'divisions').textContent).toBe('48');
		expect(requiredChild(requiredChild(attributes, 'clef'), 'sign').textContent).toBe(
			'percussion'
		);
		expect(doc.querySelectorAll('voice')).not.toHaveLength(0);
		for (const voice of Array.from(doc.querySelectorAll('voice'))) {
			expect(voice.textContent).toBe('1');
		}
	});

	it('emits one score-instrument and midi-instrument per used lane with GM mapping', () => {
		const doc = parse(exportChart(simpleChart()));
		const scoreInstruments = Array.from(doc.querySelectorAll('score-instrument'));
		const midiInstruments = Array.from(doc.querySelectorAll('midi-instrument'));
		const expected = new Map([
			['I-12', { name: 'Snare', midi: 38 }],
			['I-13', { name: 'Bass', midi: 36 }],
			['I-1C', { name: 'Left Bass', midi: 35 }]
		]);
		expect(scoreInstruments.map((el) => el.getAttribute('id')).sort()).toEqual(
			[...expected.keys()].sort()
		);
		expect(midiInstruments.map((el) => el.getAttribute('id')).sort()).toEqual(
			[...expected.keys()].sort()
		);
		for (const el of scoreInstruments) {
			const id = el.getAttribute('id')!;
			expect(requiredChild(el, 'instrument-name').textContent).toBe(expected.get(id)!.name);
			expect(requiredChild(el, 'instrument-sound').textContent).toBe('drum.group.set');
		}
		for (const el of midiInstruments) {
			const id = el.getAttribute('id')!;
			expect(requiredChild(el, 'midi-channel').textContent).toBe('10');
			expect(requiredChild(el, 'midi-program').textContent).toBe('1');
			expect(requiredChild(el, 'midi-unpitched').textContent).toBe(
				String(expected.get(id)!.midi + 1)
			);
		}
	});

	it('writes simultaneous bass and left-bass as a chord of two distinct instruments', () => {
		const doc = parse(exportChart(simpleChart()));
		const notes = children(measuresOf(doc)[0]).filter((c) => c.tagName === 'note');
		const first = notes[0];
		const second = notes[1];
		expect(directChild(first, 'chord')).toBeUndefined();
		expect(directChild(second, 'chord')).toBeDefined();
		for (const note of [first, second]) {
			const unpitched = requiredChild(note, 'unpitched');
			expect(requiredChild(unpitched, 'display-step').textContent).toBe('F');
			expect(requiredChild(unpitched, 'display-octave').textContent).toBe('4');
			expect(requiredChild(note, 'duration').textContent).toBe('48');
			expect(requiredChild(note, 'type').textContent).toBe('quarter');
		}
		expect(requiredChild(first, 'instrument').getAttribute('id')).toBe('I-13');
		expect(requiredChild(second, 'instrument').getAttribute('id')).toBe('I-1C');
		const { events, endTick } = walkMeasure(measuresOf(doc)[0]);
		expect(endTick).toBe(192);
		expect(advancingTotal(events)).toBe(192);
		const onsetTicks = events
			.filter((e) => e.kind !== 'direction' && e.kind !== 'forward')
			.map((e) => e.tick);
		expect(onsetTicks).toEqual([0, 0, 48, 96, 144]);
	});

	it('maps hi-hat keys to x and circle-x noteheads', () => {
		const c = chart([
			measure({
				entries: [
					{ kind: 'note', startTick: 0, durTicks: 48, laneIds: ['11'] },
					{ kind: 'note', startTick: 48, durTicks: 48, laneIds: ['18'] },
					{ kind: 'note', startTick: 96, durTicks: 48, laneIds: ['12'] },
					{ kind: 'rest', startTick: 144, durTicks: 48 }
				]
			})
		]);
		const doc = parse(exportChart(c));
		const notes = children(measuresOf(doc)[0]).filter((c) => c.tagName === 'note');
		expect(requiredChild(notes[0], 'notehead').textContent).toBe('x');
		expect(requiredChild(notes[1], 'notehead').textContent).toBe('circle-x');
		expect(directChild(notes[2], 'notehead')).toBeUndefined();
		expect(directChild(notes[3], 'notehead')).toBeUndefined();
	});

	it('emits rests as rest notes with advancing durations', () => {
		const doc = parse(exportChart(simpleChart()));
		const rests = children(measuresOf(doc)[0])
			.filter((c) => c.tagName === 'note')
			.filter((n) => directChild(n, 'rest'));
		expect(rests).toHaveLength(1);
		expect(requiredChild(rests[0], 'duration').textContent).toBe('48');
		expect(requiredChild(rests[0], 'type').textContent).toBe('quarter');
		expect(directChild(rests[0], 'instrument')).toBeUndefined();
	});

	it('escapes XML special characters in title and artist', () => {
		const xml = exportChart(simpleChart(), 'Tom & Jerry <Live> "Remix"', "A&B 'Artist' <C>");
		expect(xml).toContain(
			'<movement-title>Tom &amp; Jerry &lt;Live&gt; &quot;Remix&quot;</movement-title>'
		);
		expect(xml).toContain(
			'<creator type="composer">A&amp;B &apos;Artist&apos; &lt;C&gt;</creator>'
		);
		parse(xml);
	});

	it('rejects control characters that are not allowed in XML 1.0', () => {
		for (const bad of ['\u0000', '\u0001', '\u0008', '\u000b', '\u000c', '\u000e', '\u001f']) {
			expect(() => exportChart(simpleChart(), `bad${bad}title`)).toThrow(/XML 1\.0/);
		}
		expect(() => exportChart(simpleChart(), 'ok', 'bad\u0001artist')).toThrow(/U\+0001/);
	});

	it('rejects lone surrogates and noncharacters that are not allowed in XML 1.0', () => {
		for (const bad of ['\ud800', '\udc00', '\udfff', '\ufffe', '\uffff']) {
			expect(() => exportChart(simpleChart(), `bad${bad}title`)).toThrow(/XML 1\.0/);
		}
	});

	it('accepts valid Unicode including allowed whitespace controls and astral characters', () => {
		const xml = exportChart(simpleChart(), 'Tab\tLF\nCR\r Del\u007f 音楽 🥁', 'アーティスト 𝄞');
		expect(xml).toContain('🥁');
		parse(xml);
	});

	it('derives meter from measureTicks and re-emits time only on change', () => {
		const doc = parse(exportChart(threeMeasureChart()));
		const measures = measuresOf(doc);
		const times = measures.map((m) => {
			const attributes = directChild(m, 'attributes');
			const time = attributes ? directChild(attributes, 'time') : undefined;
			return time
				? {
						beats: requiredChild(time, 'beats').textContent,
						beatType: requiredChild(time, 'beat-type').textContent
					}
				: undefined;
		});
		expect(times).toEqual([
			{ beats: '4', beatType: '4' },
			{ beats: '3', beatType: '4' },
			{ beats: '7', beatType: '8' }
		]);
	});

	it('rejects bar lengths the meter units cannot represent', () => {
		const c = chart([
			measure({
				measureTicks: 50,
				entries: [
					{ kind: 'note', startTick: 0, durTicks: 48, laneIds: ['13'] },
					{ kind: 'rest', startTick: 48, durTicks: 2 }
				]
			})
		]);
		expect(() => exportChart(c)).toThrow(/measure 1/);
	});

	it('encodes 3:2 tuplets with time-modification and tuplet start/stop', () => {
		const doc = parse(exportChart(threeMeasureChart()));
		const secondMeasure = measuresOf(doc)[1];
		const notes = children(secondMeasure).filter((c) => c.tagName === 'note');
		expect(notes).toHaveLength(5);
		for (const note of notes.slice(0, 3)) {
			expect(requiredChild(note, 'duration').textContent).toBe('16');
			expect(requiredChild(note, 'type').textContent).toBe('eighth');
			const timeMod = requiredChild(note, 'time-modification');
			expect(requiredChild(timeMod, 'actual-notes').textContent).toBe('3');
			expect(requiredChild(timeMod, 'normal-notes').textContent).toBe('2');
		}
		const firstTuplet = requiredChild(requiredChild(notes[0], 'notations'), 'tuplet');
		expect(firstTuplet.getAttribute('type')).toBe('start');
		expect(firstTuplet.getAttribute('bracket')).toBe('yes');
		const lastTuplet = requiredChild(requiredChild(notes[2], 'notations'), 'tuplet');
		expect(lastTuplet.getAttribute('type')).toBe('stop');
		expect(directChild(notes[1], 'notations')).toBeUndefined();
		expect(directChild(notes[3], 'time-modification')).toBeUndefined();
		const { endTick } = walkMeasure(secondMeasure);
		expect(endTick).toBe(144);
	});

	it('emits an interior tempo direction before its owning entry with a positive offset', () => {
		const doc = parse(exportChart(threeMeasureChart()));
		const secondMeasure = measuresOf(doc)[1];
		const directions = children(secondMeasure).filter((c) => c.tagName === 'direction');
		expect(directions).toHaveLength(1);
		const direction = directions[0];
		expect(requiredChild(direction, 'offset').textContent).toBe('24');
		expect(requiredChild(direction, 'offset').getAttribute('sound')).toBe('yes');
		expect(requiredChild(direction, 'sound').getAttribute('tempo')).toBe('150');
		const metronome = requiredChild(requiredChild(direction, 'direction-type'), 'metronome');
		expect(requiredChild(metronome, 'beat-unit').textContent).toBe('quarter');
		expect(requiredChild(metronome, 'per-minute').textContent).toBe('150');
		const kids = children(secondMeasure);
		const directionIndex = kids.indexOf(direction);
		const next = kids[directionIndex + 1];
		expect(next.tagName).toBe('note');
		expect(directChild(next, 'rest')).toBeDefined();
		const { events } = walkMeasure(secondMeasure);
		const tempoEvent = events.find((e) => e.kind === 'direction');
		expect(tempoEvent?.tick).toBe(72);
	});

	it('writes a leading forward and keeps tick-zero and interior tempos before it', () => {
		const c = chart(
			[
				measure({
					entries: [
						{ kind: 'note', startTick: 8, durTicks: 24, laneIds: ['13'] },
						{ kind: 'rest', startTick: 32, durTicks: 160 }
					]
				})
			],
			[
				{ measure: 0, fraction: 0, bpm: 120 },
				{ measure: 0, fraction: 3 / 192, bpm: 100 }
			]
		);
		const doc = parse(exportChart(c));
		const kids = children(measuresOf(doc)[0]);
		const forwardIndex = kids.findIndex((c) => c.tagName === 'forward');
		expect(forwardIndex).toBeGreaterThan(0);
		expect(Number(requiredChild(kids[forwardIndex], 'duration').textContent)).toBe(8);
		const directions = kids.filter((c) => c.tagName === 'direction');
		expect(directions).toHaveLength(2);
		for (const direction of directions) {
			expect(kids.indexOf(direction)).toBeLessThan(forwardIndex);
		}
		expect(directChild(directions[0], 'offset')).toBeUndefined();
		expect(requiredChild(directions[0], 'sound').getAttribute('tempo')).toBe('120');
		expect(requiredChild(directions[1], 'offset').textContent).toBe('3');
		expect(requiredChild(directions[1], 'sound').getAttribute('tempo')).toBe('100');
		const { events, endTick } = walkMeasure(measuresOf(doc)[0]);
		expect(endTick).toBe(192);
		expect(events.filter((e) => e.kind === 'direction').map((e) => e.tick)).toEqual([0, 3]);
		expect(events.find((e) => e.kind === 'note')?.tick).toBe(8);
	});

	it('places a tick-1 first entry after the leading forward with the initial tempo before it', () => {
		const c = chart([
			measure({
				entries: [
					{ kind: 'note', startTick: 1, durTicks: 24, laneIds: ['13'] },
					{ kind: 'rest', startTick: 25, durTicks: 167 }
				]
			})
		]);
		const doc = parse(exportChart(c));
		const kids = children(measuresOf(doc)[0]);
		const forwardIndex = kids.findIndex((c) => c.tagName === 'forward');
		const directionIndex = kids.findIndex((c) => c.tagName === 'direction');
		const firstNoteIndex = kids.findIndex((c) => c.tagName === 'note');
		expect(directionIndex).toBeGreaterThanOrEqual(0);
		expect(directionIndex).toBeLessThan(forwardIndex);
		expect(forwardIndex).toBeLessThan(firstNoteIndex);
		expect(Number(requiredChild(kids[forwardIndex], 'duration').textContent)).toBe(1);
		const { events, endTick } = walkMeasure(measuresOf(doc)[0]);
		expect(endTick).toBe(192);
		expect(events.find((e) => e.kind === 'note')?.tick).toBe(1);
		expect(events.find((e) => e.kind === 'direction')?.tick).toBe(0);
	});

	it('emits a barline tempo after the final advancing entry and before the next measure', () => {
		const c = chart(
			[
				measure({
					index: 0,
					entries: [
						{ kind: 'note', startTick: 0, durTicks: 48, laneIds: ['13'] },
						{ kind: 'note', startTick: 96, durTicks: 48, laneIds: ['12'] }
					]
				}),
				measure({
					index: 1,
					entries: [{ kind: 'note', startTick: 0, durTicks: 192, laneIds: ['13'] }]
				})
			],
			[
				{ measure: 0, fraction: 0, bpm: 120 },
				{ measure: 0, fraction: 1, bpm: 150 },
				{ measure: 1, fraction: 0, bpm: 100 }
			]
		);
		const doc = parse(exportChart(c));
		const [first, second] = measuresOf(doc);
		const firstKids = children(first);
		const barlineDirection = firstKids[firstKids.length - 1];
		expect(barlineDirection.tagName).toBe('direction');
		expect(directChild(barlineDirection, 'offset')).toBeUndefined();
		expect(requiredChild(barlineDirection, 'sound').getAttribute('tempo')).toBe('150');
		const lastAdvance = firstKids
			.filter((c) => c.tagName === 'note' || c.tagName === 'forward')
			.at(-1)!;
		expect(lastAdvance.tagName).toBe('forward');
		expect(firstKids.indexOf(lastAdvance)).toBeLessThan(firstKids.length - 1);
		const secondKids = children(second);
		const secondDirection = secondKids.find((c) => c.tagName === 'direction');
		expect(secondDirection).toBeDefined();
		expect(directChild(secondDirection!, 'offset')).toBeUndefined();
		expect(requiredChild(secondDirection!, 'sound').getAttribute('tempo')).toBe('100');
		expect(secondKids.indexOf(secondDirection!)).toBeLessThan(
			secondKids.findIndex((c) => c.tagName === 'note' || c.tagName === 'forward')
		);
		const temposInDocOrder = Array.from(doc.querySelectorAll('direction > sound')).map((el) =>
			el.getAttribute('tempo')
		);
		expect(temposInDocOrder).toEqual(['120', '150', '100']);
		const firstWalk = walkMeasure(first);
		const secondWalk = walkMeasure(second);
		expect(firstWalk.endTick).toBe(192);
		expect(secondWalk.endTick).toBe(192);
		const firstDirectionEvents = firstWalk.events.filter((e) => e.kind === 'direction');
		expect(firstDirectionEvents.map((e) => e.tick)).toEqual([0, 192]);
		const secondDirectionEvents = secondWalk.events.filter((e) => e.kind === 'direction');
		expect(secondDirectionEvents.map((e) => e.tick)).toEqual([0]);
		expect(firstDirectionEvents[1].tick).toBe(
			firstWalk.endTick + secondDirectionEvents[0].tick
		);
		const forwardEvents = firstWalk.events.filter((e) => e.kind === 'forward');
		expect(forwardEvents.map((e) => e.tick)).toEqual([48, 144]);
	});

	it('rejects a final onset whose span to the barline is below the finest written type', () => {
		const c = chart([
			measure({
				entries: [
					{ kind: 'note', startTick: 0, durTicks: 96, laneIds: ['13'] },
					{ kind: 'note', startTick: 190, durTicks: 2, laneIds: ['12'] }
				]
			})
		]);
		expect(() => exportChart(c)).toThrow(/measure 1, tick 190/);
	});

	it('rejects an inter-onset span below the finest written type', () => {
		const c = chart([
			measure({
				entries: [
					{ kind: 'note', startTick: 0, durTicks: 48, laneIds: ['13'] },
					{ kind: 'note', startTick: 2, durTicks: 48, laneIds: ['12'] },
					{ kind: 'rest', startTick: 48, durTicks: 144 }
				]
			})
		]);
		expect(() => exportChart(c)).toThrow(/measure 1, tick 0/);
	});

	it('rejects tempo events with non-finite fractions', () => {
		for (const fraction of [NaN, Infinity, -Infinity]) {
			const c = chart(
				[
					measure({
						entries: [{ kind: 'note', startTick: 0, durTicks: 192, laneIds: ['13'] }]
					})
				],
				[{ measure: 0, fraction, bpm: 120 }]
			);
			expect(() => exportChart(c)).toThrow(/measure 1 has an invalid fraction/);
		}
	});

	it('rejects duplicate measure indices', () => {
		const c = chart(
			[
				measure({
					index: 0,
					entries: [{ kind: 'note', startTick: 0, durTicks: 192, laneIds: ['13'] }]
				}),
				measure({
					index: 0,
					entries: [{ kind: 'note', startTick: 0, durTicks: 192, laneIds: ['12'] }]
				})
			],
			[{ measure: 0, fraction: 0, bpm: 120 }]
		);
		expect(() => exportChart(c)).toThrow(/duplicate measure 1/);
	});

	it('rejects measures with non-integer or negative indices', () => {
		for (const index of [-1, 0.5, NaN]) {
			const c = chart(
				[
					measure({
						index,
						entries: [{ kind: 'note', startTick: 0, durTicks: 192, laneIds: ['13'] }]
					})
				],
				[{ measure: index, fraction: 0, bpm: 120 }]
			);
			expect(() => exportChart(c)).toThrow(/invalid index/);
		}
	});

	it('routes each tempo event to the measure with the matching index', () => {
		const c = chart(
			[
				measure({
					index: 0,
					entries: [{ kind: 'note', startTick: 0, durTicks: 192, laneIds: ['13'] }]
				}),
				measure({
					index: 2,
					measureTicks: 96,
					beatsPerMeasure: 2,
					entries: [{ kind: 'note', startTick: 0, durTicks: 96, laneIds: ['12'] }]
				})
			],
			[
				{ measure: 0, fraction: 0, bpm: 120 },
				{ measure: 2, fraction: 0.5, bpm: 150 }
			]
		);
		const doc = parse(exportChart(c));
		const measures = measuresOf(doc);
		expect(measures.map((m) => m.getAttribute('number'))).toEqual(['1', '3']);
		const firstDirections = children(measures[0]).filter((c) => c.tagName === 'direction');
		expect(firstDirections).toHaveLength(1);
		expect(directChild(firstDirections[0], 'offset')).toBeUndefined();
		expect(requiredChild(firstDirections[0], 'sound').getAttribute('tempo')).toBe('120');
		const secondDirections = children(measures[1]).filter((c) => c.tagName === 'direction');
		expect(secondDirections).toHaveLength(1);
		expect(requiredChild(secondDirections[0], 'offset').textContent).toBe('48');
		expect(requiredChild(secondDirections[0], 'sound').getAttribute('tempo')).toBe('150');
		expect(children(measures[1]).indexOf(secondDirections[0])).toBeLessThan(
			children(measures[1]).findIndex((c) => c.tagName === 'note')
		);
	});

	it('emits one note per distinct canonical lane id', () => {
		const c = chart([
			measure({
				entries: [
					{ kind: 'note', startTick: 0, durTicks: 48, laneIds: ['13', '13', '1c', '1C'] },
					{ kind: 'rest', startTick: 48, durTicks: 144 }
				]
			})
		]);
		const doc = parse(exportChart(c));
		const notes = children(measuresOf(doc)[0]).filter((c) => c.tagName === 'note');
		expect(notes).toHaveLength(3);
		expect(directChild(notes[0], 'chord')).toBeUndefined();
		expect(directChild(notes[1], 'chord')).toBeDefined();
		expect(requiredChild(notes[0], 'instrument').getAttribute('id')).toBe('I-13');
		expect(requiredChild(notes[1], 'instrument').getAttribute('id')).toBe('I-1C');
		expect(directChild(notes[2], 'rest')).toBeDefined();
		expect(doc.querySelectorAll('score-instrument')).toHaveLength(2);
		const { events, endTick } = walkMeasure(measuresOf(doc)[0]);
		expect(endTick).toBe(192);
		expect(events.filter((e) => e.kind === 'note').map((e) => e.tick)).toEqual([0, 0]);
	});

	it('rejects a singleton tuplet that cannot carry a 3:2 group', () => {
		const c = chart([
			measure({
				entries: [
					{ kind: 'note', startTick: 0, durTicks: 48, laneIds: ['13'] },
					{ kind: 'rest', startTick: 48, durTicks: 144 }
				],
				tuplets: [{ startIndex: 0, count: 1, slotTicks: 16 }]
			})
		]);
		expect(() => exportChart(c)).toThrow(/measure 1.*at least 2 members/);
	});

	it('advances once per onset for chords and sums each measure exactly', () => {
		const doc = parse(exportChart(threeMeasureChart()));
		const measures = measuresOf(doc);
		const expectedTotals = [192, 144, 168];
		measures.forEach((m, i) => {
			const { events, endTick } = walkMeasure(m);
			expect(endTick).toBe(expectedTotals[i]);
			expect(advancingTotal(events)).toBe(expectedTotals[i]);
		});
		const secondMeasureOnsets = walkMeasure(measures[1])
			.events.filter((e) => e.kind === 'note' || e.kind === 'rest')
			.map((e) => e.tick);
		expect(secondMeasureOnsets).toEqual([0, 16, 32, 48, 96]);
		const secondDirection = walkMeasure(measures[1]).events.find((e) => e.kind === 'direction');
		expect(secondDirection?.tick).toBe(72);
	});

	it('matches the checked-in human-importable snapshot', async () => {
		const xml = exportChart(threeMeasureChart(), 'HPA-690 Sample Chart', 'Drumery');
		await expect(xml).toMatchFileSnapshot('./__snapshots__/hpa690-sample.musicxml');
	});
});

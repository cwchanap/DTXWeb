import { laneToStaff, type DrumStaff } from './drumMapping';
import {
	TICKS_PER_WHOLE,
	type NotationChart,
	type NotationEntry,
	type NotationMeasure,
	type NotationTempoEvent
} from './model';

export interface MusicXmlMetadata {
	title: string;
	artist?: string;
}

const DIVISIONS = TICKS_PER_WHOLE / 4;
const MIN_WRITTEN_TICKS = 3;

const TYPE_BY_TICKS: ReadonlyArray<readonly [number, string]> = [
	[192, 'whole'],
	[96, 'half'],
	[48, 'quarter'],
	[24, 'eighth'],
	[12, '16th'],
	[6, '32nd'],
	[3, '64th']
];

const METER_UNITS: ReadonlyArray<readonly [number, number]> = [
	[48, 4],
	[24, 8],
	[12, 16],
	[6, 32],
	[3, 64]
];

const escapeXml = (value: string): string => {
	for (const c of value) {
		const cp = c.codePointAt(0)!;
		const legal =
			cp === 0x9 ||
			cp === 0xa ||
			cp === 0xd ||
			(cp >= 0x20 && cp <= 0xd7ff) ||
			(cp >= 0xe000 && cp <= 0xfffd) ||
			(cp >= 0x10000 && cp <= 0x10ffff);
		if (!legal) {
			throw new Error(
				`MusicXML export: text contains a character not allowed in XML 1.0 (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`
			);
		}
	}
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
};

const instrumentId = (laneId: string): string => `I-${laneId.toUpperCase()}`;

interface StaffPosition {
	step: string;
	octave: string;
	notehead?: string;
}

const staffPosition = (key: string): StaffPosition => {
	const [letter, octave, modifier] = key.split('/');
	return {
		step: letter.toUpperCase(),
		octave,
		notehead: modifier === 'x2' ? 'x' : modifier === 'x3' ? 'circle-x' : undefined
	};
};

const meterFor = (measure: NotationMeasure): { beats: number; beatType: number } => {
	for (const [unit, beatType] of METER_UNITS) {
		if (measure.measureTicks % unit === 0) {
			return { beats: measure.measureTicks / unit, beatType };
		}
	}
	throw new Error(
		`MusicXML export: measure ${measure.index + 1} has a ${measure.measureTicks}-tick ` +
			`bar length that no supported meter unit can represent`
	);
};

interface PositionedTempo {
	eventTick: number;
	bpm: number;
}

const measureTempos = (
	measure: NotationMeasure,
	tempoEvents: NotationTempoEvent[]
): PositionedTempo[] => {
	const positioned: PositionedTempo[] = [];
	for (const event of tempoEvents) {
		if (event.measure !== measure.index) continue;
		if (!Number.isFinite(event.fraction)) {
			throw new Error(
				`MusicXML export: tempo event in measure ${measure.index + 1} has an ` +
					`invalid fraction ${event.fraction}`
			);
		}
		const eventTick = Math.round(event.fraction * measure.measureTicks);
		if (eventTick < 0 || eventTick > measure.measureTicks) {
			throw new Error(
				`MusicXML export: tempo event in measure ${measure.index + 1} falls at tick ` +
					`${eventTick}, outside the ${measure.measureTicks}-tick bar`
			);
		}
		if (!Number.isFinite(event.bpm) || event.bpm <= 0) {
			throw new Error(
				`MusicXML export: tempo event in measure ${measure.index + 1}, tick ` +
					`${eventTick} has invalid bpm ${event.bpm}`
			);
		}
		positioned.push({ eventTick, bpm: event.bpm });
	}
	return positioned.sort((a, b) => a.eventTick - b.eventTick);
};

const validateMeasure = (measure: NotationMeasure): void => {
	if (!Number.isInteger(measure.measureTicks) || measure.measureTicks < 1) {
		throw new Error(
			`MusicXML export: measure ${measure.index + 1} has invalid length ${measure.measureTicks}`
		);
	}
	let previousTick = -1;
	for (const entry of measure.entries) {
		if (
			!Number.isInteger(entry.startTick) ||
			entry.startTick < 0 ||
			entry.startTick >= measure.measureTicks
		) {
			throw new Error(
				`MusicXML export: measure ${measure.index + 1} has an entry at invalid ` +
					`tick ${entry.startTick}`
			);
		}
		if (entry.startTick <= previousTick) {
			throw new Error(
				`MusicXML export: measure ${measure.index + 1} entry startTicks must be ` +
					`strictly increasing; tick ${entry.startTick} follows tick ${previousTick}`
			);
		}
		previousTick = entry.startTick;
		if (!Number.isInteger(entry.durTicks) || entry.durTicks < 1) {
			throw new Error(
				`MusicXML export: measure ${measure.index + 1}, tick ${entry.startTick} ` +
					`has invalid written duration ${entry.durTicks}`
			);
		}
		if (entry.kind !== 'note') continue;
		if (entry.laneIds.length === 0) {
			throw new Error(
				`MusicXML export: measure ${measure.index + 1}, tick ${entry.startTick} ` +
					`note entry has no lane ids`
			);
		}
		for (const laneId of entry.laneIds) {
			if (!laneToStaff(laneId)) {
				throw new Error(
					`MusicXML export: measure ${measure.index + 1}, tick ${entry.startTick} ` +
						`references unmapped lane ${laneId}`
				);
			}
		}
	}
};

interface TupletMember {
	slotTicks: number;
	isFirst: boolean;
	isLast: boolean;
}

const buildTupletMap = (measure: NotationMeasure): Map<number, TupletMember> => {
	const members = new Map<number, TupletMember>();
	for (const tuplet of measure.tuplets) {
		const { startIndex, count, slotTicks } = tuplet;
		if (!Number.isInteger(count) || count < 2) {
			throw new Error(
				`MusicXML export: measure ${measure.index + 1} tuplet at entry index ` +
					`${startIndex} has count ${count}; a 3:2 group needs at least 2 members`
			);
		}
		if (
			!Number.isInteger(startIndex) ||
			startIndex < 0 ||
			startIndex + count > measure.entries.length
		) {
			throw new Error(
				`MusicXML export: measure ${measure.index + 1} tuplet range ` +
					`${startIndex}..${startIndex + count - 1} is outside ${measure.entries.length} entries`
			);
		}
		if (!Number.isInteger(slotTicks) || slotTicks < MIN_WRITTEN_TICKS) {
			throw new Error(
				`MusicXML export: measure ${measure.index + 1} tuplet slotTicks ` +
					`${slotTicks} is below the minimum written duration (${MIN_WRITTEN_TICKS} ticks / 64th)`
			);
		}
		for (let i = startIndex; i < startIndex + count; i++) {
			if (members.has(i)) {
				throw new Error(
					`MusicXML export: measure ${measure.index + 1} has overlapping tuplet ` +
						`ranges at entry index ${i}`
				);
			}
			members.set(i, {
				slotTicks,
				isFirst: i === startIndex,
				isLast: i === startIndex + count - 1
			});
		}
	}
	return members;
};

interface WrittenSpec {
	advance: number;
	typeName: string;
	inTuplet: boolean;
}

const resolveWritten = (
	measure: NotationMeasure,
	entry: NotationEntry,
	span: number,
	tuplet?: TupletMember
): WrittenSpec => {
	const where = `measure ${measure.index + 1}, tick ${entry.startTick}`;
	if (tuplet) {
		const baseTicks = (tuplet.slotTicks * 3) / 2;
		if (!Number.isInteger(baseTicks)) {
			throw new Error(
				`MusicXML export: ${where} tuplet slot ${tuplet.slotTicks} ticks has no ` +
					`integer 3:2 written base`
			);
		}
		const base = TYPE_BY_TICKS.find(([ticks]) => ticks === baseTicks);
		if (!base) {
			throw new Error(
				`MusicXML export: ${where} tuplet written base ${baseTicks} ticks has no ` +
					`representable note type`
			);
		}
		if (tuplet.slotTicks > span) {
			throw new Error(
				`MusicXML export: ${where} tuplet slot ${tuplet.slotTicks} ticks exceeds ` +
					`the ${span}-tick span to the next onset`
			);
		}
		return { advance: tuplet.slotTicks, typeName: base[1], inTuplet: true };
	}
	const type = TYPE_BY_TICKS.find(([ticks]) => ticks <= entry.durTicks && ticks <= span);
	if (!type) {
		throw new Error(
			`MusicXML export: ${where} ` +
				(span < MIN_WRITTEN_TICKS
					? `span ${span} ticks is shorter than the minimum written duration ` +
						`(${MIN_WRITTEN_TICKS} ticks / 64th)`
					: `written duration ${entry.durTicks} ticks has no representable note type`)
		);
	}
	return { advance: type[0], typeName: type[1], inTuplet: false };
};

const collectInstruments = (chart: NotationChart): { laneId: string; staff: DrumStaff }[] => {
	const seen = new Map<string, DrumStaff>();
	for (const measure of chart.measures) {
		for (const entry of measure.entries) {
			if (entry.kind !== 'note') continue;
			for (const laneId of entry.laneIds) {
				const staff = laneToStaff(laneId);
				if (!staff) {
					throw new Error(
						`MusicXML export: measure ${measure.index + 1}, tick ${entry.startTick} ` +
							`references unmapped lane ${laneId}`
					);
				}
				const id = laneId.toUpperCase();
				if (!seen.has(id)) seen.set(id, staff);
			}
		}
	}
	return [...seen.keys()].sort().map((laneId) => ({ laneId, staff: seen.get(laneId)! }));
};

export const exportNotationChartToMusicXml = (
	chart: NotationChart,
	metadata: MusicXmlMetadata
): string => {
	if (chart.measures.length === 0) {
		throw new Error('MusicXML export: chart has no measures');
	}
	const measureIndexes = new Set<number>();
	for (const measure of chart.measures) {
		if (!Number.isInteger(measure.index) || measure.index < 0) {
			throw new Error(
				`MusicXML export: chart has a measure with invalid index ${measure.index}`
			);
		}
		if (measureIndexes.has(measure.index)) {
			throw new Error(`MusicXML export: chart has duplicate measure ${measure.index + 1}`);
		}
		measureIndexes.add(measure.index);
	}
	for (const event of chart.tempoEvents) {
		if (!Number.isInteger(event.measure) || !measureIndexes.has(event.measure)) {
			throw new Error(
				`MusicXML export: tempo event references missing measure ${event.measure + 1}`
			);
		}
	}
	for (const measure of chart.measures) validateMeasure(measure);
	const instruments = collectInstruments(chart);

	const lines: string[] = [];
	const push = (indent: number, content: string) => lines.push('  '.repeat(indent) + content);

	const emitDirection = (bpm: number, offset: number) => {
		push(3, `<direction placement="above">`);
		push(4, `<direction-type>`);
		push(5, `<metronome>`);
		push(6, `<beat-unit>quarter</beat-unit>`);
		push(6, `<per-minute>${bpm}</per-minute>`);
		push(5, `</metronome>`);
		push(4, `</direction-type>`);
		if (offset > 0) push(4, `<offset sound="yes">${offset}</offset>`);
		push(4, `<sound tempo="${bpm}"/>`);
		push(3, `</direction>`);
	};

	const emitForward = (ticks: number) => {
		push(3, `<forward>`);
		push(4, `<duration>${ticks}</duration>`);
		push(4, `<voice>1</voice>`);
		push(3, `</forward>`);
	};

	const emitNoteBody = (
		spec: WrittenSpec,
		tupletMark: 'start' | 'stop' | undefined,
		rest: boolean,
		chord: boolean,
		laneId?: string
	) => {
		if (chord) push(4, `<chord/>`);
		let position: StaffPosition | undefined;
		if (rest) {
			push(4, `<rest/>`);
		} else {
			position = staffPosition(laneToStaff(laneId!)!.key);
			push(4, `<unpitched>`);
			push(5, `<display-step>${position.step}</display-step>`);
			push(5, `<display-octave>${position.octave}</display-octave>`);
			push(4, `</unpitched>`);
		}
		push(4, `<duration>${spec.advance}</duration>`);
		if (!rest) push(4, `<instrument id="${instrumentId(laneId!)}"/>`);
		push(4, `<voice>1</voice>`);
		push(4, `<type>${spec.typeName}</type>`);
		if (spec.inTuplet) {
			push(4, `<time-modification>`);
			push(5, `<actual-notes>3</actual-notes>`);
			push(5, `<normal-notes>2</normal-notes>`);
			push(4, `</time-modification>`);
		}
		if (position?.notehead) push(4, `<notehead>${position.notehead}</notehead>`);
		if (tupletMark) {
			push(4, `<notations>`);
			push(
				5,
				tupletMark === 'start'
					? `<tuplet type="start" bracket="yes"/>`
					: `<tuplet type="stop"/>`
			);
			push(4, `</notations>`);
		}
	};

	const emitEntry = (entry: NotationEntry, spec: WrittenSpec, member?: TupletMember) => {
		const mark = member?.isFirst ? 'start' : member?.isLast ? 'stop' : undefined;
		if (entry.kind === 'rest') {
			push(3, `<note>`);
			emitNoteBody(spec, mark, true, false);
			push(3, `</note>`);
			return;
		}
		const laneIds = [...new Set(entry.laneIds.map((laneId) => laneId.toUpperCase()))];
		laneIds.forEach((laneId, laneIndex) => {
			push(3, `<note>`);
			emitNoteBody(spec, laneIndex === 0 ? mark : undefined, false, laneIndex > 0, laneId);
			push(3, `</note>`);
		});
	};

	const emitMeasure = (
		measure: NotationMeasure,
		isFirst: boolean,
		previousMeter: { beats: number; beatType: number } | undefined
	): { beats: number; beatType: number } => {
		const meter = meterFor(measure);
		push(2, `<measure number="${measure.index + 1}">`);
		if (
			isFirst ||
			!previousMeter ||
			previousMeter.beats !== meter.beats ||
			previousMeter.beatType !== meter.beatType
		) {
			push(3, `<attributes>`);
			if (isFirst) {
				push(4, `<divisions>${DIVISIONS}</divisions>`);
				push(4, `<key>`);
				push(5, `<fifths>0</fifths>`);
				push(4, `</key>`);
			}
			push(4, `<time>`);
			push(5, `<beats>${meter.beats}</beats>`);
			push(5, `<beat-type>${meter.beatType}</beat-type>`);
			push(4, `</time>`);
			if (isFirst) {
				push(4, `<clef>`);
				push(5, `<sign>percussion</sign>`);
				push(4, `</clef>`);
			}
			push(3, `</attributes>`);
		}

		const tempos = measureTempos(measure, chart.tempoEvents);
		const entries = measure.entries;
		const firstStart = entries.length ? entries[0].startTick : measure.measureTicks;
		for (const tempo of tempos.filter((t) => t.eventTick < firstStart)) {
			emitDirection(tempo.bpm, tempo.eventTick);
		}
		if (firstStart > 0) emitForward(firstStart);

		const tupletMap = buildTupletMap(measure);
		entries.forEach((entry, i) => {
			const nextStart =
				i + 1 < entries.length ? entries[i + 1].startTick : measure.measureTicks;
			const span = nextStart - entry.startTick;
			for (const tempo of tempos.filter(
				(t) => t.eventTick >= entry.startTick && t.eventTick < nextStart
			)) {
				emitDirection(tempo.bpm, tempo.eventTick - entry.startTick);
			}
			const spec = resolveWritten(measure, entry, span, tupletMap.get(i));
			emitEntry(entry, spec, tupletMap.get(i));
			const remainder = span - spec.advance;
			if (remainder > 0) emitForward(remainder);
		});
		for (const tempo of tempos.filter((t) => t.eventTick === measure.measureTicks)) {
			emitDirection(tempo.bpm, 0);
		}
		push(2, `</measure>`);
		return meter;
	};

	lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
	lines.push(`<score-partwise version="4.0">`);
	push(1, `<movement-title>${escapeXml(metadata.title)}</movement-title>`);
	if (metadata.artist) {
		push(1, `<identification>`);
		push(2, `<creator type="composer">${escapeXml(metadata.artist)}</creator>`);
		push(1, `</identification>`);
	}
	push(1, `<part-list>`);
	push(2, `<score-part id="P1">`);
	push(3, `<part-name>Drum Kit</part-name>`);
	for (const { laneId, staff } of instruments) {
		push(3, `<score-instrument id="${instrumentId(laneId)}">`);
		push(4, `<instrument-name>${escapeXml(staff.instrumentName)}</instrument-name>`);
		push(4, `<instrument-sound>drum.group.set</instrument-sound>`);
		push(3, `</score-instrument>`);
	}
	for (const { laneId, staff } of instruments) {
		push(3, `<midi-instrument id="${instrumentId(laneId)}">`);
		push(4, `<midi-channel>10</midi-channel>`);
		push(4, `<midi-program>1</midi-program>`);
		push(4, `<midi-unpitched>${staff.midi + 1}</midi-unpitched>`);
		push(3, `</midi-instrument>`);
	}
	push(2, `</score-part>`);
	push(1, `</part-list>`);
	push(1, `<part id="P1">`);
	let previousMeter: { beats: number; beatType: number } | undefined;
	chart.measures.forEach((measure, i) => {
		previousMeter = emitMeasure(measure, i === 0, previousMeter);
	});
	push(1, `</part>`);
	lines.push(`</score-partwise>`);
	return lines.join('\n') + '\n';
};

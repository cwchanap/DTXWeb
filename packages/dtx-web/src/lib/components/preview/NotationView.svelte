<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { _ } from 'svelte-i18n';
	import {
		Renderer,
		Stave,
		StaveNote,
		Voice,
		Formatter,
		Beam,
		Tuplet,
		BarlineType,
		StaveTempo
	} from 'vexflow';
	import type { NotationChart, NotationMeasure } from '@dtx/common';
	import {
		cursorPoint,
		clickToFraction,
		activeOnset,
		snapToOnset,
		type MeasureGeometry,
		type NoteOnset
	} from './cursorGeometry';

	interface Props {
		chart: NotationChart;
		/** measure/fraction is enough for the page to convert to seconds via timing. */
		onSeek?: (pos: { measure: number; fraction: number }) => void;
		/** timing-derived position; supplied by the page each frame. */
		cursorMeasure?: number;
		cursorFraction?: number;
		/** Only auto-scroll to follow the cursor while playing, not on manual seek. */
		playing?: boolean;
	}
	let { chart, onSeek, cursorMeasure = 0, cursorFraction = 0, playing = false }: Props = $props();

	let container = $state<HTMLDivElement>();
	let highlightEl = $state<HTMLDivElement>();

	// Headroom above each stave leaves room for a StaveTempo BPM marking to
	// draw without clipping against the previous row or the container edge.
	const SYSTEM_HEIGHT = 160;
	const LEFT = 10;
	const TOP = 30;
	// A measure's width scales with how many onsets it holds, so dense measures
	// get the room they need instead of cramming notes together.
	const MIN_STAVE_WIDTH = 160;
	// Horizontal px budget per onset. VexFlow allocates space by note duration, so
	// fast 32nd-note clusters get compressed well below the average; a generous
	// budget keeps even the densest clusters legible (~20px between onsets).
	const NOTE_SPACING = 30;
	const STAVE_PADDING = 48; // clef / barline / trailing space within a stave

	// Plain (non-reactive) arrays rebuilt by renderChart.
	let geometry: MeasureGeometry[] = [];
	// Rendered onset positions (per note), used to highlight the active note as the
	// playhead passes it. Rebuilt by renderChart.
	let noteOnsets: NoteOnset[] = [];
	// Bumped from the (non-effect) ResizeObserver timeout after a relayout so the
	// highlight $effect re-syncs on resize. Chart switches already retrigger via
	// `void chart`; this covers the resize-only path. Never written inside an
	// effect, to avoid Svelte's update-depth guard.
	let resizeGen = $state(0);
	let lastScrollTop = -1;
	// The width renderChart last laid out at. The ResizeObserver re-fires when a
	// render grows the SVG's height (more rows); only a *width* change warrants a
	// re-wrap, so height-only changes are ignored to avoid a re-render feedback.
	let lastRenderedWidth = 0;

	let hlX = $state(0);
	let hlW = $state(0);
	let hlTop = $state(0);
	let hlHeight = $state(0);
	let hlVisible = $state(false);

	const tupletBaseDurTicksByEntry = (measure: NotationMeasure): Map<number, number> => {
		const covered = new Map<number, number>();
		for (const tuplet of measure.tuplets) {
			// baseDurTicks = slotTicks * 3 / 2 (groupTicks/2 where groupTicks = slotTicks*3)
			const baseDurTicks = (tuplet.slotTicks * 3) / 2;
			for (let offset = 0; offset < tuplet.count; offset++) {
				covered.set(tuplet.startIndex + offset, baseDurTicks);
			}
		}
		return covered;
	};

	const toStaveNotes = (measure: NotationMeasure): StaveNote[] => {
		const tupletDurTicks = tupletBaseDurTicksByEntry(measure);
		return measure.entries.map((entry, idx) => {
			const durationTicks = tupletDurTicks.get(idx) ?? entry.durTicks;
			if (entry.kind === 'rest') {
				// Rest position is cosmetic; b/4 is the conventional rest line.
				const code = ticksToVexflowCode(durationTicks);
				return new StaveNote({ keys: ['b/4'], duration: `${code}r` });
			}
			const code = ticksToVexflowCode(durationTicks);
			return new StaveNote({ keys: entry.keys, duration: code });
		});
	};

	// Map each (binary) duration-tick value to its VexFlow code. quantize
	// emits these plain values for notes, but off-grid positions can produce
	// rests with non-table durations (e.g. a 5-tick rest from the sub-3-tick
	// fold in pushRests). Those have no exact VexFlow glyph, so the fallback
	// picks the largest representable duration <= ticks instead of defaulting
	// to a quarter — a 5-tick rest renders as a 64th (3 ticks), not a quarter
	// (48 ticks), keeping VexFlow's glyph and spacing close to the real span.
	const TICK_CODE: Record<number, string> = {
		192: 'w',
		96: 'h',
		48: 'q',
		24: '8',
		12: '16',
		6: '32',
		3: '64'
	};
	const TICK_ENTRIES = Object.entries(TICK_CODE)
		.map(([t, c]) => [Number(t), c] as const)
		.sort((a, b) => b[0] - a[0]);
	const ticksToVexflowCode = (ticks: number): string => {
		const exact = TICK_CODE[ticks];
		if (exact) return exact;
		const entry = TICK_ENTRIES.find(([t]) => t <= ticks);
		return entry ? entry[1] : '64';
	};

	const onsetCount = (measure: NotationMeasure): number =>
		measure.entries.reduce((n, e) => n + (e.kind === 'note' ? 1 : 0), 0);

	const renderChart = () => {
		if (!container) return;
		container.innerHTML = '';
		geometry = [];
		noteOnsets = [];
		// Reset the auto-scroll tracker so a new chart's first playback doesn't
		// skip scrollIntoView because lastScrollTop still matches the old chart's
		// last row.
		lastScrollTop = -1;
		const containerWidth = container.clientWidth || 900;
		lastRenderedWidth = containerWidth;
		const usableWidth = Math.max(MIN_STAVE_WIDTH, containerWidth - LEFT * 2);

		// Pass 1: give each measure a width proportional to its onset count, then
		// pack measures left-to-right, wrapping to a new row when one won't fit.
		type LaidOutMeasure = {
			measure: NotationMeasure;
			x: number;
			y: number;
			width: number;
			row: number;
		};
		const layout: LaidOutMeasure[] = [];
		let x = LEFT;
		let row = 0;
		for (const measure of chart.measures) {
			const width = Math.min(
				usableWidth,
				Math.max(MIN_STAVE_WIDTH, onsetCount(measure) * NOTE_SPACING + STAVE_PADDING)
			);
			if (x !== LEFT && x + width > LEFT + usableWidth) {
				row++;
				x = LEFT;
			}
			layout.push({ measure, x, y: TOP + row * SYSTEM_HEIGHT, width, row });
			x += width;
		}

		const rows = row + 1;

		// Pass 2: justify every wrapped row (all but the last) so its staves stretch
		// to the right edge instead of leaving a ragged gap where a measure didn't
		// fit. The last row keeps its natural width to avoid over-spreading a lone
		// trailing measure.
		const lastRow = layout.length ? layout[layout.length - 1].row : 0;
		const byRow = new Map<number, LaidOutMeasure[]>();
		for (const item of layout) {
			const arr = byRow.get(item.row);
			if (arr) arr.push(item);
			else byRow.set(item.row, [item]);
		}
		for (const [r, items] of byRow) {
			if (r === lastRow) continue;
			const natural = items.reduce((sum, it) => sum + it.width, 0);
			if (natural <= 0) continue;
			const scale = usableWidth / natural;
			let rx = LEFT;
			for (const it of items) {
				it.width *= scale;
				it.x = rx;
				rx += it.width;
			}
		}
		const renderer = new Renderer(container, Renderer.Backends.SVG);
		renderer.resize(containerWidth, TOP + rows * SYSTEM_HEIGHT + 40);
		const context = renderer.getContext();

		// Group tempo events by measure once per render so each stave looks up
		// its own marks in O(1) instead of filtering the whole chart per measure.
		const tempoEventsByMeasure = new Map<number, typeof chart.tempoEvents>();
		for (const event of chart.tempoEvents) {
			const events = tempoEventsByMeasure.get(event.measure);
			if (events) events.push(event);
			else tempoEventsByMeasure.set(event.measure, [event]);
		}

		layout.forEach(({ measure, x, y, width, row }, i) => {
			const firstInRow = x === LEFT;
			const stave = new Stave(x, y, width);
			// VexFlow draws a begin bar on every stave by default, which doubles up
			// with the previous stave's end bar for adjacent measures in the same
			// row. Only the first stave in a row needs its (implicit) begin bar.
			if (!firstInRow) stave.setBegBarType(BarlineType.NONE);
			if (firstInRow) stave.addClef('percussion');
			if (i === 0) stave.addTimeSignature(`${measure.beatsPerMeasure}/4`);
			stave.setContext(context).draw();

			try {
				context.save();
				context.setFont('Arial', 10);
				context.fillText(`${measure.index}`, x + 4, y - 10);
				context.restore();
				const notes = toStaveNotes(measure);
				const tuplets = measure.tuplets.map((tuplet) => {
					// Guard against a malformed tuplet whose startIndex + count
					// exceeds the entry array — slice clamps silently, which would
					// hand VexFlow a short note list instead of failing loudly.
					const end = Math.min(tuplet.startIndex + tuplet.count, notes.length);
					return new Tuplet(notes.slice(tuplet.startIndex, end), {
						num_notes: 3,
						notes_occupied: 2
					});
				});
				const voice = new Voice({
					num_beats: measure.beatsPerMeasure,
					beat_value: 4
				}).setStrict(false);
				voice.addTickables(notes);
				// Generate beams BEFORE drawing the voice: beaming sets each note's beam
				// reference, which suppresses its individual flag/tail at draw time.
				// Split into contiguous note groups (runs of consecutive note entries
				// uninterrupted by rests) so beams don't cross rest boundaries —
				// otherwise an eighth note, eighth rest, eighth note would render as
				// one beamed group, misrepresenting the rhythm.
				const noteGroups: StaveNote[][] = [];
				let currentGroup: StaveNote[] = [];
				measure.entries.forEach((entry, idx) => {
					if (entry.kind === 'note') {
						currentGroup.push(notes[idx]);
					} else if (currentGroup.length > 0) {
						noteGroups.push(currentGroup);
						currentGroup = [];
					}
				});
				if (currentGroup.length > 0) noteGroups.push(currentGroup);
				const beams = noteGroups.flatMap((group) => Beam.generateBeams(group));
				new Formatter()
					.joinVoices([voice])
					.format([voice], Math.max(40, width - STAVE_PADDING));
				voice.draw(context, stave);
				beams.forEach((b) => b.setContext(context).draw());
				tuplets.forEach((tuplet) => tuplet.setContext(context).draw());
				// Draw BPM markings via isolated StaveTempo annotations, never as
				// rhythmic Voice tickables — they must not affect note spacing or
				// cursor geometry. One path covers both measure-start (fraction 0)
				// and mid-measure marks: the fraction interpolates linearly between
				// the stave's note start/end x. Each annotation is caught
				// independently so a failing tempo mark can't drop the measure.
				const tempoEvents = tempoEventsByMeasure.get(measure.index) ?? [];
				for (const event of tempoEvents) {
					try {
						const startX = stave.getNoteStartX();
						const endX = stave.getNoteEndX();
						const xPos = startX + event.fraction * (endX - startX);
						new StaveTempo({ bpm: event.bpm, duration: 'q' }, xPos, 0).draw(stave, 0);
					} catch (error) {
						console.warn(`Failed to render tempo in measure ${measure.index}`, error);
					}
				}
				// Capture rendered note x-extents for the active-note highlight.
				measure.entries.forEach((entry, idx) => {
					if (entry.kind !== 'note') return;
					try {
						const bb = notes[idx].getBoundingBox();
						noteOnsets.push({
							measure: measure.index,
							position: entry.startTick / measure.measureTicks,
							x: bb.getX(),
							w: bb.getW()
						});
					} catch {
						/* not measurable (e.g. jsdom in tests) */
					}
				});
			} catch (err) {
				console.warn(`Failed to render measure ${measure.index}`, err);
			}

			geometry.push({
				index: measure.index,
				systemRow: row,
				xStart: stave.getNoteStartX(),
				xEnd: stave.getNoteEndX(),
				top: y,
				height: SYSTEM_HEIGHT
			});
		});
	};

	let resizeObserver: ResizeObserver | undefined;
	let resizeTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		// Initial render is handled by the `void chart` $effect below, which
		// runs after mount. Setting up the ResizeObserver here is all onMount
		// needs to do — calling renderChart() here too would double-render on
		// mount (once in onMount, once in the $effect).
		resizeObserver = new ResizeObserver(() => {
			// The only legitimate re-render trigger is a *width* change (responsive
			// re-wrap). A render grows the SVG's height, which re-fires this
			// observer; ignoring width-stable callbacks breaks that feedback loop
			// and removes the redundant re-render noise on first paint.
			const width = container?.clientWidth ?? 0;
			if (width === lastRenderedWidth) return;
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				renderChart();
				// Bumped outside any effect so the highlight overlay re-syncs after a
				// resize-driven relayout without tripping the update-depth guard.
				resizeGen++;
			}, 150);
		});
		if (container) resizeObserver.observe(container);
	});

	onDestroy(() => {
		clearTimeout(resizeTimer);
		resizeObserver?.disconnect();
	});

	$effect(() => {
		// Re-render when the chart reference changes (e.g. level switch).
		void chart;
		renderChart();
	});

	const handleClick = (event: MouseEvent) => {
		if (!container || !onSeek) return;
		const rect = container.getBoundingClientRect();
		const contentX = event.clientX - rect.left + container.scrollLeft;
		const pos = clickToFraction(contentX, event.clientY - rect.top, geometry);
		if (!pos) return;
		// Snap to the nearest note so the cursor and highlight land together.
		const fraction = snapToOnset(pos.measure, contentX, pos.fraction, noteOnsets);
		onSeek({ measure: pos.measure, fraction });
	};

	const handleKeydown = (event: KeyboardEvent) => {
		// The seek surface has role="slider", so it must be operable from the
		// keyboard: Arrow/Home/End actually move the playhead, not just suppress
		// scrolling. The slider's unit is a measure; valid range is 0..(measure
		// count − 1), so aria-valuemax matches lastMeasure below.
		if (!onSeek) {
			if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
			return;
		}
		const lastMeasure = Math.max(0, chart.measures.length - 1);
		switch (event.key) {
			case 'ArrowLeft':
			case 'ArrowDown':
				event.preventDefault();
				onSeek({ measure: Math.max(0, cursorMeasure - 1), fraction: 0 });
				break;
			case 'ArrowRight':
			case 'ArrowUp':
				event.preventDefault();
				onSeek({ measure: Math.min(lastMeasure, cursorMeasure + 1), fraction: 0 });
				break;
			case 'Home':
				event.preventDefault();
				onSeek({ measure: 0, fraction: 0 });
				break;
			case 'End':
				event.preventDefault();
				onSeek({ measure: lastMeasure, fraction: 1 });
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				break;
		}
	};

	$effect(() => {
		// Re-run after each geometry rebuild and whenever the timing-derived
		// position changes. `resizeGen` is bumped from the ResizeObserver timeout
		// after a relayout, so the overlay re-syncs on resize even while paused.
		// `void chart` covers chart switches (which retrigger renderChart).
		void chart;
		void resizeGen;
		const point = cursorPoint(cursorMeasure, cursorFraction, geometry);
		const active = activeOnset(cursorMeasure, cursorFraction, noteOnsets);
		if (!point) {
			hlVisible = false;
			return;
		}

		// Highlight the note the playhead is currently on.
		if (active) {
			hlVisible = true;
			hlX = active.x - 3;
			hlW = active.w + 6;
			hlTop = point.top;
			hlHeight = point.height;
		} else {
			hlVisible = false;
		}

		// Follow the highlight only during playback (no-op in jsdom). Manual seeks
		// must not yank the view, so don't scroll while paused. Only scroll when
		// the row changes, to avoid per-frame scroll jank.
		if (playing && point.top !== lastScrollTop) {
			lastScrollTop = point.top;
			highlightEl?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
		}
	});
</script>

<div class="notation-wrapper">
	<div
		bind:this={container}
		data-testid="notation-container"
		class="notation-container"
		role="slider"
		tabindex="0"
		aria-label={$_('preview.seek')}
		aria-valuemin={0}
		aria-valuemax={Math.max(0, chart.measures.length - 1)}
		aria-valuenow={cursorMeasure}
		aria-valuetext={chart.measures.length === 0
			? $_('preview.seek')
			: $_('preview.seek_value', {
					values: { measure: cursorMeasure + 1, total: chart.measures.length }
				})}
		onclick={handleClick}
		onkeydown={handleKeydown}
	></div>
	{#if hlVisible}
		<div
			bind:this={highlightEl}
			data-testid="notation-note-highlight"
			class="notation-note-highlight"
			style="left:{hlX}px; top:{hlTop}px; width:{hlW}px; height:{hlHeight}px;"
		></div>
	{/if}
</div>

<style>
	.notation-wrapper {
		position: relative;
		width: 100%;
	}
	.notation-container {
		width: 100%;
		overflow-x: auto;
		background: white;
	}
	.notation-note-highlight {
		position: absolute;
		background: rgba(59, 130, 246, 0.25);
		border-radius: 3px;
		pointer-events: none;
	}
</style>

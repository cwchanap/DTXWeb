<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { _ } from 'svelte-i18n';
	import { Renderer, Stave, StaveNote, Voice, Formatter, Beam } from 'vexflow';
	import type { NotationChart, NotationMeasure } from '@dtx/common';
	import {
		cursorPoint,
		clickToFraction,
		playheadAt,
		snapToOnset,
		type MeasureGeometry,
		type NoteOnset
	} from './cursorGeometry';

	interface Props {
		chart: NotationChart;
		currentTime?: number;
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
	let cursorEl = $state<HTMLDivElement>();

	const SYSTEM_HEIGHT = 140;
	const LEFT = 10;
	const TOP = 20;
	// A measure's width scales with how many onsets it holds, so dense measures
	// get the room they need instead of cramming notes together.
	const MIN_STAVE_WIDTH = 160;
	// Horizontal px budget per onset. VexFlow allocates space by note duration, so
	// fast 32nd-note clusters get compressed well below the average; a generous
	// budget keeps even the densest clusters legible (~20px between onsets).
	const NOTE_SPACING = 30;
	const STAVE_PADDING = 48; // clef / barline / trailing space within a stave

	let geometry: MeasureGeometry[] = [];
	// Rendered onset positions (per note), used to highlight the active note as the
	// cursor passes it. Plain (non-reactive) array, rebuilt by renderChart.
	let noteOnsets: NoteOnset[] = [];
	let lastScrollTop = -1;

	let cursorX = $state(0);
	let cursorTop = $state(0);
	let cursorHeight = $state(0);
	let cursorVisible = $state(false);

	let hlX = $state(0);
	let hlW = $state(0);
	let hlTop = $state(0);
	let hlHeight = $state(0);
	let hlVisible = $state(false);

	const toStaveNotes = (measure: NotationMeasure): StaveNote[] =>
		measure.entries.map((entry) => {
			if (entry.kind === 'rest') {
				// Rest position is cosmetic; b/4 is the conventional rest line.
				const code = ticksToRestCode(entry.durTicks);
				return new StaveNote({ keys: ['b/4'], duration: `${code}r` });
			}
			const code = ticksToRestCode(entry.durTicks);
			return new StaveNote({ keys: entry.keys, duration: code });
		});

	// Map each (binary) duration-tick value to its VexFlow code. quantize only emits
	// these plain values, so every note/rest duration maps cleanly.
	const TICK_CODE: Record<number, string> = {
		192: 'w',
		96: 'h',
		48: 'q',
		24: '8',
		12: '16',
		6: '32',
		3: '64'
	};
	const ticksToRestCode = (ticks: number): string => TICK_CODE[ticks] ?? 'q';

	const onsetCount = (measure: NotationMeasure): number =>
		measure.entries.reduce((n, e) => n + (e.kind === 'note' ? 1 : 0), 0);

	const renderChart = () => {
		if (!container) return;
		container.innerHTML = '';
		geometry = [];
		noteOnsets = [];
		const containerWidth = container.clientWidth || 900;
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
			(byRow.get(item.row) ?? byRow.set(item.row, []).get(item.row)!).push(item);
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

		layout.forEach(({ measure, x, y, width, row }, i) => {
			const firstInRow = x === LEFT;
			const stave = new Stave(x, y, width);
			if (firstInRow) stave.addClef('percussion');
			if (i === 0) stave.addTimeSignature(`${measure.beatsPerMeasure}/4`);
			stave.setContext(context).draw();

			try {
				const notes = toStaveNotes(measure);
				const voice = new Voice({
					num_beats: measure.beatsPerMeasure,
					beat_value: 4
				}).setStrict(false);
				voice.addTickables(notes);
				const onlyNotes = notes.filter((_, idx) => measure.entries[idx].kind === 'note');
				// Generate beams BEFORE drawing the voice: beaming sets each note's beam
				// reference, which suppresses its individual flag/tail at draw time.
				const beams = Beam.generateBeams(onlyNotes);
				new Formatter()
					.joinVoices([voice])
					.format([voice], Math.max(40, width - STAVE_PADDING));
				voice.draw(context, stave);
				beams.forEach((b) => b.setContext(context).draw());
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
		renderChart();
		resizeObserver = new ResizeObserver(() => {
			clearTimeout(resizeTimer);
			resizeTimer = setTimeout(renderChart, 150);
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
		if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
	};

	$effect(() => {
		// Re-run after each geometry rebuild (chart change) and whenever the
		// timing-derived position changes. `geometry` is intentionally a plain
		// (non-reactive) array; the chart dependency drives the re-read.
		void chart;
		const point = cursorPoint(cursorMeasure, cursorFraction, geometry);
		const playhead = playheadAt(cursorMeasure, cursorFraction, geometry, noteOnsets);
		if (!point || !playhead) {
			cursorVisible = false;
			hlVisible = false;
			return;
		}
		cursorVisible = true;
		// Cursor x follows the rendered note layout (see playheadAt) so the bar
		// stays aligned with the highlighted note instead of drifting ahead of it.
		cursorX = playhead.x;
		cursorTop = point.top;
		cursorHeight = point.height;

		// Highlight the note the cursor is currently on.
		if (playhead.active) {
			hlVisible = true;
			hlX = playhead.active.x - 3;
			hlW = playhead.active.w + 6;
			hlTop = point.top;
			hlHeight = point.height;
		} else {
			hlVisible = false;
		}

		// Follow the cursor only during playback (no-op in jsdom). Manual seeks
		// must not yank the view, so don't scroll while paused. Only scroll when
		// the row changes, to avoid per-frame scroll jank.
		if (playing && point.top !== lastScrollTop) {
			lastScrollTop = point.top;
			cursorEl?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
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
		aria-valuemax={chart.measures.length}
		aria-valuenow={cursorMeasure}
		onclick={handleClick}
		onkeydown={handleKeydown}
	></div>
	{#if hlVisible}
		<div
			data-testid="notation-note-highlight"
			class="notation-note-highlight"
			style="left:{hlX}px; top:{hlTop}px; width:{hlW}px; height:{hlHeight}px;"
		></div>
	{/if}
	{#if cursorVisible}
		<div
			bind:this={cursorEl}
			data-testid="notation-cursor"
			class="notation-cursor"
			style="left:{cursorX}px; top:{cursorTop}px; height:{cursorHeight}px;"
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
	.notation-cursor {
		position: absolute;
		width: 2px;
		background: rgba(220, 38, 38, 0.85);
		pointer-events: none;
	}
</style>

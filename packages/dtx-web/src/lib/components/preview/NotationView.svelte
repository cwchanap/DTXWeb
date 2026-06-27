<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Renderer, Stave, StaveNote, Voice, Formatter, Beam } from 'vexflow';
	import type { NotationChart, NotationMeasure } from '@dtx/common';
	import { cursorPoint, clickToFraction, type MeasureGeometry } from './cursorGeometry';

	interface Props {
		chart: NotationChart;
		currentTime?: number;
		/** measure/fraction is enough for the page to convert to seconds via timing. */
		onSeek?: (pos: { measure: number; fraction: number }) => void;
		/** timing-derived position; supplied by the page each frame. */
		cursorMeasure?: number;
		cursorFraction?: number;
	}
	let { chart, onSeek, cursorMeasure = 0, cursorFraction = 0 }: Props = $props();

	let container = $state<HTMLDivElement>();

	const MEASURES_PER_SYSTEM = 4;
	const SYSTEM_HEIGHT = 140;
	const STAVE_WIDTH = 260;
	const LEFT = 10;
	const TOP = 20;

	let geometry: MeasureGeometry[] = [];

	let cursorX = $state(0);
	let cursorTop = $state(0);
	let cursorHeight = $state(0);
	let cursorVisible = $state(false);

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

	const renderChart = () => {
		if (!container) return;
		container.innerHTML = '';
		geometry = [];
		const width = container.clientWidth || STAVE_WIDTH * MEASURES_PER_SYSTEM + LEFT * 2;
		const rows = Math.ceil(chart.measures.length / MEASURES_PER_SYSTEM);
		const renderer = new Renderer(container, Renderer.Backends.SVG);
		renderer.resize(width, TOP + rows * SYSTEM_HEIGHT + 40);
		const context = renderer.getContext();

		const usableWidth = width - LEFT * 2;
		const staveWidth = Math.max(160, usableWidth / MEASURES_PER_SYSTEM);

		chart.measures.forEach((measure, i) => {
			const row = Math.floor(i / MEASURES_PER_SYSTEM);
			const col = i % MEASURES_PER_SYSTEM;
			const x = LEFT + col * staveWidth;
			const y = TOP + row * SYSTEM_HEIGHT;
			const stave = new Stave(x, y, staveWidth);
			if (col === 0) stave.addClef('percussion');
			if (i === 0) stave.addTimeSignature(`${measure.beatsPerMeasure}/4`);
			stave.setContext(context).draw();

			try {
				const notes = toStaveNotes(measure);
				const voice = new Voice({
					num_beats: measure.beatsPerMeasure,
					beat_value: 4
				}).setStrict(false);
				voice.addTickables(notes);
				new Formatter().joinVoices([voice]).format([voice], staveWidth - 40);
				voice.draw(context, stave);
				const onlyNotes = notes.filter((_, idx) => measure.entries[idx].kind === 'note');
				Beam.generateBeams(onlyNotes).forEach((b) => b.setContext(context).draw());
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
		const pos = clickToFraction(
			event.clientX - rect.left + container.scrollLeft,
			event.clientY - rect.top,
			geometry
		);
		if (pos) onSeek(pos);
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
		if (!point) {
			cursorVisible = false;
			return;
		}
		cursorVisible = true;
		cursorX = point.x;
		cursorTop = point.top;
		cursorHeight = point.height;
		// Autoscroll the active position into view (no-op in jsdom).
		container?.scrollTo?.({ left: Math.max(0, point.x - 200), behavior: 'smooth' });
	});
</script>

<div class="notation-wrapper">
	<div
		bind:this={container}
		data-testid="notation-container"
		class="notation-container"
		role="slider"
		tabindex="0"
		aria-label="Seek position"
		aria-valuemin={0}
		aria-valuemax={chart.measures.length}
		aria-valuenow={cursorMeasure}
		onclick={handleClick}
		onkeydown={handleKeydown}
	></div>
	{#if cursorVisible}
		<div
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
	.notation-cursor {
		position: absolute;
		width: 2px;
		background: rgba(220, 38, 38, 0.85);
		pointer-events: none;
	}
</style>

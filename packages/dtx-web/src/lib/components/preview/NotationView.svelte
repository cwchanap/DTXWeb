<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Renderer, Stave, StaveNote, Voice, Formatter, Beam } from 'vexflow';
	import type { NotationChart, NotationMeasure } from '@dtx/common';

	interface Props {
		chart: NotationChart;
	}
	let { chart }: Props = $props();

	let container = $state<HTMLDivElement>();

	const MEASURES_PER_SYSTEM = 4;
	const SYSTEM_HEIGHT = 140;
	const STAVE_WIDTH = 260;
	const LEFT = 10;
	const TOP = 20;

	/** Geometry recorded per measure for the cursor (consumed in M3). */
	interface MeasureGeometry {
		index: number;
		systemRow: number;
		xStart: number;
		xEnd: number;
		top: number;
		height: number;
	}
	let geometry: MeasureGeometry[] = [];

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
					numBeats: measure.beatsPerMeasure,
					beatValue: 4
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
</script>

<div bind:this={container} data-testid="notation-container" class="notation-container"></div>

<style>
	.notation-container {
		width: 100%;
		overflow-x: auto;
		background: white;
	}
</style>

<script lang="ts">
	import { _ } from 'svelte-i18n';
	import ScoreList from '$lib/components/ScoreList.svelte';
</script>

<div class="container mx-auto p-4">
	<div class="mb-4">
		<h1 class="text-2xl font-bold">{$_('score.my_scores')}</h1>
	</div>
	<ScoreList />
</div>

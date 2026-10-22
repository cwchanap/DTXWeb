import { browser } from '$app/environment';
import { init, register } from 'svelte-i18n';

const defaultLocale = 'en';

register('en', () => import('./locales/en.json'));
register('jp', () => import('./locales/jp.json'));

// Browsers report BCP 47 tags (e.g. 'ja-JP'); the Japanese dictionary is registered as 'jp'.
export const normalizeLocale = (locale: string): string => {
	const base = locale.toLowerCase().split('-')[0];
	return base === 'ja' ? 'jp' : base;
};

init({
	fallbackLocale: defaultLocale,
	initialLocale: browser ? normalizeLocale(window.navigator.language) : defaultLocale
});

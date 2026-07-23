import { init, register } from 'svelte-i18n';

const defaultLocale = 'en';

register('en', () => import('./locales/en.json'));
register('ja', () => import('./locales/jp.json'));

const normalizeLocale = (locale: string): string => {
	const base = locale.toLowerCase().split('-')[0];
	return base === 'jp' ? 'ja' : base;
};

init({
	fallbackLocale: defaultLocale,
	initialLocale:
		typeof navigator !== 'undefined' ? normalizeLocale(navigator.language) : defaultLocale
});

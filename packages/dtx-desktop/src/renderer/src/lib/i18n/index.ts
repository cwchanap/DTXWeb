import { init, register } from 'svelte-i18n';

const defaultLocale = 'en';

register('en', () => import('./locales/en.json'));
register('jp', () => import('./locales/jp.json'));

init({
	fallbackLocale: defaultLocale,
	initialLocale: typeof navigator !== 'undefined' ? navigator.language : defaultLocale
});

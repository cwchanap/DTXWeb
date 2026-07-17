import en from '../renderer/src/lib/i18n/locales/en.json';

// Resolve a dotted key path (e.g. "score.link.to_cloud") against the locale
// object. Returns the key itself when not found so missing keys are visible.
const resolve = (obj: unknown, key: string): string => {
	const parts = key.split('.');
	let cur: unknown = obj;
	for (const part of parts) {
		if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
			cur = (cur as Record<string, unknown>)[part];
		} else {
			return key;
		}
	}
	return typeof cur === 'string' ? cur : key;
};

// svelte-i18n interpolation: replace {name} placeholders with values. Params
// arrive as { values: { ... } } (the MessageObject shape).
const interpolate = (template: string, params?: { values?: Record<string, unknown> }): string => {
	if (!params?.values) return template;
	return template.replace(/\{(\w+)\}/g, (_, name: string) => {
		const v = params.values?.[name];
		return v !== undefined ? String(v) : `{${name}}`;
	});
};

const translate = (key: string, params?: { values?: Record<string, unknown> }): string =>
	interpolate(resolve(en, key), params);

export const _ = {
	subscribe: (
		cb: (fn: (key: string, params?: { values?: Record<string, unknown> }) => string) => void
	) => {
		cb(translate);
		return () => {};
	}
};

export const locale = {
	subscribe: (cb: (value: string) => void) => {
		cb('en');
		return () => {};
	}
};

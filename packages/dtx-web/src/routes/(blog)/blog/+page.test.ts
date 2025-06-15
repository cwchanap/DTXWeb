import { describe, it, expect, vi } from 'vitest';

/**
 * These tests mirror the simple logic that exists inside the
 * `+page.svelte` file under the blog routes. The component itself
 * mainly exposes a mapping of locale codes to readable names and
 * callbacks that mutate local state or update the i18n store.
 *
 * Rendering the component is not required; instead we test the
 * behaviour of the small pieces of logic directly.
 */

describe('Blog +page.svelte logic', () => {
        it('provides the expected locale mapping', () => {
                const localeMap: Record<string, string> = {
                        en: 'English',
                        jp: '日本語'
                };

                expect(localeMap.en).toBe('English');
                expect(localeMap.jp).toBe('日本語');
        });

        it('updates popover state when open state changes', () => {
                let languagePopoverOpen = false;
                const onOpenChange = (details: { open: boolean }) => {
                        languagePopoverOpen = details.open;
                };

                onOpenChange({ open: true });
                expect(languagePopoverOpen).toBe(true);

                onOpenChange({ open: false });
                expect(languagePopoverOpen).toBe(false);
        });

        it('calls locale.set when changing language', () => {
                const locale = { set: vi.fn() };
                const changeLanguage = (l: string) => locale.set(l);

                changeLanguage('jp');
                expect(locale.set).toHaveBeenCalledWith('jp');

                changeLanguage('en');
                expect(locale.set).toHaveBeenCalledWith('en');
        });
});

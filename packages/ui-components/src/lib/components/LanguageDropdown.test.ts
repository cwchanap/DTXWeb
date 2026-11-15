import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LanguageDropdown from './LanguageDropdown.svelte';

const localeMap = { en: 'English', jp: '日本語', fr: 'Français' };

const renderOpen = (locales: string[]) =>
	render(LanguageDropdown, { props: { isOpen: true, locales, localeMap } });

const menuItems = () => screen.getAllByRole('menuitem');

describe('LanguageDropdown keyboard focus after locales change', () => {
	it('focuses the visually-last item with End after locales reorder', async () => {
		const { rerender } = renderOpen(['en', 'jp', 'fr']);
		menuItems()[1].focus();
		await rerender({ locales: ['fr', 'en', 'jp'] });
		await fireEvent.keyDown(window, { key: 'End' });
		expect(document.activeElement).toHaveTextContent('日本語');
		await fireEvent.keyDown(window, { key: 'Home' });
		expect(document.activeElement).toHaveTextContent('Français');
	});

	it('keeps arrow navigation in visual order after a locale is inserted', async () => {
		const { rerender } = renderOpen(['en', 'fr']);
		await rerender({ locales: ['en', 'jp', 'fr'] });
		menuItems()[1].focus();
		await fireEvent.keyDown(window, { key: 'ArrowDown' });
		expect(document.activeElement).toHaveTextContent('Français');
	});

	it('focuses the first item with Home after a locale is removed', async () => {
		const { rerender } = renderOpen(['en', 'jp', 'fr']);
		await rerender({ locales: ['jp', 'fr'] });
		menuItems()[1].focus();
		await fireEvent.keyDown(window, { key: 'Home' });
		expect(document.activeElement).toHaveTextContent('日本語');
	});
});

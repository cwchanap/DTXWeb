import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const localeMock = vi.hoisted(() => ({ set: vi.fn() }));
const localesMock = vi.hoisted(() => ({
	subscribe: (run: (value: string[]) => void) => {
		run(['en', 'jp']);
		return () => {};
	}
}));
const translateMock = vi.hoisted(
	() =>
		(key: string): string =>
			key
);

vi.mock('svelte-i18n', () => ({
	locale: localeMock,
	locales: localesMock,
	_: {
		subscribe: (run: (value: (key: string) => string) => void) => {
			run(translateMock);
			return () => {};
		}
	}
}));

vi.mock('$lib/components/ChartList.svelte', () => ({
	default: vi.fn()
}));

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_ENABLE_BLOG_DOWNLOAD: 'false' }
}));

import BlogPage from './+page.svelte';

describe('Blog Page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the page header', () => {
		render(BlogPage);
		expect(screen.getByText('blog.welcome_message')).toBeInTheDocument();
	});

	it('renders the language change button', () => {
		render(BlogPage);
		expect(screen.getByText('blog.change_language')).toBeInTheDocument();
	});

	it('shows language dropdown when language button is clicked', async () => {
		render(BlogPage);
		const langButton = screen.getByText('blog.change_language');
		await fireEvent.click(langButton);
		expect(screen.getByText('English')).toBeInTheDocument();
	});

	it('changes locale when a language option is clicked', async () => {
		render(BlogPage);
		const langButton = screen.getByText('blog.change_language');
		await fireEvent.click(langButton);
		const enButton = screen.getByText('English');
		await fireEvent.click(enButton);
		expect(localeMock.set).toHaveBeenCalledWith('en');
	});

	it('closes language dropdown when clicking outside', async () => {
		render(BlogPage);
		const langButton = screen.getByText('blog.change_language');
		await fireEvent.click(langButton);
		expect(screen.getByText('English')).toBeInTheDocument();

		await fireEvent.click(document.body);
		expect(screen.queryByText('English')).not.toBeInTheDocument();
	});
});

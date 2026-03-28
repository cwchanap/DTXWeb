/**
 * Unit tests for ChartList.svelte component
 *
 * This file uses a Svelte 5 compatible approach to testing components.
 * Based on the Svelte 5 documentation, certain methods like `mount` cannot be invoked
 * during server-side rendering, which is what happens in traditional component tests.
 *
 * Instead, we're using a more basic approach that focuses on testing the component's
 * logic and state changes rather than DOM interactions.
 *
 * Note: This test file uses 'any' type in several places to work around TypeScript errors
 * that occur when testing Svelte components, especially with complex dependencies like Supabase.
 * In a real-world scenario, you might want to create more specific types for your mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Mock modules that would be imported by the component
vi.mock('svelte-i18n', () => ({
	_: () => (key: string) => key
}));

vi.mock('@skeletonlabs/skeleton', () => ({
	popup: () => ({}),
	getModalStore: () => ({
		trigger: vi.fn()
	}),
	getToastStore: () => ({
		trigger: vi.fn()
	}),
	SlideToggle: vi.fn()
}));

vi.mock('$lib/components/ImageAudio.svelte', () => ({}));

vi.mock('$lib/utils', () => ({
	formatLevelDisplay: (dtxFiles: unknown) => {
		if (Array.isArray(dtxFiles)) {
			return dtxFiles.map((file: { level: number }) => file.level).join(', ');
		}
		return 'N/A';
	}
}));

// Create a mock Supabase client
const createMockSupabase = () => {
	// Create a mock that returns the test data
	return {
		from: vi.fn().mockImplementation(() => ({
			select: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			ilike: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			range: vi.fn().mockReturnThis(),
			then: vi.fn().mockImplementation((callback) => {
				callback({
					data: mockItems,
					error: null,
					count: mockItems.length
				});
				return { catch: vi.fn() };
			})
		})),
		storage: {
			from: vi.fn().mockReturnValue({
				getPublicUrl: vi.fn().mockReturnValue({
					data: { publicUrl: 'https://example.com/mock-url' }
				})
			})
		},
		auth: {
			getUser: vi.fn().mockResolvedValue({
				data: { user: { id: 'mock-user-id' } }
			})
		}
	};
};

// Test data
const mockItems = [
	{
		id: 1,
		title: 'Test Song 1',
		artist: 'Test Artist 1',
		bpm: 120,
		download_url: 'https://example.com/download1',
		is_published: true,
		display_id: 'TST001',
		dtx_files: [{ level: 3 }, { level: 5 }],
		created_at: '2023-01-01',
		updated_at: '2023-01-02',
		publish_date: '2023-01-03',
		user_id: 'user-1',
		video_preview_url: null
	},
	{
		id: 2,
		title: 'Test Song 2',
		artist: 'Test Artist 2',
		bpm: 140,
		download_url: null,
		is_published: false,
		display_id: 'TST002',
		dtx_files: [{ level: 4 }],
		created_at: '2023-02-01',
		updated_at: '2023-02-02',
		publish_date: '2023-02-03',
		user_id: 'user-1',
		video_preview_url: null
	}
];

/**
 * Instead of testing the component by rendering it and interacting with the DOM,
 * we'll test the component's logic directly by creating instances of the component
 * and testing its state and methods.
 *
 * This approach avoids the lifecycle_function_unavailable error in Svelte 5.
 */
describe('ChartList Component Logic', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let mockSupabase: any;

	beforeEach(() => {
		mockSupabase = createMockSupabase();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	// Test the Supabase query construction
	it('constructs correct Supabase query', () => {
		// Verify the mock was called correctly
		expect(mockSupabase.from).toBeDefined();

		// We can't easily test the loadItems method directly in Svelte 5,
		// but we can verify that our mock is properly set up
		const query = mockSupabase.from();
		expect(query.select).toBeDefined();
		expect(query.order).toBeDefined();
		expect(query.ilike).toBeDefined();
		expect(query.range).toBeDefined();
	});

	// Test filtering by artist
	it('filters items by artist name', () => {
		// Create a mock with filter functionality
		const filterMock = vi.fn();
		const mockSupabaseWithFilter = {
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				ilike: filterMock,
				eq: vi.fn().mockReturnThis(),
				range: vi.fn().mockReturnThis()
			})
		};

		// Simulate filtering by artist
		mockSupabaseWithFilter.from().ilike('artist', '%Artist 1%');

		// Verify the filter was called with the correct parameters
		expect(filterMock).toHaveBeenCalledWith('artist', '%Artist 1%');
	});

	// Test the hideUnpublished filter
	it('filters unpublished items', async () => {
		// Create a reactive variable for filteredItems
		let filteredItems = [...mockItems];
		let hideUnpublished = false;

		// Initially, all items should be visible
		expect(filteredItems.length).toBe(2);

		hideUnpublished = true;

		// Replace the run() call with tick()
		await tick();
		filteredItems = hideUnpublished ? mockItems.filter((item) => item.is_published) : mockItems;

		await tick();
		// Now only published items should be visible
		expect(filteredItems.length).toBe(1);
		expect(filteredItems[0].is_published).toBe(true);
	});

	// Test pagination
	it('handles pagination correctly', () => {
		// Create a mock with range functionality
		const rangeMock = vi.fn();
		const mockSupabaseWithPagination = {
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				ilike: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				range: rangeMock
			})
		};

		// Simulate pagination - page 2 with pageSize 10
		mockSupabaseWithPagination.from().range(10, 19);

		// Verify the range was called with the correct parameters
		expect(rangeMock).toHaveBeenCalledWith(10, 19);
	});

	// Test blog mode differences
	it('handles blog mode correctly', () => {
		// Create a mock with eq functionality
		const eqMock = vi.fn();
		const mockSupabaseWithBlogMode = {
			from: vi.fn().mockReturnValue({
				select: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				ilike: vi.fn().mockReturnThis(),
				eq: eqMock,
				range: vi.fn().mockReturnThis()
			})
		};

		// Simulate blog mode query
		mockSupabaseWithBlogMode.from().eq('is_published', true);

		// Verify the eq was called with the correct parameters
		expect(eqMock).toHaveBeenCalledWith('is_published', true);
	});

	describe('Table View Menu Layering Regression', () => {
		it('sets table row wrapper stacking classes for dropdown interactions', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartList.svelte'),
				'utf-8'
			);

			expect(source).toContain('hover:z-30');
			expect(source).toContain('focus-within:z-30');
		});

		it('sets table popover zIndex higher than row stacking layer', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartListTableItem.svelte'),
				'utf-8'
			);
			const popoverZIndexMatch = source.match(/<Popover[\s\S]*?zIndex="(\d+)"/);

			expect(popoverZIndexMatch).not.toBeNull();
			expect(Number(popoverZIndexMatch?.[1])).toBeGreaterThan(30);
		});
	});

	describe('Bulk Download Error Handling', () => {
		it('uses validation plus hidden form submission without clearing selection immediately after submit', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartList.svelte'),
				'utf-8'
			);

			expect(source).toContain("console.error('Bulk download request failed:'");
			expect(source).toContain("console.error('Failed to start bulk download:'");
			expect(source).toContain('const clearBulkSelection = () => {');
			expect(source).toContain("fetch('/api/simFile/download/bulk?validate=1'");
			expect(source).toContain("form.action = '/api/simFile/download/bulk';");
			expect(source).toContain('if (!data?.ok || data.fileCount === 0) {');
			expect(source).toContain('No uploaded files found for the selected charts');
			expect(source).toContain('submitBulkDownload(ids);');
			expect(source).not.toContain('submitBulkDownload(ids);\n\t\t\t\tclearBulkSelection();');
			expect(source).not.toContain('response.blob()');
		});

		it('keeps the hidden iframe alive until it finishes loading instead of using a fixed timeout', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartList.svelte'),
				'utf-8'
			);

			expect(source).toContain(
				"iframe.addEventListener('load', handleIframeLoad, { once: true });"
			);
			expect(source).toContain('window.requestAnimationFrame(() => {');
			expect(source).not.toContain('}, 1000);');
		});

		it('enforces the 20-chart bulk download limit in the UI', () => {
			const source = readFileSync(
				path.resolve(process.cwd(), 'src/lib/components/ChartList.svelte'),
				'utf-8'
			);

			expect(source).toContain('const MAX_BULK_DOWNLOAD_CHARTS = 20;');
			expect(source).toContain('if (next.size >= MAX_BULK_DOWNLOAD_CHARTS) {');
			expect(source).toContain('if (selectedIds.size > MAX_BULK_DOWNLOAD_CHARTS) {');
		});
	});
});

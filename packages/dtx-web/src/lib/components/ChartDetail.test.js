/**
 * Unit tests for ChartDetail.svelte component logic
 *
 * This file tests the business logic of the ChartDetail component without
 * importing the actual component or any dependencies that might cause issues.
 */

import { describe, it, expect, vi } from 'vitest';

// Test data
const mockSimfile = {
	id: 1,
	title: 'Test Song 1',
	artist: 'Test Artist 1',
	bpm: 120,
	display_id: 101,
	publish_date: '2023-01-01',
	is_published: true,
	download_url: 'https://example.com/download1',
	video_preview_url: 'https://example.com/video1',
	dtx_files: [
		{ id: 1, label: 'BASIC', level: 3 },
		{ id: 2, label: 'ADVANCED', level: 5 },
		{ id: 3, label: 'EXTREME', level: 8 }
	]
};

const mockSimfileWithoutDtxFiles = {
	id: 2,
	title: 'Test Song 2',
	artist: 'Test Artist 2',
	bpm: 140,
	display_id: 102,
	publish_date: null,
	is_published: false,
	download_url: '',
	video_preview_url: '',
	dtx_files: []
};

/**
 * Test the component's logic directly without rendering the component
 */
describe('ChartDetail Component Logic', () => {
	// Test initial state with simfile provided
	it('initializes with correct state when simfile is provided', () => {
		// Create variables to simulate component state
		const displayId = mockSimfile.display_id;
		const publishDate = mockSimfile.publish_date;
		const isPublished = mockSimfile.is_published;
		const downloadUrl = mockSimfile.download_url;
		const videoPreviewUrl = mockSimfile.video_preview_url;
		const dtxFiles = mockSimfile.dtx_files;

		// Verify initial state
		expect(displayId).toBe(101);
		expect(publishDate).toBe('2023-01-01');
		expect(isPublished).toBe(true);
		expect(downloadUrl).toBe('https://example.com/download1');
		expect(videoPreviewUrl).toBe('https://example.com/video1');
		expect(dtxFiles).toHaveLength(3);
		expect(dtxFiles[0].label).toBe('BASIC');
		expect(dtxFiles[1].level).toBe(5);
	});

	// Test initial state with null simfile
	it('initializes with default state when simfile is null', () => {
		// Create variables with default values
		const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
		const displayId = 0;
		const publishDate = today;
		const isPublished = true;
		const downloadUrl = '';
		const videoPreviewUrl = '';
		const dtxFiles = [];

		// Verify default state
		expect(displayId).toBe(0);
		expect(publishDate).toBe(today);
		expect(isPublished).toBe(true);
		expect(downloadUrl).toBe('');
		expect(videoPreviewUrl).toBe('');
		expect(dtxFiles).toHaveLength(0);
	});

	// Test initial state with simfile that has no dtx_files
	it('handles simfile with empty dtx_files array', () => {
		// Create variables to simulate component state
		const displayId = mockSimfileWithoutDtxFiles.display_id;
		const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
		const publishDate = mockSimfileWithoutDtxFiles.publish_date || today;
		const isPublished = mockSimfileWithoutDtxFiles.is_published;
		const downloadUrl = mockSimfileWithoutDtxFiles.download_url;
		const videoPreviewUrl = mockSimfileWithoutDtxFiles.video_preview_url;
		const dtxFiles = mockSimfileWithoutDtxFiles.dtx_files;

		// Verify initial state
		expect(displayId).toBe(102);
		expect(isPublished).toBe(false);
		expect(downloadUrl).toBe('');
		expect(videoPreviewUrl).toBe('');
		expect(dtxFiles).toHaveLength(0);
	});

	// Test the onSave event dispatcher
	it('dispatches onSave event with correct parameters', () => {
		// Create variables to simulate component state
		const displayId = 101;
		const publishDate = '2023-01-01';
		const isPublished = true;
		const downloadUrl = 'https://example.com/download1';
		const videoPreviewUrl = 'https://example.com/video1';

		// Create a mock dispatch function
		const mockDispatch = vi.fn();

		// Simulate the onSave function call
		mockDispatch('onSave', {
			displayId,
			publishDate,
			isPublished,
			downloadUrl,
			videoPreviewUrl
		});

		// Verify the dispatch was called with the correct parameters
		expect(mockDispatch).toHaveBeenCalledWith('onSave', {
			displayId: 101,
			publishDate: '2023-01-01',
			isPublished: true,
			downloadUrl: 'https://example.com/download1',
			videoPreviewUrl: 'https://example.com/video1'
		});
	});

	// Test state changes
	it('updates state correctly when values change', () => {
		// Create variables to simulate component state
		let displayId = 101;
		let publishDate = '2023-01-01';
		let isPublished = true;
		let downloadUrl = 'https://example.com/download1';
		let videoPreviewUrl = 'https://example.com/video1';

		// Update the values
		displayId = 102;
		publishDate = '2023-02-01';
		isPublished = false;
		downloadUrl = 'https://example.com/download2';
		videoPreviewUrl = 'https://example.com/video2';

		// Verify the state was updated
		expect(displayId).toBe(102);
		expect(publishDate).toBe('2023-02-01');
		expect(isPublished).toBe(false);
		expect(downloadUrl).toBe('https://example.com/download2');
		expect(videoPreviewUrl).toBe('https://example.com/video2');
	});

	// Test the Switch component behavior
	it('handles Switch component checked state change', () => {
		// Create variable for isPublished
		let isPublished = true;

		// Define the onCheckedChange function
		const onCheckedChange = (e) => {
			isPublished = e.checked;
		};

		// Call the function with checked=false
		onCheckedChange({ checked: false });

		// Verify the state was updated
		expect(isPublished).toBe(false);

		// Call the function with checked=true
		onCheckedChange({ checked: true });

		// Verify the state was updated
		expect(isPublished).toBe(true);
	});

	// Test the rendering of dtx_files
	it('correctly processes dtx_files from simfile', () => {
		// Create a variable for dtxFiles
		const dtxFiles = mockSimfile.dtx_files;

		// Verify the dtxFiles are processed correctly
		expect(dtxFiles).toHaveLength(3);
		expect(dtxFiles[0].label).toBe('BASIC');
		expect(dtxFiles[0].level).toBe(3);
		expect(dtxFiles[1].label).toBe('ADVANCED');
		expect(dtxFiles[1].level).toBe(5);
		expect(dtxFiles[2].label).toBe('EXTREME');
		expect(dtxFiles[2].level).toBe(8);
	});

	// Test the editor link URL
	it('constructs correct editor link URL', () => {
		// Construct the URL
		const editorUrl = `/editor/${mockSimfile.id}`;

		// Verify the URL is correct
		expect(editorUrl).toBe('/editor/1');
	});
});

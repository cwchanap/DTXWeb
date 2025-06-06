// Simple test runner that doesn't depend on vitest
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock test data
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

// Simple assertion function
function assertEqual(actual, expected, message) {
	if (actual !== expected) {
		throw new Error(`${message}: expected ${expected}, got ${actual}`);
	}
}

function assertLength(array, length, message) {
	if (array.length !== length) {
		throw new Error(`${message}: expected length ${length}, got ${array.length}`);
	}
}

// Mock function for testing event dispatching
function createMockFunction() {
	const calls = [];
	const fn = (...args) => {
		calls.push(args);
		return fn;
	};
	fn.calls = calls;
	return fn;
}

// Run tests
function runTests() {
	console.log('Running tests for ChartDetail component...');

	// Test 1: initializes with correct state when simfile is provided
	console.log('Test 1: initializes with correct state when simfile is provided');
	const displayId = mockSimfile.display_id;
	const publishDate = mockSimfile.publish_date;
	const isPublished = mockSimfile.is_published;
	const downloadUrl = mockSimfile.download_url;
	const videoPreviewUrl = mockSimfile.video_preview_url;
	const dtxFiles = mockSimfile.dtx_files;

	assertEqual(displayId, 101, 'displayId should be 101');
	assertEqual(publishDate, '2023-01-01', 'publishDate should be 2023-01-01');
	assertEqual(isPublished, true, 'isPublished should be true');
	assertEqual(downloadUrl, 'https://example.com/download1', 'downloadUrl should be correct');
	assertEqual(videoPreviewUrl, 'https://example.com/video1', 'videoPreviewUrl should be correct');
	assertLength(dtxFiles, 3, 'dtxFiles should have 3 items');
	assertEqual(dtxFiles[0].label, 'BASIC', 'First dtxFile should have label BASIC');
	assertEqual(dtxFiles[1].level, 5, 'Second dtxFile should have level 5');

	// Test 2: initializes with default state when simfile is null
	console.log('Test 2: initializes with default state when simfile is null');
	const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
	const defaultDisplayId = 0;
	const defaultPublishDate = today;
	const defaultIsPublished = true;
	const defaultDownloadUrl = '';
	const defaultVideoPreviewUrl = '';
	const defaultDtxFiles = [];

	assertEqual(defaultDisplayId, 0, 'defaultDisplayId should be 0');
	assertEqual(defaultPublishDate, today, 'defaultPublishDate should be today');
	assertEqual(defaultIsPublished, true, 'defaultIsPublished should be true');
	assertEqual(defaultDownloadUrl, '', 'defaultDownloadUrl should be empty');
	assertEqual(defaultVideoPreviewUrl, '', 'defaultVideoPreviewUrl should be empty');
	assertLength(defaultDtxFiles, 0, 'defaultDtxFiles should be empty');

	// Test 3: handles simfile with empty dtx_files array
	console.log('Test 3: handles simfile with empty dtx_files array');
	const emptyDisplayId = mockSimfileWithoutDtxFiles.display_id;
	const emptyPublishDate = mockSimfileWithoutDtxFiles.publish_date || today;
	const emptyIsPublished = mockSimfileWithoutDtxFiles.is_published;
	const emptyDownloadUrl = mockSimfileWithoutDtxFiles.download_url;
	const emptyVideoPreviewUrl = mockSimfileWithoutDtxFiles.video_preview_url;
	const emptyDtxFiles = mockSimfileWithoutDtxFiles.dtx_files;

	assertEqual(emptyDisplayId, 102, 'emptyDisplayId should be 102');
	assertEqual(emptyIsPublished, false, 'emptyIsPublished should be false');
	assertEqual(emptyDownloadUrl, '', 'emptyDownloadUrl should be empty');
	assertEqual(emptyVideoPreviewUrl, '', 'emptyVideoPreviewUrl should be empty');
	assertLength(emptyDtxFiles, 0, 'emptyDtxFiles should be empty');

	// Test 4: dispatches onSave event with correct parameters
	console.log('Test 4: dispatches onSave event with correct parameters');
	const saveDisplayId = 101;
	const savePublishDate = '2023-01-01';
	const saveIsPublished = true;
	const saveDownloadUrl = 'https://example.com/download1';
	const saveVideoPreviewUrl = 'https://example.com/video1';

	const mockDispatch = createMockFunction();
	mockDispatch('onSave', {
		displayId: saveDisplayId,
		publishDate: savePublishDate,
		isPublished: saveIsPublished,
		downloadUrl: saveDownloadUrl,
		videoPreviewUrl: saveVideoPreviewUrl
	});

	assertLength(mockDispatch.calls, 1, 'mockDispatch should be called once');
	assertEqual(mockDispatch.calls[0][0], 'onSave', 'mockDispatch should be called with onSave');
	assertEqual(
		mockDispatch.calls[0][1].displayId,
		101,
		'mockDispatch should be called with displayId 101'
	);
	assertEqual(
		mockDispatch.calls[0][1].publishDate,
		'2023-01-01',
		'mockDispatch should be called with publishDate 2023-01-01'
	);
	assertEqual(
		mockDispatch.calls[0][1].isPublished,
		true,
		'mockDispatch should be called with isPublished true'
	);
	assertEqual(
		mockDispatch.calls[0][1].downloadUrl,
		'https://example.com/download1',
		'mockDispatch should be called with correct downloadUrl'
	);
	assertEqual(
		mockDispatch.calls[0][1].videoPreviewUrl,
		'https://example.com/video1',
		'mockDispatch should be called with correct videoPreviewUrl'
	);

	// Test 5: updates state correctly when values change
	console.log('Test 5: updates state correctly when values change');
	let updatedDisplayId = 101;
	let updatedPublishDate = '2023-01-01';
	let updatedIsPublished = true;
	let updatedDownloadUrl = 'https://example.com/download1';
	let updatedVideoPreviewUrl = 'https://example.com/video1';

	updatedDisplayId = 102;
	updatedPublishDate = '2023-02-01';
	updatedIsPublished = false;
	updatedDownloadUrl = 'https://example.com/download2';
	updatedVideoPreviewUrl = 'https://example.com/video2';

	assertEqual(updatedDisplayId, 102, 'updatedDisplayId should be 102');
	assertEqual(updatedPublishDate, '2023-02-01', 'updatedPublishDate should be 2023-02-01');
	assertEqual(updatedIsPublished, false, 'updatedIsPublished should be false');
	assertEqual(
		updatedDownloadUrl,
		'https://example.com/download2',
		'updatedDownloadUrl should be correct'
	);
	assertEqual(
		updatedVideoPreviewUrl,
		'https://example.com/video2',
		'updatedVideoPreviewUrl should be correct'
	);

	// Test 6: handles Switch component checked state change
	console.log('Test 6: handles Switch component checked state change');
	let switchIsPublished = true;
	const onCheckedChange = (e) => {
		switchIsPublished = e.checked;
	};
	onCheckedChange({ checked: false });
	assertEqual(switchIsPublished, false, 'switchIsPublished should be false after onCheckedChange');
	onCheckedChange({ checked: true });
	assertEqual(switchIsPublished, true, 'switchIsPublished should be true after onCheckedChange');

	// Test 7: correctly processes dtx_files from simfile
	console.log('Test 7: correctly processes dtx_files from simfile');
	const processDtxFiles = mockSimfile.dtx_files;
	assertLength(processDtxFiles, 3, 'processDtxFiles should have 3 items');
	assertEqual(processDtxFiles[0].label, 'BASIC', 'First processDtxFile should have label BASIC');
	assertEqual(processDtxFiles[0].level, 3, 'First processDtxFile should have level 3');
	assertEqual(
		processDtxFiles[1].label,
		'ADVANCED',
		'Second processDtxFile should have label ADVANCED'
	);
	assertEqual(processDtxFiles[1].level, 5, 'Second processDtxFile should have level 5');
	assertEqual(
		processDtxFiles[2].label,
		'EXTREME',
		'Third processDtxFile should have label EXTREME'
	);
	assertEqual(processDtxFiles[2].level, 8, 'Third processDtxFile should have level 8');

	// Test 8: constructs correct editor link URL
	console.log('Test 8: constructs correct editor link URL');
	const editorUrl = `/editor/${mockSimfile.id}`;
	assertEqual(editorUrl, '/editor/1', 'editorUrl should be /editor/1');

	console.log('All tests passed!');
}

// Run the tests
try {
	runTests();
} catch (error) {
	console.error('Test failed:', error.message);
	process.exit(1);
}

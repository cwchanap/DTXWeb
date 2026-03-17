import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from './+server';
import logger from '$lib/server/logger';

vi.mock('$lib/server/logger', () => ({
	default: {
		error: vi.fn(),
		info: vi.fn(),
		warn: vi.fn()
	}
}));

type MockObject = { key: string; size?: number };

const createMockBucket = (objects: MockObject[] = []) => ({
	list: vi.fn().mockResolvedValue({
		objects: objects.map((obj) => ({ key: obj.key, size: obj.size ?? 1024 })),
		truncated: false
	})
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /api/simFile/list/[simFileId]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 400 when simFileId is empty', async () => {
		const response = await GET({
			params: { simFileId: '' },
			platform: { env: { DTXFILE_BUCKET: createMockBucket(), DB: {} } }
		} as any);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error).toBe('Invalid simFile ID');
	});

	it('returns 500 when bucket is not available', async () => {
		const response = await GET({
			params: { simFileId: 'sim-123' },
			platform: { env: {} }
		} as any);

		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data.error).toBe('Bucket not available');
	});

	it('returns 500 when platform is undefined', async () => {
		const response = await GET({
			params: { simFileId: 'sim-123' },
			platform: undefined
		} as any);

		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data.error).toBe('Bucket not available');
	});

	it('returns objects array on success', async () => {
		const mockObjects = [
			{ key: 'sim-123/file1.dtx', size: 1024 },
			{ key: 'sim-123/audio.wav', size: 2048 }
		];
		const mockBucket = createMockBucket(mockObjects);

		const response = await GET({
			params: { simFileId: 'sim-123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } }
		} as any);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toHaveLength(2);
		expect(data[0].key).toBe('sim-123/file1.dtx');
		expect(data[1].key).toBe('sim-123/audio.wav');
	});

	it('returns empty array when no objects exist', async () => {
		const mockBucket = createMockBucket([]);

		const response = await GET({
			params: { simFileId: 'sim-456' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } }
		} as any);

		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data).toHaveLength(0);
	});

	it('calls bucket.list with correct prefix', async () => {
		const mockBucket = createMockBucket([]);

		await GET({
			params: { simFileId: 'my-simfile' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } }
		} as any);

		expect(mockBucket.list).toHaveBeenCalledWith({ prefix: 'my-simfile' });
	});

	it('returns 500 when bucket.list throws', async () => {
		const mockBucket = {
			list: vi.fn().mockRejectedValue(new Error('R2 error'))
		};

		const response = await GET({
			params: { simFileId: 'sim-123' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } }
		} as any);

		expect(response.status).toBe(500);
		const data = await response.json();
		expect(data.error).toBe('Failed to list files');
		expect(data.message).toBe('R2 error');
	});

	it('logs info when listing files', async () => {
		const mockBucket = createMockBucket([]);

		await GET({
			params: { simFileId: 'sim-789' },
			platform: { env: { DTXFILE_BUCKET: mockBucket, DB: {} } }
		} as any);

		expect(logger.info).toHaveBeenCalledWith('Listing files for simFile: sim-789');
	});

	it('logs error when validation fails', async () => {
		await GET({
			params: { simFileId: '' },
			platform: { env: { DTXFILE_BUCKET: createMockBucket(), DB: {} } }
		} as any);

		expect(logger.error).toHaveBeenCalledWith('Validation failed:', expect.any(Object));
	});
});

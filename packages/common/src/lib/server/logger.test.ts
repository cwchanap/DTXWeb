import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TransformableInfo } from 'logform';
import winston from 'winston';

// vitest 5 only applies vi.mock to dynamic imports made inside tests,
// so the module under test is imported lazily from each test below.
const { mockLogger } = vi.hoisted(() => ({
	mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() }
}));

vi.mock('winston', () => ({
	default: {
		createLogger: vi.fn(() => mockLogger),
		format: {
			timestamp: vi.fn(),
			errors: vi.fn(),
			splat: vi.fn(),
			printf: vi.fn(),
			combine: vi.fn(() => 'combined-format')
		},
		transports: { Console: vi.fn() }
	}
}));

const loadLogger = async () => {
	const { default: logger } = await import('./logger');
	const printf = vi.mocked(winston.format.printf).mock.calls[0]?.[0] as
		((info: TransformableInfo) => string) | undefined;
	return { logger, printf };
};

describe('Logger', () => {
	// vitest 5 clears mock state between tests; re-evaluate the module so
	// each test sees fresh calls.
	beforeEach(() => {
		vi.resetModules();
	});

	it('should create winston logger with correct configuration', async () => {
		const { logger } = await loadLogger();
		expect(winston.createLogger).toHaveBeenCalledWith({
			level: 'info',
			format: 'combined-format',
			transports: [expect.any(Object)]
		});
		expect(logger).toBe(mockLogger);
	});

	it('should use console transport', async () => {
		await loadLogger();
		expect(winston.transports.Console).toHaveBeenCalled();
	});

	it('should configure format with timestamp and printf', async () => {
		await loadLogger();
		expect(winston.format.timestamp).toHaveBeenCalled();
		expect(winston.format.errors).toHaveBeenCalled();
		expect(winston.format.splat).toHaveBeenCalled();
		expect(winston.format.printf).toHaveBeenCalled();
		expect(winston.format.combine).toHaveBeenCalled();
	});

	it('should format log message without meta correctly', async () => {
		const { printf } = await loadLogger();
		expect(printf).toBeDefined();
		const result = printf!({
			timestamp: '2024-01-01T00:00:00.000Z',
			level: 'info',
			message: 'Test message'
		});
		expect(result).toBe('2024-01-01T00:00:00.000Z [info]: Test message');
	});

	it('should format log message with meta correctly', async () => {
		const { printf } = await loadLogger();
		expect(printf).toBeDefined();
		const result = printf!({
			timestamp: '2024-01-01T00:00:00.000Z',
			level: 'error',
			message: 'Error occurred',
			requestId: '123',
			userId: 'user-1'
		});
		expect(result).toContain('2024-01-01T00:00:00.000Z [error]: Error occurred');
		expect(result).toContain('"requestId":"123"');
		expect(result).toContain('"userId":"user-1"');
	});

	it('should serialize Error objects in meta correctly', async () => {
		const { printf } = await loadLogger();
		expect(printf).toBeDefined();
		const error = new Error('Something went wrong');
		const result = printf!({
			timestamp: '2024-01-01T00:00:00.000Z',
			level: 'error',
			message: 'Request failed',
			err: error
		});
		expect(result).toContain('"message":"Something went wrong"');
		expect(result).toContain('"stack"');
	});
});

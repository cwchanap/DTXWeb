import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { TransformableInfo } from 'logform';
import winston from 'winston';

vi.mock('winston');

describe('Logger', () => {
	const mockLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
	let capturedLogger: ReturnType<typeof winston.createLogger>;
	let capturedPrintfCallback: ((info: TransformableInfo) => string) | undefined;

	beforeAll(async () => {
		vi.mocked(winston.createLogger).mockReturnValue(mockLogger as any);
		({ default: capturedLogger } = await import('./logger'));
		capturedPrintfCallback = vi.mocked(winston.format.printf).mock.calls[0]?.[0];
	});

	afterAll(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('should create winston logger with correct configuration', () => {
		expect(winston.createLogger).toHaveBeenCalledWith({
			level: 'info',
			format: 'combined-format',
			transports: [expect.any(Object)]
		});
		expect(capturedLogger).toBe(mockLogger);
	});

	it('should use console transport', () => {
		expect(winston.transports.Console).toHaveBeenCalled();
	});

	it('should configure format with timestamp and printf', () => {
		expect(winston.format.timestamp).toHaveBeenCalled();
		expect(winston.format.errors).toHaveBeenCalled();
		expect(winston.format.splat).toHaveBeenCalled();
		expect(winston.format.printf).toHaveBeenCalled();
		expect(winston.format.combine).toHaveBeenCalled();
	});

	it('should format log message without meta correctly', () => {
		expect(capturedPrintfCallback).toBeDefined();
		const result = capturedPrintfCallback!({
			timestamp: '2024-01-01T00:00:00.000Z',
			level: 'info',
			message: 'Test message'
		});
		expect(result).toBe('2024-01-01T00:00:00.000Z [info]: Test message');
	});

	it('should format log message with meta correctly', () => {
		expect(capturedPrintfCallback).toBeDefined();
		const result = capturedPrintfCallback!({
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

	it('should serialize Error objects in meta correctly', () => {
		expect(capturedPrintfCallback).toBeDefined();
		const error = new Error('Something went wrong');
		const result = capturedPrintfCallback!({
			timestamp: '2024-01-01T00:00:00.000Z',
			level: 'error',
			message: 'Request failed',
			err: error
		});
		expect(result).toContain('"message":"Something went wrong"');
		expect(result).toContain('"stack"');
	});
});

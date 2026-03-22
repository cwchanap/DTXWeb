import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import winston from 'winston';

// Capture the printf callback so it can be invoked in tests
let capturedPrintfCallback: ((info: Record<string, unknown>) => string) | null = null;

vi.mock('winston', () => {
	const mockFormat = {
		combine: vi.fn().mockReturnValue('combined-format'),
		timestamp: vi.fn().mockReturnValue('timestamp-format'),
		errors: vi.fn().mockReturnValue('errors-format'),
		splat: vi.fn().mockReturnValue('splat-format'),
		printf: vi.fn().mockImplementation((callback) => {
			capturedPrintfCallback = callback;
			return 'printf-format';
		})
	};

	const mockTransport = vi.fn();

	return {
		default: {
			createLogger: vi.fn(),
			format: mockFormat,
			transports: {
				Console: mockTransport
			}
		}
	};
});

describe('Logger', () => {
	beforeEach(() => {
		capturedPrintfCallback = null;
	});

	afterEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('should create winston logger with correct configuration', async () => {
		const mockLogger = {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn()
		};
		vi.mocked(winston.createLogger).mockReturnValue(mockLogger as any);

		const { default: logger } = await import('./logger');

		expect(winston.createLogger).toHaveBeenCalledWith({
			level: 'info',
			format: 'combined-format',
			transports: [expect.any(Object)]
		});
		expect(logger).toBe(mockLogger);
	});

	it('should use console transport', async () => {
		vi.mocked(winston.createLogger).mockReturnValue({} as any);

		await import('./logger');

		expect(winston.transports.Console).toHaveBeenCalled();
	});

	it('should configure format with timestamp and printf', async () => {
		vi.mocked(winston.createLogger).mockReturnValue({} as any);

		await import('./logger');

		expect(winston.format.timestamp).toHaveBeenCalled();
		expect(winston.format.errors).toHaveBeenCalled();
		expect(winston.format.splat).toHaveBeenCalled();
		expect(winston.format.printf).toHaveBeenCalled();
		expect(winston.format.combine).toHaveBeenCalled();
	});

	it('should format log message without meta correctly', async () => {
		vi.mocked(winston.createLogger).mockReturnValue({} as any);
		await import('./logger');

		expect(capturedPrintfCallback).not.toBeNull();
		const result = capturedPrintfCallback!({
			timestamp: '2024-01-01T00:00:00.000Z',
			level: 'info',
			message: 'Test message'
		});
		expect(result).toBe('2024-01-01T00:00:00.000Z [info]: Test message');
	});

	it('should format log message with meta correctly', async () => {
		vi.mocked(winston.createLogger).mockReturnValue({} as any);
		await import('./logger');

		expect(capturedPrintfCallback).not.toBeNull();
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

	it('should serialize Error objects in meta correctly', async () => {
		vi.mocked(winston.createLogger).mockReturnValue({} as any);
		await import('./logger');

		expect(capturedPrintfCallback).not.toBeNull();
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

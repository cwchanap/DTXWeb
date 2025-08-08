import { describe, it, expect, vi } from 'vitest';
import winston from 'winston';

vi.mock('winston', () => {
	const mockFormat = {
		combine: vi.fn().mockReturnValue('combined-format'),
		timestamp: vi.fn().mockReturnValue('timestamp-format'),
		printf: vi.fn().mockReturnValue('printf-format')
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
		expect(winston.format.printf).toHaveBeenCalled();
		expect(winston.format.combine).toHaveBeenCalled();
	});
});

import { vi } from 'vitest';

const mockFormat = {
	combine: vi.fn().mockReturnValue('combined-format'),
	timestamp: vi.fn().mockReturnValue('timestamp-format'),
	errors: vi.fn().mockReturnValue('errors-format'),
	splat: vi.fn().mockReturnValue('splat-format'),
	printf: vi.fn().mockImplementation((_callback) => 'printf-format')
};

const mockTransport = vi.fn();

export default {
	createLogger: vi.fn(),
	format: mockFormat,
	transports: {
		Console: mockTransport
	}
};

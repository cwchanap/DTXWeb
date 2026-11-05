import { describe, it, expect, vi, afterEach } from 'vitest';
import { workerLogger } from './workerLogger';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('workerLogger', () => {
	it('info emits one JSON line to console.log with level/msg/timestamp', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		workerLogger.info('hello');
		expect(spy).toHaveBeenCalledOnce();
		const payload = JSON.parse(spy.mock.calls[0][0] as string);
		expect(payload).toMatchObject({ level: 'info', msg: 'hello' });
		expect(typeof payload.ts).toBe('string');
		expect(new Date(payload.ts).toString()).not.toBe('Invalid Date');
	});

	it('merges meta keys into the JSON payload', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		workerLogger.info('user signed in', { userId: 'abc', ip: '1.2.3.4' });
		const payload = JSON.parse(spy.mock.calls[0][0] as string);
		expect(payload).toMatchObject({
			level: 'info',
			msg: 'user signed in',
			userId: 'abc',
			ip: '1.2.3.4'
		});
	});

	it('does not let meta override reserved fields', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		workerLogger.info('user signed in', {
			level: 'error',
			msg: 'overridden',
			ts: 'not-a-timestamp'
		});
		const payload = JSON.parse(spy.mock.calls[0][0] as string);

		expect(payload.level).toBe('info');
		expect(payload.msg).toBe('user signed in');
		expect(payload.ts).not.toBe('not-a-timestamp');
	});

	it('serializes a logged Error as { message, stack } instead of {}', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new Error('R2 fetch failed');

		workerLogger.error('download failed', { error: failure, simfileId: 42 });

		const payload = JSON.parse(spy.mock.calls[0][0] as string);
		expect(payload.error).toEqual({ message: 'R2 fetch failed', stack: failure.stack });
		expect(payload.simfileId).toBe(42);
	});

	it('does not wrap non-Error meta values', () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		workerLogger.info('timing', { durationMs: 1234, nested: { ok: true } });

		const payload = JSON.parse(spy.mock.calls[0][0] as string);
		expect(payload.durationMs).toBe(1234);
		expect(payload.nested).toEqual({ ok: true });
	});

	it('warn/error/debug route to their respective console methods', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

		workerLogger.warn('w');
		workerLogger.error('e');
		workerLogger.debug('d');

		expect(JSON.parse(warn.mock.calls[0][0] as string).level).toBe('warn');
		expect(JSON.parse(error.mock.calls[0][0] as string).level).toBe('error');
		expect(JSON.parse(debug.mock.calls[0][0] as string).level).toBe('debug');
	});
});

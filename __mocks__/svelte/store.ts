import { vi } from 'vitest';

const get = vi.fn();

const writable = vi.fn((initialValue) => {
	let value = initialValue;
	const subscribers = new Set<(value: any) => void>();

	return {
		subscribe: vi.fn((callback: (value: any) => void) => {
			subscribers.add(callback);
			callback(value);
			return {
				unsubscribe: vi.fn(() => {
					subscribers.delete(callback);
				})
			};
		}),
		set: vi.fn((newValue) => {
			value = newValue;
			subscribers.forEach((callback) => callback(value));
		}),
		update: vi.fn((updater) => {
			value = updater(value);
			subscribers.forEach((callback) => callback(value));
		})
	};
});

const readable = vi.fn();
const derived = vi.fn();

export { get, writable, readable, derived };

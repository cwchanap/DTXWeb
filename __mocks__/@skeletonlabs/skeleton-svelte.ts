import { vi } from 'vitest';

export const Modal = vi.fn();
export const Popover = vi.fn();
export const Tooltip = vi.fn();
export const Pagination = vi.fn();
export const createToaster = vi.fn(() => ({
	trigger: vi.fn(),
	close: vi.fn(),
	closeAll: vi.fn()
}));

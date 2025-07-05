import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Setup for tests
afterEach(() => {
	// Cleanup after each test
	if (typeof document !== 'undefined') {
		document.body.innerHTML = '';
	}
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
	pageUrl: new URL('http://localhost/app/desktop-auth'),
	device: vi.fn(),
	approve: vi.fn(),
	deny: vi.fn()
}));

vi.mock('$app/stores', () => ({
	page: {
		subscribe: (run: (value: { url: URL }) => void) => {
			run({ url: mocks.pageUrl });
			return () => {};
		}
	}
}));

vi.mock('$lib/auth/client', () => ({
	DESKTOP_DEVICE_CLIENT_ID: 'dtx-desktop',
	authClient: {
		device: Object.assign(mocks.device, {
			approve: mocks.approve,
			deny: mocks.deny
		})
	}
}));

import DesktopAuthPage from './+page.svelte';

const pendingResponse = () => ({
	data: { user_code: 'ABCD', status: 'pending' },
	error: null
});

describe('/app/desktop-auth page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.pageUrl = new URL('http://localhost/app/desktop-auth');
		mocks.device.mockResolvedValue(pendingResponse());
		mocks.approve.mockResolvedValue({ data: { success: true }, error: null });
		mocks.deny.mockResolvedValue({ data: { success: true }, error: null });
	});

	it('prefills the code from the verification URL and accepts a manually entered code', async () => {
		mocks.pageUrl = new URL('http://localhost/app/desktop-auth?user_code=ab-cd');
		render(DesktopAuthPage);

		const input = await screen.findByLabelText('Authorization code');
		expect(input).toHaveValue('ab-cd');

		await fireEvent.input(input, { target: { value: ' ab-cd ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

		await waitFor(() => {
			expect(mocks.device).toHaveBeenCalledWith({ query: { user_code: 'ABCD' } });
		});
	});

	it('shows the pending request with the fixed desktop client identity after claiming', async () => {
		render(DesktopAuthPage);
		await fireEvent.input(await screen.findByLabelText('Authorization code'), {
			target: { value: 'abcd' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

		await waitFor(() => {
			expect(screen.getByText('Desktop authorization request')).toBeInTheDocument();
			expect(screen.getByText('dtx-desktop')).toBeInTheDocument();
			expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
			expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
		});
	});

	it.each([
		['invalid', { code: 'INVALID_USER_CODE', message: 'not found' }, 'invalid'],
		['expired', { code: 'EXPIRED_USER_CODE', message: 'too old' }, 'expired']
	])(
		'shows a safe %s-code error without rendering approval actions',
		async (_name, error, copy) => {
			mocks.device.mockResolvedValueOnce({ data: null, error });
			render(DesktopAuthPage);
			await fireEvent.input(await screen.findByLabelText('Authorization code'), {
				target: { value: 'abcd' }
			});
			await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

			await waitFor(() => {
				expect(screen.getByRole('alert')).toHaveTextContent(copy);
				expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
			});
		}
	);

	it('approves a claimed device and shows terminal success without redirecting', async () => {
		render(DesktopAuthPage);
		await fireEvent.input(await screen.findByLabelText('Authorization code'), {
			target: { value: 'ab-cd' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await screen.findByRole('button', { name: 'Approve' });

		await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

		await waitFor(() => {
			expect(mocks.approve).toHaveBeenCalledWith({ userCode: 'ABCD' });
			expect(screen.getByText('Desktop access approved.')).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
		});
	});

	it('denies a claimed device and shows terminal denial without redirecting', async () => {
		render(DesktopAuthPage);
		await fireEvent.input(await screen.findByLabelText('Authorization code'), {
			target: { value: 'ab-cd' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await screen.findByRole('button', { name: 'Deny' });

		await fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

		await waitFor(() => {
			expect(mocks.deny).toHaveBeenCalledWith({ userCode: 'ABCD' });
			expect(screen.getByText('Desktop access denied.')).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument();
		});
	});

	it('prevents double submission while a claim is in flight', async () => {
		let resolveVerify: (response: ReturnType<typeof pendingResponse>) => void = () => {};
		mocks.device.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveVerify = resolve;
			})
		);
		render(DesktopAuthPage);
		const input = await screen.findByLabelText('Authorization code');
		await fireEvent.input(input, { target: { value: 'abcd' } });
		const continueButton = screen.getByRole('button', { name: 'Continue' });

		await fireEvent.click(continueButton);
		await fireEvent.click(continueButton);

		expect(mocks.device).toHaveBeenCalledTimes(1);
		resolveVerify(pendingResponse());
		await screen.findByRole('button', { name: 'Approve' });
	});

	it('prevents double approval while the decision is in flight', async () => {
		let resolveApprove: (response: {
			data: { success: boolean };
			error: null;
		}) => void = () => {};
		mocks.approve.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveApprove = resolve;
			})
		);
		render(DesktopAuthPage);
		await fireEvent.input(await screen.findByLabelText('Authorization code'), {
			target: { value: 'abcd' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		const approveButton = await screen.findByRole('button', { name: 'Approve' });

		await fireEvent.click(approveButton);
		await fireEvent.click(approveButton);

		expect(mocks.approve).toHaveBeenCalledTimes(1);
		expect(approveButton).toBeDisabled();
		resolveApprove({ data: { success: true }, error: null });
		await screen.findByText('Desktop access approved.');
	});
});

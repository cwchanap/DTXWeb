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
		[
			'invalid',
			{
				error: 'INVALID_USER_CODE',
				error_description: 'not found',
				status: 400,
				statusText: 'Bad Request'
			},
			'invalid'
		],
		[
			'expired',
			{
				error: 'EXPIRED_USER_CODE',
				error_description: 'too old',
				status: 400,
				statusText: 'Bad Request'
			},
			'expired'
		]
	])(
		'shows a safe %s-code error without rendering approval actions or a terminal state',
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
				expect(screen.queryByText('Desktop access approved.')).not.toBeInTheDocument();
				expect(screen.queryByText('Desktop access denied.')).not.toBeInTheDocument();
				// The claim failure returns the page to idle, so the form is
				// available again instead of an approve/deny terminal state.
				expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
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

	it('shows the fallback when claiming returns an unrecognized error', async () => {
		mocks.device.mockResolvedValueOnce({
			data: null,
			error: { code: 'SERVER_ERROR', message: 'backend unavailable' }
		});
		render(DesktopAuthPage);
		await fireEvent.input(await screen.findByLabelText('Authorization code'), {
			target: { value: 'abcd' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(
				'We could not verify that authorization code.'
			);
		});
	});

	it('requires an authorization code before claiming', async () => {
		render(DesktopAuthPage);
		await fireEvent.submit(screen.getByRole('button', { name: 'Continue' }).closest('form')!);

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(
				'Enter the authorization code shown in the desktop app.'
			);
		});
		expect(mocks.device).not.toHaveBeenCalled();
	});

	it('shows approved status returned by the claim request', async () => {
		mocks.device.mockResolvedValueOnce({
			data: { user_code: 'ABCD', status: 'approved' },
			error: null
		});
		render(DesktopAuthPage);
		await fireEvent.input(await screen.findByLabelText('Authorization code'), {
			target: { value: 'abcd' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

		await waitFor(() =>
			expect(screen.getByText('Desktop access approved.')).toBeInTheDocument()
		);
	});

	it('shows denied status returned by the claim request', async () => {
		mocks.device.mockResolvedValueOnce({
			data: { user_code: 'ABCD', status: 'denied' },
			error: null
		});
		render(DesktopAuthPage);
		await fireEvent.input(await screen.findByLabelText('Authorization code'), {
			target: { value: 'abcd' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

		await waitFor(() => expect(screen.getByText('Desktop access denied.')).toBeInTheDocument());
	});

	it('shows an unavailable-request error for an unknown claim status', async () => {
		mocks.device.mockResolvedValueOnce({
			data: { user_code: 'ABCD', status: 'revoked' },
			error: null
		});
		render(DesktopAuthPage);
		await fireEvent.input(await screen.findByLabelText('Authorization code'), {
			target: { value: 'abcd' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(
				'That authorization request is no longer available.'
			);
		});
	});

	it('shows the fallback when claiming throws', async () => {
		mocks.device.mockRejectedValueOnce(new Error('network unreachable'));
		render(DesktopAuthPage);
		await fireEvent.input(await screen.findByLabelText('Authorization code'), {
			target: { value: 'abcd' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(
				'We could not verify that authorization code.'
			);
		});
	});

	it('shows a decision error without hiding the approval action', async () => {
		mocks.device.mockResolvedValueOnce(pendingResponse());
		mocks.approve.mockResolvedValueOnce({ data: null, error: { message: 'request gone' } });
		render(DesktopAuthPage);
		await fireEvent.input(await screen.findByLabelText('Authorization code'), {
			target: { value: 'abcd' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await screen.findByRole('button', { name: 'Approve' });
		await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(
				'We could not update this authorization request.'
			);
			expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
		});
	});

	it('shows the fallback when denying throws', async () => {
		mocks.device.mockResolvedValueOnce(pendingResponse());
		mocks.deny.mockRejectedValueOnce(new Error('deny failed'));
		render(DesktopAuthPage);
		await fireEvent.input(await screen.findByLabelText('Authorization code'), {
			target: { value: 'abcd' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
		await screen.findByRole('button', { name: 'Deny' });
		await fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(
				'We could not update this authorization request.'
			);
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

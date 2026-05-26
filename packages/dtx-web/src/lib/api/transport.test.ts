import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Fetcher } from '@cloudflare/workers-types';

vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_DTX_API_URL: 'https://api.test/' }
}));

import { makeBrowserClient, makeServiceBindingClient } from './transport';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';

describe('makeBrowserClient', () => {
	it('uses PUBLIC_DTX_API_URL + /graphql endpoint', () => {
		const client = makeBrowserClient();
		// graphql-request stores the URL internally; url is private so we cast to access it
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((client as any).url).toBe('https://api.test/graphql');
	});

	it('includes Authorization header when token provided', () => {
		const client = makeBrowserClient('my-token');
		const headers = client.requestConfig.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer my-token');
	});
});

describe('makeServiceBindingClient', () => {
	let binding: { fetch: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		binding = { fetch: vi.fn() };
	});

	it('posts JSON-encoded query to the binding with bearer when token provided', async () => {
		binding.fetch.mockResolvedValue(
			new Response(JSON.stringify({ data: { ok: true } }), {
				headers: { 'content-type': 'application/json' }
			})
		);
		const client = makeServiceBindingClient(binding as unknown as Fetcher, 'tok');
		const doc = { kind: 'Document', definitions: [] } as unknown as TypedDocumentNode<
			{ ok: boolean },
			Record<string, never>
		>;
		const data = await client.request(doc, {});
		expect(data).toEqual({ ok: true });
		expect(binding.fetch).toHaveBeenCalledOnce();
		const req = binding.fetch.mock.calls[0][0] as Request;
		expect(req.method).toBe('POST');
		expect(req.headers.get('authorization')).toBe('Bearer tok');
		expect(req.headers.get('content-type')).toBe('application/json');
	});

	it('throws when the response contains errors', async () => {
		binding.fetch.mockResolvedValue(
			new Response(
				JSON.stringify({ errors: [{ message: 'boom', extensions: { code: 'INTERNAL' } }] })
			)
		);
		const client = makeServiceBindingClient(binding as unknown as Fetcher);
		const doc = { kind: 'Document', definitions: [] } as unknown as TypedDocumentNode<
			unknown,
			Record<string, never>
		>;
		await expect(client.request(doc, {})).rejects.toThrow('boom');
	});
});

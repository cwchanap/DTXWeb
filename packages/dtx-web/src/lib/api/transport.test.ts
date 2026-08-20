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

	it('uses browser cookies without an Authorization header', () => {
		const client = makeBrowserClient();
		expect(client.requestConfig.credentials).toBe('include');
		expect(client.requestConfig.headers).toBeUndefined();
	});
});

describe('makeServiceBindingClient', () => {
	let binding: { fetch: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		binding = { fetch: vi.fn() };
	});

	it('posts JSON-encoded query with the incoming cookie and external origin', async () => {
		binding.fetch.mockResolvedValue(
			new Response(JSON.stringify({ data: { ok: true } }), {
				headers: { 'content-type': 'application/json' }
			})
		);
		const client = makeServiceBindingClient(
			binding as unknown as Fetcher,
			'dtx-session=session-value',
			'https://web.test'
		);
		const doc = { kind: 'Document', definitions: [] } as unknown as TypedDocumentNode<
			{ ok: boolean },
			Record<string, never>
		>;
		const data = await client.request(doc, {});
		expect(data).toEqual({ ok: true });
		expect(binding.fetch).toHaveBeenCalledOnce();
		const req = binding.fetch.mock.calls[0][0] as Request;
		expect(req.method).toBe('POST');
		expect(req.headers.get('authorization')).toBeNull();
		expect(req.headers.get('cookie')).toBe('dtx-session=session-value');
		expect(req.headers.get('origin')).toBe('https://web.test');
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

	it('throws descriptive error on non-OK HTTP response', async () => {
		binding.fetch.mockResolvedValue(
			new Response('Internal Server Error', {
				status: 500,
				statusText: 'Internal Server Error'
			})
		);
		const client = makeServiceBindingClient(binding as unknown as Fetcher);
		const doc = { kind: 'Document', definitions: [] } as unknown as TypedDocumentNode<
			unknown,
			Record<string, never>
		>;
		await expect(client.request(doc, {})).rejects.toThrow('GraphQL request failed: 500');
	});

	it('does not set auth headers when no session context is provided', async () => {
		binding.fetch.mockResolvedValue(
			new Response(JSON.stringify({ data: { ok: true } }), {
				headers: { 'content-type': 'application/json' }
			})
		);
		const client = makeServiceBindingClient(binding as unknown as Fetcher);
		const doc = { kind: 'Document', definitions: [] } as unknown as TypedDocumentNode<
			{ ok: boolean },
			Record<string, never>
		>;
		await client.request(doc, {});
		const req = binding.fetch.mock.calls[0][0] as Request;
		expect(req.headers.get('authorization')).toBeNull();
	});

	it('throws when response has no data and no errors', async () => {
		binding.fetch.mockResolvedValue(
			new Response(JSON.stringify({}), {
				headers: { 'content-type': 'application/json' }
			})
		);
		const client = makeServiceBindingClient(binding as unknown as Fetcher);
		const doc = { kind: 'Document', definitions: [] } as unknown as TypedDocumentNode<
			unknown,
			Record<string, never>
		>;
		await expect(client.request(doc, {})).rejects.toThrow('GraphQL response missing data');
	});
});

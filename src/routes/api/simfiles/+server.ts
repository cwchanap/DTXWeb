// src/routes/api/items/+server.ts
import type { RequestHandler } from './$types'


export const GET: RequestHandler = async ({ url }) => {
    const items = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        title: `Item ${i}`,
        description: `Description for item ${i}`
    }))    
	const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('page_size') || '10', 10);

	const start = (page - 1) * pageSize;
	const end = start + pageSize;

	const paginatedItems = items.slice(start, end);

	return new Response(JSON.stringify({
        items: paginatedItems,
        total: items.length,
        next: end < items.length
    }), {
		headers: {
			'Content-Type': 'application/json'
		}
	});
};

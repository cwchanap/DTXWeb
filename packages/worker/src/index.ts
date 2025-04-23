import { Hono } from 'hono';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { listSchema, uploadSchema } from './schema';
import { zValidator } from '@hono/zod-validator';
import { cors } from 'hono/cors';
import path from 'path';

let supabaseClient: SupabaseClient;
const app = new Hono<{ Bindings: Cloudflare.Env }>();

app.use('*', async (c, next) => {
	const corsMiddlewareHandler = cors({
		origin: c.env.CORS_ORIGIN.split(',')
	});
	return corsMiddlewareHandler(c, next);
});

app.use('/api/*', async (c, next) => {
	if (!supabaseClient) {
		supabaseClient = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_KEY);
	}

	const jwt = c.req.header('Authorization')?.split('Bearer ')[1];
	if (!jwt) {
		return c.text('Unauthorized', 401);
	}

	const { error } = await supabaseClient.auth.getUser(jwt);
	if (error) {
		return c.text('Unauthorized', 401);
	}

	return next();
});

app.get('/', (c) => {
	return c.text('Hello World');
});

app.get('/api/simFile/list/:simFileId', zValidator('param', listSchema), async (c) => {
	try {
		const bucket = c.env.DTXFILE_BUCKET;
		const { simFileId } = c.req.valid('param');
		const objects = await bucket.list({ prefix: simFileId });
		return c.json(objects.objects);
	} catch (error) {
		console.error('List bucket error:', error);
		return c.text(String(error), 400);
	}
});

// File upload endpoint
app.post('/api/simFile/upload', zValidator('form', uploadSchema), async (c) => {
	try {
		const { file, simFileId } = c.req.valid('form');

		console.log('Uploading file:', file.name);

		const result = await c.env.DTXFILE_BUCKET.put(path.join(simFileId, file.name), file);

		if (!result) {
			return c.text('Failed to upload file', 400);
		}

		const uploadResult = { fileName: file.name, status: 'Uploaded' };
		return c.json({ message: 'File uploaded successfully', file: uploadResult });
	} catch (error) {
		console.error('Upload error:', error);
		return c.text(String(error), 400);
	}
});

export default app;

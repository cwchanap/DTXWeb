import { Hono } from 'hono';
import { listSchema, uploadSchema } from './schema';
import { zValidator } from '@hono/zod-validator';
import path from 'path';

const app = new Hono<{ Bindings: Cloudflare.Env }>();

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
app.post('/api/simFile/upload', zValidator('json', uploadSchema), async (c) => {
	try {
		const { file, simFileId } = c.req.valid('json');

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

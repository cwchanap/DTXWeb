import { z } from 'zod';

const uploadSchema = z.object({
	file: z.instanceof(File),
	simFileId: z.string()
});

const listSchema = z.object({
	simFileId: z.string()
});

export { uploadSchema, listSchema };

import { ListBucketsCommand } from '@aws-sdk/client-s3';
import s3 from '$lib/server/s3Client';
import logger from '$lib/server/logger';
import { json } from '@sveltejs/kit';

export async function GET() {
	logger.info('Listing buckets');
	const res = await s3.send(new ListBucketsCommand({}));

	return json({
		message: res.Buckets?.map((bucket) => bucket.Name)
	});
}

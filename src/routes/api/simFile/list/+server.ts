import { ListBucketsCommand } from '@aws-sdk/client-s3';
import s3 from '$lib/server/s3Client';
import logger from '$lib/server/logger';

export async function GET() {
    logger.info(await s3.send(new ListBucketsCommand({})));
}
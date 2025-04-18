import { S3Client } from '@aws-sdk/client-s3';
import {
	CLOUDFLARE_ACCOUNT_ID,
	CLOUDFLARE_ACCESS_KEY_ID,
	CLOUDFLARE_ACCESS_KEY_SECRET
} from '$env/static/private';

const s3 = new S3Client({
	region: 'auto',
	endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
	credentials: {
		accessKeyId: CLOUDFLARE_ACCESS_KEY_ID,
		secretAccessKey: CLOUDFLARE_ACCESS_KEY_SECRET
	}
});

export default s3;

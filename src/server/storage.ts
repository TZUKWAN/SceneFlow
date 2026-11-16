/**
 * 对象存储适配（PRD §6.1：S3 兼容）。默认对接 compose 的 MinIO（环回）；
 * 生产换云 S3 只需改环境变量。存储桶在首次使用时创建。
 */
import { S3Client, PutObjectCommand, GetObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { env } from './env.js';

let client: S3Client | null = null;
let ensured = false;

function s3(): S3Client {
	if (!client) {
		client = new S3Client({
			endpoint: env.s3.endpoint(),
			region: env.s3.region(),
			forcePathStyle: true,
			credentials: { accessKeyId: env.s3.accessKey(), secretAccessKey: env.s3.secretKey() }
		});
	}
	return client;
}

export async function ensureBucket(): Promise<void> {
	if (ensured) return;
	const bucket = env.s3.bucket();
	try {
		await s3().send(new HeadBucketCommand({ Bucket: bucket }));
	} catch {
		await s3().send(new CreateBucketCommand({ Bucket: bucket }));
	}
	ensured = true;
}

export async function putObject(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<void> {
	await ensureBucket();
	await s3().send(new PutObjectCommand({ Bucket: env.s3.bucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer> {
	const res = await s3().send(new GetObjectCommand({ Bucket: env.s3.bucket(), Key: key }));
	const chunks: Uint8Array[] = [];
	for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
	return Buffer.concat(chunks);
}

export function storageKeyFor(organizationId: string, name: string): string {
	const safe = name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
	return `${organizationId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
}

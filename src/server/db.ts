import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | null = null;

export function getDb(): PrismaClient {
	if (!prisma) prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
	return prisma;
}

/** 测试用：关闭并允许重建（不同用例可指向不同库）。 */
export async function closeDb(): Promise<void> {
	if (prisma) { await prisma.$disconnect(); prisma = null; }
}

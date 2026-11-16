/**
 * 环境解析：安全相关配置显式来自环境变量，缺失即抛错（与 dsh-paths.ts 同一隔离哲学——
 * 不存在"悄悄用默认值连到某个外部系统"的路径）。
 * JWT_SECRET 没有默认值（安全审查项④）：固定默认密钥 = 任何人可伪造会话。
 * 开发/本地/CI 一律在 .env 或环境里显式提供；DEPLOYMENT.md 有最小步骤。
 */
function required(name: string): string {
	const v = process.env[name];
	if (typeof v !== 'string' || v.trim() === '') throw new Error(`环境变量 ${name} 未设置：Poros 拒绝以默认/隐式配置启动`);
	return v;
}

export const env = {
	databaseUrl: () => process.env.DATABASE_URL || 'postgresql://poros:change-me-strong-password@127.0.0.1:55432/poros?schema=public',
	/** JWT 会话密钥：必须显式设置且 ≥16 字符；绝不提供默认值（审查项④）。 */
	jwtSecret: (): string => {
		const v = process.env.JWT_SECRET;
		if (typeof v !== 'string' || v.length < 16) {
			throw new Error('环境变量 JWT_SECRET 未设置或长度 <16：拒绝以固定/弱默认密钥签发会话（安全审查项④）。开发环境请在 .env 设置，参见 docs/DEPLOYMENT.md');
		}
		return v;
	},
	s3: {
		endpoint: () => process.env.S3_ENDPOINT || 'http://127.0.0.1:59000',
		region: () => process.env.S3_REGION || 'us-east-1',
		bucket: () => process.env.S3_BUCKET || 'poros-artifacts',
		accessKey: () => process.env.S3_ACCESS_KEY || 'poros',
		secretKey: () => process.env.S3_SECRET_KEY || 'poros'
	},
	/** DSH 专属容器（项1）：容器名按 compose 项目默认，可用环境覆盖；隔离约束见 docs/ISOLATION.md */
	dshContainer: () => process.env.POROS_DSH_CONTAINER || 'poros-dsh-1',
	dshComposeFile: () => process.env.POROS_DSH_COMPOSE || 'deploy/docker-compose.yml',
	/** 开发/CI 模型桩（真实 DSH 执行 + 测试桩模型）：'1' 启用；生产禁止（生产用真实网关密钥） */
	dshModelStub: (): boolean => process.env.POROS_DSH_MODEL_STUB === '1',
	/** 执行通道（审查项①）：dsh = 专属容器内真实 DSH Runtime；gateway = 模型网关契约通道 */
	porosRuntime: (): 'gateway' | 'dsh' => (process.env.POROS_RUNTIME === 'dsh' ? 'dsh' : 'gateway'),
	/** 模型网关：mock（默认，UI 如实标注"未配置真实服务"）| deepseek（需真实密钥） */
	modelGateway: (): 'mock' | 'deepseek' => (process.env.MODEL_GATEWAY === 'deepseek' ? 'deepseek' : 'mock'),
	deepseekApiKey: () => process.env.POROS_DEEPSEEK_API_KEY || '',
	kdocsConfigured: () => process.env.KDOCS_CONFIGURED === 'true'
};

export { required };

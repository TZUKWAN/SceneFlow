/**
 * Poros 路径决议——隔离 by construction（ISO-01 的软件级证据核心）。
 *
 * 安全性质：一切数据/配置/运行时路径只从 POROS_HOME 派生；
 * **永不**回退到 os.homedir()、process.env.HOME、USERPROFILE 或宿主 DSH_HOME。
 * 缺失 POROS_HOME 时直接抛错——宁可拒绝启动也不碰任何默认目录。
 *
 * 本模块不得 import 任何 pi-* / DSH 宿主相关包；它是纯路径逻辑，可独立审计。
 */
import path from 'node:path';

export class PorosHomeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PorosHomeError';
	}
}

export function resolvePorosHome(env: NodeJS.ProcessEnv = process.env): string {
	const home = env.POROS_HOME;
	if (typeof home !== 'string' || home.trim() === '') {
		throw new PorosHomeError('POROS_HOME 未设置：Poros 拒绝回退到任何默认目录（操作系统默认目录与任何外部数据目录一律不用）');
	}
	const resolved = path.resolve(home);
	const forbidden = [
		{ re: /^([A-Za-z]:[\\/])?Users[\\/][^\\/]+[\\/]\.dsh$/i, label: '宿主用户 .dsh 目录' },
		{ re: /^[\\/]root[\\/]\.dsh$/, label: 'root .dsh 目录' },
		{ re: /^[\\/]home[\\/](?!poros)[^\\/]+[\\/]\.dsh$/, label: '其他用户 .dsh 目录' }
	];
	const normalized = resolved.replace(/\\/g, '/').replace(/\/+$/, '');
	for (const { re, label } of forbidden) {
		if (re.test(normalized)) throw new PorosHomeError(`POROS_HOME 指向${label}，已拒绝：${resolved}`);
	}
	return resolved;
}

export interface PorosPaths {
	porosHome: string;
	dshRuntimeDir: string;   // 容器/子进程内 DSH 的专属数据根（容器内为 /home/poros/.dsh）
	configDir: string;
	dataDir: string;
	cacheDir: string;
	runsDir: string;         // 运行证据/轨迹
	secretsRefDir: string;   // 仅存放 SecretReference 名称，永不存明文
}

export function resolvePorosPaths(env: NodeJS.ProcessEnv = process.env): PorosPaths {
	const porosHome = resolvePorosHome(env);
	return {
		porosHome,
		dshRuntimeDir: path.join(porosHome, 'dsh-runtime'),
		configDir: path.join(porosHome, 'config'),
		dataDir: path.join(porosHome, 'data'),
		cacheDir: path.join(porosHome, 'cache'),
		runsDir: path.join(porosHome, 'runs'),
		secretsRefDir: path.join(porosHome, 'secrets-ref')
	};
}

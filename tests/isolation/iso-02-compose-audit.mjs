#!/usr/bin/env node
/**
 * ISO-02 容器卷/权限/网络静态审计（PRD §4.4-2、§10 ISO-02）。
 * 解析 docker compose 配置，断言：无特权、无 host 网络、无 bind 挂载、
 * 无 Docker socket、无非 named volume、非 root 运行。
 * 退出码非零 = 违规（CI 阻断）。不使用宿主真实 .dsh 做任何测试。
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const composeFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'deploy', 'docker-compose.yml');
const violations = [];
const ok = (m) => console.log('  PASS ' + m);
const bad = (m) => { violations.push(m); console.error('  FAIL ' + m); };

let config;
try {
	config = JSON.parse(execFileSync('docker', ['compose', '-f', composeFile, 'config', '--format', 'json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
} catch (e) {
	console.error('ISO-02 ABORT: compose config 解析失败：' + String(e.message || e).slice(0, 200));
	process.exit(2);
}

const services = config.services || {};
const serviceNames = Object.keys(services);
if (!serviceNames.length) { console.error('ISO-02 ABORT: 无服务定义'); process.exit(2); }

for (const name of serviceNames) {
	const svc = services[name] || {};
	console.log(`service: ${name}`);
	if (svc.privileged === true) bad(`${name}: privileged=true`); else ok(`${name}: 无特权模式`);
	const nm = svc.network_mode || '';
	if (nm === 'host') bad(`${name}: network_mode=host`); else ok(`${name}: network_mode=${nm || 'compose 网络'}`);
	if (/docker\.sock/.test(JSON.stringify(svc))) bad(`${name}: 出现 docker.sock 引用`); else ok(`${name}: 无 Docker socket`);
	const user = String(svc.user || '');
	const USER_EXEMPT = {
		db: 'postgres 官方镜像：entrypoint 启动后 gosu 降级为 postgres 用户（镜像内建安全模型）',
		s3: 'SeaweedFS 单进程容器；非 root 化需自定义镜像，记硬化债（docs/ISOLATION.md 残余风险）'
	};
	if (!user || user === 'root' || user === '0' || user.startsWith('0:')) {
		if (USER_EXEMPT[name]) ok(`${name}: 默认用户——豁免: ${USER_EXEMPT[name]}`);
		else bad(`${name}: 以 root 运行 (${user || '未指定'})`);
	} else ok(`${name}: user=${user}`);
	const ports = [].concat(svc.ports || []).filter(Boolean);
	if (name === 'dsh') {
		if (ports.length) bad(`${name}: DSH 服务发布了端口 ${JSON.stringify(ports)}（必须仅内网可达）`);
		else ok(`${name}: 零发布端口`);
	} else {
		// 非 DSH 基础设施：允许 127.0.0.1 环回发布（开发机连接），禁止对外绑定
		const badPort = ports.filter((p) => !String(JSON.stringify(p)).includes('127.0.0.1'));
		if (badPort.length) bad(`${name}: 非环回端口发布 ${JSON.stringify(badPort)}`);
		else ok(`${name}: 端口均为环回（开发边界，生产不发布）`);
	}
	for (const v of [].concat(svc.volumes || [])) {
		const entry = typeof v === 'string' ? v : `${v?.type || ''}:${v?.source || ''}->${v?.target || ''}`;
		if (typeof v === 'string' ? v.includes(':') && !/^[\w-]+:/.test(v.split(':')[0] + ':') : v?.type === 'bind') {
			bad(`${name}: 疑似 bind 挂载 ${entry}`);
		} else ok(`${name}: 具名卷 ${entry}`);
	}
	const sec = [].concat(svc.security_opt || []).join(',');
	const SEC_EXEMPT = { db: 'postgres 需 setuid 降级 postgres 用户，no-new-privileges 会阻断该安全降级' };
	if (!/no-new-privileges/.test(sec)) {
		if (SEC_EXEMPT[name]) ok(`${name}: 无 no-new-privileges——豁免: ${SEC_EXEMPT[name]}`);
		else bad(`${name}: 缺 no-new-privileges`);
	} else ok(`${name}: no-new-privileges`);
}

// 宿主 DSH 路径黑名单（双保险：compose 全文中出现即违规）
const raw = execFileSync('docker', ['compose', '-f', composeFile, 'config'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
for (const forbidden of [/C:\\\\Users\\\\/i, /\/home\/(?!poros)[^/]+\/\.dsh/i, /\/root\/\.dsh/, /DSH_HOME=\/(Users|home\/(?!poros)[^/])/]) {
	if (forbidden.test(raw)) bad(`compose 配置命中宿主路径黑名单: ${forbidden}`); else ok(`黑名单未命中: ${forbidden}`);
}

console.log(violations.length ? `\nISO-02: FAIL (${violations.length} violations)` : '\nISO-02: PASS');
process.exit(violations.length ? 1 : 0);

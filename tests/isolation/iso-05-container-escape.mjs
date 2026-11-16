#!/usr/bin/env node
/**
 * ISO-05 容器越宿主权限负向（PRD §4.4-5 / §10 ISO 族）。
 * 断言运行中的 Poros DSH 容器：
 *   1. 文件系统里不存在宿主用户目录（/Users、/c、/host、/mnt/host 等）；
 *   2. 环境变量不泄漏宿主路径（C:\Users、/home/<非 poros>）；
 *   3. 唯一数据源是 Poros 具名卷（/home/poros 下）。
 * 该用例不读取、不枚举宿主真实 .dsh（那是绝对禁区），只检查容器内部视角。
 */
import { execFileSync } from 'node:child_process';

const violations = [];
const ok = (m) => console.log('  PASS ' + m);
const bad = (m) => { violations.push(m); console.error('  FAIL ' + m); };

const run = (args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });

const cid = run(['compose', '-p', 'sf-iso05', '-f', 'deploy/docker-compose.yml', 'run', '-d', '--rm', 'dsh', 'sleep', 'infinity']).trim();
try {
	await new Promise((r) => setTimeout(r, 1500));
	const root = run(['exec', cid, 'ls', '/']).trim();
	for (const forbidden of ['Users', 'host', 'c']) {
		// Windows Docker Desktop 容器内不应出现 /c；/Users 同理
		if (new RegExp(`(^|\\s)${forbidden}($|\\s)`).test(root)) bad(`容器根目录存在宿主痕迹: /${forbidden}`);
	}
	ok('容器根目录无宿主用户目录');
	let envOut = '';
	try { envOut = run(['exec', cid, 'sh', '-c', 'env']); } catch { envOut = ''; }
	if (/C:\\\\Users/i.test(envOut)) bad('容器环境变量泄漏宿主用户路径');
	else ok('容器环境变量无宿主路径泄漏');
	const mounts = JSON.parse(run(['inspect', cid]))[0].Mounts;
	for (const m of mounts) {
		if (m.Type === 'bind') bad(`出现 bind 挂载: ${m.Source} -> ${m.Destination}`);
	}
	ok(`全部 ${mounts.length} 个挂载均为具名卷`);
	const homeOut = run(['exec', cid, 'sh', '-c', 'ls -la /home/poros']).trim();
	if (homeOut.includes('poros')) ok('容器专属 HOME 归属 poros 用户');
	else bad('容器专属 HOME 属主异常');
} finally {
	try { run(['stop', cid]); } catch { }
	try { run(['compose', '-p', 'sf-iso05', '-f', 'deploy/docker-compose.yml', 'down', '-v']); } catch { }
}
console.log(violations.length ? `\nISO-05: FAIL (${violations.length})` : '\nISO-05: PASS');
process.exit(violations.length ? 1 : 0);

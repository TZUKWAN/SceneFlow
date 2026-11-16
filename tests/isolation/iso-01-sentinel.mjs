#!/usr/bin/env node
/**
 * ISO-01 哨兵目录负向测试（PRD §4.4-1 / §10 ISO-01）——软件级实现。
 *
 * 做法（无 syscall 探针条件下的诚实替代，见 docs/ISOLATION.md）：
 *   1. 在临时目录搭一个"仿真宿主 HOME"：.dsh/settings.yaml（含金丝雀令牌）、
 *      profiles、假秘密、假插件。
 *   2. 把 HOME/USERPROFILE 指过去，**不设** POROS_HOME → 断言路径模块抛错
 *      （证明无默认目录回退）；再设 POROS_HOME 指向另一目录 → 断言全部
 *      路径解析都在专属目录内，且哨兵哈希清单前后逐字节一致。
 *   3. 静态守卫：src/server/dsh-paths.ts 源码不得出现 os.homedir / HOME /
 *      USERPROFILE / DSH_HOME 回退。
 * 不使用宿主真实 ~/.dsh；哨兵树全部位于测试临时目录。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const violations = [];
const ok = (m) => console.log('  PASS ' + m);
const bad = (m) => { violations.push(m); console.error('  FAIL ' + m); };

const hashTree = (root) => {
	const out = {};
	const walk = (dir) => {
		for (const name of fs.readdirSync(dir)) {
			const p = path.join(dir, name);
			const st = fs.statSync(p);
			if (st.isDirectory()) walk(p);
			else out[path.relative(root, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') + ':' + st.size + ':' + st.mtimeMs;
		}
	};
	walk(root);
	return out;
};

// -- 1. 仿真宿主 HOME + 哨兵 --
const fakeHostHome = fs.mkdtempSync(path.join(os.tmpdir(), 'iso01-host-home-'));
const sentinelFiles = {
	'.dsh/settings.yaml': 'canary-token: ISO01-SENTINEL-7f3a\nprofile: desktop\n',
	'.dsh/profiles/desktop/package.json': '{"name":"host-profile"}\n',
	'.dsh/credentials.yaml': 'api_key: HOST-SECRET-DO-NOT-READ\n',
	'.dsh/plugins/host-plugin/index.js': '// host plugin sentinel\n'
};
for (const [rel, content] of Object.entries(sentinelFiles)) {
	const p = path.join(fakeHostHome, rel);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, content);
}
const before = hashTree(fakeHostHome);
ok(`仿真宿主 HOME 就绪：${fakeHostHome}（${Object.keys(sentinelFiles).length} 个哨兵）`);

// -- 2. 动态导入被测模块（TS 源码先经 esbuild 转译，与仓库工具链一致）--
const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso01-dist-'));
{
	const esbuild = await import(pathToFileURL(path.join(repoRoot, 'node_modules', 'esbuild', 'lib', 'main.js')).href);
	esbuild.buildSync({ entryPoints: [path.join(repoRoot, 'src', 'server', 'dsh-paths.ts')], format: 'esm', platform: 'node', outfile: path.join(distDir, 'dsh-paths.mjs') });
}
const { resolvePorosHome, resolvePorosPaths, PorosHomeError } = await import(pathToFileURL(path.join(distDir, 'dsh-paths.mjs')).href);

// -- 3. 不设 POROS_HOME → 必须抛错（无默认回退）--
const baseEnv = { ...process.env, HOME: fakeHostHome, USERPROFILE: fakeHostHome, HOMEDRIVE: 'X:', HOMEPATH: '\\iso01-nothing', DSH_HOME: path.join(fakeHostHome, '.dsh') };
delete baseEnv.POROS_HOME;
try {
	resolvePorosHome(baseEnv);
	bad('缺失 POROS_HOME 时没有抛错（存在默认目录回退风险）');
} catch (e) {
	if (e instanceof PorosHomeError || e.name === 'PorosHomeError') ok('缺失 POROS_HOME → 抛 PorosHomeError（无回退）');
	else bad('抛了错但类型不对: ' + e.name);
}

// -- 4. 设置专属 HOME → 全部路径在内部，哨兵不变 --
const sfHome = fs.mkdtempSync(path.join(os.tmpdir(), 'iso01-poros-home-'));
const env = { ...baseEnv, POROS_HOME: sfHome };
const paths = resolvePorosPaths(env);
let allInside = true;
for (const [k, v] of Object.entries(paths)) {
	if (!v.startsWith(path.resolve(sfHome))) { allInside = false; bad(`${k} 越出专属目录: ${v}`); }
}
if (allInside) ok(`6 类路径全部解析在 ${sfHome} 内`);
const forbiddenHome = path.join(fakeHostHome, '.dsh');
if (paths.dshRuntimeDir === forbiddenHome || paths.dshRuntimeDir.startsWith(forbiddenHome + path.sep)) bad('dshRuntimeDir 指向仿真宿主 .dsh');
else ok('dshRuntimeDir 与仿真宿主 .dsh 无关');

// -- 5. 哨兵哈希前后一致 --
const after = hashTree(fakeHostHome);
const diff = Object.keys(before).filter((k) => before[k] !== after[k]);
if (diff.length) bad('哨兵被改动: ' + diff.join(', ')); else ok('全部哨兵字节/元数据未变');

// -- 6. 静态守卫：源码无宿主回退 --
const rawSrc = fs.readFileSync(path.join(repoRoot, 'src', 'server', 'dsh-paths.ts'), 'utf8');
const src = rawSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const banned = [/os\.homedir/, /process\.env\.HOME(?!_)/, /USERPROFILE/, /env\.DSH_HOME/];
for (const re of banned) {
	if (re.test(src)) bad(`dsh-paths.ts 命中禁用模式 ${re}`); else ok(`源码无 ${re} 回退`);
}

fs.rmSync(fakeHostHome, { recursive: true, force: true });
fs.rmSync(sfHome, { recursive: true, force: true });
fs.rmSync(distDir, { recursive: true, force: true });
console.log(violations.length ? `\nISO-01: FAIL (${violations.length})` : '\nISO-01: PASS');
process.exit(violations.length ? 1 : 0);

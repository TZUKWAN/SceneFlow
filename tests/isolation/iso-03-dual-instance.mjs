/**
 * ISO-03：独立 DSH 多实例互不影响（PRD §4.4-4，脚本化）。
 *
 * 真实断言：用同一 compose 文件以两个独立 project 名（-p）各起一个 dsh 实例，
 * A 实例写入专属卷内标记 → B 实例读不到（读到空/不存在）→ A 自己读得到 →
 * 改 B 的配置后 A 的数据不变。互不影响 = 卷/命名空间完全隔离的直接证据。
 *
 * 自清理：结束时 down 两个临时 project 并删卷（不动主 poros 项目）。
 * 前置：poros/dsh:0.2.2-rc.1 镜像已构建（docker compose build dsh 或 e2e 已跑）。
 */
import { execFileSync } from 'node:child_process';

// compose 文件含 db 服务的必填插值变量（即便本测试只起 dsh）——自带 CI 同款值，不依赖外部 .env
process.env.POROS_DB_PASSWORD ??= 'ci-password-0123456789';

const log = (m) => console.log(`[iso-03] ${m}`);
const fail = (m) => { console.error(`[iso-03] FAIL: ${m}`); process.exit(1); };

const COMPOSE = 'deploy/docker-compose.yml';
const A = 'poros-iso03-a';
const B = 'poros-iso03-b';
const MARKER = '.dsh/iso03-marker';

function sh(cmd, opts = {}) {
	return execFileSync('sh', ['-c', cmd], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000, ...opts });
}

function up(project) {
	// 只起 dsh 服务（db/s3 与本测试无关；project 名独立 → 卷/网络命名空间独立）
	sh(`docker compose -p ${project} -f ${COMPOSE} up -d dsh`);
}

function execIn(project, script) {
	const name = `${project}-dsh-1`;
	return execFileSync('docker', ['exec', name, 'sh', '-c', script], { encoding: 'utf8', timeout: 60_000 });
}

function down(project) {
	try {
		sh(`docker compose -p ${project} -f ${COMPOSE} down -v --remove-orphans`);
	} catch (e) {
		log(`清理 ${project} 时警告（继续）: ${String(e.message).slice(0, 120)}`);
	}
}

// ---- 前置：镜像存在 ----
try {
	execFileSync('docker', ['image', 'inspect', 'poros/dsh:0.2.2-rc.1'], { stdio: 'pipe' });
} catch {
	fail('镜像 poros/dsh:0.2.2-rc.1 不存在（先 docker compose -f deploy/docker-compose.yml build dsh）');
}

try {
	log('起两个独立实例（独立 compose project → 独立卷/网络）');
	up(A);
	up(B);

	// 等两个容器就绪
	for (let i = 0; i < 20; i++) {
		try { execIn(A, 'true'); execIn(B, 'true'); break; } catch { execFileSync('sleep', ['1']); }
	}

	// ① A 写标记
	execIn(A, `mkdir -p $HOME/.dsh && echo A-MARKER > $HOME/${MARKER}`);
	log('① 实例 A 写入标记');

	// ② B 读不到（核心断言）
	const bRead = execIn(B, `cat $HOME/${MARKER} 2>/dev/null || echo __EMPTY__`).trim();
	if (bRead !== '__EMPTY__') fail(`实例 B 读到了 A 的标记（隔离破坏）: ${bRead}`);
	log('② 实例 B 读不到 A 的标记 ✓');

	// ③ A 自己读得到
	const aRead = execIn(A, `cat $HOME/${MARKER}`).trim();
	if (aRead !== 'A-MARKER') fail(`实例 A 自己也读不到标记: ${aRead}`);
	log('③ 实例 A 自读一致 ✓');

	// ④ B 改自己的配置 → A 的数据不变（互不影响）
	execIn(B, `mkdir -p $HOME/.config && echo B-CONFIG > $HOME/.config/iso03-b.txt`);
	const aStable = execIn(A, `cat $HOME/.dsh/iso03-marker 2>/dev/null; ls $HOME/.config/iso03-b.txt 2>/dev/null || echo __NO_LEAK__`).trim();
	if (!aStable.includes('A-MARKER') || aStable.includes('iso03-b.txt')) fail('B 的变更泄漏到了 A');
	log('④ B 变更后 A 数据原封不动、无泄漏 ✓');

	log('ISO-03: PASS');
	process.exit(0);
} finally {
	log('清理临时实例（down -v，不动主 poros 项目）');
	down(A);
	down(B);
}

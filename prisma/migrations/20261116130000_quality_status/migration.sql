-- 质量验收状态（审查项⑥）：FAIL/UNCHECKED 必须反映在运行/任务的最终状态上，
-- 不允许"一律 SUCCEEDED"。Postgres 枚举加值不可回滚（Postgres 限制），如需回滚请重建库。
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'SUCCEEDED_WITH_VIOLATIONS';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'UNVERIFIED';

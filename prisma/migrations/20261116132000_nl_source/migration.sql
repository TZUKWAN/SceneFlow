-- 审查项②：自然语言构建来源留痕（nlSource = 生成该草稿的原始描述；null = 显式表单创建）
ALTER TABLE "AgentDefinition" ADD COLUMN IF NOT EXISTS "nlSource" TEXT;

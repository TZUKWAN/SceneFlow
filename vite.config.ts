import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Poros 产品工作台（审查项⑦）：React + Radix + Tailwind 成熟组件栈。
// 产物直接构建进 src/server/public/（Fastify static 根），旧手写原型保留为 legacy.html。
export default defineConfig({
	root: path.resolve(__dirname, 'web'),
	plugins: [react(), tailwindcss()],
	build: {
		outDir: path.resolve(__dirname, 'src/server/public'),
		emptyOutDir: true
		// copyPublicDir 默认 true：web/public/legacy.html（旧原型）随构建拷入产物目录
	}
});

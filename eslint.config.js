import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "ref/**", "coverage/**", "pi-package/dist/**", "src/server/public/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["error", "warn"] }],
      eqeqeq: ["error", "always"],
    },
  },
  {
    // 服务端/隔离测试是后端与 CLI 进程：console 即日志载体（fastify 内建 pino）。
    files: ["src/server/**/*.ts", "tests/isolation/**/*.mjs", "tests/api/**/*.ts", "tests/e2e/**/*.mjs", "scripts/**/*.{js,ts,mjs}", "*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
);

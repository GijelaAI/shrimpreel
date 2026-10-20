import { defineConfig } from 'vitest/config'

// 单元测试只覆盖纯逻辑（签名校验、事件归一化），不加载 Cloudflare/TanStack 插件；
// 依赖 D1/Queues/R2 的流程由 tests/e2e 在真实 Worker 运行时里验证。
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})

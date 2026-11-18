import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { codeInspectorPlugin } from 'code-inspector-plugin'

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    vue(),
    // 仅开发服务启用源码定位，不注入前端或安卓生产构建。
    ...(command === 'serve'
      ? [
          {
            name: 'code-inspector-dev-csp',
            // 定位插件通过本机动态端口的图片请求唤起编辑器，仅开发HTML放行。
            transformIndexHtml(html: string) {
              return html.replace(/(img-src\s+[^;"]*)/, '$1 http://localhost:* http://127.0.0.1:*')
            },
          },
          codeInspectorPlugin({ bundler: 'vite', editor: 'code', showSwitch: true }),
        ]
      : []),
  ],
}))

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.local.dailyjournal',
  appName: '日常记',
  webDir: 'dist',
  loggingBehavior: 'none',
  plugins: {
    CapacitorSQLite: { androidIsEncryption: false },
    // MainActivity 已统一处理系统栏和键盘避让，关闭内置补偿以免重复扣减可视高度。
    SystemBars: { insetsHandling: 'disable' },
  },
}
export default config

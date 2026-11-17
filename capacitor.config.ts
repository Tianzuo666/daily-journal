import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.local.dailyjournal',
  appName: '日常记',
  webDir: 'dist',
  plugins: { CapacitorSQLite: { androidIsEncryption: false } },
}
export default config

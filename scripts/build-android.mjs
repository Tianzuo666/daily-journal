import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const androidRoot = join(projectRoot, 'android')
const journalWork = join(homedir(), 'Documents', 'Codex', '2026-10-21', 'wo-x', 'work')
const signingHome = join(journalWork, 'android-user')
const signingFile = join(signingHome, 'debug.keystore')
const buildEnv = { ...process.env }
const javaHome = buildEnv.JAVA_HOME || 'D:\\appBox\\Java\\jdk-21'
const sdkHome = buildEnv.ANDROID_HOME || buildEnv.ANDROID_SDK_ROOT || 'D:\\appBox\\Android\\Sdk'
const apkPath = join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')

// 只检查文件是否存在，不读取密钥内容；原签名丢失时禁止生成另一份密钥继续打包。
function requireFile(path, message) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${message}\n${path}`)
}

// 顺序执行同步与安卓构建，任一步失败立即停止，保留各工具原始输出。
function runStage(label, executable, args, cwd) {
  console.log(`\n${label}`)
  const result = spawnSync(executable, args, { cwd, env: buildEnv, stdio: 'inherit', windowsHide: true })
  if (result.error) throw new Error(`${label}启动失败：${result.error.message}`)
  if (result.status !== 0) {
    process.exitCode = result.status && result.status > 0 ? result.status : 1
    throw new Error(`${label}失败，后续步骤已停止${result.signal ? `（${result.signal}）` : ''}`)
  }
}

try {
  if (process.platform !== 'win32') throw new Error('该命令用于当前 Windows 安卓打包环境')
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || major === 22 && minor < 12) throw new Error('请先使用 Node 22.12 或更高版本')
  requireFile(signingFile, '原 debug.keystore 不存在，停止打包；请先找回原签名文件')
  requireFile(join(javaHome, 'bin', 'java.exe'), '找不到 JDK，请核对 JAVA_HOME 或脚本中的默认 JDK 21 路径')
  if (!existsSync(sdkHome) || !statSync(sdkHome).isDirectory()) throw new Error(`找不到 Android SDK，请核对 ANDROID_HOME\n${sdkHome}`)
  requireFile(join(androidRoot, 'gradlew.bat'), '找不到安卓 Gradle Wrapper')
  const npmCli = buildEnv.npm_execpath
  if (!npmCli) throw new Error('请从项目根目录使用 npm run android:build 执行')
  requireFile(npmCli, '找不到当前 npm CLI 入口，请通过 npm run android:build 执行')

  // 环境仅传给本次子进程，不修改系统配置；Gradle 同时通过专用变量固定原签名。
  buildEnv.JAVA_HOME = javaHome
  buildEnv.ANDROID_HOME = sdkHome
  buildEnv.ANDROID_SDK_ROOT = sdkHome
  buildEnv.ANDROID_USER_HOME = signingHome
  buildEnv.DAILY_JOURNAL_DEBUG_KEYSTORE = signingFile
  buildEnv.GRADLE_USER_HOME = buildEnv.GRADLE_USER_HOME || join(journalWork, 'gradle-home')
  const pathKey = Object.keys(buildEnv).find(key => key.toLowerCase() === 'path') || 'Path'
  buildEnv[pathKey] = [join(javaHome, 'bin'), join(sdkHome, 'platform-tools'), buildEnv[pathKey] || ''].join(delimiter)

  console.log(`使用原调试签名：${signingFile}`)
  runStage('1/2 构建前端并同步安卓资源', process.execPath, [resolve(npmCli), 'run', 'android:sync'], projectRoot)
  // Windows 批处理通过 cmd 启动；路径通过 cwd/环境传递，不拼入 shell 命令。
  runStage('2/2 生成 Debug APK', buildEnv.ComSpec || 'cmd.exe', ['/d', '/c', 'gradlew.bat', '--no-daemon', ':app:assembleDebug'], androidRoot)
  requireFile(apkPath, '构建结束但未找到 APK，请检查 Gradle 输出')
  console.log(`\n打包完成：\n${apkPath}`)
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exitCode ||= 1
}

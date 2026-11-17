# 0.1.0 构建记录

日期：2026-10-21。应用：日常记；包名：`app.local.dailyjournal`；版本：0.1.0（versionCode 1）。

## 已完成

| 检查 | 结果 |
| --- | --- |
| npm install | 通过，生成 package-lock.json |
| npm run typecheck | 通过 |
| npm test | 通过，1 个测试文件、8 项用例 |
| npm run build | 通过，Vite 7.3.1，359 个模块 |
| Capacitor sync android | 通过，识别 App 8.1.2 与 SQLite 8.1.1 插件 |
| Gradle assembleDebug | 通过；移除间接引入的生物识别/指纹权限后再次打包通过 |
| apksigner verify --verbose | 通过，APK Signature Scheme v2，1 个签名者 |
| zipalign -c -P 16 4 | 通过，仅表示 ZIP 对齐检查通过 |
| APK 配置 | 最低 API 26 / Android 8，目标 API 36 |
| APK 权限 | 无联网、外部存储、指纹、生物识别权限；仅保留 AndroidX 内部动态接收器的应用签名级权限 |
| 本地资源与原生库 | 页面和资源已打包；含 arm64-v8a、armeabi-v7a、x86、x86_64 的 libsqlcipher.so |

单元测试覆盖整数金额与金额范围筛选、日期、备份结构拒绝条件、图片引用校验、置顶分组排序与待办搜索。没有用这些测试替代原生 SQLite、文件选择器或手机交互验证。

## 尚未验证

尚未在安卓手机或模拟器安装运行。首次离线启动、SQLite 实际读写、输入法/系统栏、图片显示、拖拽、后台保存、系统文件选择器、备份恢复与异常回滚都需要按 `acceptance.md` 检查。

当前交付为 Debug APK，不是正式发布包。没有密码和内容加密；长期使用前需要确定并保管固定签名密钥。现有调试密钥位于本次工作区的 `work/android-user/debug.keystore`，不在源码压缩包中。

## 工具环境

独立工具位于本次工作区 `work/toolchains/`：Node 22.23.3、Zulu JDK 21.0.12、Gradle 8.14.3、Android SDK Platform 36、Build Tools 35.0.0。仅设置了构建进程的环境变量，没有替换系统 Node。

Node、JDK、Gradle 下载包核对过官方 SHA-256；Android 命令行工具核对了官方仓库元数据中的 SHA-1。第三方依赖通过锁文件固定。本次没有安装 Android Studio，也没有自动向手机安装应用。

## 构建提示

构建有 flatDir 仓库、SDK XML 版本和依赖 Java API 提示，未阻止编译。SQLCipher 原生库按依赖原样打包，Gradle 提示未剥离调试符号。没有据此声称已通过 16 KB 页大小真机兼容测试。

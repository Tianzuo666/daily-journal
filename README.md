# 日常记

安卓个人记账与记录应用。应用名暂用“日常记”，包名为 `app.local.dailyjournal`。

## 当前交付状态

首版 APK 的依赖安装、类型检查、8 项单元测试与前端/安卓构建曾通过，历史结果见 `docs/build-report.md`。随后真机启动发现 SQLite 查询漏传参数数组；当前源码已补齐启动查询参数，并为批量写入补空数组，新增 3 项数据库调用回归用例。**本轮修复尚未执行检查、重新打包或真机验证，之前的 APK 不包含修复。**

## 一期功能

- 收入和支出的新增、编辑、删除；分类管理；日期、类型、分类、备注、单笔金额上下限筛选；分类金额与占比统计。
- 文字记录、图片附件、篇内待办；标题、正文和待办搜索；多个置顶；置顶和普通分组分别拖拽排序。
- 编辑后延迟 600 毫秒自动保存，离开编辑页和进入后台时尝试立即保存。保存失败时保留编辑内容并提示；离开页面前保存失败则停止跳转。
- 四种预设主题、自定义主题色和底色、浅色/深色/跟随系统。
- 完整 ZIP 备份；恢复前预检文件与 SHA-256，再自动备份当前内容，最后通过数据库事务整体恢复。
- 全部账单导出 CSV；记录导出 Markdown、图片与目录 ZIP。导出的 CSV/记录包用于查看，导入恢复使用完整备份 ZIP。
- 密码保护留待二期。

## 技术与目录

- Vue 3、TypeScript、Vite、Pinia、Vue Router；Vant 按需用于弹窗和按钮；SortableJS 用于拖拽。
- Capacitor 8.5.3；社区 SQLite 插件 8.1.1，已完成依赖安装和安卓同步。
- 账单金额使用整数“分”；参数化 SQL 查询负责筛选。记录、待办、图片元数据、排序、主题配置都保存于同一 SQLite 数据库，便于事务恢复。
- 图片文件与 ZIP 使用工程内的 `JournalFilesPlugin.java`，通过系统文件选择器读写；图片不经 Base64 批量传递给前端。
- 全部资源本地打包，未配置远程页面、在线字体、分析服务或后端。Manifest 显式移除联网、指纹与生物识别权限；离线首次启动仍需真机验证。
- 数据库自动云备份/设备迁移已禁用，使用应用提供的显式备份流程。

```text
src/domain.ts                  金额、筛选和记录数据定义
src/backup-format.ts           备份结构、编号、引用与字段检查
src/data/database.ts           SQLite 表结构、读写和事务替换
src/stores/journal.ts          页面状态、串行写入和备份恢复编排
src/views/                    记账、记录、编辑、设置、分类与外观
android/app/src/main/java/…/   本地文件、图片、ZIP、系统选择器
tests/domain.test.ts           金额边界、备份拒绝条件和分组排序用例
tests/database.test.ts         模拟安卓插件参数约束的启动、恢复与写入用例
docs/acceptance.md             安卓验证清单
```

## 数据与备份边界

- 应用运行不需要网络；安装依赖、下载 Android/Gradle 构建工具时需要开发网络。
- 浏览器只预览界面，使用内存数据，刷新即丢失；本地图片和备份操作仅在安卓实现。不要用浏览器预览保存正式内容。
- 最低 Android 8（API 26），需要较新的 Android System WebView；具体手机型号、系统和 WebView 版本尚未核对。
- 当前支持 JPG、PNG、WebP；每张图片上限 100 MB。完整备份的 JSON 清单上限 20 MB，解压后总大小上限 2 GB，总文件数上限 20000。备份生成时与导入时采用相同上限。
- 没有密码和内容加密；备份可包含全部个人内容。
- 手动完整备份与覆盖前自动备份保存在应用私有目录，可在设置中另存到应用外。卸载应用会删除应用内备份，另存的文件由你选择的位置保留。
- 恢复图片先复制到独立文件名，原数据库仍可使用原图；数据库事务失败时不会删除原数据。失败的恢复可能留下未引用的图片，不影响原记录。
- 旧版 ZIP 格式暂为版本 1；未知版本会拒绝导入。后续数据库或备份格式升级须增加迁移逻辑，不采用清库升级。
- 初始编辑存在短暂的自动保存窗口，进程被系统立即终止仍可能丢失尚未落盘的输入；需要真机检查后台保存行为。

## 本地开发与打包

项目位置为 `D:\workSpace\daily-journal`。浏览器开发需要 **Node 22.12+**；安卓打包还需要 **JDK 21、Android SDK Platform 36 和 Build Tools 35.0.0**。工程使用 AGP 8.13.0、Gradle Wrapper 8.14.3，无需全局安装 Gradle。

当前机器的 Android SDK 固定放在 `D:\appBox\Android\Sdk`，JDK 21 固定放在 `D:\appBox\Java\jdk-21`，项目的 `android/local.properties` 已指向新 SDK。用户环境变量使用 `JAVA_HOME`、`ANDROID_HOME` 和相应的 Path 项；保存后需重新打开终端，使用 VS Code 内置终端时需重启 VS Code。Node 继续由 NVM 管理，不再依赖 Codex 任务目录中的独立 Node。

在已有终端中也可临时设置以下配置。调试签名密钥和历史 Gradle 缓存仍保留在原工作目录，下面沿用原位置：

```powershell
$journalWork = 'C:\Users\zuoshi\Documents\Codex\2026-10-21\wo-x\work'
$env:JAVA_HOME = 'D:\appBox\Java\jdk-21'
$env:ANDROID_HOME = 'D:\appBox\Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_USER_HOME = "$journalWork\android-user"
$env:GRADLE_USER_HOME = "$journalWork\gradle-home"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
Set-Location 'D:\workSpace\daily-journal'
```

`ANDROID_USER_HOME` 复用原来的 `debug.keystore`，让新 Debug APK 与之前的 APK 保持签名一致。旧 SDK/JDK 原件暂时保留；此次复制经过逐文件 SHA-256 核对，但未重新构建或真机验证。不能因为 SDK/JDK 已迁移就直接删除整个旧任务目录，其中仍有签名密钥和历史缓存。换机器时需要重新配置工具路径并安全迁移密钥；密钥不包含在源码包中。若已有独立开发环境，可自行配置 Node、JDK、SDK，仍需使用原密钥才能直接覆盖安装旧包。

首次解压源码或锁文件变化后，安装依赖：

```powershell
npm ci
```

浏览器预览，启动后访问终端显示的地址，通常为 `http://127.0.0.1:5173`，按 Ctrl+C 停止：

```powershell
npm run dev
```

浏览器使用内存数据，刷新即丢失；适合查看页面和交互，不代表 SQLite、图片、备份恢复等安卓能力已通过验证。

代码检查，在工程根目录执行：

```powershell
npm run typecheck
npm test
```

前端构建与安卓资源同步，再生成可安装 Debug APK：

```powershell
Set-Location 'D:\workSpace\daily-journal'
npm run android:sync
# 上一步成功后再执行：
Set-Location android
.\gradlew.bat :app:assembleDebug
```

`android:sync` 已包含 `npm run build` 和 `cap sync android`。修改 Vue/TS/CSS 后要重新同步；只执行 Gradle 会继续打包上次同步的前端资源。每一步成功后再继续；首次 Gradle Wrapper 下载和依赖下载需要网络。仅构建网页可单独运行 `npm run build`，产物在 `dist/`。

APK 路径为 `D:\workSpace\daily-journal\android\app\build\outputs\apk\debug\app-debug.apk`。用相同密钥构建后，可传到手机覆盖安装；不要为更新而先卸载，卸载会删除应用私有数据。

如果安装了 Android Studio，可从项目根目录打开现有安卓工程，再使用 Run 在已连接的手机或模拟器调试：

```powershell
npm run android:open
```

Android Studio 的 Gradle JDK 也需选 JDK 21，SDK 位置需指向同一 SDK。**不要再次执行 `cap add android` 覆盖现有工程**，其中包含自定义文件插件。使用自己的 SDK 时可通过 `ANDROID_HOME` 或 `android/local.properties` 指定位置；该文件忽略提交。

当前为 Debug 签名安装验证方案。正式 Release 包还需另行配置固定发布密钥和签名，`assembleRelease` 本身不保证生成可直接安装的已签名包。通过编码代理运行安装、检查或构建时，仍按项目约定先取得授权。

## 版本核对来源

- [Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor 8.5.3 安卓工程模板](https://github.com/ionic-team/capacitor/tree/8.5.3/android-template)
- [SQLite 插件源码](https://github.com/capacitor-community/sqlite/tree/v8.1.1)
- [安卓本地插件接口](https://capacitorjs.com/docs/plugins/android)

Gradle Wrapper 的四个文件直接取自上述 Capacitor 8.5.3 官方模板，保留了原脚本许可。本次实际使用独立下载、校验过官方摘要的 Gradle 8.14.3 执行构建。

# 日常记

安卓个人记账与记录应用。应用名暂用“日常记”，包名为 `app.local.dailyjournal`。

## 当前交付状态

**一期已通过用户真机验收；当前工作区为二期开发源码，尚未完成二期验收。** 用户已确认一期修复后的启动、保存、图片和备份恢复无问题，见 [一期验收记录](docs/acceptance.md)。一期结果不代表本轮二期源码已经构建或真机验收。

首版构建及 8 项单元测试结果保留在 [历史构建报告](docs/build-report.md)。SQLite 查询参数修复后的版本已通过用户真机验收；后续的数据库和二期回归用例尚未运行，不从一期真机通过推定本轮自动检查结果。本轮已修改二期源码，未重新运行构建或测试。

二期原30项确认后，用户已取消预算，并追加分类多选、筛选选中态和统计再次点击收起，见 [最新二期需求与实施状态](docs/phase2-requirements.md)。快捷记账、日历/标签、可选密码锁、回收站/备份、趋势、分类合并、账单图片、周期待确认的主体源码保留。数据库和备份格式仍为2，兼容一期格式及旧二期预算字段；不再提供预算入口或计算。未安装新依赖。用户选择自行验证，本轮未运行类型检查、测试、构建或真机安装，见 [二期验收清单](docs/phase2-acceptance.md)。

账单分类多选按任一分类匹配，与日期、类型、金额和备注同时生效；筛选入口及各选项高亮展示选中状态。统计入口可再次点击收起；近6/12个月再次点击当前按钮恢复展开前日期，切换两个快捷范围时保留原返回点。

2026-11-18 首页按已确认效果图改为支出优先：突出本月支出，默认查看支出，可切换全部/收入及月份；账单按天分组显示日小计，周期入口下移缩小，分类排行先于趋势。主按钮保留“记一笔”，沿用已有主题配色。已写入源码与分组用例，尚未运行验证。

## 一期功能

- 收入和支出的新增、编辑、删除；分类管理；日期、类型、分类、备注、单笔金额上下限筛选；分类金额与占比统计。
- 文字记录、图片附件、篇内待办；标题、正文和待办搜索；多个置顶；置顶和普通分组分别拖拽排序。
- 编辑后延迟 600 毫秒自动保存，离开编辑页和进入后台时尝试立即保存。保存失败时保留编辑内容并提示；离开页面前保存失败则停止跳转。
- 四种预设主题、自定义主题色和底色、浅色/深色/跟随系统。
- 完整 ZIP 备份；恢复前预检文件与 SHA-256，再自动备份当前内容，最后通过数据库事务整体恢复。
- 全部账单导出 CSV；记录导出 Markdown、图片与目录 ZIP。导出的 CSV/记录包用于查看，导入恢复使用完整备份 ZIP。
- 密码保护留待二期：已确认默认不启用，可在设置中开启；其余细节见二期需求草案。

## 技术与目录

- Vue 3、TypeScript、Vite、Pinia、Vue Router；Vant 按需用于弹窗和按钮；SortableJS 用于拖拽。
- Capacitor 8.5.3；社区 SQLite 插件 8.1.1，已完成依赖安装和安卓同步。
- 账单金额使用整数“分”；参数化 SQL 查询负责筛选。记录、待办、图片元数据、排序、主题配置都保存于同一 SQLite 数据库，便于事务恢复。
- 图片文件与 ZIP 使用工程内的 `JournalFilesPlugin.java`，通过系统文件选择器读写；图片不经 Base64 批量传递给前端。
- 全部资源本地打包，未配置远程页面、在线字体、分析服务或后端。Manifest 显式移除联网、指纹与生物识别权限；一期启动等核心流程已由用户完成真机验收。
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
docs/phase2-requirements.md    二期需求草案、已确认决定与验收标准
```

## 数据与备份边界

- 应用运行不需要网络；安装依赖、下载 Android/Gradle 构建工具时需要开发网络。
- 浏览器只预览界面，使用内存数据，刷新即丢失；本地图片和备份操作仅在安卓实现。不要用浏览器预览保存正式内容。
- 最低 Android 8（API 26），需要较新的 Android System WebView；具体手机型号、系统和 WebView 版本尚未核对。
- 当前支持 JPG、PNG、WebP；每张图片上限 100 MB。完整备份的 JSON 清单上限 20 MB，解压后总大小上限 2 GB，总文件数上限 20000。备份生成时与导入时采用相同上限。
- 一期没有应用密码；二期开发源码支持可选六位应用锁，默认关闭，系统锁屏凭据验证后可重设。应用锁不是内容加密，备份仍可包含全部个人内容及回收站内容，密码不在备份中。
- 手动完整备份与覆盖前自动备份保存在应用私有目录，可在设置中另存到应用外。卸载应用会删除应用内备份，另存的文件由你选择的位置保留。
- 恢复图片先复制到独立文件名，原数据库仍可使用原图；数据库事务失败时不会删除原数据。失败的恢复可能留下未引用的图片，不影响原记录。
- 二期数据库与 ZIP 格式为版本2，新程序兼容一期格式1；未知版本会拒绝导入，不清库升级。旧程序不能读取二期备份。
- 编辑存在短暂的自动保存窗口，进程被系统立即终止仍可能丢失尚未落盘的输入；保存流程已通过用户真机验收，但不承诺极短时间杀进程时零丢失。

## 版本号统一管理

只修改项目根目录 `package.json` 的 `version`，例如从 `0.1.0` 改为 `0.2.0`。设置页直接读取此值；安卓 Gradle 打包时读取同一个文件，自动设置 `versionName`，并按“主版本 × 1,000,000 + 次版本 × 1,000 + 修订号”生成 `versionCode`，不需要手动修改 Vue 页面或 Gradle 版本字段。

| package.json.version / 安装包显示版本 | 自动生成的 versionCode |
| --- | --- |
| `0.1.0` | `1000` |
| `0.1.1` | `1001` |
| `0.2.0` | `2000` |
| `1.0.0` | `1000000` |

版本使用 `主.次.修订` 三段非负整数，无前导零，次版本和修订号各不超过999，生成的整数必须为1～2100000000；格式无效时停止安卓构建，不静默回退旧版本。当前不支持 `beta` 等预发布后缀。每次发布应提高版本，沿用同一签名。[Android 版本说明](https://developer.android.com/studio/publish/versioning)

修改版本后，在项目根目录运行 `npm run android:build`，按下文的一键流程同步前端并生成 APK，确保设置页和安装包版本一起更新。直接运行 Gradle 会读取新版本，但不能代替前端资源构建与同步。`package-lock.json` 由 npm 维护，不作为应用运行版本来源。

此统一版本实现已写入源码，尚未运行类型检查、前端构建或安卓构建。

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

`ANDROID_USER_HOME` 复用原来的 `debug.keystore`，让新 Debug APK 与之前的 APK 保持签名一致。旧 SDK/JDK 原件暂时保留；此前迁移时只核对了逐文件 SHA-256。当前一期真机验收结论来自用户确认，不能用于推断某次工具迁移后执行过哪些自动检查。不能因为 SDK/JDK 已迁移就直接删除整个旧任务目录，其中仍有签名密钥和历史缓存。换机器时需要重新配置工具路径并安全迁移密钥；密钥不包含在源码包中。若已有独立开发环境，可自行配置 Node、JDK、SDK，仍需使用原密钥才能直接覆盖安装旧包。

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

一键构建前端、同步安卓资源并生成 Debug APK，在项目根目录执行：

```powershell
Set-Location 'D:\workSpace\daily-journal'
npm run android:build
```

该命令依次执行 `android:sync`（包含前端类型检查、构建及 Capacitor 同步）和 `gradlew.bat --no-daemon :app:assembleDebug`。前一步失败就停止；不执行 `npm install`/`npm ci`、单元测试、自动修改版本或安装到手机。Gradle 缺少缓存时仍可能下载构建工具和安卓依赖。脚本已写入，尚未执行验证。

原签名固定为 `%USERPROFILE%\Documents\Codex\2026-10-21\wo-x\work\android-user\debug.keystore`，同时设置本次进程的 `ANDROID_USER_HOME` 和传给 Gradle 的专用密钥路径；不会因当前终端的默认签名目录不同而换钥。文件不存在时在前端构建前停止，不自动生成或复制另一份。该命令继续构建 Debug 包；不能据此推定手机现有 APK 的证书已核对。

JDK 优先使用已有 `JAVA_HOME`，未设置时使用 `D:\appBox\Java\jdk-21`；SDK 优先使用 `ANDROID_HOME`/`ANDROID_SDK_ROOT`，未设置时使用 `D:\appBox\Android\Sdk`。Gradle 缓存沿用已有 `GRADLE_USER_HOME`，未设置时使用原工作目录的 `gradle-home`。这些设置只影响本次构建子进程，不修改系统环境变量。签名文件路径定义在 `scripts/build-android.mjs`，移动工具目录时须保留并安全迁移原密钥。

需要分步排查时，也可沿用前面的临时环境设置，然后执行：

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

## VS Code 的 Vue 3 提示

本项目使用 Vue 3 和 TypeScript 的 `moduleResolution: Bundler`。VS Code 使用 Vue - Official（扩展标识 `Vue.volar`）；若安装了 Vetur（`octref.vetur`），在此工作区禁用 Vetur，再重载窗口。无需为了 Vetur 的模块找不到提示把解析方式改为 `node`。扩展的安装和启停由用户操作，本轮未修改全局编辑器设置。[Vue 官方建议](https://vuejs.org/guide/scaling-up/tooling.html#ide-support)

## 版本核对来源

- [Capacitor 环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)
- [Capacitor 8.5.3 安卓工程模板](https://github.com/ionic-team/capacitor/tree/8.5.3/android-template)
- [SQLite 插件源码](https://github.com/capacitor-community/sqlite/tree/v8.1.1)
- [安卓本地插件接口](https://capacitorjs.com/docs/plugins/android)

Gradle Wrapper 的四个文件直接取自上述 Capacitor 8.5.3 官方模板，保留了原脚本许可。本次实际使用独立下载、校验过官方摘要的 Gradle 8.14.3 执行构建。

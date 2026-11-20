# 部署说明（生产服务器）

本目录存放生产部署所需的脚本。系统由**两个进程**组成，部署时必须区分清楚：

| 进程 | 文件 | 要求 | 作用 |
|---|---|---|---|
| API + 静态站点 | `server.js` | 必须**常驻**（服务化） | 提供 `/api/*` 接口、托管 `dist/` 前端；统计计算逻辑在这里 |
| 统计定时任务 | `stats_job.js` | 由 systemd timer / cron / 计划任务**周期性触发** | 通过 HTTP 调用 `POST /api/stats/rebuild`，本身不读写数据库 |

> `stats_job.js` 只依赖 Node 内置能力（Node 18+ 的 `fetch`），没有第三方依赖；`server.js` 依赖 `better-sqlite3`（原生模块）。

## 目录内容

```
deploy/
├── README.md                       # 本文件
├── linux/
│   ├── mesmonitor.service          # systemd 服务模板（占位符由 install.sh 替换）
│   └── install.sh                  # 一键：装依赖 → 构建 → 装服务 → 装定时任务
└── windows/
    ├── install-service.ps1         # 用 NSSM 把 server.js 注册为 Windows 服务
    ├── install-task.ps1            # 注册「生产统计」计划任务
    └── run-stats.bat               # 统计任务批处理入口（人工执行 / 备用）
```

## 前置条件

- Node.js **18+**（`stats_job.js` 使用内置 `fetch`）
- 服务器时区为 **Asia/Shanghai / China Standard Time (UTC+8)**：统计按服务器本地时间计算「昨天/今天」，班次归属也按 `collect_time` 划分，时区错误会导致统计错位一天
- 运行服务的账号对项目目录（`mesmonitor.db`、`server.log`、`stats_job.log`）有读写权限
- `npm install` 能成功编译/下载 `better-sqlite3`（Linux 需要 gcc/make/python3，或命中预编译包）

---

## Linux 部署

### 一键部署

```bash
# 上传代码到 /opt/mesmonitor，然后：
cd /opt/mesmonitor

sudo bash deploy/linux/install.sh --init-db      # 首次部署：初始化数据库（会清空现有数据）
sudo bash deploy/linux/install.sh                # 后续升级：装依赖 + 构建 + 重启服务 + 刷定时任务
```

常用参数（均可用环境变量指定）：

| 参数 / 变量 | 默认值 | 说明 |
|---|---|---|
| `APP_DIR` | 脚本上两级目录 | 项目根目录 |
| `RUN_USER` | `$SUDO_USER` / 当前用户 | 运行服务与定时任务的账号 |
| `PORT` | `3456` | 服务端口 |
| `SERVICE_NAME` | `mesmonitor` | systemd 服务名 |
| `CRON_SCHEDULE` | `10 * * * *` | 统计任务执行周期 |
| `--init-db` | 关闭 | 额外初始化数据库（**会清空全部业务数据**） |
| `--no-cron` | — | 不安装 crontab |
| `--uninstall` | — | 停止并移除服务与定时任务（保留代码和数据库） |

```bash
# 自定义示例
sudo APP_DIR=/opt/mesmonitor RUN_USER=mes PORT=4000 CRON_SCHEDULE="0 * * * *" \
     bash deploy/linux/install.sh
```

### 手动部署（等价步骤）

```bash
cd /opt/mesmonitor
npm ci                                   # 安装依赖（须在目标机安装，不能直接拷 node_modules）
npm run build                            # 生成 dist/
node -e "const D=require('better-sqlite3');const fs=require('fs');const db=new D('mesmonitor.db');db.exec(fs.readFileSync('init_all.sql','utf8'));db.close()"   # 仅首次
```

写服务文件 `/etc/systemd/system/mesmonitor.service`（把 `mesmonitor.service` 里的占位符改成实际值），然后：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mesmonitor
sudo systemctl status mesmonitor
```

安装定时任务（在运行用户下）：

```bash
crontab -u mes -e
# 加入一行，每小时重算昨天+今天：
10 * * * * cd /opt/mesmonitor && /usr/bin/node stats_job.js >/dev/null 2>&1  # mesmonitor-stats-job
```

> `stats_job.js` 自己会写 `stats_job.log`，cron 里无需再重定向到该文件。

### 上线后验证

```bash
cd /opt/mesmonitor
node stats_job.js --all                 # 首次：按 process_data 全量建历史统计
node stats_job.js --date $(date +%F)    # 验证单次增量任务
tail -n 20 stats_job.log                # 应看到「统计完成 … 写入 N 行，来源记录 M 条」
curl -s "http://127.0.0.1:3456/api/stats/list?pageSize=1" | head -c 300
```

---

## Windows 部署

以下命令在**管理员 PowerShell** 中执行，工作目录为项目根（如 `D:\mesmonitor`）。

### 1. 安装依赖并构建

```powershell
npm ci
node -e "const D=require('better-sqlite3');const fs=require('fs');const db=new D('mesmonitor.db');db.exec(fs.readFileSync('init_all.sql','utf8'));db.close()"   # 仅首次，会清空数据
npm run build
```

### 2. 注册 API 服务（NSSM）

```powershell
winget install NSSM.NSSM        # 若尚未安装 NSSM，安装后重开 PowerShell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-service.ps1 -DryRun   # 先看将执行什么
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-service.ps1
```

脚本会：注册 `MESMonitor` 服务 → 设置工作目录 `AppDirectory` → 注入 `PORT`/`NODE_ENV` → 日志重定向到 `logs\service.out.log` / `service.err.log`（10MB 轮转）→ 自动启动并做一次 HTTP 探活。

常用参数：`-AppDir`、`-NodeExe`、`-ServiceName`、`-Port`、`-Force`（重装）、`-Uninstall`。

```powershell
nssm restart MESMonitor       # 修改配置后重启
nssm stop MESMonitor
```

> 项目路径建议放在 `D:\` 等非用户目录：服务以 `SYSTEM` 身份运行，用户目录可能存在权限问题。

### 3. 注册统计计划任务

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-task.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-task.ps1                 # 每天 00:10，重算昨天+今天
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-task.ps1 -RepeatHours 2  # 每 2 小时重算
```

脚本会以 `SYSTEM` 身份、最高权限注册任务 `MES-Stats-Job`，动作是绝对路径调用 `node.exe stats_job.js`（不依赖 PATH 与工作目录）。

首次建历史统计可以单独跑一次性任务：

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install-task.ps1 -All -RunOnce -TaskName MES-Stats-Job-All
schtasks /run /tn "MES-Stats-Job-All"
schtasks /delete /tn "MES-Stats-Job-All" /f
```

常用参数：`-TaskName`、`-StartTime`（默认 `00:10`）、`-RepeatHours`、`-Port`、`-All`、`-RunOnce`、`-Uninstall`。

### 4. 人工执行 / 排查

```bat
deploy\windows\run-stats.bat                  :: 重算昨天+今天
deploy\windows\run-stats.bat --all            :: 全量重建
deploy\windows\run-stats.bat --date 2026-11-17
deploy\windows\run-stats.bat --days 7
```

脚本自动 `cd` 到项目根目录执行，日志写入项目根的 `stats_job.log`。若 `node` 不在系统 PATH，可先设置环境变量 `NODE_EXE`：

```bat
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
deploy\windows\run-stats.bat
```

---

## 统计任务参数

| 参数 | 说明 |
|---|---|
| 无参数 | 重算「昨天 + 今天」 |
| `--all` | 清空 `production_stats` 后按 `process_data` 全部记录重建 |
| `--days N` | 重算最近 N 天（含今天） |
| `--date YYYY-MM-DD` | 重算指定某天 |
| `--from A --to B` | 重算区间（单次上限 400 天） |
| `--loop N` | 常驻模式，每 N 秒重算一次（需自行守护进程） |
| `--host` / `--port` | 后端地址，默认 `127.0.0.1:3456`，须与 `server.js` 一致 |

统计口径：一条 `process_data` 记录计为 1 件产出；质量数取自 `data_status`；配置了 `shift_config` 则按班次汇总，否则按天；**未启用设备（`devices.is_active <> 1`）的记录不参与统计**。

## 首次上线建议顺序

1. `npm ci` → `npm run build`
2. 初始化数据库（仅首次，会清空数据）
3. 启动服务并确认两个入口可访问：车间看板 `http://<IP>:3456/`、管理后台 `http://<IP>:3456/admin`
4. `node stats_job.js --all` 建历史统计
5. `node stats_job.js --date <今天>` 验证增量任务
6. 确认 `stats_job.log` 输出正常后，再启用 cron / 计划任务
7. 打开「生产统计」页面核对总量与 `process_data` 记录数是否一致

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| `统计异常 … ECONNREFUSED` | `server.js` 未运行或端口不一致；检查服务状态与 `--port` |
| 统计日期整体偏移一天 | 服务器时区不是 UTC+8；Linux 用 `timedatectl set-timezone Asia/Shanghai`，Windows 用 `tzutil /s "China Standard Time"` |
| 统计总量与工艺数据不一致 | 检查是否有设备被停用（停用设备不统计）；页面对应提示 `skippedRecords` |
| `better-sqlite3` 安装失败 | 缺构建工具（`apt install build-essential python3`）或 Node 版本与已编译产物 ABI 不匹配，重装 `node_modules` |
| 计划任务执行无日志 | 任务以 `SYSTEM` 运行，确认对项目目录有写权限；用 `run-stats.bat` 人工执行对照 |
| 页面空白 / 仍是旧界面 | 忘记 `npm run build`，或浏览器缓存；强制刷新 |
| 外网无法访问 3456 | 放行防火墙端口（`ufw allow 3456` / Windows 高级防火墙入站规则） |

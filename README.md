# MES Monitor - 压铸车间监控系统

基于 Web 的 MES（制造执行系统）压铸车间设备监控平台，实现对压铸产线设备状态、工艺参数、产品质量的实时监控与数据管理。

## 功能模块

### 1. 设备状态监控
- 设备清单与实时状态（运行 / 预警 / 故障）由设备管理表驱动，首页自动展示
- 设备运行状态可视化统计与卡片展示，卡片显示设备名称与设备编号
- 点击设备卡片查看报警详情弹窗，查询该设备的历史报警记录

### 2. 设备管理（增删查改）
- 设备档案维护：设备名称、设备编号、类型、位置、型号、厂家、安装日期、备注
- 支持按关键字（名称 / 编号 / 位置）、设备类型、启用状态查询
- 新增 / 编辑 / 删除设备，删除前校验工艺数据引用，被引用设备禁止删除
- **设备编号为全系统统一业务主键**：`process_data.device_code`、首页监控、工艺数据与分析筛选均指向设备管理表；修改设备编号时自动同步已有工艺数据的关联编号
- 启用 / 停用设备，停用后不在首页监控中展示

### 3. 产品档案管理（增删查改）
- 产品档案维护：产品名称、产品编码（唯一）、产品类型、说明，管理后台「产品管理」页支持新增 / 编辑 / 删除
- 支持按关键字（名称 / 编码 / 说明）与产品类型查询；列表展示每个产品被热成像记录引用的条数
- 产品名称与编码均要求唯一；编码留空表示暂不编码（空编码存 `NULL`，允许多个）
- 已被 `thermal_records` 引用的产品禁止删除，删除前提示引用条数
- 老库启动时自动补齐 `products` 表结构与索引，无需重跑 `init_all.sql`

### 4. 热成像温度检测
- 20 点位热成像温度采集与存储
- 温度热力图由点位数据实时生成（前端内联 SVG 渲染）
- 温度高低颜色映射（高温红 → 中温绿/黄 → 低温蓝），超过阈值自动高亮
- 实时显示最高 / 最低温度

### 5. 模具配方管理
- **模具档案维护**（后台「模具档案」页）：模具名称、编码（唯一）、类型、说明、启用状态；列表显示被配方引用的条数，停用模具不再出现在配方下拉中，已被配方引用的模具禁止删除
- **配方关联产品**：`mold_recipes.product_id` 引用 `products`，产品在配方表单中从「产品管理」下拉选择，不再手工输入名称；`product_name` 作为冗余快照随产品同步保存，老库中的历史文本名称在服务启动时按名称自动回填 `product_id`
- **配方关联模具**：`mold_recipes.mold_id` 引用 `molds`，表单中为下拉选择（可选「未指定模具」）
- 配方参数（一快 / 二快 / 增压三组 + 工艺时间，共 14 项数值参数）支持新增、编辑、删除
- 筛选项全部为下拉：产品（产品档案）、模具（模具档案）、生产线（现有产线去重），同时兼容 `product` / `mold` 名称关键字查询
- **表格 + 分页**：配方列表以表格展示全部 **24 列**（产品名称 / 产品编码 / 模具 / 产线 + 一快、二快、增压三组的开关与位置 / 阀位 / 压力 + 跟踪终点、快射储能、增压储能、压射 / 增压 / 冷却 / 锤击时间、慢压流量 + 备注 / 更新时间），产品名称与编码分列显示，按参数分组加竖线分隔、数值右对齐；**每列固定宽度**（见模板 `colgroup`，当前总宽 2266px，新增参数时累加该值即可），一屏放不下时通过表格下方的**横向进度条**左右拖动（或点击轨道跳转）查看后面的参数；支持分页（每页 10 / 20 / 50 / 100 可选，页码跳转），筛选与分页状态在会话内保持
- **导出 CSV**：按当前筛选条件导出全部配方（25 列，含三组开关与全部 14 项参数），文件名 `模具配方_时间戳.csv`
- **双端可用**：车间看板（`/#recipe`）只读查看配方，管理后台（`/admin#recipe`）可新增 / 编辑 / 删除，两端共用同一个页面组件

### 6. 管路数据监控
- 压力、温度、流量、阀门参数实时显示
- 支持一键下发参数设定值
- 参数修改记录追踪（`pipeline_edit_log`，记录旧值 → 新值）

### 7. 安灯呼叫系统
- 8 种快捷呼叫类型（缺料、质量异常、设备故障等）
- 支持自定义呼叫类型与详情
- 呼叫状态流转管理（待响应 → 处理中 → 已完成）
- 完整操作日志记录（发起 / 响应 / 完成 / 取消，含操作人、内容、时间）
- 所有输入交互使用内置 Vue 弹窗，不依赖浏览器原生 `prompt()`/`alert()`（兼容内嵌 WebView 环境）

### 8. 工艺数据采集
- 15 项工艺参数实时采集：慢压射速度（低速）、快压射速度（高速）、铸造压力、增压压力、浇注温度、模具温度、循环周期、保压时间、压射时间、料柄厚度、熔炉当前温度、鹅颈当前温度、射嘴当前温度、当前油温、高速切换点
- 与 P3500T 标准参数自动对比判定（正常 / 预警 / 不合格）
- 支持按设备 / 产品 / 批次 / 时间范围 / 状态多条件筛选
- 分页查询与页码跳转，每页条数可选 10 / 20 / 50 / 100（默认 10）
- **固定列宽 + 横向进度条**：7 个基础列固定宽度（合计 786px），参数列由 `/api/process/params` 动态生成且每列 110px，`process_data` 新增参数字段后表格自动加列，列多或窗口变窄时不被挤压换行，通过表格上方的进度条左右拖动查看
- 支持导出 CSV：导出当前筛选条件下的全部数据；未设置时间范围时默认导出最近一个月

### 9. 历史工件数据分析
- **数据来源统一**：分析数据直接取自工艺数据表 `process_data`（以 `workpiece_no` 标识工件），不单独存储业务数据；分析所需的每个参数在工艺数据表中必然存在
- **标准版本化**：分析标准按时间段生效，每条记录按其采集时间自动匹配当时的标准版本（例如 5 月前使用标准1、5 月起使用标准2）
- **标准可维护**：标准版本与参数可在页面「标准管理」或数据库中新增 / 修改 / 删除，新增参数只能从工艺数据表已有字段中选择
- **标准顺序可调**：标准明细行支持 ▲ / ▼ 上下移动，调整后立即持久化 `display_order`，标准面板与数据表格的参数列顺序同步变化（新增参数默认排在末尾，可前移）
- 逐参数偏差判定：偏差 ≤ 容差为合格、≤ 2 倍容差为预警、超出为不合格；越限值高亮并显示偏差比例
- **固定列宽 + 横向进度条**：列宽按「序号 / 工件编号 / 批次 / 设备 / 产品 / 采集时间 / 判定标准 / 参数列 / 判定」固定，参数列每列 120px 并随参数数量自动加宽，翻页或参数变化时列宽稳定不挤压，超出容器用横向进度条查看
- 支持按工件编号 / 批次 / 设备 / **产品型号** / 采集时间范围组合查询，合格率 / 不合格率统计与分页，标准变更全程留痕（`analysis_standard_logs`）

### 10. 产品生产统计
- 按「日期 + 班次 + 设备」统计生产数、合格数、预警数、不合格数，统计结果落库（`production_stats`）
- **数据源唯一**：统计只读取工艺数据表 `process_data`（一条工艺记录 = 1 件产出），不使用任何模拟数据
- **仅统计启用设备**：设备管理中 `is_active = 1` 的设备才参与统计，设备停用后其工艺记录不再生成统计行（重复统计也不会回填）
- **班次可选**：未配置班次时按天统计；配置班次后按班次统计，跨天班次（如 20:00-08:00）自动归属开始日
- 统计行完全由 `process_data` 聚合产生，没有来源记录的日期 / 班次 / 设备不会生成空行
- 支持日期范围 / 设备 / 班次筛选与分页（每页 10 / 20 / 50 / 100 可选），汇总卡片展示生产总数、合格率
- 支持导出 CSV：按当前筛选条件导出；未修改默认日期时导出最近一个月
- 提供「重新统计」按钮与定时任务脚本 `stats_job.js`，可按计划自动生成统计

### 11. 生产计划
- 按设备下达计划（`production_plans`）：计划编号、名称、设备、产品型号（可选）、计划数、计划周期
- **完整状态流转**：起草 → 下达（派发生效）→ 执行中 ⇄ 暂停 → 完成 → 结案；起草 / 已下达 / 执行中 / 暂停可取消，已取消可恢复为起草
- **状态约束**：起草状态可修改全部字段；已下达后仅可改名称与备注（排产要素锁定，需先「撤回」为起草）；已完成仅可结案；仅起草 / 已取消的计划可删除
- **开始执行与完成可回填实际时间**：点「开始」「完成」时弹窗默认当前时间，可改成实际发生时间（如月初生产、月中才补确认），完成数按回填区间统计，多个计划各自独立不串数据；暂停 / 恢复 / 取消仍按实际切换时间记录，保证暂停区间真实
- **回填时间受计划周期约束**：`occurred_at` 必须是有效日历时间（`YYYY-MM-DD HH:MM`），不得晚于当前时间、不得早于计划开始时间；开始执行时若已过计划结束时间，需先撤回为起草并调整计划周期，避免出现「设备被占用但完成数为 0」
- **同设备执行区间不重叠**：开始 / 恢复执行时校验该设备已有计划的执行段，若时间区间重叠则拒绝并提示占用计划（编号、区间）；不同设备的计划可同时执行。计划暂停 / 完成后释放设备，其他计划即可开始
- **暂停必须填写原因**，用于异常情况追溯；每次流转写入 `production_plan_logs`（操作人、时间、原因），编辑弹窗内可查看流转记录
- **完成度按执行段累计**：完成数 = 各「执行段」（`production_plan_segments`，即每次开始执行→暂停/完成/取消 的时间区间）内该设备的工艺记录数之和；暂停期间设备生产其他计划的产出不计入本计划，恢复后从当前时间继续累计，因此「计划数 500 → 已做 100 → 暂停 → 恢复 → 再做 50」累计为 150
- 未开始执行（起草 / 已下达）的计划完成数为 0；撤回或恢复起草会清空执行段
- 指定产品型号时只统计该产品；未启用设备的记录不参与统计（与生产统计口径一致）
- 已下达 / 执行中 / 暂停的计划超过结束时间自动标记「已超期」/「逾期未执行」，各状态数量在汇总卡片中分别展示
- 页面每 15 秒自动刷新计划状态与进度；支持设备 / 状态 / 关键字 / 日期范围筛选
- 每个计划提供「查询」按钮，弹窗按分页列出该计划关联的工艺记录（与完成数同口径：设备 + 周期 ∩ 执行段 + 产品），并列展示全部工艺参数，便于核对完成数来源
- 分页每页条数可选 10 / 20 / 50 / 100（默认 10）；支持导出 CSV，未设置日期范围时导出最近一个月

### 12. 工艺参数曲线
- 可任选 `process_data` 中的工艺参数（8 项全部可选）组合成多条曲线同时展示，同一参数颜色固定
- 数据范围两种方式：最近 50 / 100 / 200 条记录，或按采集时间范围查询（时间范围模式最多返回 2000 条）
- 支持按设备 / 产品型号过滤
- **纵轴为参数真实数值**：每条曲线按自身量程映射到绘图区，量纲悬殊（如 0.19 m/s 与 680 ℃）时不会把小幅值曲线压成直线
- 纵轴刻度跟随当前基准曲线（默认第一条可见曲线），点击图例即可切换，图例同时显示各参数当前值，悬停可看到取值范围
- 鼠标悬停显示该时刻所有曲线的原始数值；点击图例切换纵轴，点击图例右侧 × 隐藏 / 显示单条曲线
- 数据取自 `/api/process/chart`，可选参数由 `/api/process/params` 从 `process_data` 实际字段自动生成，新增工艺参数无需改页面

## 系统划分（前端显示系统 / 后端管理系统）

两套前端共用同一个后端 API 与 SQLite 数据库，按使用场景拆分为两个独立入口：

| 系统 | 访问地址 | 定位 | 包含模块 |
|---|---|---|---|
| 前端显示系统 | `/` | 车间看板，只读展示 | 首页、热成像、管路控制（参数显示）、模具配方（查看）、安灯呼叫（呼叫看板）、工艺数据、工艺参数曲线、生产统计、生产计划（进度） |
| 后端管理系统 | `/admin` | 管理后台，配置与运维 | 设备管理、产品管理、模具档案、模具配方、管路参数下发、安灯呼叫处理、数据分析、工艺参数曲线、生产统计（班次设置 / 重新统计）、生产计划（起草 / 下达 / 暂停 / 完成 / 结案） |

- 两套系统各自维护导航与 URL hash，刷新后都停留在当前模块；
- 管路、安灯、统计、计划四个页面为双端共用组件，通过 `viewMode="display|admin"` 隐藏或显示管理操作，避免维护两份页面；
- 两个入口共用同一份构建产物与全局样式，`server.js` 按路径分配入口：`/` → `index.html`，`/admin` → `admin.html`。

## 登录与权限控制

系统内置账号体系，按「页面可见性 + 按钮动作」两级授权，权限在**后端强制校验**，不是仅隐藏前端按钮。

### 账号与登录

- 初始超级管理员：用户名由 `DEFAULT_ADMIN_USER` 指定（默认 `admin`）。**密码不再有内置默认值**：未配置 `DEFAULT_ADMIN_PASSWORD` 时，首次建库随机生成 16 位密码并只在控制台输出一次，请立即登录修改；配置了该变量则使用配置值（长度 6~128）
- 登录接口下发 `HttpOnly + SameSite=Lax` 会话 Cookie（`mes_session`），令牌不写入 `localStorage`；会话默认 12 小时，活跃时自动续期；HTTPS 部署请设置 `COOKIE_SECURE=1` 追加 `Secure`
- 连续输错密码达到阈值（默认 5 次）按「IP + 用户名」锁定 60 秒，返回 429；默认只信任直连 IP，`X-Forwarded-For` 需显式开启 `TRUST_PROXY=1` 才解析，避免伪造 IP 绕过锁定
- 修改密码后该账号其它终端会话立即失效；停用 / 删除用户会清理其全部会话

### 未登录可见内容

- 车间看板 `/`：只展示「首页」看板内容（设备概览 + 报警详情）与「登录」按钮，其它看板页签隐藏
- 管理后台 `/admin`：直接展示整页登录框，未登录无法进入任何配置页面
- 接口侧仅放行 `/health`、`/api/auth/*`、`/api/devices/overview`、`/api/devices/alarm-log`，其余接口一律 401

### 授权模型

| 层级 | 说明 | 作用点 |
|---|---|---|
| 车间看板页面 | 该账号能看到的显示端页签（首页 / 热成像 / 管路 / 配方 / 安灯 / 工艺 / 曲线 / 统计 / 计划） | 显示端导航与页面渲染；对应模块的读接口 |
| 后台管理页面 | 该账号能进入的后台页签（设备 / 产品 / 模具 / 配方 / 管路 / 安灯 / 分析 / 曲线 / 统计 / 计划 / 用户权限） | 后台导航与页面渲染；对应模块的读接口 |
| 按钮动作 | 新增 / 修改 / 删除等写操作，按模块勾选（如 `device:create`、`plan:operate`、`stats:config`、`andon:respond`） | 后台与看板的操作按钮；后端写接口，越权返回 403 |

- 超级管理员（`role = super`）自动拥有全部页面与动作，不参与勾选
- 非超级管理员即使拥有「用户权限」页，也不能把超管身份或「用户权限」模块授出，无法修改 / 删除超管账号
- 仅拥有 `display: plan` 而不具备 `plan:operate` 的账号可在看板查看计划进度但不能开始 / 暂停 / 完成

**按钮权限与页面强关联**：动作权限依附于所属模块页面，未分配该模块页面时，其下的新增 / 删除等动作不生效。

- 授权界面：取消某模块页面后，该模块的动作组变灰并提示「需先勾选该页面」，已勾选的动作自动取消后保存
- 接口侧：保存时自动丢弃「无页面却有动作」的组合，读取用户信息时同样收敛；写接口会先校验是否拥有该模块页面，没有则返回 403
- 模块页面任一端（看板或后台）拥有即可承载该模块动作，例如「安灯呼叫」看板页可承载 `andon:create`、`andon:respond`

### 用户管理

进入「后台 → 用户权限」可完成：新增账号、修改显示名称、重置密码、启用 / 停用、删除，以及逐项勾选看板页面、后台页面与按钮动作。同一页面内的「编辑 / 重置密码 / 删除」按钮本身也受 `user:update` / `user:delete` 控制。

### 退出登录

点击「退出」后回到初始界面：直接展示车间看板首页（未登录状态），地址栏不保留上一个模块的 hash；在后台退出则跳转回 `/`，不再停留在后台登录页。

### 机器令牌（自动化脚本）

若配置了 `ADMIN_TOKEN`，服务端脚本（如 `stats_job.js`）可携带 `X-Admin-Token` 调用接口（等同超级管理员），用于定时统计、采集写入等无人值守任务。

**浏览器端不支持该令牌**：`/admin?token=xxx` 不再写入或携带 `X-Admin-Token`。机器令牌等同超级管理员，一旦进入 `localStorage` 会被 XSS 或共享大屏终端窃取并绕过全部页面/按钮权限与审计，仅限受控脚本通过环境变量使用。

## 技术栈

- **前端**: Vue 3（单文件组件 SFC）+ Vite 构建工具，双入口（显示端 / 管理端）
- **后端**: Node.js 原生 `http` 模块（提供 API + 静态托管）
- **架构**: 前后端分离（前端 Vue 进程与后端 Node 进程通过 HTTP 通信，详见下文「前端与后端的关系」）
- **数据库**: SQLite + better-sqlite3
- **交互**: 自定义 Vue 组件弹窗（替代原生 `prompt`/`alert`）

## 项目结构

```
mesmonitor/
├── index.html             # 前端显示系统入口（车间看板）
├── admin.html             # 后端管理系统入口（管理后台）
├── vite.config.js         # Vite 双入口配置 + 开发代理 /api → 3456
├── server.js              # Node.js 服务端（API + 静态托管：/ → 看板、/admin → 后台）
├── seed_process_data.js   # 工艺数据随机造数脚本（批量写入 process_data）
├── stats_job.js           # 生产统计定时任务脚本（单次 / 常驻循环）
├── package.json           # 项目依赖配置
├── init_all.sql           # 数据库初始化脚本（建表 + 默认数据）
├── css/
│   └── style.css          # 全局样式（两套系统共用）
├── systems/               # 两套前端系统源码
│   ├── shared/            # 共用层（API、通用弹窗、导航、双端共用页面）
│   │   ├── api.js             # API 请求与分页工具
│   │   ├── AppDialog.vue      # 通用弹窗组件（替代 prompt/alert）
│   │   ├── usePageNav.js      # 导航 + URL hash 持久化（刷新保持模块）
│   │   └── pages/             # 按 viewMode 区分只读 / 管理的双端页面
│   │       ├── PipelinePage.vue      # 管路参数（看板只读 / 后台可下发）
│   │       ├── AndonPage.vue         # 安灯呼叫（看板只读 / 后台可响应完成）
│   │       ├── StatsPage.vue         # 生产统计（看板只读 / 后台含班次设置与重算）
│   │       ├── ShiftConfigDialog.vue # 班次设置弹窗
│   │       ├── PlanPage.vue          # 生产计划（看板只读 / 后台可配置）
│   │       ├── PlanEditDialog.vue    # 计划新增 / 编辑弹窗
│   │       ├── RecipePage.vue        # 模具配方（看板只读 / 后台可增删改）
│   │       ├── RecipeEditDialog.vue  # 配方新增 / 编辑弹窗
│   │       └── ProcessChartPage.vue  # 工艺参数曲线（双端共用）
│   ├── display/           # 前端显示系统（车间看板，只读展示）
│   │   ├── main.js
│   │   ├── DisplayApp.vue # 导航：首页 / 热成像 / 管路 / 模具配方 / 安灯 / 工艺 / 曲线 / 统计 / 计划
│   │   └── pages/         # HomePage（设备状态）、ThermalPage（热成像）、ProcessPage（工艺数据）
│   └── admin/             # 后端管理系统（管理后台，配置与运维）
│       ├── main.js
│       ├── AdminApp.vue   # 导航：设备 / 产品 / 模具 / 配方 / 管路 / 安灯 / 分析 / 曲线 / 统计 / 计划
│       └── pages/         # DevicePage、DeviceEditDialog、ProductPage、ProductEditDialog、MoldPage、MoldEditDialog、AnalysisPage、AnalysisStandardDialog
├── dist/                  # Vite 构建产物（npm run build 生成，git 忽略）
├── mesmonitor.db          # SQLite 数据库文件（运行时生成）
├── server.log             # 运行日志（自动生成，git 忽略）
└── README.md              # 项目说明
```

> 前端采用 Vue 3 **单文件组件（SFC）** + Vite 构建。开发时通过 `npm run dev`（Vite 热更新，端口 5173）；生产时执行 `npm run build` 生成 `dist/`，由 `server.js` 直接托管。

## 数据库

共 **21 张数据表**，覆盖全部功能模块，详见 `init_all.sql`：

| 模块 | 数据表 | 说明 |
|------|--------|------|
| 设备监控 / 设备管理 | `devices` / `device_status` / `device_status_history` | 设备档案（编号为业务主键）、当前状态、状态历史 |
| 热成像 | `thermal_records` / `thermal_point_temps` / `thermal_alarm_config` | 成像记录、点位温度、报警阈值 |
| 产品 | `products` | 产品档案（后台「产品管理」维护），热成像记录按 `product_id` 引用 |
| 模具配方 | `molds` / `mold_recipes` | 模具档案、配方参数；`mold_recipes.product_id` → `products`、`mold_id` → `molds`（均 `ON DELETE SET NULL`，`product_name` 为冗余快照） |
| 管路数据 | `pipeline_params` / `pipeline_edit_log` | 管路参数、下发修改记录 |
| 安灯呼叫 | `andon_calls` / `andon_call_types` / `andon_call_logs` | 呼叫记录、呼叫类型、操作日志 |
| 工艺数据 | `process_data` | 工艺采集数据（全系统唯一数据源） |
| 工件分析 | `analysis_standard_versions` / `analysis_standards` / `analysis_standard_logs` | 分析标准版本（按时间段生效）、标准明细、变更日志 |
| 生产统计 | `shift_config` / `production_stats` | 班次配置（可为空，空=按天）、日期+班次+设备产量统计 |
| 生产计划 | `production_plans` / `production_plan_logs` / `production_plan_segments` | 计划数、周期与状态流转时间戳；流转日志留痕；执行段决定完成数统计区间 |

> `andon_call_logs`（安灯操作日志）关联 `andon_calls` 外键，记录发起 / 响应 / 完成 / 取消等操作，含操作人、操作内容与时间。

### 数据表说明（逐表）

| 表名 | 是什么表 | 存储什么内容 |
|------|----------|--------------|
| `devices` | 设备档案表 | 设备名称、设备编号（业务主键）、类型、位置、型号、厂家、安装日期、启用状态 |
| `device_status` | 设备实时状态表 | 每台设备最新一次运行状态（running / warning / error）及报警、明细信息 |
| `device_status_history` | 设备状态历史表 | 状态变更记录：状态、报警内容、开始 / 结束时间与持续秒数 |
| `products` | 产品档案表 | 产品名称、产品编码（唯一）、产品类型、说明，供热成像记录与模具配方引用 |
| `thermal_records` | 热成像记录表 | 每次采集的产品、采集时间、最高 / 最低 / 平均温度、报警状态、图像信息 |
| `thermal_point_temps` | 热成像点位温度表 | 单次采集内各点位（默认 20 点）的温度、坐标、是否报警 |
| `thermal_alarm_config` | 热成像阈值配置表 | 各点位的温度上下限、名称与启用状态 |
| `molds` | 模具档案表 | 模具名称、模具编码（唯一）、模具类型、说明、启用状态 |
| `mold_recipes` | 模具配方表 | 配方归属（`product_id`、`mold_id`、生产线）与一快 / 二快 / 增压等 14 项工艺参数 |
| `pipeline_params` | 管路参数表 | 压力、温度、流量、阀门开度的当前设定值及允许区间 |
| `pipeline_edit_log` | 管路修改日志表 | 每次参数下发的参数名、旧值、新值、操作人、时间与备注 |
| `andon_calls` | 安灯呼叫记录表 | 呼叫类型、呼叫详情、发起人、呼叫时间、状态、处理人与处理结果 |
| `andon_call_types` | 安灯呼叫类型表 | 8 种呼叫类型的名称、编码、图标、排序与启用状态 |
| `andon_call_logs` | 安灯操作日志表 | 每个呼叫的发起 / 响应 / 完成 / 取消操作留痕（操作人、内容、时间） |
| `process_data` | 工艺数据采集表（全系统唯一数据源） | 每条工件的采集时间、设备编号、产品型号、批次、工件号、15 项工艺参数与判定状态；新增参数字段只需给表加列，服务启动时老库自动补列并同步到表格/曲线/导出/分析参数清单 |
| `analysis_standard_versions` | 分析标准版本表 | 标准版本编码 / 名称、适用产品型号、生效起止时间（按时间段匹配判定标准） |
| `analysis_standards` | 分析标准明细表 | 某版本下每个工艺参数的基准值、容差、单位与显示顺序 |
| `analysis_standard_logs` | 分析标准变更日志表 | 标准版本与参数的新增 / 修改 / 删除操作留痕 |
| `shift_config` | 班次配置表 | 班次编码、名称与起止时间（表可为空，空 = 按天统计） |
| `production_stats` | 生产统计表 | 按「日期 + 班次 + 设备」汇总的生产数、合格数、预警数、不合格数 |
| `production_plans` | 生产计划表 | 计划编号 / 名称、设备编号、产品型号、计划数、计划周期、状态及下达 / 开始 / 暂停 / 完成 / 结案 / 取消时间戳与暂停原因 |
| `production_plan_logs` | 生产计划流转日志表 | 计划每次创建、修改、下达、开始、暂停、恢复、完成、结案、取消、删除的操作人、前后状态、原因与时间 |
| `production_plan_segments` | 计划执行段表 | 每次「开始执行 → 暂停 / 完成 / 取消」的时间区间，完成数只统计落在这些区间内的工艺记录 |
| `users` | 登录账号表 | 用户名（唯一）、显示名称、scrypt 密码哈希、角色（`super` / `normal`）、看板页面 / 后台页面 / 按钮动作授权（JSON 数组）、启用状态与最近登录时间 |
| `user_sessions` | 登录会话表 | 会话令牌（64 位随机串）、所属用户、创建 / 过期时间、IP 与 User-Agent；过期由服务每小时清理 |

> **数据来源说明**：历史工件分析模块**不再单独存业务数据**，全部取自 `process_data`；该表新增 `workpiece_no`（工件编号）作为分析标识。分析标准只描述"用哪些参数、按什么标准值判定"，其中 `analysis_standards.param_key` 必须是 `process_data` 中存在的工艺参数列，从而保证"分析要用的参数，工艺数据表一定包含"。
>
> **标准版本说明**：`analysis_standard_versions` 用 `effective_from` / `effective_to` 描述生效区间（`effective_to` 为空表示至今有效，`product_model` 为空表示全部产品通用）。判定时按记录的 `collect_time` 匹配当时生效的版本，因此历史数据始终按当时的标准判定，新标准只影响生效期之后的数据。
>
> **设备关联说明**：`devices.device_code` 是设备业务主键，`process_data.device_code` 与之对应；首页监控、工艺数据筛选、分析筛选、列表中的设备名称全部由设备管理表提供，不再各自维护设备清单。修改设备编号时服务端会事务内同步更新 `process_data.device_code`，删除设备前会校验工艺数据引用，被引用设备禁止删除。设备列表与各页面设备下拉统一按「启用优先、编号升序」排序，停用设备排在启用设备之后；未启用设备在列表中统一显示为「关机」状态，不再展示其历史运行状态。
>
> **产品 / 模具关联说明**：`mold_recipes.product_id` 引用 `products`、`mold_id` 引用 `molds`，配方表单与筛选项均改为下拉选择；`product_name` 仅作冗余快照，列表展示优先取产品档案名称。老库启动时按产品名称自动回填 `product_id`（写入 `[MIGRATE]` 日志），未匹配到档案的历史记录保持为空，列表回退显示原文本名称。
>
> **生产统计口径**：`production_stats` 按「`stat_date` + `shift_code` + `device_code`」唯一，一条工艺记录计为 1 件产出；质量数取 `process_data.data_status`（`normal` → 合格、`warning` → 预警、其余 → 不合格）。未配置班次时 `shift_code` 为空串、`shift_name` 为「全天」；配置班次后按 `shift_config` 的时间窗划分，跨天班次（如 20:00-08:00）归属开始日，班次空档内产生的记录归入「未分班」。

> **历史遗留表清理**：旧版 `process_standards`（按产品型号存标准参数）已被分析标准版本表 `analysis_standard_versions` + `analysis_standards` 取代，代码中无任何读写。`init_all.sql` 不再创建该表；服务启动时如检测到老库残留该表，会自动 `DROP` 并写入 `[MIGRATE]` 日志，无需手工清理。

所有初始化数据使用 **"先清空再插入"** 模式，脚本可重复执行，不会造成数据翻倍。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录（body：`username`/`password`），成功下发 `mes_session` Cookie |
| POST | `/api/auth/logout` | 退出登录（清理会话与 Cookie） |
| GET | `/api/auth/me` | 当前登录用户与权限目录；未登录返回 `user: null` |
| GET | `/api/auth/meta` | 看板页面 / 后台页面 / 按钮动作目录（需登录） |
| POST | `/api/auth/password` | 修改自己的密码（body：`old_password`/`new_password`） |
| GET | `/api/auth/users` | 用户列表（需「用户权限」页面） |
| POST | `/api/auth/users/create` | 新增用户（`username`/`password`/`display_pages`/`admin_pages`/`actions`） |
| POST | `/api/auth/users/update` | 修改用户 / 重置密码 / 重新授权（body：`id` + 可改字段） |
| POST | `/api/auth/users/delete` | 删除用户（不能删除自己与最后一个超级管理员） |
| GET | `/api/devices/overview` | 设备概览（统计 + 状态卡片，仅启用设备；未登录可读） |
| GET | `/api/devices/alarm-log?name=` | 按设备名称查询报警历史 |
| GET | `/api/devices/list?keyword=&type=&active=` | 设备列表（含最新状态、关联工艺数据条数、统计与类型） |
| GET | `/api/devices/options` | 设备编号下拉选项（各页面筛选项数据来源） |
| POST | `/api/devices/create` | 新增设备（body：`device_name`/`device_code`/`device_type`/`location` 等） |
| POST | `/api/devices/update` | 修改设备（body：`id` + 可改字段；编号变更时同步 `process_data`） |
| POST | `/api/devices/delete` | 删除设备（body：`id`，被工艺数据引用时拒绝删除） |
| GET | `/api/products/list?keyword=&type=` | 产品档案列表（含被热成像记录引用条数、类型与统计） |
| GET | `/api/products/options` | 产品下拉选项（`id` / `product_name` / `product_code`） |
| POST | `/api/products/create` | 新增产品（body：`product_name` 必填，可选 `product_code`/`product_type`/`description`） |
| POST | `/api/products/update` | 修改产品（body：`id` + 可改字段，名称与编码需唯一） |
| POST | `/api/products/delete` | 删除产品（body：`id`，被热成像记录引用时拒绝删除） |
| GET | `/api/thermal/latest` | 最新热成像记录及点位温度 |
| GET | `/api/molds/list?keyword=&type=&active=` | 模具档案列表（含配方引用条数、类型与统计） |
| GET | `/api/molds/options` | 模具下拉选项（仅启用模具，供配方表单使用） |
| POST | `/api/molds/create` | 新增模具（body：`mold_name` 必填，可选 `mold_code`/`mold_type`/`description`/`is_active`） |
| POST | `/api/molds/update` | 修改模具（body：`id` + 可改字段） |
| POST | `/api/molds/delete` | 删除模具（body：`id`，被配方引用时拒绝删除） |
| GET | `/api/recipes?product_id=&mold_id=&line=` | 模具配方查询（返回数组，`product_id`/`mold_id` 按关联查询，另兼容 `product`/`mold` 名称关键字） |
| GET | `/api/recipes/list?product_id=&mold_id=&line=&page=&pageSize=` | 模具配方分页查询（返回 `total`/`totalPages`/`data`，`pageSize` 上限 200） |
| GET | `/api/recipes/export?product_id=&mold_id=&line=` | 模具配方导出 CSV（按当前筛选条件导出全部记录，25 列） |
| GET | `/api/recipes/options` | 配方表单 / 筛选项（产品档案、启用模具、已用产线） |
| POST | `/api/recipes/create` | 新增配方（body：`product_id` 必填，可选 `mold_id`/`production_line`/14 项参数/`remark`） |
| POST | `/api/recipes/update` | 修改配方（body：`id` + 可改字段，产品变更时同步冗余产品名称） |
| POST | `/api/recipes/delete` | 删除配方（body：`id`） |
| GET | `/api/pipeline` | 获取管路参数 |
| POST | `/api/pipeline/update` | 更新管路参数（body：`pressure`/`temperature`/`flow`/`valve`，写入修改日志） |
| GET | `/api/andon/types` | 安灯呼叫类型 |
| GET | `/api/andon/calls` | 安灯呼叫记录 |
| POST | `/api/andon/call` | 发起安灯呼叫（body：`call_type`/`call_detail`/`caller`，写日志） |
| POST | `/api/andon/respond` | 响应呼叫（body：`id`/`handler`，待响应 → 处理中） |
| POST | `/api/andon/complete` | 完成呼叫（body：`id`/`handle_remark`/`operator`，处理中 → 已完成） |
| GET | `/api/andon/logs` | 安灯操作日志（发起/响应/完成/取消） |
| GET | `/api/process/data?page=&pageSize=&device=&product=&batch=&startTime=&endTime=&status=` | 工艺数据分页查询 |
| GET | `/api/process/filters` | 工艺筛选项（设备列表取自设备管理表，含编号 + 名称；产品列表取自工艺数据） |
| GET | `/api/process/params` | 可作为曲线展示的工艺参数清单（`process_data` 的工艺参数列 + 中文名 + 单位） |
| GET | `/api/process/chart?params=&limit=&startTime=&endTime=&device=&product=` | 工艺参数曲线数据（`params` 逗号分隔；`limit` 取 50/100/200，填时间则为时间范围模式，升序返回） |
| GET | `/api/process/export?device=&product=&batch=&startTime=&endTime=&status=` | 工艺数据导出 CSV（全量不分页；填时间则导出该时间段，否则默认最近一个月） |
| GET | `/api/analysis/data?page=&pageSize=&keyword=&device=&product=&startTime=&endTime=` | 分析数据分页查询（数据来自 `process_data`，按记录时间匹配标准版本判定，含合格率 / 不合格率） |
| GET | `/api/analysis/filters` | 分析筛选项（设备列表取自设备管理表，产品列表取自 `process_data`） |
| GET | `/api/analysis/standards` | 当前生效版本的标准明细 |
| GET | `/api/analysis/params` | 可作为分析标准的工艺参数清单（取自 `process_data` 字段） |
| GET | `/api/analysis/versions` | 标准版本列表（含各版本标准明细）+ 可选用参数 |
| POST | `/api/analysis/versions/create` | 新增标准版本（body：`version_name`/`version_code`/`product_model`/`effective_from`/`effective_to`/`remark`） |
| POST | `/api/analysis/versions/update` | 修改标准版本（body：`id` + 可改字段，含 `is_active`） |
| POST | `/api/analysis/versions/delete` | 删除标准版本及其标准明细（body：`id`） |
| POST | `/api/analysis/standards/create` | 新增标准参数（body：`version_id`/`param_key`/`standard_value`/`tolerance`/`unit`，`param_key` 须为工艺数据表已有字段） |
| POST | `/api/analysis/standards/update` | 修改标准参数（body：`id` + 可改字段） |
| POST | `/api/analysis/standards/delete` | 删除标准参数（body：`id`） |
| GET | `/api/analysis/standard-logs` | 标准变更日志 |
| GET | `/api/stats/list?startDate=&endDate=&device=&shift=&page=&pageSize=` | 生产统计查询（含汇总与合格率） |
| GET | `/api/stats/export?startDate=&endDate=&device=&shift=` | 生产统计导出 CSV（填日期则导出该区间，否则默认最近一个月） |
| POST | `/api/stats/rebuild` | 重新统计（body：`startDate`/`endDate` 按区间重算，默认昨天+今天；`all: true` 时清空统计表并按 `process_data` 全部记录全量重建；仅统计已启用设备，返回 `skippedRecords`/`inactiveDevices`） |
| GET | `/api/stats/shifts` | 班次配置列表与当前统计模式（day / shift） |
| POST | `/api/stats/shifts/create` | 新增班次（body：`shift_name`/`shift_code`/`start_time`/`end_time`；启用班次之间不允许时间重叠） |
| POST | `/api/stats/shifts/update` | 修改班次（body：`id` + 可改字段，含 `is_active`；`sort_order` 必须为整数，班次时间不允许与其它启用班次重叠） |
| POST | `/api/stats/shifts/delete` | 删除班次（body：`id`；已被生产统计引用时返回 400，确认删除需传 `force: true`） |
| POST | `/api/stats/shifts/init` | 一键生成标准班次（白班 08:00-20:00 / 夜班 20:00-08:00） |
| GET | `/api/plans/list?keyword=&device=&status=&startDate=&endDate=&page=&pageSize=` | 生产计划列表（含实时完成数、完成率与汇总） |
| GET | `/api/plans/export?keyword=&device=&status=&startDate=&endDate=` | 生产计划导出 CSV（按计划开始时间过滤，否则默认最近一个月） |
| GET | `/api/plans/options` | 计划表单可选设备（仅启用）与产品型号 |
| POST | `/api/plans/create` | 新增计划（body：`device_code`/`plan_count`/`start_time`/`end_time`，可选 `plan_code`/`plan_name`/`product_model`/`remark`；创建后状态为 `draft` 起草） |
| POST | `/api/plans/update` | 修改计划（body：`id` + 可改字段；起草可改全部，已下达/执行中/暂停仅可改 `plan_name`/`remark`） |
| POST | `/api/plans/status` | 计划状态流转（body：`id`、`status` = issued / running / paused / completed / closed / cancelled / draft；暂停需传 `remark`；`running`（首次开始）与 `completed` 可传 `occurred_at` 回填实际时间，格式 `YYYY-MM-DD HH:MM`，须为有效日期且位于计划周期内、不晚于当前时间；同一设备执行区间重叠时返回 400 并提示占用计划） |
| POST | `/api/plans/delete` | 删除计划（body：`id`；仅 `draft` / `cancelled` 可删除） |
| GET | `/api/plans/logs?id=&limit=` | 计划状态流转记录（`id` 为空返回全部，`limit` 默认 100、最大 500） |
| GET | `/api/plans/records?id=&page=&pageSize=` | 计划关联的工艺数据（与完成数同口径，返回分页记录 + 工艺参数清单 + 计划概要，`pageSize` 默认 20、最大 100） |

> 所有接口响应为 JSON。POST 接口需 `Content-Type: application/json` 请求体。
> 错误码约定：参数缺失 / 格式非法 / 状态不合法 → 400；资源不存在 → 404；未授权 → 401；请求体超限 → 413；
> 未注册的 `/api/*` 路径 → 404 JSON（不再回退为页面）；路径存在但方法不匹配 → 405 并带 `Allow` 头。
> 时间 / 日期类查询参数（`startTime`/`endTime`/`startDate`/`endDate`）会做日历校验，非法值直接返回 400，不再静默返回空结果。

## 环境变量与安全配置

服务通过环境变量控制运行参数，默认值适用于内网单机部署：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3456` | 监听端口 |
| `DB_PATH` | `./mesmonitor.db` | 数据库文件路径 |
| `LOG_FILE` | `./server.log` | 日志文件路径 |
| `ADMIN_TOKEN` | 空（不启用） | 机器令牌：**仅服务端脚本**携带 `X-Admin-Token` 时等同超级管理员；浏览器端已不支持 |
| `SESSION_TTL_HOURS` | `12` | 登录会话有效期（小时），活跃访问自动续期 |
| `DEFAULT_ADMIN_USER` | `admin` | 首次启动创建的超级管理员用户名（仅在 users 表为空时生效） |
| `DEFAULT_ADMIN_PASSWORD` | 空（随机生成） | 初始超管密码，长度 6~128；为空时随机生成并只在控制台输出一次 |
| `COOKIE_SECURE` | `0` | 置 `1` 时会话 Cookie 追加 `Secure`，HTTPS 部署必须开启 |
| `TRUST_PROXY` | `0` | 置 `1` 时才解析 `X-Forwarded-For`（仅在可信反向代理之后开启，否则可被伪造绕过登录锁定） |
| `LOGIN_MAX_FAILS` | `5` | 同一 IP + 用户名连续登录失败多少次后锁定 |
| `LOGIN_LOCK_SECONDS` | `60` | 登录失败锁定时长（秒） |
| `LOGIN_MAX_CONCURRENT` | `8` | 同时进行的登录校验上限，超出返回 429（scrypt 校验异步执行，避免占满 CPU） |
| `CORS_ORIGIN` | 空（不开放跨域） | 逗号分隔的来源白名单，仅对匹配来源下发 CORS 头 |
| `MAX_BODY_BYTES` | `1048576` | 请求体大小上限，超出返回 413（低于 1024 时取默认值） |
| `LOG_MAX_BYTES` | `5242880` | 日志文件上限，超出后轮转为 `server.log.1` |
| `HISTORY_RETENTION_DAYS` | `0`（不清理） | 大于 0 时每天清理早于该天数的流转日志、安灯记录、状态历史与统计派生表（工艺数据 / 计划主表 / 审计日志不受影响） |
| `ANALYSIS_MAX_SCAN` | `20000` | 分析列表单次判定的最大扫描行数，调大可覆盖更多历史但会延长单次请求耗时 |
| `DEVICE_CODE_SYNC_MAX_ROWS` | `20000` | 修改设备编号时允许同步的最大工艺数据条数，超出则拒绝并要求迁移 |

登录后浏览器持有会话 Cookie；自动化脚本使用 `ADMIN_TOKEN` 时直接带请求头即可：

```
X-Admin-Token: <你的令牌>
```

写接口还会做输入收敛：`pageSize` 上限 200、非法 JSON 返回 400、错误详情只写日志不回传；
日期时间做日历校验（拒绝 13 月 / 2 月 31 日 / 25 点）、数值字段拒绝 `NaN` / `Infinity`、文本字段拒绝对象与数组；
静态资源响应带 CSP / `X-Content-Type-Options` / `X-Frame-Options`，且只从 `dist/` 提供，不暴露源码与配置文件。

### 健康检查与备份

- `GET /health` 返回服务与数据库状态，可用于负载均衡或监控探活：

  ```json
  { "status": "ok", "database": "ok", "uptime": 21600, "time": "2026-11-19T00:49:38.938Z" }
  ```

- 数据库热备份（不中断服务，默认保留 7 天）：

  ```bash
  ./deploy/backup.sh                 # Linux，建议加入 crontab
  0 2 * * * /opt/mesmonitor/deploy/backup.sh >> /var/log/mesmonitor-backup.log 2>&1

  powershell -File deploy\backup.ps1 # Windows，建议加入计划任务
  ```

- WAL 文件每小时自动 checkpoint 回主库，避免 `-wal` 长期增长。
- CI：`.github/workflows/ci.yml` 在 push / PR 时执行语法检查、前端构建与依赖审计。

## 快速开始

### 1. 克隆项目

```bash
git clone <仓库地址>
cd mesmonitor
```

### 2. 安装依赖

```bash
npm install
```

> 依赖包括 `better-sqlite3`（数据库驱动）、`vue@3`（前端框架）、`vite` 与 `@vitejs/plugin-vue`（构建工具）。

### 3. 初始化数据库

项目初次运行时，需要先创建 SQLite 数据库并导入表结构和默认数据：

```bash
node -e "const Database=require('better-sqlite3');const fs=require('fs');const db=new Database('mesmonitor.db');db.exec(fs.readFileSync('init_all.sql','utf8'));console.log('数据库初始化完成');db.close()"
```

> 数据库文件 `mesmonitor.db` 会在当前目录自动生成。如果已有旧数据库，执行初始化会清空全部表数据并重新填入默认数据。

### 4. 构建前端

前端为 Vue 3 单文件组件（`.vue`），需要先构建为静态资源：

```bash
npm run build
```

> 构建产物输出到 `dist/` 目录（含 `index.html` 与 `assets/`）。若 `dist/` 不存在，`server.js` 会回退托管项目根目录的静态文件。

### 5. 部署到另一台服务器（需要拷贝哪些文件）

生产部署时，目标服务器**不需要** `systems/`、`css/`、`index.html`、`admin.html`、`vite.config.js` 等前端源码，因为页面已经在 `dist/` 中打包完成。按下列清单拷贝即可运行。

#### 方式一：只拷贝构建产物（推荐，目标机无需构建环境）

| 文件 / 文件夹 | 是否必需 | 说明 |
|---|---|---|
| `server.js` | 必需 | Node.js 服务：API 接口 + 托管 `dist/` 静态页面 |
| `dist/` | 必需 | `npm run build` 生成的前端产物（`index.html`、`admin.html`、`assets/`） |
| `package.json`、`package-lock.json` | 必需 | 依赖清单，用于目标机安装运行依赖 |
| `init_all.sql` | 新库必需 | 目标机首次部署时初始化数据库 |
| `mesmonitor.db` | 可选 | 需要沿用现有数据时拷贝；全新环境可跳过 |
| `stats_job.js` | 可选 | 生产统计定时任务脚本（需要按计划生成统计数据时） |
| `deploy/` | 可选 | systemd 单元、Linux 一键部署、Windows 服务 / 计划任务脚本 |

目标机执行：

```bash
npm ci --omit=dev
node server.js
```

> `better-sqlite3` 是原生模块，**不能**把 Windows 上的 `node_modules/` 直接拷到 Linux（反之亦然），必须在目标机重新 `npm install`。
> 全新数据库按步骤 3 的命令初始化后再启动服务。

#### 方式二：拷贝源码，在目标机构建

目标机已具备 Node.js 18+ 与构建环境时，可拷贝以下内容后自行构建：

```
server.js  stats_job.js  package.json  package-lock.json  init_all.sql
index.html  admin.html  vite.config.js
css/  systems/        （可选：deploy/）
```

目标机执行：

```bash
npm ci
node -e "const Database=require('better-sqlite3');const fs=require('fs');const db=new Database('mesmonitor.db');db.exec(fs.readFileSync('init_all.sql','utf8'));db.close()"
npm run build
node server.js
```

#### 数据库迁移注意

- 拷贝 `mesmonitor.db` 前先停止旧服务，避免 `-wal` / `-shm` 未合并导致数据缺失；
- 建议用 SQLite 一致性备份后再拷贝（只拷备份文件，不拷 `-wal` / `-shm`）：
  ```bash
  node -e "const D=require('better-sqlite3');const db=new D('mesmonitor.db');db.backup('mesmonitor-backup.db').then(()=>{db.close();console.log('备份完成')})"
  ```
- 或直接执行 `init_all.sql` 初始化空库，再通过页面录入或脚本导入数据。
  **注意**：该脚本包含 `DROP TABLE` / 全表 `DELETE`，会清空同名表数据，仅适用于全新库或演示环境，生产库严禁执行。

#### 可选环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3456` | 服务监听端口 |
| `DB_PATH` | `./mesmonitor.db` | 数据库文件路径 |
| `LOG_FILE` | `./server.log` | 运行日志路径 |
| `ADMIN_TOKEN` | 空 | 自动化脚本令牌（等同超级管理员） |
| `SESSION_TTL_HOURS` | `12` | 登录会话有效期（小时） |
| `DEFAULT_ADMIN_USER` | `admin` | 默认超级管理员用户名 |
| `DEFAULT_ADMIN_PASSWORD` | 空（随机生成） | 初始超管密码；为空时随机生成并只在控制台输出一次 |
| `COOKIE_SECURE` | `0` | HTTPS 部署置 `1`，会话 Cookie 追加 `Secure` |
| `TRUST_PROXY` | `0` | 仅在可信反向代理之后置 `1`，才解析 `X-Forwarded-For` |
| `LOGIN_MAX_FAILS` | `5` | 连续登录失败锁定阈值 |
| `LOGIN_LOCK_SECONDS` | `60` | 登录失败锁定时长（秒） |
| `CORS_ORIGIN` | 空 | 跨域白名单，同源部署留空 |
| `HISTORY_RETENTION_DAYS` | `0` | 历史日志 / 统计派生数据保留天数，0 表示不清理（审计日志永不自动清理） |

启动后浏览器访问 `http://<服务器>:3456/`：

- 未登录只显示看板「首页」与「登录」按钮；
- 点击登录，使用初始超级管理员 `admin` 与控制台打印的随机密码登录（若配置了 `DEFAULT_ADMIN_PASSWORD` 则使用该值；登录后请立即在右上角「修改密码」中改掉）；
- 进入 `/admin` 后可在「用户权限」中创建账号并勾选看板页面、后台页面与按钮动作。

### 6. 启动服务

数据库初始化和前端构建完成后，启动 Node.js 后端服务：

```bash
node server.js
```

终端会输出：

```
✅ MES Monitor API 服务已启动: http://localhost:3456
📊 数据库: <项目路径>\mesmonitor.db
```

浏览器访问两个入口：

- 车间看板（前端显示系统）：`http://localhost:3456/`
- 管理后台（后端管理系统）：`http://localhost:3456/admin`

> **生产服务器部署**：服务常驻（systemd / Windows 服务）与统计定时任务（cron / 计划任务）的脚本和完整步骤见 [`deploy/README.md`](deploy/README.md)。

> 如果提示 `mesmonitor.db` 不存在，请先返回执行步骤 3 初始化数据库。

### 开发模式（可选）

前端开发时推荐使用 Vite 开发服务器（热更新，修改 `.vue` 自动刷新），需要同时启动两个进程：

```bash
node server.js        # 终端 1：启动后端 API 服务（3456）
npm run dev           # 终端 2：启动前端开发服务器（http://localhost:5173）
```

开发服务器默认运行于 `http://localhost:5173`。`vite.config.js` 已配置 `/api` 请求代理到 `http://localhost:3456`，前端页面发起的 `/api/...` 请求会自动转发给后端处理，前端代码仍以相对路径调用，无需跨域处理。

> **注意**：开发模式需要 **两个进程同时运行**。`npm run dev` 只提供前端页面与热更新，**不提供 API**，必须同时运行 `node server.js` 才能获取数据。开发模式访问看板 `http://localhost:5173/`、后台 `http://localhost:5173/admin`；生产模式统一走 `http://localhost:3456/` 与 `/admin`。

## 前端与后端的关系

本项目采用**前后端分离**架构，前端（Vue）与后端（Node.js）是**两个独立进程**，通过 HTTP 接口通信。前端包含两个入口（车间看板 `/` 与管理后台 `/admin`），共用同一套 `/api/*` 接口：

```
┌────────────┐   /api/...   ┌─────────────────────────────┐
│  前端进程    │ ──────────► │  后端进程 (server.js)         │
│ (Vue 页面)   │ ◄────────── │  · 提供全部 /api/* 数据接口    │
└────────────┘   JSON 响应  │  · 读写 mesmonitor.db        │
                            └─────────────────────────────┘
```

**`node server.js` 和 `npm run dev` 运行的是同一个项目，但职责不同**：

| | `node server.js`（后端） | `npm run dev`（前端） |
|---|---|---|
| 本质 | Node.js API 服务 | Vite 前端开发服务器 |
| 提供内容 | `/api/*` 数据接口 + 静态托管 `dist/` | 仅前端页面（热更新 HMR） |
| 端口 | 3456 | 5173 |
| 数据库 | 直接读写 `mesmonitor.db` | 不接触数据库 |
| 访问页面 | 是（托管 dist 时） | 是（开发时） |

- **生产方式**：`npm run build` 先把前端打包为静态文件 `dist/`，之后**只运行** `node server.js`。此时后端进程同时扮演"静态文件服务器（托管 dist）"和"API 服务器"两个角色，因此**只需一个端口 3456** 即可访问完整系统。
- **开发方式**：Vite 开发服务器（5173）只编译前端、不运行后端代码，所以需要**额外运行** `node server.js`（3456）提供 API。前端页面通过 `vite.config.js` 的 `proxy` 把 `/api` 请求代理到后端，实现"同一域名"的效果。

## 关键实现说明

- **双入口与页面切换**：`systems/display/DisplayApp.vue`（看板 7 个模块）与 `systems/admin/AdminApp.vue`（后台 7 个模块）各自通过 `v-show` 控制页面显隐（内联 `display` 样式），不再依赖 CSS 的 `.active` 类切换，避免与 Vue 显隐逻辑冲突；两个入口共用 `systems/shared` 下的 API、通用弹窗与四个双端页面。
- **刷新保持当前模块**：当前模块同步写入 URL hash（如 `#device`），初始化时从 hash 恢复页面并监听 `hashchange`，因此浏览器刷新、前进后退或直接打开带 hash 的地址都会停留在对应模块，不会回到首页。
- **统计完全来源于工艺数据**：统计不预设 0 行、不引用设备档案补齐设备，而是逐条读取 `process_data`，按 `collect_time` 归属到「日期 × 班次 × 设备」后累加，因此每一行统计都能追溯到来源记录；重算时先删除区间内旧数据再整体写入，保证可重复执行且不会累加错乱。全量重算（`all: true` / `--all`）会清空整表后按当前全部工艺记录重建。
- **设备启用状态参与统计**：统计前先取 `devices.is_active = 1` 的设备集合，未启用设备（停用 / 报废）的工艺记录直接跳过，接口返回 `skippedRecords`（跳过的记录数）与 `inactiveDevices`（涉及设备编号），页面会提示跳过情况；设备重新启用后再次统计即可恢复其统计行。
- **计划完成度按执行段实时聚合**：`production_plans` 只保存计划本身（设备、产品、计划数、周期），完成数由子查询实时统计；统计条件除「设备 + 计划周期 + 可选产品 + 设备启用」外，还要求记录落在 `production_plan_segments` 的某个执行区间内（`started_at ~ ended_at`，未关闭的段统计到当前时间），因此暂停期间的其他产出不会串入本计划。产线一有新记录计划进度立刻变化，不需要定时重算；页面每 15 秒轮询刷新计划。
- **执行段维护**：进入执行中开段，暂停 / 完成 / 取消关段，撤回或恢复起草清空；老库升级时按已有状态自动补建一条历史段（执行中统计到当前，暂停统计到暂停时刻，完成 / 结案 / 取消沿用原计划周期），保证历史数字不跳变。
- **计划状态机在服务端强制校验**：`PLAN_TRANSITIONS` 定义合法流转（起草→下达→执行中⇄暂停→完成→结案，另有取消与恢复起草），非法流转返回 400；排产要素（编号/设备/产品/计划数/周期）在下达后锁定，避免已生效计划被静默改动；每次流转写入 `production_plan_logs` 供追溯。
- **设备口径统一**：设备档案是唯一设备来源，`device_code` 作为业务主键贯穿首页监控、工艺数据、分析筛选与列表展示；服务启动时 `ensureDeviceCodes()` 会把旧库的 `DEV-xxx` 编号按设备名称统一为工艺采集编号，并把工艺数据中出现但未登记的编号自动补登记，保证各页面设备一致。
- **弹窗交互**：安灯、管路等模块的交互提示统一使用 `AppDialog.vue` 内置弹窗（支持 `input` / `confirm` / `alert` 三种模式），替代浏览器原生 `prompt()` / `alert()`，以保证在内嵌 WebView 中可用。
- **热成像热力图**：由点位温度实时生成内联 SVG（`v-html` 渲染），替代 `data:image/svg+xml` URI，规避部分 WebView 对长 Data URI 的兼容问题。
- **静态托管**：`server.js` 的静态服务优先提供 `dist/` 构建产物，缺失时回退项目根目录，并支持 SPA 回退到 `dist/index.html`。
- **分析数据同源**：分析页不维护独立业务表，直接查询 `process_data`；判定结果在服务端按"每条记录采集时间对应的标准版本"实时计算，因此修改标准不会改变已发生记录当时使用的判定依据。
- **旧库自动升级**：`server.js` 启动时执行 `ensureSchema()`：为 `process_data` 补充 `workpiece_no`、把旧 `workpiece_analysis` 数据并入工艺数据表后删除旧表、把旧版无版本的标准迁移为「历史标准」版本，无需手工改库。

## 运行日志

服务运行时会自动记录所有 API 请求与响应日志，写入当前目录 `server.log`：

```
[2026-08-27 10:30:12] [REQUEST]  GET /api/devices/overview
[2026-08-27 10:30:12] [RESPONSE] GET /api/devices/overview => 200 | keys: stats,devices
[2026-08-27 10:31:05] [REQUEST]  POST /api/pipeline/update | body: {"pressure":85}
[2026-08-27 10:31:05] [RESPONSE] POST /api/pipeline/update => 200 | 操作成功
```

- 记录内容：请求时间、方法、路径、查询参数、POST 请求体、响应状态码与结果摘要
- 日志同时输出到控制台，方便实时查看
- `server.log` 已被 `.gitignore` 排除，不会提交到仓库

## 验证数据库

```bash
node -e "const Database=require('better-sqlite3');const db=new Database('mesmonitor.db');const tables=['devices','device_status','device_status_history','products','thermal_records','thermal_point_temps','thermal_alarm_config','molds','mold_recipes','pipeline_params','pipeline_edit_log','andon_call_types','andon_calls','andon_call_logs','process_data','analysis_standard_versions','analysis_standards','analysis_standard_logs','shift_config','production_stats','production_plans','production_plan_logs','production_plan_segments'];tables.forEach(t=>{const r=db.prepare('SELECT COUNT(*) AS cnt FROM '+t).get();console.log(t.padEnd(30)+': '+r.cnt+' 条');});db.close()"
```

> 输出共 23 张表的记录数，便于确认各模块数据是否初始化成功。

## 生成模拟数据

`process_data` 是工艺 / 分析共用的唯一数据源，可用造数脚本批量写入随机数据（避免手工插入）：

```bash
node seed_process_data.js            # 默认 10000 条，采集时间覆盖近 180 天
node seed_process_data.js 500 90     # 500 条，覆盖近 90 天
```

- 参数值围绕各产品（P3500T / P5000T / P2600T）的工艺基准值波动，`data_status` 按容差规则自动判定（正常 / 预警 / 不合格，比例约 82% / 12% / 6%）
- 工件编号 `workpiece_no` 由「日期 + 6 位全局序列」生成并带唯一索引，脚本可重复执行，不会产生重复编号
- 采集时间在指定天数区间内均匀分布，写入后在工艺数据查询与分析模块立即可见

## 生产统计定时任务

`stats_job.js` 通过 HTTP 调用后端 `/api/stats/rebuild` 生成统计，需先启动 `node server.js`。

```bash
node stats_job.js                    # 重算「昨天 + 今天」（推荐交给计划任务周期执行）
node stats_job.js --all              # 按 process_data 全部记录全量重建（清空统计表后重算）
node stats_job.js --days 7           # 重算最近 7 天（含今天）
node stats_job.js --date 2026-11-17  # 重算指定某天
node stats_job.js --from 2026-06-01 --to 2026-06-30   # 重算区间（补历史）
node stats_job.js --loop 600         # 常驻运行，每 10 分钟重算一次
node stats_job.js --port 4000        # 指定后端端口（默认 3456）
```

执行结果同时输出到控制台与 `stats_job.log`，日志中的「来源记录」即为本次参与统计的 `process_data` 记录数。历史数据补全或核对口径时，使用 `--all` 一次性按当前表内全部记录重建。

> 服务启用登录鉴权后，脚本需携带机器令牌：设置环境变量 `ADMIN_TOKEN`（与服务端一致）或用 `--token <令牌>` 传入；未配置时脚本会收到 401 并给出提示。

**Windows 计划任务（每天 00:10 重算前一天+当天）**

```powershell
schtasks /create /tn "MES生产统计" /tr "C:\Program Files\nodejs\node.exe D:\MES-hl\mesmonitor\stats_job.js" /sc daily /st 00:10 /f
```

**Linux / macOS（crontab）**

```bash
# 每小时重算当天与前一天
0 * * * * cd /path/to/mesmonitor && /usr/bin/node stats_job.js >> stats_job.log 2>&1
```

> 修改班次配置后历史统计不会自动变化，需在页面点击「重新统计」或对相应区间执行一次任务脚本。

> 生产环境的服务化与定时任务脚本（systemd 单元、Linux 一键部署、Windows 服务 / 计划任务 / 批处理）见 [`deploy/README.md`](deploy/README.md)。

## 常见问题

**Q: 数据库不存在怎么办？**
A: 执行步骤 3 的初始化命令即可自动创建 `mesmonitor.db` 并导入全部表结构和默认数据。

**Q: 如何重置数据库？**
A: 重新执行步骤 3 的初始化命令，会清空所有数据并重新填入默认值。

**Q: 端口被占用？**
A: 编辑 `server.js` 中的 `PORT` 常量（默认 3456），或启动时指定环境变量（如 `PORT=4000 node server.js`），修改后重启服务即可。

**Q: 页面空白 / 没有内容显示？**
A: 多为浏览器缓存了旧版本导致。强制刷新（`Ctrl + F5`）或清除浏览器缓存后重试；若仍未恢复，确认已执行 `npm run build` 生成 `dist/` 并重启服务。

**Q: 在内嵌 WebView（如 IDE 预览）中安灯操作无反应？**
A: WebView 不支持浏览器原生 `prompt()`。本项目安灯模块已改用内置 Vue 弹窗组件（`AppDialog.vue`）替代原生弹窗，无需额外处理。若仍异常，请确认使用的是最新构建产物。

**Q: 修改了 `.vue` 组件但页面没变化？**
A: 需要重新执行 `npm run build` 生成新的 `dist/` 产物（生产模式），或使用 `npm run dev` 开发模式（自动热更新）。

**Q: 首次部署需要几步？**
A: 四步：① `npm install` 安装依赖 → ② 初始化数据库（步骤 3 命令）→ ③ `npm run build` 构建前端 → ④ `node server.js` 启动服务。移植到另一台服务器时按步骤 5 的文件清单拷贝。

**Q: 如何让不同时间段的数据使用不同分析标准？**
A: 进入「历史工件分析 → 标准管理」，先「新建版本」（填写生效开始/结束时间），再为该版本维护标准参数；也可直接写库：向 `analysis_standard_versions` 插入版本记录后，向 `analysis_standards` 插入该版本的参数标准。系统按每条工艺记录的 `collect_time` 自动匹配当时生效的版本，历史数据不会被新标准改写。

**Q: 想新增一个分析参数（例如"模具温度"之外的新工艺参数）？**
A: 分析参数必须来自工艺数据表，先确保 `process_data` 存在该字段（工艺采集写入该字段），再在标准管理中新增该参数标准；后端会校验 `param_key` 是否为 `process_data` 的字段，不存在则拒绝。

**Q: 旧数据库升级后分析数据有何变化？**
A: 服务启动时会自动迁移：旧 `workpiece_analysis` 数据并入 `process_data`（按工件编号/采集记录去重）后删除旧表，旧版无版本的标准自动归入「历史标准」版本。业务数据不丢失，无需手工改库。

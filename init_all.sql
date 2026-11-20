-- ============================================================
-- MES设备监控系统 - 完整数据库初始化脚本 (All-in-One)
-- 数据库文件: mesmonitor.db
-- 运行方式: sqlite3 mesmonitor.db < init_all.sql
-- 逻辑: 表不存在则创建，表存在则清空数据后重新插入默认数据
-- ============================================================

PRAGMA foreign_keys = OFF;

-- ============================================================
-- 第1部分: 设备监控模块
-- ============================================================

-- 1.1 设备信息表
CREATE TABLE IF NOT EXISTS devices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    device_name     TEXT    NOT NULL UNIQUE,
    device_type     TEXT    NOT NULL,
    device_code     TEXT    UNIQUE,
    location        TEXT,
    model           TEXT,
    manufacturer    TEXT,
    install_date    TEXT,
    description     TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 1.2 设备实时状态表
CREATE TABLE IF NOT EXISTS device_status (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id       INTEGER NOT NULL,
    status          TEXT    NOT NULL,              -- running/warning/error
    alarm_info      TEXT,
    detail_info     TEXT,
    updated_at      TEXT    DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- 1.3 历史状态记录表
CREATE TABLE IF NOT EXISTS device_status_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id       INTEGER NOT NULL,
    status          TEXT    NOT NULL,
    alarm_info      TEXT,
    detail_info     TEXT,
    start_time      TEXT    NOT NULL,
    end_time        TEXT,
    duration_seconds INTEGER,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- 设备监控索引
CREATE INDEX IF NOT EXISTS idx_device_status_device_id ON device_status(device_id);
CREATE INDEX IF NOT EXISTS idx_device_status_status    ON device_status(status);
CREATE INDEX IF NOT EXISTS idx_history_device_id       ON device_status_history(device_id);
CREATE INDEX IF NOT EXISTS idx_history_status          ON device_status_history(status);
CREATE INDEX IF NOT EXISTS idx_history_start_time      ON device_status_history(start_time);
CREATE INDEX IF NOT EXISTS idx_history_end_time        ON device_status_history(end_time);


-- ============================================================
-- 第2部分: 热成像模块
-- ============================================================

-- 2.1 产品表
CREATE TABLE IF NOT EXISTS products (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name    TEXT    NOT NULL,
    product_code    TEXT    UNIQUE,
    product_type    TEXT,
    description     TEXT,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 2.2 热成像记录表
CREATE TABLE IF NOT EXISTS thermal_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id      INTEGER NOT NULL,
    record_time     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    image_path      TEXT,
    image_base64    TEXT,
    image_format    TEXT    DEFAULT 'svg',
    max_temp        REAL,
    min_temp        REAL,
    avg_temp        REAL,
    alarm_status    TEXT    DEFAULT 'normal',
    alarm_msg       TEXT,
    remark          TEXT,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- 2.3 热成像点位温度表
CREATE TABLE IF NOT EXISTS thermal_point_temps (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id       INTEGER NOT NULL,
    point_name      TEXT    NOT NULL,
    point_index     INTEGER NOT NULL,
    temperature     REAL    NOT NULL,
    pos_x           REAL,
    pos_y           REAL,
    is_alarm        INTEGER DEFAULT 0,
    alarm_threshold REAL,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (record_id) REFERENCES thermal_records(id) ON DELETE CASCADE
);

-- 2.4 热成像报警阈值配置表
CREATE TABLE IF NOT EXISTS thermal_alarm_config (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    point_index     INTEGER NOT NULL UNIQUE,
    point_name      TEXT    NOT NULL,
    temp_high       REAL    DEFAULT 80.0,
    temp_low        REAL    DEFAULT 0.0,
    is_enabled      INTEGER DEFAULT 1,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 热成像索引
CREATE INDEX IF NOT EXISTS idx_thermal_product_id   ON thermal_records(product_id);
CREATE INDEX IF NOT EXISTS idx_thermal_record_time  ON thermal_records(record_time);
CREATE INDEX IF NOT EXISTS idx_thermal_point_record ON thermal_point_temps(record_id);
CREATE INDEX IF NOT EXISTS idx_thermal_point_index  ON thermal_point_temps(record_id, point_index);


-- ============================================================
-- 第3部分: 模具配方模块
-- ============================================================

-- 3.1 模具信息表
CREATE TABLE IF NOT EXISTS molds (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    mold_name       TEXT    NOT NULL,
    mold_code       TEXT    UNIQUE,
    mold_type       TEXT,
    description     TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 3.2 模具配方主表
-- 注意: 先删除再重建, 以兼容旧结构(缺少 product_id)
-- product_id 关联 products 产品档案, product_name 作为冗余快照保留
DROP TABLE IF EXISTS mold_recipes;
CREATE TABLE mold_recipes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id      INTEGER,
    product_name    TEXT    NOT NULL,
    mold_id         INTEGER,
    production_line TEXT,
    fast1_enabled   TEXT    DEFAULT '否',
    fast1_position  REAL    DEFAULT 0,
    fast1_valve     REAL    DEFAULT 0,
    fast2_enabled   TEXT    DEFAULT '否',
    fast2_position  REAL    DEFAULT 0,
    fast2_valve     REAL    DEFAULT 0,
    boost_enabled   TEXT    DEFAULT '0',
    boost_position  REAL    DEFAULT 0,
    boost_pressure  REAL    DEFAULT 0,
    track_end_pos   REAL    DEFAULT 0,
    fast_energy_pressure REAL DEFAULT 0,
    boost_energy_pressure REAL DEFAULT 0,
    injection_time  REAL    DEFAULT 0,
    boost_delay     REAL    DEFAULT 0,
    cooling_time    REAL    DEFAULT 0,
    hammer_delay    REAL    DEFAULT 0,
    slow_flow       REAL    DEFAULT 0,
    remark          TEXT,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    FOREIGN KEY (mold_id) REFERENCES molds(id) ON DELETE SET NULL
);

-- 模具配方索引
CREATE INDEX IF NOT EXISTS idx_recipe_product    ON mold_recipes(product_name);
CREATE INDEX IF NOT EXISTS idx_recipe_product_id ON mold_recipes(product_id);
CREATE INDEX IF NOT EXISTS idx_recipe_mold       ON mold_recipes(mold_id);
CREATE INDEX IF NOT EXISTS idx_recipe_line       ON mold_recipes(production_line);


-- ============================================================
-- 第4部分: 管路数据模块
-- ============================================================

-- 4.1 管路配方参数表
CREATE TABLE IF NOT EXISTS pipeline_params (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    param_name      TEXT    NOT NULL UNIQUE,
    param_value     REAL    NOT NULL DEFAULT 0,
    param_unit      TEXT    NOT NULL,
    min_value       REAL,
    max_value       REAL,
    updated_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 4.2 管路参数下发记录表
CREATE TABLE IF NOT EXISTS pipeline_edit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    param_name      TEXT    NOT NULL,
    old_value       REAL    NOT NULL,
    new_value       REAL    NOT NULL,
    operator        TEXT    DEFAULT '系统',
    edit_time       TEXT    DEFAULT (datetime('now','localtime')),
    remark          TEXT
);

-- 管路数据索引
CREATE INDEX IF NOT EXISTS idx_pipeline_edit_time ON pipeline_edit_log(edit_time);


-- ============================================================
-- 第5部分: 安灯呼叫系统模块
-- ============================================================

-- 5.1 安灯呼叫记录表
CREATE TABLE IF NOT EXISTS andon_calls (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    call_type       TEXT    NOT NULL,
    call_detail     TEXT,
    caller          TEXT    NOT NULL DEFAULT '系统自动',
    call_time       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    status          TEXT    NOT NULL DEFAULT 'pending',
    handler         TEXT,
    handle_time     TEXT,
    handle_remark   TEXT,
    created_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 5.2 呼叫类型配置表
CREATE TABLE IF NOT EXISTS andon_call_types (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type_name       TEXT    NOT NULL UNIQUE,
    type_key        TEXT    NOT NULL UNIQUE,
    type_icon       TEXT,
    sort_order      INTEGER DEFAULT 0,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 5.3 安灯操作日志表
CREATE TABLE IF NOT EXISTS andon_call_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id         INTEGER NOT NULL,
    action          TEXT    NOT NULL,             -- create/respond/complete/cancel
    operator        TEXT    NOT NULL,             -- 操作人
    content         TEXT,                         -- 操作内容描述
    operate_time    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (call_id) REFERENCES andon_calls(id) ON DELETE CASCADE
);

-- 安灯索引
CREATE INDEX IF NOT EXISTS idx_andon_call_type   ON andon_calls(call_type);
CREATE INDEX IF NOT EXISTS idx_andon_status      ON andon_calls(status);
CREATE INDEX IF NOT EXISTS idx_andon_call_time   ON andon_calls(call_time);
CREATE INDEX IF NOT EXISTS idx_andon_log_call    ON andon_call_logs(call_id);
CREATE INDEX IF NOT EXISTS idx_andon_log_time    ON andon_call_logs(operate_time);


-- ============================================================
-- 第6部分: 工艺数据采集模块
-- 说明: process_data 是全系统唯一的数据源表
--       历史工件分析模块不单独存业务数据，全部数据均来自本表
-- ============================================================

-- 6.1 工艺数据采集表(唯一数据源)
-- 注意: 本脚本会重置全部数据, 先删除再重建, 以兼容旧版表结构(缺少 workpiece_no)
DROP TABLE IF EXISTS process_data;
CREATE TABLE process_data (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    collect_time    TEXT    NOT NULL,
    device_code     TEXT    NOT NULL,
    product_model   TEXT    NOT NULL,
    batch_no        TEXT    NOT NULL,
    workpiece_no    TEXT,                          -- 工件编号(分析模块以此标识每条工艺记录)
    slow_speed      REAL,                          -- 低速 / 慢压射速度
    fast_speed      REAL,                          -- 高速 / 快压射速度
    cast_pressure   REAL,                          -- 铸造压力
    boost_pressure  REAL,                          -- 增压压力
    pour_temp       REAL,                          -- 浇注温度
    mold_temp       REAL,                          -- 模具温度
    cycle_time      REAL,                          -- 循环时间
    hold_time       REAL,                          -- 保压时间
    injection_time  REAL,                          -- 压射时间(s)
    sprue_thickness REAL,                          -- 料柄厚度(mm)
    furnace_temp    REAL,                          -- 熔炉当前温度(℃)
    goose_neck_temp REAL,                          -- 鹅颈当前温度(℃)
    nozzle_temp     REAL,                          -- 射嘴当前温度(℃)
    oil_temp        REAL,                          -- 当前油温(℃)
    fast_switch_point REAL,                        -- 高速切换点(mm)
    data_status     TEXT    DEFAULT 'normal',
    remark          TEXT,
    created_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 说明: 旧版标准参数表 process_standards 已被分析标准版本表
--       (analysis_standard_versions + analysis_standards)完全取代, 不再创建;
--       老库中的该表由 server.js 启动时自动删除(代码中无任何读写)。

-- 工艺数据索引
CREATE INDEX IF NOT EXISTS idx_process_collect_time ON process_data(collect_time);
CREATE INDEX IF NOT EXISTS idx_process_device_code  ON process_data(device_code);
CREATE INDEX IF NOT EXISTS idx_process_product      ON process_data(product_model);
CREATE INDEX IF NOT EXISTS idx_process_batch        ON process_data(batch_no);
CREATE INDEX IF NOT EXISTS idx_process_status       ON process_data(data_status);
-- 复合索引：设备+时间（统计聚合、计划进度、设备详情高频组合）
-- production_stats / production_plans 的复合索引在各自建表语句之后创建，见文件末尾
CREATE INDEX IF NOT EXISTS idx_process_device_time   ON process_data(device_code, collect_time DESC);
CREATE INDEX IF NOT EXISTS idx_process_time_status   ON process_data(collect_time, data_status);


-- ============================================================
-- 第7部分: 历史工件数据分析模块
-- 说明: 不再单独存储分析业务数据, 分析数据统一来源于 process_data
--       本模块只维护"分析标准", 且标准支持版本化(按时间段生效)
-- ============================================================

-- 7.1 分析标准版本表(一个版本代表一个时间区间使用的判定标准)
--     例: 2026-01-01 ~ 2026-05-01 使用 标准1, 2026-05-01 起使用 标准2
-- 注意: 先删除旧版表(含 旧 analysis_standards / workpiece_analysis), 以兼容旧结构
DROP TABLE IF EXISTS workpiece_analysis;
DROP TABLE IF EXISTS analysis_standard_logs;
DROP TABLE IF EXISTS analysis_standards;
DROP TABLE IF EXISTS analysis_standard_versions;
CREATE TABLE analysis_standard_versions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    version_code    TEXT    NOT NULL UNIQUE,      -- 版本编码, 如 STD-2026-01
    version_name    TEXT    NOT NULL,             -- 版本名称, 如 标准1
    product_model   TEXT,                         -- 适用产品型号, 空 = 全部产品通用
    effective_from  TEXT    NOT NULL,             -- 生效开始时间
    effective_to    TEXT,                         -- 生效结束时间, 空 = 至今有效
    remark          TEXT,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 7.2 分析标准明细表(版本 + 参数)
--     param_key 必须是 process_data 中存在的工艺参数字段,
--     保证"分析模块要分析的参数, 工艺数据表中一定包含"
CREATE TABLE IF NOT EXISTS analysis_standards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id      INTEGER NOT NULL,
    param_name      TEXT    NOT NULL,
    param_key       TEXT    NOT NULL,
    standard_value  REAL    NOT NULL,
    tolerance       REAL    NOT NULL,
    unit            TEXT,
    display_order   INTEGER DEFAULT 0,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (version_id) REFERENCES analysis_standard_versions(id) ON DELETE CASCADE,
    UNIQUE (version_id, param_key)
);

-- 7.3 分析标准变更日志表(新增 / 修改 / 删除 标准时留痕)
CREATE TABLE IF NOT EXISTS analysis_standard_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    version_id      INTEGER,
    version_code    TEXT,
    action          TEXT    NOT NULL,             -- create_version/update_version/delete_version/create/update/delete
    target          TEXT,                         -- 操作对象(版本或参数)
    content         TEXT,                         -- 变更内容
    operator        TEXT    DEFAULT '系统',
    operate_time    TEXT    DEFAULT (datetime('now','localtime'))
);

-- 工艺数据唯一工件编号索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_process_workpiece_no ON process_data(workpiece_no);

-- 分析标准版本 / 明细索引
CREATE INDEX IF NOT EXISTS idx_std_version_effective ON analysis_standard_versions(effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_std_version_product   ON analysis_standard_versions(product_model);
CREATE INDEX IF NOT EXISTS idx_std_version_id        ON analysis_standards(version_id);
CREATE INDEX IF NOT EXISTS idx_std_log_time          ON analysis_standard_logs(operate_time);


-- ============================================================
-- 第8部分: 产品生产统计模块
-- 说明: 按"天 + 班次 + 设备"汇总 process_data 的产量与质量数
--       未配置班次时按天统计(shift_code = ''), 配置班次后按班次统计
-- ============================================================

-- 8.1 班次配置表(可为空, 为空表示按天统计)
DROP TABLE IF EXISTS shift_config;
CREATE TABLE shift_config (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_code      TEXT    NOT NULL UNIQUE,      -- 班次编码, 如 DAY / NIGHT
    shift_name      TEXT    NOT NULL,             -- 班次名称, 如 白班
    start_time      TEXT    NOT NULL,             -- 开始时间 HH:MM
    end_time        TEXT    NOT NULL,             -- 结束时间 HH:MM (小于开始时间表示跨天)
    sort_order      INTEGER DEFAULT 0,
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 8.2 设备产量统计表(由定时任务 / 重新统计生成)
DROP TABLE IF EXISTS production_stats;
CREATE TABLE production_stats (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    stat_date       TEXT    NOT NULL,             -- 统计日期 YYYY-MM-DD
    shift_code      TEXT    NOT NULL DEFAULT '',  -- 班次编码, '' 表示按天统计
    shift_name      TEXT    DEFAULT '全天',        -- 班次名称冗余保存, 便于历史展示
    device_code     TEXT    NOT NULL,             -- 设备编号(关联 devices.device_code)
    total_count     INTEGER DEFAULT 0,            -- 生产数
    qualified_count INTEGER DEFAULT 0,            -- 合格数
    warning_count   INTEGER DEFAULT 0,            -- 预警数
    unqualified_count INTEGER DEFAULT 0,          -- 不合格数
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    DEFAULT (datetime('now','localtime')),
    UNIQUE (stat_date, shift_code, device_code)
);

-- 生产统计索引
CREATE INDEX IF NOT EXISTS idx_stats_date        ON production_stats(stat_date);
CREATE INDEX IF NOT EXISTS idx_stats_shift       ON production_stats(shift_code);
CREATE INDEX IF NOT EXISTS idx_stats_device      ON production_stats(device_code);


-- ============================================================
-- 第9部分: 生产计划模块
-- 说明: 给每台设备下达计划数, 计划完成数由 process_data 实时聚合
--       完成数 = 该设备在 [start_time, end_time] 内的工艺记录数
--       (计划指定了产品型号时, 只统计该产品的记录)
-- ============================================================

DROP TABLE IF EXISTS production_plans;
CREATE TABLE production_plans (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_code       TEXT    NOT NULL UNIQUE,      -- 计划编号, 如 PLAN-20261117-001
    plan_name       TEXT,                         -- 计划名称 / 工单号
    device_code     TEXT    NOT NULL,             -- 设备编号(关联 devices.device_code)
    product_model   TEXT,                         -- 限定产品型号, 空 = 该设备全部产品
    plan_count      INTEGER NOT NULL,             -- 计划生产数
    start_time      TEXT    NOT NULL,             -- 计划开始时间 YYYY-MM-DD HH:MM:SS
    end_time        TEXT    NOT NULL,             -- 计划结束时间
    status          TEXT    NOT NULL DEFAULT 'running',  -- running / completed / cancelled
    completed_at    TEXT,                         -- 结束(或取消)时间
    remark          TEXT,
    created_at      TEXT    DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    DEFAULT (datetime('now','localtime'))
);

-- 生产计划索引
CREATE INDEX IF NOT EXISTS idx_plan_device ON production_plans(device_code);
CREATE INDEX IF NOT EXISTS idx_plan_time   ON production_plans(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_plan_status ON production_plans(status);


-- ============================================================
-- ==================== 初始化数据 ============================
-- 策略: 先清空再插入，保证每次执行结果一致
-- 注意: 按外键依赖顺序，先清子表再清父表，先插父表再插子表
-- ============================================================

-- ----- 清空所有数据 (按外键依赖从子到父) -----
DELETE FROM thermal_point_temps;
DELETE FROM thermal_records;
DELETE FROM device_status_history;
DELETE FROM device_status;
DELETE FROM pipeline_edit_log;
DELETE FROM pipeline_params;
DELETE FROM mold_recipes;
DELETE FROM molds;
DELETE FROM andon_call_logs;
DELETE FROM andon_calls;
DELETE FROM andon_call_types;
DELETE FROM production_stats;
DELETE FROM shift_config;
DELETE FROM production_plans;
DELETE FROM process_data;
DELETE FROM analysis_standard_logs;
DELETE FROM analysis_standards;
DELETE FROM analysis_standard_versions;
DELETE FROM thermal_alarm_config;
DELETE FROM products;
DELETE FROM devices;

-- ----- 班次配置: 默认不配置班次, 统计按天汇总 -----
-- 如需按班次统计, 可执行下面的语句(白班 08:00-20:00 / 夜班 20:00-08:00):
-- INSERT INTO shift_config (shift_code, shift_name, start_time, end_time, sort_order) VALUES
--     ('DAY',   '白班', '08:00', '20:00', 1),
--     ('NIGHT', '夜班', '20:00', '08:00', 2);

-- ----- 设备基础数据 (8台设备) -----
-- 说明: device_code 为设备业务主键, 工艺数据 process_data.device_code
--       与设备管理模块引用同一套编号, 保证各页面设备一致
INSERT INTO devices (device_name, device_type, device_code, location, description) VALUES
    ('红外钳机', '钳机',     'HWQJ-008', '压铸车间', '红外钳机上下料设备'),
    ('压铸机',   '压铸机',   'YZJ-001',  '压铸车间', '主压铸成型设备'),
    ('真空机',   '真空机',   'ZKJ-002',  '压铸车间', '抽真空辅助设备'),
    ('喷雾机',   '喷雾机',   'PWJ-003',  '压铸车间', '模具喷涂设备'),
    ('抽芯机',   '抽芯机',   'CXJ-004',  '压铸车间', '抽芯机构设备'),
    ('求温机',   '温控设备', 'QWJ-006',  '压铸车间', '模温控制设备'),
    ('取件机',   '取件机',   'QJJ-005',  '压铸车间', '自动取件设备'),
    ('点冷机',   '冷却设备', 'DLJ-007',  '压铸车间', '局部点冷设备');

-- ----- 设备当前状态数据 -----
INSERT INTO device_status (device_id, status, alarm_info, detail_info)
SELECT d.id, s.status, s.alarm_info, s.detail_info
FROM devices d
JOIN (
    SELECT '红外钳机' AS name, 'error' AS status,   '缺料报警'     AS alarm_info, '权监超时配区'         AS detail_info UNION ALL
    SELECT '压铸机',          'running',            '正常'         , '--'                             UNION ALL
    SELECT '真空机',          'warning',            '非空压力异常' , 'D灯归压力异常'                  UNION ALL
    SELECT '喷雾机',          'error',              '喷涂模块异常' , '喷涂模块异常'                   UNION ALL
    SELECT '抽芯机',          'error',              '故障停机'     , 'C602单元常状状态异常'           UNION ALL
    SELECT '求温机',          'error',              '过载停机'     , 'C602过温异常'                   UNION ALL
    SELECT '取件机',          'warning',            '正常异响'     , 'xx通道异常'                     UNION ALL
    SELECT '点冷机',          'running',            '正常开机'     , 'xx温度正常'
) s ON d.device_name = s.name;

-- ----- 设备状态历史记录 -----
INSERT INTO device_status_history (device_id, status, alarm_info, detail_info, start_time)
SELECT d.id, s.status, s.alarm_info, s.detail_info, datetime('now','localtime')
FROM devices d
JOIN (
    SELECT '红外钳机' AS name, 'error' AS status,   '缺料报警'     AS alarm_info, '权监超时配区'         AS detail_info UNION ALL
    SELECT '压铸机',          'running',            '正常'         , '--'                             UNION ALL
    SELECT '真空机',          'warning',            '非空压力异常' , 'D灯归压力异常'                  UNION ALL
    SELECT '喷雾机',          'error',              '喷涂模块异常' , '喷涂模块异常'                   UNION ALL
    SELECT '抽芯机',          'error',              '故障停机'     , 'C602单元常状状态异常'           UNION ALL
    SELECT '求温机',          'error',              '过载停机'     , 'C602过温异常'                   UNION ALL
    SELECT '取件机',          'warning',            '正常异响'     , 'xx通道异常'                     UNION ALL
    SELECT '点冷机',          'running',            '正常开机'     , 'xx温度正常'
) s ON d.device_name = s.name;

-- ----- 产品基础数据 (3个产品) -----
-- 注意: 显式指定 id, 保证热成像记录 / 模具配方中的 product_id 引用始终有效
INSERT INTO products (id, product_name, product_code, product_type, description) VALUES
    (1, '有色压铸3500T', 'PROD-P3500T', '压铸件', '3500T压铸机生产的有色金属压铸件'),
    (2, '有色压铸5000T', 'PROD-P5000T', '压铸件', '5000T压铸机生产的有色金属压铸件'),
    (3, '有色压铸2600T', 'PROD-P2600T', '压铸件', '2600T压铸机生产的有色金属压铸件');

-- ----- 热成像: 示例记录 (3条) -----
INSERT INTO thermal_records (id, product_id, record_time, image_format, max_temp, min_temp, avg_temp, alarm_status) VALUES
    (1, 1, '2026-05-13 14:30:00', 'svg', 88.5, 35.2, 62.8, 'normal'),
    (2, 1, '2026-05-13 13:15:00', 'svg', 92.3, 36.0, 65.1, 'warning'),
    (3, 2, '2026-05-13 10:00:00', 'svg', 85.0, 34.5, 60.2, 'normal');

-- ----- 热成像: 示例点位温度数据 (20个点位 x 3条记录) -----
INSERT INTO thermal_point_temps (id, record_id, point_name, point_index, temperature, pos_x, pos_y, is_alarm) VALUES
    (1,  1, '点位01', 1,  62.5, 50,  50,  0),(2,  1, '点位02', 2,  58.3, 120, 50,  0),
    (3,  1, '点位03', 3,  65.1, 190, 50,  0),(4,  1, '点位04', 4,  71.2, 260, 50,  0),
    (5,  1, '点位05', 5,  60.8, 330, 50,  0),(6,  1, '点位06', 6,  63.4, 400, 50,  0),
    (7,  1, '点位07', 7,  69.0, 470, 50,  0),(8,  1, '点位08', 8,  57.6, 540, 50,  0),
    (9,  1, '点位09', 9,  64.2, 590, 50,  0),(10, 1, '点位10',10, 66.8, 50,  150, 0),
    (11, 1, '点位11',11, 59.5, 120, 150, 0),(12, 1, '点位12',12, 68.3, 190, 150, 0),
    (13, 1, '点位13',13, 72.0, 260, 150, 0),(14, 1, '点位14',14, 61.7, 330, 150, 0),
    (15, 1, '点位15',15, 65.9, 400, 150, 0),(16, 1, '点位16',16, 70.5, 470, 150, 0),
    (17, 1, '点位17',17, 58.8, 540, 150, 0),(18, 1, '点位18',18, 63.1, 590, 150, 0),
    (19, 1, '点位19',19, 67.2, 50,  250, 0),(20, 1, '点位20',20, 60.4, 120, 250, 0),
    (21, 2, '点位01', 1,  68.2, 50,  50,  0),(22, 2, '点位02', 2,  72.5, 120, 50,  0),
    (23, 2, '点位03', 3,  70.8, 190, 50,  0),(24, 2, '点位04', 4,  78.3, 260, 50,  0),
    (25, 2, '点位05', 5,  66.0, 330, 50,  0),(26, 2, '点位06', 6,  71.5, 400, 50,  0),
    (27, 2, '点位07', 7,  82.1, 470, 50,  1),(28, 2, '点位08', 8,  69.3, 540, 50,  0),
    (29, 2, '点位09', 9,  74.6, 590, 50,  0),(30, 2, '点位10',10, 65.9, 50,  150, 0),
    (31, 2, '点位11',11, 68.4, 120, 150, 0),(32, 2, '点位12',12, 73.2, 190, 150, 0),
    (33, 2, '点位13',13, 81.5, 260, 150, 1),(34, 2, '点位14',14, 67.8, 330, 150, 0),
    (35, 2, '点位15',15, 70.1, 400, 150, 0),(36, 2, '点位16',16, 75.9, 470, 150, 0),
    (37, 2, '点位17',17, 64.2, 540, 150, 0),(38, 2, '点位18',18, 69.7, 590, 150, 0),
    (39, 2, '点位19',19, 72.3, 50,  250, 0),(40, 2, '点位20',20, 66.5, 120, 250, 0),
    (41, 3, '点位01', 1,  59.8, 50,  50,  0),(42, 3, '点位02', 2,  56.2, 120, 50,  0),
    (43, 3, '点位03', 3,  62.4, 190, 50,  0),(44, 3, '点位04', 4,  68.0, 260, 50,  0),
    (45, 3, '点位05', 5,  58.5, 330, 50,  0),(46, 3, '点位06', 6,  61.9, 400, 50,  0),
    (47, 3, '点位07', 7,  66.3, 470, 50,  0),(48, 3, '点位08', 8,  55.7, 540, 50,  0),
    (49, 3, '点位09', 9,  63.0, 590, 50,  0),(50, 3, '点位10',10, 60.2, 50,  150, 0),
    (51, 3, '点位11',11, 57.8, 120, 150, 0),(52, 3, '点位12',12, 65.5, 190, 150, 0),
    (53, 3, '点位13',13, 69.2, 260, 150, 0),(54, 3, '点位14',14, 59.6, 330, 150, 0),
    (55, 3, '点位15',15, 63.8, 400, 150, 0),(56, 3, '点位16',16, 67.4, 470, 150, 0),
    (57, 3, '点位17',17, 56.9, 540, 150, 0),(58, 3, '点位18',18, 61.2, 590, 150, 0),
    (59, 3, '点位19',19, 64.5, 50,  250, 0),(60, 3, '点位20',20, 58.1, 120, 250, 0);

-- ----- 热成像: 20个点位报警阈值配置 -----
INSERT INTO thermal_alarm_config (point_index, point_name, temp_high, temp_low) VALUES
    (1, '点位01',80,0),(2,'点位02',80,0),(3,'点位03',80,0),(4,'点位04',80,0),
    (5,'点位05',80,0),(6,'点位06',80,0),(7,'点位07',80,0),(8,'点位08',80,0),
    (9,'点位09',80,0),(10,'点位10',80,0),(11,'点位11',80,0),(12,'点位12',80,0),
    (13,'点位13',80,0),(14,'点位14',80,0),(15,'点位15',80,0),(16,'点位16',80,0),
    (17,'点位17',80,0),(18,'点位18',80,0),(19,'点位19',80,0),(20,'点位20',80,0);

-- ----- 模具基础数据 (4套模具) -----
-- 注意: 显式指定 id, 保证模具配方中的 mold_id 引用始终有效
INSERT INTO molds (id, mold_name, mold_code, mold_type, description) VALUES
    (1, '红岛模具', 'MOLD-HD-001', '压铸模', '红岛系列压铸专用模具'),
    (2, '标准压铸模', 'MOLD-STD-001', '压铸模', '通用型标准压铸模具'),
    (3, '精密压铸模', 'MOLD-JM-001', '精密模', '高精度压铸专用模具'),
    (4, '大型压铸模', 'MOLD-LG-001', '大型模', '大型工件压铸专用模具');

-- ----- 模具配方数据 (4条配方) -----
INSERT INTO mold_recipes (id, product_id, product_name, mold_id, production_line,
    fast1_enabled, fast1_position, fast1_valve,
    fast2_enabled, fast2_position, fast2_valve,
    boost_enabled, boost_position, boost_pressure,
    track_end_pos, fast_energy_pressure, boost_energy_pressure,
    injection_time, boost_delay, cooling_time, hammer_delay, slow_flow, remark) VALUES
    (1, 1, '有色压铸3500T', 1, '1号线',
     '是', 120.5, 65.0,
     '否', 0, 0,
     '1', 180.0, 85.0,
     250.0, 14.0, 14.0,
     3.5, 0.5, 12.0, 2.0, 1.2, '红岛模具标准配方'),
    (2, 2, '有色压铸5000T', 2, '2号线',
     '是', 150.0, 72.0,
     '是', 220.0, 68.0,
     '1', 200.0, 95.0,
     280.0, 16.0, 16.0,
     4.0, 0.6, 14.0, 2.5, 1.5, '大型件标准配方'),
    (3, 3, '有色压铸2600T', 3, '1号线',
     '是', 100.0, 58.0,
     '否', 0, 0,
     '1', 160.0, 75.0,
     220.0, 12.0, 12.0,
     3.0, 0.4, 10.0, 1.8, 1.0, '精密件标准配方'),
    (4, 1, '有色压铸3500T', 4, '3号线',
     '是', 130.0, 68.0,
     '是', 200.0, 62.0,
     '1', 190.0, 88.0,
     260.0, 15.0, 15.0,
     3.8, 0.55, 13.0, 2.2, 1.3, '大型模具配方');

-- ----- 管路配方: 默认参数值 -----
INSERT INTO pipeline_params (param_name, param_value, param_unit, min_value, max_value) VALUES
    ('压力设定', 85.0, 'MPa',  60.0, 120.0),
    ('温度设定', 680.0, '℃',   600.0, 750.0),
    ('流量设定', 2.85, 'm/s',  1.5, 4.5),
    ('阀门开度', 75,   '%',    0, 100);

-- ----- 管路: 示例下发记录 (3条) -----
INSERT INTO pipeline_edit_log (id, param_name, old_value, new_value, operator, edit_time, remark) VALUES
    (1, '压力设定', 82.0, 85.0, '张工',   '2026-05-13 08:30:00', '根据工艺标准调整'),
    (2, '温度设定', 675.0, 680.0, '李技术', '2026-05-13 09:15:00', '提高浇注温度以改善流动性'),
    (3, '阀门开度', 70, 75, '王操作',     '2026-05-13 10:00:00', '按配方参数调整阀门开度');

-- ----- 安灯: 8种呼叫类型配置 -----
INSERT INTO andon_call_types (type_name, type_key, sort_order) VALUES
    ('质量异常',        'quality',      1),
    ('设备故障',        'device',       2),
    ('物料短缺',        'material',     3),
    ('安全告警',        'safety',       4),
    ('模具异常',        'mold',         5),
    ('工装辅助',        'tooling',      6),
    ('调取历史',        'history',      7),
    ('一键登录',        'login',        8);

-- ----- 安灯: 示例呼叫记录 (6条) -----
INSERT INTO andon_calls (id, call_type, call_detail, caller, call_time, status, handler, handle_time, handle_remark) VALUES
    (1, '质量异常', '压铸件表面气孔超标，需停线检查',           '张工',   '2026-05-13 08:23:15', 'completed',  '李质检', '2026-05-13 08:45:00', '已联系质检员复核，停线整改中'),
    (2, '设备故障', 'C602单元常状状态异常，需要维修',           '王操作', '2026-05-13 09:10:42', 'processing', '赵维修', '2026-05-13 09:20:10', NULL),
    (3, '物料短缺', '铝锭库存不足，需紧急补料',                 '陈班长', '2026-05-13 09:45:30', 'pending',    NULL, NULL, NULL),
    (4, '安全告警', '3号压铸机区域烟雾传感器触发',             '系统自动','2026-05-13 10:02:18', 'processing', '安保组', '2026-05-13 10:08:42', NULL),
    (5, '模具异常', '红岛模次压铸工艺参数超差',                 '刘技师', '2026-05-13 10:30:55', 'pending',    NULL, NULL, NULL),
    (6, '工装辅助', '夹具定位销磨损需更换',                     '孙操作', '2026-05-13 11:15:22', 'completed',  '周工装', '2026-05-13 11:40:05', '已更换定位销并恢复生产');

-- ----- 安灯: 示例操作日志 (8条) -----
INSERT INTO andon_call_logs (id, call_id, action, operator, content, operate_time) VALUES
    (1, 1, 'create',   '张工',   '发起【质量异常】呼叫',                    '2026-05-13 08:23:15'),
    (2, 1, 'respond',  '李质检', '响应呼叫，开始处理',                      '2026-05-13 08:30:20'),
    (3, 1, 'complete', '李质检', '完成处理：已联系质检员复核，停线整改中',  '2026-05-13 08:45:00'),
    (4, 2, 'create',   '王操作', '发起【设备故障】呼叫',                    '2026-05-13 09:10:42'),
    (5, 2, 'respond',  '赵维修', '响应呼叫，开始处理',                      '2026-05-13 09:20:10'),
    (6, 4, 'create',   '系统自动','发起【安全告警】呼叫',                   '2026-05-13 10:02:18'),
    (7, 4, 'respond',  '安保组', '响应呼叫，开始处理',                      '2026-05-13 10:08:42'),
    (8, 6, 'create',   '孙操作', '发起【工装辅助】呼叫',                    '2026-05-13 11:15:22');

-- ----- 工艺数据: 14条示例采集记录(工艺 / 分析共用同一数据源) -----
INSERT INTO process_data (id, collect_time, device_code, product_model, batch_no, workpiece_no,
    slow_speed, fast_speed, cast_pressure, boost_pressure, pour_temp, mold_temp, cycle_time, hold_time,
    injection_time, sprue_thickness, furnace_temp, goose_neck_temp, nozzle_temp, oil_temp, fast_switch_point,
    data_status) VALUES
    -- 2026-04 数据: 当时生效标准为「标准1」
    (11,'2026-04-20 09:12:05','YZJ-001','P3500T','B20260420001','WJ202604200001',0.18,2.85,85.1,92.0,679,245,58.1,12.4,3.18,18.2,698,657,638,44.6,318.5,'normal'),
    (12,'2026-04-20 09:13:40','YZJ-001','P3500T','B20260420001','WJ202604200002',0.22,2.80,84.0,91.0,681,246,58.6,12.6,3.24,18.9,703,662,642,45.8,322.1,'normal'),
    (13,'2026-04-20 09:15:18','ZKJ-002','P3500T','B20260420001','WJ202604200003',0.25,2.62,80.2,86.5,660,236,63.0,13.9,3.05,17.4,688,651,631,47.2,309.4,'warning'),
    (14,'2026-04-20 09:17:02','ZKJ-002','P3500T','B20260420001','WJ202604200004',0.19,2.86,85.4,92.4,680,244,58.0,12.5,3.21,18.6,701,659,641,45.2,321.7,'normal'),
    -- 2026-05 数据: 2026-05-01 起生效标准为「标准2」(更严格)
    (1, '2026-05-13 14:32:15','YZJ-001','P3500T','B20260513001','WJ202605130001',0.18,2.85,85.3,92.1,680,245,58.2,12.5,3.19,18.4,699,658,639,44.9,319.8,'normal'),
    (2, '2026-05-13 14:31:48','YZJ-001','P3500T','B20260513001','WJ202605130002',0.19,2.82,84.8,91.5,682,246,57.9,12.3,3.23,18.8,702,661,642,45.6,321.4,'normal'),
    (3, '2026-05-13 14:31:20','ZKJ-002','P3500T','B20260513001','WJ202605130003',0.17,2.90,86.1,93.2,678,243,58.5,12.8,3.17,18.1,697,656,637,44.3,317.9,'normal'),
    (4, '2026-05-13 14:30:55','YZJ-001','P3500T','B20260513001','WJ202605130004',0.21,2.75,83.2,89.8,675,240,59.1,13.0,3.28,19.2,705,664,644,46.4,324.6,'normal'),
    (5, '2026-05-13 14:30:28','PWJ-003','P5000T','B20260513002','WJ202605130005',0.20,3.15,92.5,101.2,700,258,62.3,14.2,3.62,21.2,722,680,657,48.4,352.6,'unqualified'),
    (6, '2026-05-13 14:29:50','CXJ-004','P2600T','B20260513003','WJ202605130006',0.16,2.50,78.5,84.2,650,232,52.8,10.5,2.78,15.6,673,636,618,42.6,293.4,'unqualified'),
    (7, '2026-05-13 14:29:12','QJJ-005','P3500T','B20260513001','WJ202605130007',0.18,2.88,85.0,91.8,681,244,58.0,12.6,3.20,18.5,700,660,640,45.0,320.2,'normal'),
    (8, '2026-05-13 14:28:35','YZJ-001','P3500T','B20260513001','WJ202605130008',0.19,2.83,85.5,92.5,679,245,57.8,12.4,3.22,18.7,701,661,641,45.4,321.0,'normal'),
    (9, '2026-05-13 14:28:00','ZKJ-002','P5000T','B20260513002','WJ202605130009',0.22,3.20,93.0,102.5,702,260,63.0,14.5,3.55,20.6,716,674,651,47.1,345.8,'unqualified'),
    (10,'2026-05-13 14:27:22','PWJ-003','P2600T','B20260513004','WJ202605130010',0.15,2.40,76.8,82.5,645,228,51.5,10.0,2.84,16.1,678,641,622,43.8,297.2,'unqualified');

-- ----- 分析标准版本: 标准1(2026上半年) / 标准2(2026-05起) -----
--       判定时按工艺记录的采集时间自动匹配当时生效的版本
INSERT INTO analysis_standard_versions (id, version_code, version_name, product_model, effective_from, effective_to, remark) VALUES
    (1, 'STD-2026-01', '标准1', NULL, '2026-01-01 00:00:00', '2026-05-01 00:00:00', '上半年放宽判定标准'),
    (2, 'STD-2026-02', '标准2', NULL, '2026-05-01 00:00:00', NULL,                  '5月起收紧判定标准,持续生效');

-- ----- 分析标准明细: 标准1(宽容差) -----
INSERT INTO analysis_standards (version_id, param_name, param_key, standard_value, tolerance, unit, display_order) VALUES
    (1,'慢压射速度','slow_speed',      0.18, 0.05, 'm/s', 1),
    (1,'快压射速度','fast_speed',      2.85, 0.25, 'm/s', 2),
    (1,'铸造压力',  'cast_pressure',   85.0, 5.0,  'MPa', 3),
    (1,'增压压力',  'boost_pressure',  92.0, 6.0,  'MPa', 4),
    (1,'浇注温度',  'pour_temp',       680,  20,   '℃',   5),
    (1,'模具温度',  'mold_temp',       245,  15,   '℃',   6),
    (1,'循环周期',  'cycle_time',      58.0, 5.0,  's',   7),
    (1,'保压时间',  'hold_time',       12.5, 1.5,  's',   8);

-- ----- 分析标准明细: 标准2(严容差) -----
INSERT INTO analysis_standards (version_id, param_name, param_key, standard_value, tolerance, unit, display_order) VALUES
    (2,'慢压射速度','slow_speed',      0.18, 0.03, 'm/s', 1),
    (2,'快压射速度','fast_speed',      2.85, 0.15, 'm/s', 2),
    (2,'铸造压力',  'cast_pressure',   85.0, 3.0,  'MPa', 3),
    (2,'增压压力',  'boost_pressure',  92.0, 4.0,  'MPa', 4),
    (2,'浇注温度',  'pour_temp',       680,  15,   '℃',   5),
    (2,'模具温度',  'mold_temp',       245,  10,   '℃',   6),
    (2,'循环周期',  'cycle_time',      58.0, 3.0,  's',   7),
    (2,'保压时间',  'hold_time',       12.5, 1.0,  's',   8);

-- ----- 分析标准变更日志: 标准2上线记录 -----
INSERT INTO analysis_standard_logs (version_id, version_code, action, target, content, operator, operate_time) VALUES
    (1, 'STD-2026-01', 'create_version', '标准1', '创建标准版本,有效期 2026-01-01 ~ 2026-05-01', '张工', '2025-12-28 09:00:00'),
    (2, 'STD-2026-02', 'create_version', '标准2', '创建标准版本,自 2026-05-01 起生效',           '张工', '2026-04-28 10:20:00');

-- ----- 复合索引：统计表与计划表（表已在前文创建） -----
CREATE INDEX IF NOT EXISTS idx_stats_date_device ON production_stats(stat_date, device_code);
CREATE INDEX IF NOT EXISTS idx_plans_start_device ON production_plans(start_time, device_code);

PRAGMA foreign_keys = ON;

-- =============================================================================
-- TraceOS Lab — 成就系统 (Achievements)
-- 部署顺序：依赖 02-schema.sql 的 users 表
-- achievements   — 成就目录（静态种子，与 Go 端 internal/achievement 保持一致）
-- user_achievements — 用户解锁记录
-- =============================================================================

CREATE TABLE IF NOT EXISTS achievements (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    category    TEXT NOT NULL,
    icon        TEXT NOT NULL,
    sort_order  INT  NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_achievements (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    unlocked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user
    ON user_achievements(user_id, unlocked_at DESC);

INSERT INTO achievements (id, name, description, category, icon, sort_order) VALUES
    ('first_submission', '初次尝试',   '完成第一次代码提交',             '里程碑', 'flag',       1),
    ('first_qualified', '首战告捷',   '第一次提交即通过全部核心测试',   '里程碑', 'trophy',     2),
    ('first_try_win',   '一击命中',   '在某个实验的第一次提交即达标',   '里程碑', 'target',     3),
    ('submit_10',       '坚持不懈',   '累计提交 10 次代码',            '坚持',   'flame',      4),
    ('prolific',        '高产作者',   '累计提交 20 次代码',            '坚持',   'rocket',     5),
    ('submit_50',       '百炼成钢',   '累计提交 50 次代码',            '坚持',   'hammer',     6),
    ('qualified_5',     '连战连捷',   '累计 5 次提交达标',             '里程碑', 'medal',      7),
    ('qualified_10',    '十全十美',   '累计 10 次提交达标',            '卓越',   'crown',      8),
    ('perfect_score',   '满分达成',   '获得一次满分',                  '卓越',   'star',       9),
    ('clean_sweep',     '完美主义',   '累计 3 次获得满分',             '卓越',   'shield',    10),
    ('edge_master',     '边界征服',   '累计获得 50 分边界分',          '卓越',   'sparkles',  11),
    ('hard_mode',       '攻坚克难',   '在高难度实验中达标',            '卓越',   'mountain',  12),
    ('category_3',      '三域探索',   '完成 3 个不同类别的实验',       '探索',   'compass',   13),
    ('category_all',    '全域通吃',   '完成全部 6 个类别的实验',       '探索',   'globe',     14),
    ('polyglot',        '双语程序员', '使用 2 种以上语言提交',         '探索',   'code',      15),
    ('lab_3',           '实验达人',   '完成 3 个不同实验',             '探索',   'flask',     16),
    ('lab_10',          '实验大师',   '完成 10 个不同实验',            '探索',   'beaker',    17),
    ('deadlock_hunter', '死锁猎手',   '在提交中检测到死锁',            '分析',   'lock',      18)
ON CONFLICT (id) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    category    = EXCLUDED.category,
    icon        = EXCLUDED.icon,
    sort_order  = EXCLUDED.sort_order;

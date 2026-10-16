-- TraceOS Lab 用户管理改造 v1
-- 学生学号/班级 + 教师所带班级数组，支撑分权与扩展字段

-- 学生扩展字段：学号 + 班级
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_no VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS class_name VARCHAR(50);
-- 教师所带班级（数组），用于"只管本班"分权
ALTER TABLE users ADD COLUMN IF NOT EXISTS teaching_classes TEXT[];

CREATE INDEX IF NOT EXISTS idx_users_class ON users(class_name) WHERE role = 'student';
CREATE INDEX IF NOT EXISTS idx_users_student_no ON users(student_no) WHERE role = 'student';

COMMENT ON COLUMN users.student_no IS '学生学号（仅 role=student）';
COMMENT ON COLUMN users.class_name IS '班级名（仅 role=student）';
COMMENT ON COLUMN users.teaching_classes IS '所带班级列表（仅 role=teacher）';

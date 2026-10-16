package achievement

// Definition is the immutable catalog entry for a single achievement.
// It is the single source of truth used by the evaluator and the HTTP API.
type Definition struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Icon        string `json:"icon"`
}

// Definitions enumerates every achievement in display order.
// Keep IDs in sync with deploy/init-db/28-achievements.sql.
var Definitions = []Definition{
	{ID: "first_submission", Name: "初次尝试", Description: "完成第一次代码提交", Category: "里程碑", Icon: "flag"},
	{ID: "first_qualified", Name: "首战告捷", Description: "第一次提交即通过全部核心测试", Category: "里程碑", Icon: "trophy"},
	{ID: "first_try_win", Name: "一击命中", Description: "在某个实验的第一次提交即达标", Category: "里程碑", Icon: "target"},
	{ID: "submit_10", Name: "坚持不懈", Description: "累计提交 10 次代码", Category: "坚持", Icon: "flame"},
	{ID: "prolific", Name: "高产作者", Description: "累计提交 20 次代码", Category: "坚持", Icon: "rocket"},
	{ID: "submit_50", Name: "百炼成钢", Description: "累计提交 50 次代码", Category: "坚持", Icon: "hammer"},
	{ID: "qualified_5", Name: "连战连捷", Description: "累计 5 次提交达标", Category: "里程碑", Icon: "medal"},
	{ID: "qualified_10", Name: "十全十美", Description: "累计 10 次提交达标", Category: "卓越", Icon: "crown"},
	{ID: "perfect_score", Name: "满分达成", Description: "获得一次满分", Category: "卓越", Icon: "star"},
	{ID: "clean_sweep", Name: "完美主义", Description: "累计 3 次获得满分", Category: "卓越", Icon: "shield"},
	{ID: "edge_master", Name: "边界征服", Description: "累计获得 50 分边界分", Category: "卓越", Icon: "sparkles"},
	{ID: "hard_mode", Name: "攻坚克难", Description: "在高难度实验中达标", Category: "卓越", Icon: "mountain"},
	{ID: "category_3", Name: "三域探索", Description: "完成 3 个不同类别的实验", Category: "探索", Icon: "compass"},
	{ID: "category_all", Name: "全域通吃", Description: "完成全部 6 个类别的实验", Category: "探索", Icon: "globe"},
	{ID: "polyglot", Name: "双语程序员", Description: "使用 2 种以上语言提交", Category: "探索", Icon: "code"},
	{ID: "lab_3", Name: "实验达人", Description: "完成 3 个不同实验", Category: "探索", Icon: "flask"},
	{ID: "lab_10", Name: "实验大师", Description: "完成 10 个不同实验", Category: "探索", Icon: "beaker"},
	{ID: "deadlock_hunter", Name: "死锁猎手", Description: "在提交中检测到死锁", Category: "分析", Icon: "lock"},
}

// ByID returns the definition for a given achievement ID, or nil.
func ByID(id string) *Definition {
	for i := range Definitions {
		if Definitions[i].ID == id {
			return &Definitions[i]
		}
	}
	return nil
}

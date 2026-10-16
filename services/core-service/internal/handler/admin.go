package handler

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/model"
	"github.com/traceos-lab/core-service/internal/repository"
)

type AdminHandler struct {
	db      *pgxpool.Pool
	subRepo *repository.SubmissionRepo
	expRepo *repository.ExperimentRepo
}

func NewAdminHandler(db *pgxpool.Pool, subRepo *repository.SubmissionRepo, expRepo *repository.ExperimentRepo) *AdminHandler {
	return &AdminHandler{db: db, subRepo: subRepo, expRepo: expRepo}
}

// ── DB Overview ────────────────────────────────────────────────────

func (h *AdminHandler) GetDBOverview(c *gin.Context) {
	var totalStudents, totalTeachers, totalAdmins, activeToday int
	rows, err := h.db.Query(c, "SELECT role, COUNT(*) FROM users GROUP BY role")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var role string
		var count int
		if err := rows.Scan(&role, &count); err != nil {
			continue
		}
		switch role {
		case "student":
			totalStudents = count
		case "teacher":
			totalTeachers = count
		case "admin":
			totalAdmins = count
		}
	}
	totalUsers := totalStudents + totalTeachers + totalAdmins
	h.db.QueryRow(c, "SELECT COUNT(*) FROM users WHERE last_login_at > CURRENT_DATE").Scan(&activeToday)

	var totalSubs, todaySubs, weekSubs int
	h.db.QueryRow(c, "SELECT COUNT(*) FROM submissions").Scan(&totalSubs)
	h.db.QueryRow(c, "SELECT COUNT(*) FROM submissions WHERE created_at > CURRENT_DATE").Scan(&todaySubs)
	h.db.QueryRow(c, "SELECT COUNT(*) FROM submissions WHERE created_at > NOW() - INTERVAL '7 days'").Scan(&weekSubs)

	statusBreakdown := make(map[string]int)
	srows, _ := h.db.Query(c, "SELECT status, COUNT(*) FROM submissions GROUP BY status")
	if srows != nil {
		defer srows.Close()
		for srows.Next() {
			var st string
			var cnt int
			srows.Scan(&st, &cnt)
			statusBreakdown[st] = cnt
		}
	}

	var totalExps int
	byCategory := make(map[string]int)
	h.db.QueryRow(c, "SELECT COUNT(*) FROM experiments").Scan(&totalExps)
	erows, _ := h.db.Query(c, "SELECT category, COUNT(*) FROM experiments GROUP BY category")
	if erows != nil {
		defer erows.Close()
		for erows.Next() {
			var cat string
			var cnt int
			erows.Scan(&cat, &cnt)
			byCategory[cat] = cnt
		}
	}

	var totalDiag, completedDiag, failedDiag int
	var avgConf float64
	h.db.QueryRow(c, "SELECT COUNT(*) FROM diagnoses").Scan(&totalDiag)
	h.db.QueryRow(c, "SELECT COUNT(*) FROM diagnoses WHERE status='completed'").Scan(&completedDiag)
	h.db.QueryRow(c, "SELECT COUNT(*) FROM diagnoses WHERE status='failed'").Scan(&failedDiag)
	h.db.QueryRow(c, "SELECT COALESCE(AVG(confidence_score),0) FROM diagnoses WHERE status='completed'").Scan(&avgConf)

	type errorItem struct {
		ErrorType string `json:"error_type"`
		Count     int    `json:"count"`
	}
	var recentErrors []errorItem
	erows2, _ := h.db.Query(c, "SELECT error_type, COUNT(*) as cnt FROM error_statistics GROUP BY error_type ORDER BY cnt DESC LIMIT 5")
	if erows2 != nil {
		defer erows2.Close()
		for erows2.Next() {
			var ei errorItem
			erows2.Scan(&ei.ErrorType, &ei.Count)
			recentErrors = append(recentErrors, ei)
		}
	}
	if recentErrors == nil {
		recentErrors = []errorItem{}
	}

	c.JSON(http.StatusOK, gin.H{
		"users": gin.H{
			"total":        totalUsers,
			"students":     totalStudents,
			"teachers":     totalTeachers,
			"admins":       totalAdmins,
			"active_today": activeToday,
		},
		"submissions": gin.H{
			"total":            totalSubs,
			"today":            todaySubs,
			"this_week":        weekSubs,
			"status_breakdown": statusBreakdown,
		},
		"experiments": gin.H{
			"total":       totalExps,
			"by_category": byCategory,
		},
		"diagnoses": gin.H{
			"total":          totalDiag,
			"completed":      completedDiag,
			"failed":         failedDiag,
			"avg_confidence": avgConf,
		},
		"recent_errors": recentErrors,
	})
}

// ── Submission Queue ───────────────────────────────────────────────

type StuckItem struct {
	ID              string  `json:"id"`
	ExperimentID    string  `json:"experiment_id"`
	StudentName     string  `json:"student_name"`
	Status          string  `json:"status"`
	CreatedAt       string  `json:"created_at"`
	StuckMinutes    float64 `json:"stuck_minutes"`
	ExperimentTitle string  `json:"experiment_title"`
}

func (h *AdminHandler) GetSubmissionQueue(c *gin.Context) {
	stuckMin, _ := strconv.Atoi(c.DefaultQuery("stuck_minutes", "10"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	rows, err := h.db.Query(c, `
		SELECT s.id, s.experiment_id, COALESCE(u.full_name,u.username), s.status, s.created_at,
		       EXTRACT(EPOCH FROM (NOW()-s.created_at))/60, COALESCE(e.title,'')
		FROM submissions s
		JOIN users u ON u.id=s.student_id
		LEFT JOIN experiments e ON e.id=s.experiment_id
		WHERE s.status='running' AND s.created_at < NOW() - ($1 || ' minutes')::INTERVAL
		ORDER BY s.created_at ASC LIMIT $2 OFFSET $3
	`, fmt.Sprintf("%d", stuckMin), pageSize, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var items []StuckItem
	for rows.Next() {
		var si StuckItem
		if err := rows.Scan(&si.ID, &si.ExperimentID, &si.StudentName, &si.Status, &si.CreatedAt, &si.StuckMinutes, &si.ExperimentTitle); err != nil {
			continue
		}
		items = append(items, si)
	}
	if items == nil {
		items = []StuckItem{}
	}

	var total int
	h.db.QueryRow(c, `
		SELECT COUNT(*) FROM submissions
		WHERE status='running' AND created_at < NOW() - ($1 || ' minutes')::INTERVAL
	`, fmt.Sprintf("%d", stuckMin)).Scan(&total)

	summary := make(map[string]int)
	summary["pending_count"] = 0
	summary["running_count"] = 0
	summary["stuck_count"] = total
	summary["completed_count"] = 0
	summary["failed_count"] = 0
	summary["compile_error_count"] = 0
	srows, _ := h.db.Query(c, "SELECT status, COUNT(*) FROM submissions GROUP BY status")
	if srows != nil {
		defer srows.Close()
		for srows.Next() {
			var st string
			var cnt int
			srows.Scan(&st, &cnt)
			summary[st+"_count"] = cnt
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"data":      items,
		"summary":   summary,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// ── Batch Reset Submissions ────────────────────────────────────────

type BatchResetReq struct {
	SubmissionIDs []string `json:"submission_ids" binding:"required"`
	TargetStatus  string   `json:"target_status" binding:"required"`
}

func (h *AdminHandler) BatchResetSubmissions(c *gin.Context) {
	var req BatchResetReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.TargetStatus != "pending" && req.TargetStatus != "failed" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target_status must be pending or failed"})
		return
	}
	if len(req.SubmissionIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "submission_ids is empty"})
		return
	}

	tag, err := h.db.Exec(c, "UPDATE submissions SET status=$1 WHERE id=ANY($2)", req.TargetStatus, req.SubmissionIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reset_count": tag.RowsAffected()})
}

// ── Experiment Configs ─────────────────────────────────────────────

type ExpConfigItem struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Title           string  `json:"title"`
	Category        string  `json:"category"`
	Difficulty      string  `json:"difficulty"`
	TimeLimit       int     `json:"time_limit"`
	MemoryLimit     int64   `json:"memory_limit"`
	SandboxLevel    int     `json:"sandbox_level"`
	MaxSubmissions  int     `json:"max_submissions"`
	IsPublished     bool    `json:"is_published"`
	SubmissionCount int     `json:"submission_count"`
	PassRate        float64 `json:"pass_rate"`
	TestCaseCount   int     `json:"test_case_count"`
}

func (h *AdminHandler) GetExperimentConfigs(c *gin.Context) {
	category := c.Query("category")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize

	baseWhere := "WHERE 1=1"
	args := []interface{}{}
	argIdx := 1
	if category != "" {
		baseWhere += fmt.Sprintf(" AND e.category=$%d", argIdx)
		args = append(args, category)
		argIdx++
	}
	args = append(args, pageSize, offset)

	query := fmt.Sprintf(`
		SELECT e.id, e.name, e.title, e.category, e.difficulty,
		       e.time_limit, e.memory_limit, e.sandbox_level, e.max_submissions, e.is_published,
		       COUNT(s.id),
		       COALESCE(ROUND(100.0*COUNT(CASE WHEN s.status='completed' AND s.score>0 THEN 1 END)/NULLIF(COUNT(s.id),0),1),0),
		       (SELECT COUNT(*) FROM test_cases tc WHERE tc.experiment_id=e.id)
		FROM experiments e
		LEFT JOIN submissions s ON s.experiment_id=e.id
		%s GROUP BY e.id ORDER BY e.category, e.name
		LIMIT $%d OFFSET $%d`, baseWhere, argIdx, argIdx+1)

	rows, err := h.db.Query(c, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var items []ExpConfigItem
	for rows.Next() {
		var ci ExpConfigItem
		if err := rows.Scan(&ci.ID, &ci.Name, &ci.Title, &ci.Category, &ci.Difficulty,
			&ci.TimeLimit, &ci.MemoryLimit, &ci.SandboxLevel, &ci.MaxSubmissions, &ci.IsPublished,
			&ci.SubmissionCount, &ci.PassRate, &ci.TestCaseCount); err != nil {
			continue
		}
		items = append(items, ci)
	}
	if items == nil {
		items = []ExpConfigItem{}
	}

	var total int
	countWhere := "WHERE 1=1"
	countArgs := []interface{}{}
	if category != "" {
		countWhere += fmt.Sprintf(" AND category=$%d", 1)
		countArgs = append(countArgs, category)
	}
	if len(countArgs) > 0 {
		h.db.QueryRow(c, "SELECT COUNT(*) FROM experiments "+countWhere, countArgs...).Scan(&total)
	} else {
		h.db.QueryRow(c, "SELECT COUNT(*) FROM experiments").Scan(&total)
	}

	c.JSON(http.StatusOK, model.PaginatedResponse{
		Data: items, Total: total, Page: page, PageSize: pageSize,
		TotalPages: int(math.Ceil(float64(total) / float64(pageSize))),
	})
}

// ── Test Cases ─────────────────────────────────────────────────────

type TestCaseItem struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Type            string `json:"type"`
	CompareMode     string `json:"compare_mode"`
	InputData       string `json:"input_data"`
	ExpectedOutput  string `json:"expected_output"`
	IsPublic        bool   `json:"is_public"`
	ScoreWeight     int    `json:"score_weight"`
	OrderIndex      int    `json:"order_index"`
	RecentFailCount int    `json:"recent_fail_count"`
	RecentPassCount int    `json:"recent_pass_count"`
}

func (h *AdminHandler) ListTestCases(c *gin.Context) {
	expID := c.Param("id")

	var expTitle string
	h.db.QueryRow(c, "SELECT title FROM experiments WHERE id=$1", expID).Scan(&expTitle)

	rows, err := h.db.Query(c, `
		SELECT tc.id, tc.name, tc.type, tc.compare_mode, tc.input_data, tc.expected_output,
		       tc.is_public, tc.score_weight, tc.order_index,
		       COALESCE(SUM(CASE WHEN tr.status='failed' OR tr.status='error' OR tr.status='timeout' THEN 1 ELSE 0 END),0),
		       COALESCE(SUM(CASE WHEN tr.status='passed' THEN 1 ELSE 0 END),0)
		FROM test_cases tc
		LEFT JOIN LATERAL (
			SELECT status FROM test_results
			WHERE test_case_id=tc.id ORDER BY created_at DESC LIMIT 100
		) tr ON true
		WHERE tc.experiment_id=$1
		GROUP BY tc.id, tc.order_index
		ORDER BY tc.order_index
	`, expID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var cases []TestCaseItem
	for rows.Next() {
		var tc TestCaseItem
		if err := rows.Scan(&tc.ID, &tc.Name, &tc.Type, &tc.CompareMode, &tc.InputData, &tc.ExpectedOutput,
			&tc.IsPublic, &tc.ScoreWeight, &tc.OrderIndex, &tc.RecentFailCount, &tc.RecentPassCount); err != nil {
			continue
		}
		cases = append(cases, tc)
	}
	if cases == nil {
		cases = []TestCaseItem{}
	}

	c.JSON(http.StatusOK, gin.H{
		"experiment_id":    expID,
		"experiment_title": expTitle,
		"test_cases":       cases,
	})
}

// ── Update Test Case ───────────────────────────────────────────────

type UpdateTestCaseReq struct {
	ExpectedOutput *string `json:"expected_output"`
	IsPublic       *bool   `json:"is_public"`
	ScoreWeight    *int    `json:"score_weight"`
}

func (h *AdminHandler) UpdateTestCase(c *gin.Context) {
	id := c.Param("id")
	var req UpdateTestCaseReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if req.ExpectedOutput != nil {
		setClauses = append(setClauses, fmt.Sprintf("expected_output=$%d", argIdx))
		args = append(args, *req.ExpectedOutput)
		argIdx++
	}
	if req.IsPublic != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_public=$%d", argIdx))
		args = append(args, *req.IsPublic)
		argIdx++
	}
	if req.ScoreWeight != nil {
		setClauses = append(setClauses, fmt.Sprintf("score_weight=$%d", argIdx))
		args = append(args, *req.ScoreWeight)
		argIdx++
	}
	if len(setClauses) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no fields to update"})
		return
	}

	args = append(args, id)
	query := fmt.Sprintf("UPDATE test_cases SET %s WHERE id=$%d", strings.Join(setClauses, ", "), argIdx)
	_, err := h.db.Exec(c, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": id, "updated": true})
}


// AIAdjustScoreRequest is the request body for AI score adjustment.
type AIAdjustScoreRequest struct {
	SubmissionID    string `json:"submission_id" binding:"required"`
	StructureAdjust int    `json:"structure_adjust"`
	BehaviorAdjust  int    `json:"behavior_adjust"`
	TotalAdjust     int    `json:"total_adjust"`
	Reason          string `json:"reason" binding:"required"`
}

// AIAdjustScore receives AI score adjustments and applies them to a submission.
func (h *AdminHandler) AIAdjustScore(c *gin.Context) {
	var req AIAdjustScoreRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	// Clamp adjustments per dimension: max +-10, total max +-15
	if req.StructureAdjust > 10 {
		req.StructureAdjust = 10
	}
	if req.StructureAdjust < -10 {
		req.StructureAdjust = -10
	}
	if req.BehaviorAdjust > 10 {
		req.BehaviorAdjust = 10
	}
	if req.BehaviorAdjust < -10 {
		req.BehaviorAdjust = -10
	}
	if req.TotalAdjust > 15 {
		req.TotalAdjust = 15
	}
	if req.TotalAdjust < -15 {
		req.TotalAdjust = -15
	}

	// Apply adjustment to submission score (clamped to [0, total_score])
	_, err := h.db.Exec(c,
		"UPDATE submissions SET ai_score_adjustment = $1, ai_score_reason = $2, "+
			"score = GREATEST(LEAST(score + $1, total_score), 0) WHERE id = $3",
		req.TotalAdjust, req.Reason, req.SubmissionID)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{
		"submission_id": req.SubmissionID,
		"adjustment":    req.TotalAdjust,
		"reason":        req.Reason,
	})
}

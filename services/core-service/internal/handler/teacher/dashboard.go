package teacher

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/middleware"
)

// ── Dashboard types ──────────────────────────────────────────────────────────

type DashboardData struct {
	ExperimentStats      []ExperimentStat  `json:"experiment_stats"`
	ScoreDistribution    []ScoreBucket     `json:"score_distribution"`
	DailySubmissions     []DailyCount      `json:"daily_submissions"`
	DifficultExperiments []ExperimentStat  `json:"difficult_experiments"`
	Overview             DashboardOverview `json:"overview"`
}

type ExperimentStat struct {
	ExperimentID      string  `json:"experiment_id"`
	Title             string  `json:"title"`
	Category          string  `json:"category"`
	TotalSubmissions  int     `json:"total_submissions"`
	PassedSubmissions int     `json:"passed_submissions"`
	PassRate          float64 `json:"pass_rate"`
	AvgScore          float64 `json:"avg_score"`
}

type ScoreBucket struct {
	Range string `json:"range"`
	Count int    `json:"count"`
}

type DailyCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type DashboardOverview struct {
	TotalStudents    int     `json:"total_students"`
	TotalSubmissions int     `json:"total_submissions"`
	TotalExperiments int     `json:"total_experiments"`
	AvgPassRate      float64 `json:"avg_pass_rate"`
}

// ── Dashboard handler ───────────────────────────────────────────────────────

type DashboardHandler struct {
	db *pgxpool.Pool
}

func NewDashboardHandler(db *pgxpool.Pool) *DashboardHandler {
	return &DashboardHandler{db: db}
}

func (h *DashboardHandler) GetDashboard(c *gin.Context) {
	userRole := middleware.GetUserRole(c)
	teacherID := middleware.GetUserID(c)

	data := DashboardData{}

	// ── Overview ──
	var ov struct {
		totalStudents    int
		totalSubmissions int
		totalExps        int
		avgPassRate      float64
	}

	if userRole == "admin" {
		h.db.QueryRow(c, `SELECT COUNT(*) FROM users WHERE role='student'`).Scan(&ov.totalStudents)
		h.db.QueryRow(c, `SELECT COUNT(*) FROM submissions`).Scan(&ov.totalSubmissions)
		h.db.QueryRow(c, `SELECT COUNT(*) FROM experiments WHERE is_published=true`).Scan(&ov.totalExps)
		h.db.QueryRow(c, `
			SELECT COALESCE(
				AVG(CASE WHEN status='completed' AND total_score>0 AND score*100.0/total_score>=60 THEN 1.0 ELSE 0.0 END),0
			)*100 FROM submissions
		`).Scan(&ov.avgPassRate)
	} else {
		h.db.QueryRow(c, `
			SELECT COUNT(DISTINCT u.id)
			FROM users u
			JOIN course_enrollments ce ON ce.student_id=u.id
			JOIN courses c2 ON c2.id=ce.course_id
			WHERE c2.teacher_id=$1 AND u.role='student'
		`, teacherID).Scan(&ov.totalStudents)
		h.db.QueryRow(c, `
			SELECT COUNT(s.id)
			FROM submissions s
			JOIN course_enrollments ce ON ce.student_id=s.student_id
			JOIN courses c2 ON c2.id=ce.course_id
			WHERE c2.teacher_id=$1
		`, teacherID).Scan(&ov.totalSubmissions)
		h.db.QueryRow(c, `
			SELECT COUNT(DISTINCT e.id)
			FROM experiments e
			JOIN submissions s ON s.experiment_id=e.id
			JOIN course_enrollments ce ON ce.student_id=s.student_id
			JOIN courses c2 ON c2.id=ce.course_id
			WHERE c2.teacher_id=$1 AND e.is_published=true
		`, teacherID).Scan(&ov.totalExps)
		h.db.QueryRow(c, `
			SELECT COALESCE(
				AVG(CASE WHEN s.status='completed' AND s.total_score>0 AND s.score*100.0/s.total_score>=60 THEN 1.0 ELSE 0.0 END),0
			)*100
			FROM submissions s
			JOIN course_enrollments ce ON ce.student_id=s.student_id
			JOIN courses c2 ON c2.id=ce.course_id
			WHERE c2.teacher_id=$1
		`, teacherID).Scan(&ov.avgPassRate)
	}
	data.Overview = DashboardOverview{
		TotalStudents:    ov.totalStudents,
		TotalSubmissions: ov.totalSubmissions,
		TotalExperiments: ov.totalExps,
		AvgPassRate:      ov.avgPassRate,
	}

	// ── Experiment stats ──
	var expQuery string
	var expArgs []interface{}

	if userRole == "admin" {
		expQuery = `
			SELECT e.id, e.title, COALESCE(e.category,''),
			       COUNT(s.id),
			       COALESCE(COUNT(CASE WHEN s.status='completed' AND s.score*100.0/NULLIF(s.total_score,0)>=60 THEN 1 END),0),
			       COALESCE(AVG(CASE WHEN s.total_score>0 AND s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0)
			FROM experiments e
			LEFT JOIN submissions s ON e.id=s.experiment_id
			WHERE e.is_published=true
			GROUP BY e.id, e.title, e.category
			ORDER BY COALESCE(AVG(CASE WHEN s.total_score>0 AND s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0) DESC NULLS LAST
		`
	} else {
		expQuery = `
			SELECT e.id, e.title, COALESCE(e.category,''),
			       COUNT(s.id),
			       COALESCE(COUNT(CASE WHEN s.status='completed' AND s.score*100.0/NULLIF(s.total_score,0)>=60 THEN 1 END),0),
			       COALESCE(AVG(CASE WHEN s.total_score>0 AND s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0)
			FROM experiments e
			LEFT JOIN submissions s ON e.id=s.experiment_id AND s.student_id IN (
				SELECT ce2.student_id FROM course_enrollments ce2
				JOIN courses c3 ON c3.id=ce2.course_id
				WHERE c3.teacher_id=$1
			)
			WHERE e.is_published=true
			GROUP BY e.id, e.title, e.category
			ORDER BY COALESCE(AVG(CASE WHEN s.total_score>0 AND s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0) DESC NULLS LAST
		`
		expArgs = append(expArgs, teacherID)
	}

	rows, err := h.db.Query(c, expQuery, expArgs...)
	if err != nil {
		log.Printf("dashboard experiment_stats: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	data.ExperimentStats = make([]ExperimentStat, 0)
	for rows.Next() {
		var es ExperimentStat
		if err := rows.Scan(&es.ExperimentID, &es.Title, &es.Category, &es.TotalSubmissions, &es.PassedSubmissions, &es.AvgScore); err == nil {
			if es.TotalSubmissions > 0 {
				es.PassRate = float64(es.PassedSubmissions) * 100.0 / float64(es.TotalSubmissions)
			}
			data.ExperimentStats = append(data.ExperimentStats, es)
		}
	}

	// ── Difficult experiments (lowest pass rate, limit 10) ──
	data.DifficultExperiments = make([]ExperimentStat, 0)
	if len(data.ExperimentStats) > 0 {
		diff := make([]ExperimentStat, len(data.ExperimentStats))
		copy(diff, data.ExperimentStats)
		for i := 0; i < len(diff); i++ {
			for j := i + 1; j < len(diff); j++ {
				if diff[i].PassRate > diff[j].PassRate {
					diff[i], diff[j] = diff[j], diff[i]
				}
			}
		}
		limit := 10
		if len(diff) < limit {
			limit = len(diff)
		}
		data.DifficultExperiments = diff[:limit]
	}

	// ── Score distribution ──
	data.ScoreDistribution = make([]ScoreBucket, 0)
	var distQuery string
	var distArgs []interface{}

	if userRole == "admin" {
		distQuery = `
			SELECT
				FLOOR((score*100.0/NULLIF(total_score,0))/10)*10 as bucket,
				COUNT(*)
			FROM submissions
			WHERE status='completed' AND total_score>0
			GROUP BY bucket
			ORDER BY bucket
		`
	} else {
		distQuery = `
			SELECT
				FLOOR((s.score*100.0/NULLIF(s.total_score,0))/10)*10 as bucket,
				COUNT(*)
			FROM submissions s
			JOIN course_enrollments ce ON ce.student_id=s.student_id
			JOIN courses c2 ON c2.id=ce.course_id
			WHERE s.status='completed' AND s.total_score>0 AND c2.teacher_id=$1
			GROUP BY bucket
			ORDER BY bucket
		`
		distArgs = append(distArgs, teacherID)
	}

	distRows, err := h.db.Query(c, distQuery, distArgs...)
	if err != nil {
		log.Printf("dashboard score_distribution: %v", err)
	} else {
		defer distRows.Close()
		bucketMap := make(map[int]int)
		for distRows.Next() {
			var bucket float64
			var count int
			if err := distRows.Scan(&bucket, &count); err == nil {
				bucketMap[int(bucket)] += count
			}
		}
		data.ScoreDistribution = make([]ScoreBucket, 0, 10)
		for b := 0; b <= 90; b += 10 {
			label := ""
			if b == 90 {
				label = "90-100"
			} else {
				label = fmt.Sprintf("%d-%d", b, b+9)
			}
			data.ScoreDistribution = append(data.ScoreDistribution, ScoreBucket{Range: label, Count: bucketMap[b]})
		}
	}

	// ── Daily submissions (last 30 days) ──
	data.DailySubmissions = make([]DailyCount, 0)
	var dailyQuery string
	var dailyArgs []interface{}

	if userRole == "admin" {
		dailyQuery = `
			SELECT DATE(created_at) as day, COUNT(*)
			FROM submissions
			WHERE created_at > NOW() - INTERVAL '30 days'
			GROUP BY day
			ORDER BY day
		`
	} else {
		dailyQuery = `
			SELECT DATE(s.created_at) as day, COUNT(*)
			FROM submissions s
			JOIN course_enrollments ce ON ce.student_id=s.student_id
			JOIN courses c2 ON c2.id=ce.course_id
			WHERE s.created_at > NOW() - INTERVAL '30 days' AND c2.teacher_id=$1
			GROUP BY day
			ORDER BY day
		`
		dailyArgs = append(dailyArgs, teacherID)
	}

	dailyRows, err := h.db.Query(c, dailyQuery, dailyArgs...)
	if err != nil {
		log.Printf("dashboard daily_submissions: %v", err)
	} else {
		defer dailyRows.Close()
		data.DailySubmissions = make([]DailyCount, 0)
		for dailyRows.Next() {
			var dc DailyCount
			var day time.Time
			if err := dailyRows.Scan(&day, &dc.Count); err == nil {
				dc.Date = day.Format("2006-01-02")
				data.DailySubmissions = append(data.DailySubmissions, dc)
			}
		}
	}

	c.JSON(http.StatusOK, data)
}

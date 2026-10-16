package teacher

import (
	"encoding/csv"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/middleware"
	"golang.org/x/crypto/bcrypt"
)

type StatsHandler struct {
	db *pgxpool.Pool
}

func NewStatsHandler(db *pgxpool.Pool) *StatsHandler {
	return &StatsHandler{db: db}
}

func (h *StatsHandler) isAdmin(c *gin.Context) bool {
	return middleware.GetUserRole(c) == "admin"
}

func (h *StatsHandler) teacherID(c *gin.Context) string {
	return middleware.GetUserID(c)
}

func (h *StatsHandler) GetOverview(c *gin.Context) {
	if h.isAdmin(c) {
		h.adminOverview(c)
	} else {
		h.teacherOverview(c)
	}
}

type courseRow struct {
	ID, Name  string
	Stu, Sub, Act int
	Avg float64
}

type courseExpRow struct {
	CID, CName, EID, ETitle *string
	Subs, Passed int
	Avg float64
}

type expRow struct {
	ID, Title    string
	Subs, Passed int
	Avg float64
}

func (h *StatsHandler) adminOverview(c *gin.Context) {
	var ts, tsubs, ta int
	var ga float64
	h.db.QueryRow(c, `SELECT COUNT(*) FROM users WHERE role='student'`).Scan(&ts)
	h.db.QueryRow(c, `SELECT COUNT(*) FROM submissions`).Scan(&tsubs)
	h.db.QueryRow(c, `SELECT COALESCE(AVG(score*100.0/NULLIF(total_score,0)),0) FROM submissions WHERE status='completed'`).Scan(&ga)
	h.db.QueryRow(c, `SELECT COUNT(DISTINCT student_id) FROM submissions WHERE created_at>NOW()-INTERVAL'7 days'`).Scan(&ta)

	r, _ := h.db.Query(c, `
		SELECT c.id, c.name, COUNT(DISTINCT ce.student_id), COUNT(s2.id),
		       COALESCE(AVG(CASE WHEN s2.status='completed' THEN s2.score*100.0/NULLIF(s2.total_score,0) END),0),
		       COUNT(DISTINCT CASE WHEN s2.created_at>NOW()-INTERVAL'7 days' THEN s2.student_id END)
		FROM courses c
		LEFT JOIN course_enrollments ce ON ce.course_id=c.id
		LEFT JOIN submissions s2 ON s2.student_id=ce.student_id
		WHERE c.is_published=true GROUP BY c.id, c.name ORDER BY c.name
	`)
	var courses []gin.H
	if r != nil { defer r.Close(); for r.Next() { var cr courseRow; if r.Scan(&cr.ID, &cr.Name, &cr.Stu, &cr.Sub, &cr.Avg, &cr.Act) == nil { courses = append(courses, gin.H{"course_id":cr.ID,"course_name":cr.Name,"student_count":cr.Stu,"submission_count":cr.Sub,"average_score":fmt.Sprintf("%.1f",cr.Avg),"active_students":cr.Act}) } } }

	er, _ := h.db.Query(c, `
		SELECT c.id, c.name, e.id, e.title,
		       COUNT(s.id),
		       COALESCE(COUNT(CASE WHEN s.status='completed' AND s.score>0 THEN 1 END),0),
		       COALESCE(AVG(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0)
		FROM experiments e
		LEFT JOIN submissions s ON s.experiment_id=e.id
		LEFT JOIN course_enrollments ce ON ce.student_id=s.student_id
		LEFT JOIN courses c ON c.id=ce.course_id
		WHERE e.is_published=true
		GROUP BY c.id, c.name, e.id, e.title
		ORDER BY COALESCE(c.name,'zzz'), e.created_at
	`)
	var ces []gin.H
	if er != nil { defer er.Close(); for er.Next() { var cr courseExpRow; if er.Scan(&cr.CID, &cr.CName, &cr.EID, &cr.ETitle, &cr.Subs, &cr.Passed, &cr.Avg) == nil { cid := ""; cn := "未分班"; if cr.CID != nil { cid = *cr.CID }; if cr.CName != nil { cn = *cr.CName }; eid := ""; et := ""; if cr.EID != nil { eid = *cr.EID }; if cr.ETitle != nil { et = *cr.ETitle }; pr := 0.0; if cr.Subs > 0 { pr = float64(cr.Passed) * 100.0 / float64(cr.Subs) }; ces = append(ces, gin.H{"course_id":cid,"course_name":cn,"id":eid,"title":et,"total_submissions":cr.Subs,"passed":cr.Passed,"avg_score":cr.Avg,"pass_rate":pr}) } } }

	er2, _ := h.db.Query(c, `
		SELECT e.id, e.title, COUNT(s.id),
		       COALESCE(COUNT(CASE WHEN s.status='completed' AND s.score>0 THEN 1 END),0),
		       COALESCE(AVG(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0)
		FROM experiments e LEFT JOIN submissions s ON s.experiment_id=e.id
		WHERE e.is_published=true GROUP BY e.id, e.title ORDER BY e.created_at
	`)
	var flat []gin.H
	if er2 != nil { defer er2.Close(); for er2.Next() { var er expRow; if er2.Scan(&er.ID, &er.Title, &er.Subs, &er.Passed, &er.Avg) == nil { pr := 0.0; if er.Subs > 0 { pr = float64(er.Passed) * 100.0 / float64(er.Subs) }; flat = append(flat, gin.H{"id":er.ID,"title":er.Title,"total_submissions":er.Subs,"passed":er.Passed,"avg_score":er.Avg,"pass_rate":pr}) } } }

	c.JSON(http.StatusOK, gin.H{
		"total_students": ts, "total_submissions": tsubs, "average_score": fmt.Sprintf("%.1f", ga),
		"active_students": ta, "course_stats": courses, "course_experiment_stats": ces, "experiment_stats": flat,
	})
}

func (h *StatsHandler) teacherOverview(c *gin.Context) {
	tid := h.teacherID(c)
	var ts, tsubs, ta int
	var ga float64
	h.db.QueryRow(c, `SELECT COUNT(DISTINCT u.id) FROM users u JOIN course_enrollments ce ON ce.student_id=u.id JOIN courses c ON c.id=ce.course_id WHERE c.teacher_id=$1 AND u.role='student'`, tid).Scan(&ts)
	h.db.QueryRow(c, `SELECT COUNT(s.id) FROM submissions s JOIN course_enrollments ce ON ce.student_id=s.student_id JOIN courses c ON c.id=ce.course_id WHERE c.teacher_id=$1`, tid).Scan(&tsubs)
	h.db.QueryRow(c, `SELECT COALESCE(AVG(s.score*100.0/NULLIF(s.total_score,0)),0) FROM submissions s JOIN course_enrollments ce ON ce.student_id=s.student_id JOIN courses c ON c.id=ce.course_id WHERE c.teacher_id=$1 AND s.status='completed'`, tid).Scan(&ga)
	h.db.QueryRow(c, `SELECT COUNT(DISTINCT s.student_id) FROM submissions s JOIN course_enrollments ce ON ce.student_id=s.student_id JOIN courses c ON c.id=ce.course_id WHERE c.teacher_id=$1 AND s.created_at>NOW()-INTERVAL'7 days'`, tid).Scan(&ta)

	r, _ := h.db.Query(c, `
		SELECT c.id, c.name, COUNT(DISTINCT ce.student_id), COUNT(s2.id),
		       COALESCE(AVG(CASE WHEN s2.status='completed' THEN s2.score*100.0/NULLIF(s2.total_score,0) END),0),
		       COUNT(DISTINCT CASE WHEN s2.created_at>NOW()-INTERVAL'7 days' THEN s2.student_id END)
		FROM courses c LEFT JOIN course_enrollments ce ON ce.course_id=c.id LEFT JOIN submissions s2 ON s2.student_id=ce.student_id
		WHERE c.teacher_id=$1 GROUP BY c.id, c.name ORDER BY c.name
	`, tid)
	var courses []gin.H
	if r != nil { defer r.Close(); for r.Next() { var cr courseRow; if r.Scan(&cr.ID, &cr.Name, &cr.Stu, &cr.Sub, &cr.Avg, &cr.Act) == nil { courses = append(courses, gin.H{"course_id":cr.ID,"course_name":cr.Name,"student_count":cr.Stu,"submission_count":cr.Sub,"average_score":fmt.Sprintf("%.1f",cr.Avg),"active_students":cr.Act}) } } }

	er, err := h.db.Query(c, `
		SELECT c.id, c.name, e.id, e.title, COUNT(s.id),
		       COALESCE(COUNT(CASE WHEN s.status='completed' AND s.score>0 THEN 1 END),0),
		       COALESCE(AVG(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0)
		FROM experiments e
		JOIN submissions s ON s.experiment_id=e.id
		JOIN course_enrollments ce ON ce.student_id=s.student_id
		JOIN courses c ON c.id=ce.course_id AND c.teacher_id=$1
		WHERE e.is_published=true
		GROUP BY c.id, c.name, e.id, e.title ORDER BY c.name, e.created_at
	`, tid)
	var ces []gin.H
	if err != nil { log.Printf("teacherOverview per-course exp: %v", err) } else { defer er.Close(); for er.Next() { var cr courseExpRow; if er.Scan(&cr.CID, &cr.CName, &cr.EID, &cr.ETitle, &cr.Subs, &cr.Passed, &cr.Avg) == nil { cid := ""; cn := ""; if cr.CID != nil { cid = *cr.CID }; if cr.CName != nil { cn = *cr.CName }; eid := ""; et := ""; if cr.EID != nil { eid = *cr.EID }; if cr.ETitle != nil { et = *cr.ETitle }; pr := 0.0; if cr.Subs > 0 { pr = float64(cr.Passed) * 100.0 / float64(cr.Subs) }; ces = append(ces, gin.H{"course_id":cid,"course_name":cn,"id":eid,"title":et,"total_submissions":cr.Subs,"passed":cr.Passed,"avg_score":cr.Avg,"pass_rate":pr}) } } }

	er2, err2 := h.db.Query(c, `
		SELECT e.id, e.title, COUNT(s.id),
		       COALESCE(COUNT(CASE WHEN s.status='completed' AND s.score>0 THEN 1 END),0),
		       COALESCE(AVG(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0)
		FROM experiments e
		JOIN submissions s ON s.experiment_id=e.id
		JOIN course_enrollments ce ON ce.student_id=s.student_id
		JOIN courses c ON c.id=ce.course_id AND c.teacher_id=$1
		WHERE e.is_published=true
		GROUP BY e.id, e.title ORDER BY e.created_at
	`, tid)
	var flat []gin.H
	if err2 != nil { log.Printf("teacherOverview flat: %v", err2) } else { defer er2.Close(); for er2.Next() { var er expRow; if er2.Scan(&er.ID, &er.Title, &er.Subs, &er.Passed, &er.Avg) == nil { pr := 0.0; if er.Subs > 0 { pr = float64(er.Passed) * 100.0 / float64(er.Subs) }; flat = append(flat, gin.H{"id":er.ID,"title":er.Title,"total_submissions":er.Subs,"passed":er.Passed,"avg_score":er.Avg,"pass_rate":pr}) } } }

	c.JSON(http.StatusOK, gin.H{
		"total_students": ts, "total_submissions": tsubs, "average_score": fmt.Sprintf("%.1f", ga),
		"active_students": ta, "course_stats": courses, "course_experiment_stats": ces, "experiment_stats": flat,
	})
}

func (h *StatsHandler) GetTopErrors(c *gin.Context) {
	days, _ := strconv.Atoi(c.DefaultQuery("days", "30"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	type EC struct{ ErrorType string `json:"error_type"`; Count int `json:"count"` }
	var r []EC
	if h.isAdmin(c) {
		rows, err := h.db.Query(c, `SELECT d.error_type,COUNT(*) FROM diagnoses d WHERE d.created_at>NOW()-make_interval(days=>$1) GROUP BY d.error_type ORDER BY COUNT(*) DESC LIMIT $2`, days, limit)
		if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
		defer rows.Close()
		for rows.Next() { var e EC; if rows.Scan(&e.ErrorType, &e.Count) == nil { r = append(r, e) } }
	} else {
		tid := h.teacherID(c)
		rows, err := h.db.Query(c, `SELECT d.error_type,COUNT(*) FROM diagnoses d JOIN submissions s ON s.id=d.submission_id JOIN course_enrollments ce ON ce.student_id=s.student_id JOIN courses c2 ON c2.id=ce.course_id AND c2.teacher_id=$1 WHERE d.created_at>NOW()-make_interval(days=>$2) GROUP BY d.error_type ORDER BY COUNT(*) DESC LIMIT $3`, tid, days, limit)
		if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
		defer rows.Close()
		for rows.Next() { var e EC; if rows.Scan(&e.ErrorType, &e.Count) == nil { r = append(r, e) } }
	}
	c.JSON(200, gin.H{"errors": r})
}

func (h *StatsHandler) GetErrorHeatmap(c *gin.Context) {
	type HE struct{ Experiment, ErrorType string; Count int `json:"count"` }
	var r []HE
	if h.isAdmin(c) {
		rows, err := h.db.Query(c, `SELECT e.title,d.error_type,COUNT(*) FROM diagnoses d JOIN submissions s ON s.id=d.submission_id JOIN experiments e ON e.id=s.experiment_id GROUP BY e.title,d.error_type ORDER BY COUNT(*) DESC`)
		if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
		defer rows.Close()
		for rows.Next() { var h HE; if rows.Scan(&h.Experiment, &h.ErrorType, &h.Count) == nil { r = append(r, h) } }
	} else {
		tid := h.teacherID(c)
		rows, err := h.db.Query(c, `SELECT e.title,d.error_type,COUNT(*) FROM diagnoses d JOIN submissions s ON s.id=d.submission_id JOIN experiments e ON e.id=s.experiment_id JOIN course_enrollments ce ON ce.student_id=s.student_id JOIN courses c2 ON c2.id=ce.course_id AND c2.teacher_id=$1 GROUP BY e.title,d.error_type ORDER BY COUNT(*) DESC`, tid)
		if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
		defer rows.Close()
		for rows.Next() { var h HE; if rows.Scan(&h.Experiment, &h.ErrorType, &h.Count) == nil { r = append(r, h) } }
	}
	c.JSON(200, gin.H{"heatmap": r})
}

func (h *StatsHandler) GetCommonIssues(c *gin.Context) {
	type IS struct{ ErrorType, Experiment string; Count int `json:"count"` }
	var r []IS
	if h.isAdmin(c) {
		rows, err := h.db.Query(c, `SELECT d.error_type,e.title,COUNT(*) FROM diagnoses d JOIN submissions s ON s.id=d.submission_id JOIN experiments e ON e.id=s.experiment_id GROUP BY d.error_type,e.title HAVING COUNT(*)>=5 ORDER BY COUNT(*) DESC`)
		if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
		defer rows.Close()
		for rows.Next() { var i IS; if rows.Scan(&i.ErrorType, &i.Experiment, &i.Count) == nil { r = append(r, i) } }
	} else {
		tid := h.teacherID(c)
		rows, err := h.db.Query(c, `SELECT d.error_type,e.title,COUNT(*) FROM diagnoses d JOIN submissions s ON s.id=d.submission_id JOIN experiments e ON e.id=s.experiment_id JOIN course_enrollments ce ON ce.student_id=s.student_id JOIN courses c2 ON c2.id=ce.course_id AND c2.teacher_id=$1 GROUP BY d.error_type,e.title HAVING COUNT(*)>=5 ORDER BY COUNT(*) DESC`, tid)
		if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
		defer rows.Close()
		for rows.Next() { var i IS; if rows.Scan(&i.ErrorType, &i.Experiment, &i.Count) == nil { r = append(r, i) } }
	}
	c.JSON(200, gin.H{"issues": r})
}

func (h *StatsHandler) GetStudents(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 { page = 1 }
	q := c.Query("q")

	var total int
	type SI struct{
		ID string `json:"id"`; Username string `json:"username"`; Email string `json:"email"`
		FullName *string `json:"full_name,omitempty"`; IsActive bool `json:"is_active"`
		LastLoginAt *time.Time `json:"last_login_at,omitempty"`; CreatedAt time.Time `json:"created_at"`
		TotalSubmissions int `json:"total_submissions"`; AvgScore float64 `json:"avg_score"`
		BestScore float64 `json:"best_score"`; CourseNames *string `json:"course_names,omitempty"`
		StudentNo *string `json:"student_no,omitempty"`; ClassName *string `json:"class_name,omitempty"`
		IsOnline bool `json:"is_online"`
	}
	scanRow := func(rows pgx.Rows, s *SI) error {
		return rows.Scan(&s.ID, &s.Username, &s.FullName, &s.Email, &s.IsActive, &s.LastLoginAt, &s.CreatedAt,
			&s.StudentNo, &s.ClassName, &s.TotalSubmissions, &s.AvgScore, &s.BestScore, &s.CourseNames, &s.IsOnline)
	}
	var st []SI

	if h.isAdmin(c) {
		var args []interface{}
		where := []string{"u.role='student'"}
		idx := 1
		if q != "" {
			where = append(where, fmt.Sprintf("(u.username ILIKE $%d OR u.email ILIKE $%d OR COALESCE(u.full_name,'') ILIKE $%d)", idx, idx, idx))
			args = append(args, "%"+q+"%"); idx++
		}
		whereSQL := strings.Join(where, " AND ")
		h.db.QueryRow(c, fmt.Sprintf("SELECT COUNT(DISTINCT u.id) FROM users u WHERE %s", whereSQL), args...).Scan(&total)
		args = append(args, pageSize, (page-1)*pageSize)
		rows, err := h.db.Query(c, fmt.Sprintf(`
			SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.last_login_at, u.created_at,
			       u.student_no, u.class_name,
			       COUNT(DISTINCT s.id),
			       COALESCE(AVG(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0),
			       COALESCE(MAX(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0),
			       COALESCE(STRING_AGG(DISTINCT c.name, ', '), ''),
			       (u.last_login_at IS NOT NULL AND u.last_login_at > NOW() - INTERVAL '15 minutes')
			FROM users u
			LEFT JOIN submissions s ON s.student_id=u.id
			LEFT JOIN course_enrollments ce ON ce.student_id=u.id
			LEFT JOIN courses c ON c.id=ce.course_id
			WHERE %s
			GROUP BY u.id
			ORDER BY u.username
			LIMIT $%d OFFSET $%d
		`, whereSQL, idx, idx+1), args...)
		if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
		defer rows.Close()
		for rows.Next() {
			var s SI
			if scanRow(rows, &s) == nil { st = append(st, s) }
		}
	} else {
		tid := h.teacherID(c)
		// Prefer teaching_classes scoping; fallback to course enrollment.
		var classes []string
		_ = h.db.QueryRow(c, `SELECT teaching_classes FROM users WHERE id = $1`, tid).Scan(&classes)
		var args []interface{}
		where := []string{"u.role='student'"}
		idx := 1
		if len(classes) > 0 {
			where = append(where, fmt.Sprintf("u.class_name = ANY($%d)", idx))
			args = append(args, classes); idx++
		} else {
			where = append(where, fmt.Sprintf(`u.id IN (SELECT ce.student_id FROM course_enrollments ce JOIN courses c2 ON c2.id=ce.course_id WHERE c2.teacher_id=$%d)`, idx))
			args = append(args, tid); idx++
		}
		if q != "" {
			where = append(where, fmt.Sprintf("(u.username ILIKE $%d OR u.email ILIKE $%d OR COALESCE(u.full_name,'') ILIKE $%d)", idx, idx, idx))
			args = append(args, "%"+q+"%"); idx++
		}
		whereSQL := strings.Join(where, " AND ")
		h.db.QueryRow(c, fmt.Sprintf("SELECT COUNT(DISTINCT u.id) FROM users u WHERE %s", whereSQL), args...).Scan(&total)
		args = append(args, pageSize, (page-1)*pageSize)
		rows, err := h.db.Query(c, fmt.Sprintf(`
			SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.last_login_at, u.created_at,
			       u.student_no, u.class_name,
			       COUNT(DISTINCT s.id),
			       COALESCE(AVG(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0),
			       COALESCE(MAX(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0),
			       COALESCE(STRING_AGG(DISTINCT c.name, ', '), ''),
			       (u.last_login_at IS NOT NULL AND u.last_login_at > NOW() - INTERVAL '15 minutes')
			FROM users u
			LEFT JOIN submissions s ON s.student_id=u.id
			LEFT JOIN course_enrollments ce ON ce.student_id=u.id
			LEFT JOIN courses c ON c.id=ce.course_id
			WHERE %s
			GROUP BY u.id
			ORDER BY u.username
			LIMIT $%d OFFSET $%d
		`, whereSQL, idx, idx+1), args...)
		if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
		defer rows.Close()
		for rows.Next() {
			var s SI
			if scanRow(rows, &s) == nil { st = append(st, s) }
		}
	}

	if st == nil { st = []SI{} }
	c.JSON(200, gin.H{"data": st, "total": total, "page": page, "page_size": pageSize, "total_pages": (total + pageSize - 1) / pageSize})
}


func (h *StatsHandler) GetStudentDetail(c *gin.Context) {
	sid := c.Param("id")
	if !h.isAdmin(c) {
		tid := h.teacherID(c); var cnt int
		if err := h.db.QueryRow(c, `SELECT COUNT(*) FROM course_enrollments ce JOIN courses c2 ON c2.id=ce.course_id WHERE ce.student_id=$1 AND c2.teacher_id=$2`, sid, tid).Scan(&cnt); err != nil || cnt == 0 { c.JSON(403, gin.H{"error": "access denied"}); return }
	}
	var su struct{ ID, Username, Email string; FullName *string `json:"full_name,omitempty"`; IsActive bool `json:"is_active"`; LastLoginAt *time.Time `json:"last_login_at,omitempty"`; CreatedAt time.Time `json:"created_at"` }
	if err := h.db.QueryRow(c, `SELECT id,username,full_name,email,is_active,last_login_at,created_at FROM users WHERE id=$1 AND role='student'`, sid).Scan(&su.ID, &su.Username, &su.FullName, &su.Email, &su.IsActive, &su.LastLoginAt, &su.CreatedAt); err != nil { c.JSON(404, gin.H{"error": "student not found"}); return }
	type EP struct{ Experiment string `json:"experiment"`; BestScore float64 `json:"best_score"`; TotalSubmissions int `json:"total_submissions"`; LastSubmissionAt *time.Time `json:"last_submission_at,omitempty"` }
	var pr []EP
	r2, err := h.db.Query(c, `SELECT e.title,COALESCE(MAX(CASE WHEN sub.status='completed' THEN sub.score*100.0/NULLIF(sub.total_score,0) END),0),COUNT(sub.id),COALESCE(MAX(sub.created_at),NULL) FROM experiments e LEFT JOIN submissions sub ON sub.experiment_id=e.id AND sub.student_id=$1 WHERE e.is_published=true GROUP BY e.id,e.title ORDER BY e.created_at`, sid)
	if err != nil { log.Printf("GetStudentDetail: %v", err) } else { defer r2.Close(); for r2.Next() { var p EP; if r2.Scan(&p.Experiment, &p.BestScore, &p.TotalSubmissions, &p.LastSubmissionAt) == nil { pr = append(pr, p) } } }
	var crs []map[string]string
	cr, _ := h.db.Query(c, `SELECT c.id,c.name FROM courses c JOIN course_enrollments ce ON ce.course_id=c.id WHERE ce.student_id=$1`, sid)
	if cr != nil { defer cr.Close(); for cr.Next() { var ci, cn string; if cr.Scan(&ci, &cn) == nil { crs = append(crs, map[string]string{"id": ci, "name": cn}) } } }
	c.JSON(200, gin.H{"student": su, "progress": pr, "courses": crs})
}

func (h *StatsHandler) ExportData(c *gin.Context) {
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=traceos-export-%s.csv", time.Now().Format("20060102-150405")))
	c.Header("Cache-Control", "no-cache")
	c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})
	w := csv.NewWriter(c.Writer)
	w.Write([]string{"username", "full_name", "email", "total_submissions", "avg_score", "best_score"})
	wr := func(rows pgx.Rows) { for rows.Next() { var un, em string; var fn *string; var ts int; var as, bs float64; if rows.Scan(&un, &fn, &em, &ts, &as, &bs) == nil { f := ""; if fn != nil { f = *fn }; w.Write([]string{un, f, em, strconv.Itoa(ts), fmt.Sprintf("%.1f", as), fmt.Sprintf("%.1f", bs)}) } } }
	if h.isAdmin(c) {
		rows, err := h.db.Query(c, `SELECT u.username,u.full_name,u.email,COUNT(s.id),COALESCE(AVG(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0),COALESCE(MAX(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0) FROM users u LEFT JOIN submissions s ON s.student_id=u.id WHERE u.role='student' GROUP BY u.id,u.username,u.full_name,u.email ORDER BY u.username`)
		if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
		defer rows.Close(); wr(rows)
	} else {
		tid := h.teacherID(c)
		rows, err := h.db.Query(c, `SELECT u.username,u.full_name,u.email,COUNT(s.id),COALESCE(AVG(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0),COALESCE(MAX(CASE WHEN s.status='completed' THEN s.score*100.0/NULLIF(s.total_score,0) END),0) FROM users u JOIN course_enrollments ce ON ce.student_id=u.id JOIN courses c2 ON c2.id=ce.course_id AND c2.teacher_id=$1 LEFT JOIN submissions s ON s.student_id=u.id WHERE u.role='student' GROUP BY u.id,u.username,u.full_name,u.email ORDER BY u.username`, tid)
		if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
		defer rows.Close(); wr(rows)
	}
	w.Flush()
}


// ResetStudentPassword PUT /teacher/students/:id/password
// Allows a teacher to reset the password of a student they manage (by class).
func (h *StatsHandler) ResetStudentPassword(c *gin.Context) {
	sid := c.Param("id")
	var req struct {
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据格式不正确"})
		return
	}
	if len(req.Password) < 6 || len(req.Password) > 128 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "密码需为 6-128 个字符"})
		return
	}

	if h.isAdmin(c) {
		// admin: allow via admin endpoints instead; but if used, verify student exists
		var cnt int
		if err := h.db.QueryRow(c, `SELECT COUNT(*) FROM users WHERE id=$1 AND role='student'`, sid).Scan(&cnt); err != nil || cnt == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "学生不存在"})
			return
		}
	} else {
		tid := h.teacherID(c)
		var classes []string
		if err := h.db.QueryRow(c, `SELECT teaching_classes FROM users WHERE id=$1`, tid).Scan(&classes); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"error": "无法验证权限"})
			return
		}
		var ok bool
		if len(classes) > 0 {
			var cn *string
			_ = h.db.QueryRow(c, `SELECT class_name FROM users WHERE id=$1 AND role='student'`, sid).Scan(&cn)
			if cn != nil {
				for _, cl := range classes {
					if cl == *cn { ok = true; break }
				}
			}
		} else {
			// fallback: course enrollment ownership
			var cnt int
			_ = h.db.QueryRow(c, `SELECT COUNT(*) FROM course_enrollments ce JOIN courses c2 ON c2.id=ce.course_id WHERE ce.student_id=$1 AND c2.teacher_id=$2`, sid, tid).Scan(&cnt)
			ok = cnt > 0
		}
		if !ok {
			c.JSON(http.StatusForbidden, gin.H{"error": "无权操作该学生"})
			return
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}
	if _, err := h.db.Exec(c, `UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2`, string(hash), sid); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": sid, "reset": true})
}

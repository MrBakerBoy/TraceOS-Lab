package teacher

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// 教学分析是聚合结果，无需秒级新鲜度；缓存降低每次刷新对 AI 服务的同步依赖。
	aiAnalysisCacheTTL = 5 * time.Minute
	// 外部 AI 调用是首屏之外的辅助数据，缩短超时避免请求被长尾 LLM 拖住。
	aiServiceTimeout = 15 * time.Second
)

type AIAnalysisHandler struct {
	db *pgxpool.Pool

	mu       sync.RWMutex
	cache    gin.H
	cachedAt time.Time

	buildMu sync.Mutex
}

func NewAIAnalysisHandler(db *pgxpool.Pool) *AIAnalysisHandler {
	return &AIAnalysisHandler{db: db}
}

type diagnosisItem struct {
	ErrorType       string `json:"error_type"`
	Severity        string `json:"severity"`
	RootCause       string `json:"root_cause"`
	ExperimentTitle string `json:"experiment_title"`
	StudentName     string `json:"student_name"`
}

type classAnalysisRequest struct {
	Diagnoses        []diagnosisItem `json:"diagnoses"`
	TotalStudents    int             `json:"total_students"`
	TotalSubmissions int             `json:"total_submissions"`
	AverageScore     float64         `json:"average_score"`
}

type classAnalysisResponse struct {
	Summary                string   `json:"summary"`
	ErrorPatterns          []string `json:"error_patterns"`
	TeachingSuggestions    []string `json:"teaching_suggestions"`
	ChallengingExperiments []string `json:"challenging_experiments"`
}

func (h *AIAnalysisHandler) GetAIAnalysis(c *gin.Context) {
	if h.serveCached(c) {
		return
	}

	// 串行化构建：并发 miss 时只触发一次 AI 调用，避免重复消耗。
	h.buildMu.Lock()
	defer h.buildMu.Unlock()
	if h.serveCached(c) {
		return
	}

	ctx, cancel := context.WithTimeout(c, aiServiceTimeout+5*time.Second)
	defer cancel()

	payload, err := h.buildAnalysis(ctx)
	if err != nil {
		log.Printf("GetAIAnalysis: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to aggregate diagnoses"})
		return
	}

	h.mu.Lock()
	h.cache = payload
	h.cachedAt = time.Now()
	h.mu.Unlock()

	c.JSON(http.StatusOK, payload)
}

func (h *AIAnalysisHandler) serveCached(c *gin.Context) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.cache == nil || time.Since(h.cachedAt) >= aiAnalysisCacheTTL {
		return false
	}
	c.JSON(http.StatusOK, h.cache)
	return true
}

func (h *AIAnalysisHandler) buildAnalysis(ctx context.Context) (gin.H, error) {
	// 1. Aggregate diagnosis data
	diagnoses, err := h.aggregateDiagnoses(ctx)
	if err != nil {
		return nil, fmt.Errorf("aggregate diagnoses: %w", err)
	}

	// 2. Get stats
	var totalStudents, totalSubmissions int
	var avgScore float64
	h.db.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE role = 'student'`).Scan(&totalStudents)
	h.db.QueryRow(ctx, `SELECT COUNT(*) FROM submissions`).Scan(&totalSubmissions)
	h.db.QueryRow(ctx, `SELECT COALESCE(AVG(score * 100.0 / NULLIF(total_score, 0)), 0) FROM submissions WHERE status = 'completed'`).Scan(&avgScore)

	// 3. Call AI service
	reqBody := classAnalysisRequest{
		Diagnoses:        diagnoses,
		TotalStudents:    totalStudents,
		TotalSubmissions: totalSubmissions,
		AverageScore:     avgScore,
	}

	aiURL := os.Getenv("AI_SERVICE_URL")
	if aiURL == "" {
		aiURL = "http://ai-service:8000"
	}

	body, _ := json.Marshal(reqBody)
	client := &http.Client{Timeout: aiServiceTimeout}
	resp, err := client.Post(
		fmt.Sprintf("%s/api/ai/analyze-class", aiURL),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		log.Printf("GetAIAnalysis: call AI service: %v", err)
		return fallbackAnalysis(diagnoses, totalStudents, totalSubmissions, avgScore), nil
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		log.Printf("GetAIAnalysis: AI service returned %d: %s", resp.StatusCode, string(respBody))
		return fallbackAnalysis(diagnoses, totalStudents, totalSubmissions, avgScore), nil
	}

	var analysis classAnalysisResponse
	if err := json.Unmarshal(respBody, &analysis); err != nil {
		log.Printf("GetAIAnalysis: parse response: %v", err)
		return fallbackAnalysis(diagnoses, totalStudents, totalSubmissions, avgScore), nil
	}

	return gin.H{
		"analysis":          analysis,
		"total_students":    totalStudents,
		"total_submissions": totalSubmissions,
		"average_score":     fmt.Sprintf("%.1f", avgScore),
		"diagnosis_count":   len(diagnoses),
	}, nil
}

func (h *AIAnalysisHandler) aggregateDiagnoses(ctx context.Context) ([]diagnosisItem, error) {
	rows, err := h.db.Query(ctx, `
		SELECT COALESCE(d.error_type, '') AS error_type,
		       COALESCE(d.severity, '') AS severity,
		       COALESCE(d.root_cause, '') AS root_cause,
		       COALESCE(e.title, '') AS experiment_title,
		       COALESCE(u.username, '') AS student_name
		FROM diagnoses d
		LEFT JOIN submissions s ON s.id = d.submission_id
		LEFT JOIN experiments e ON e.id = s.experiment_id
		LEFT JOIN users u ON u.id = d.student_id
		WHERE d.status = 'completed'
		ORDER BY d.created_at DESC
		LIMIT 200
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []diagnosisItem
	for rows.Next() {
		var d diagnosisItem
		if err := rows.Scan(&d.ErrorType, &d.Severity, &d.RootCause, &d.ExperimentTitle, &d.StudentName); err != nil {
			continue
		}
		items = append(items, d)
	}
	return items, nil
}

func fallbackAnalysis(diagnoses []diagnosisItem, totalStudents, totalSubmissions int, avgScore float64) gin.H {
	errorCounts := make(map[string]int)
	expCounts := make(map[string]int)
	for _, d := range diagnoses {
		if d.ErrorType != "" {
			errorCounts[d.ErrorType]++
		}
		if d.ExperimentTitle != "" {
			expCounts[d.ExperimentTitle]++
		}
	}

	var errorPatterns []string
	for t, c := range errorCounts {
		errorPatterns = append(errorPatterns, fmt.Sprintf("%s (%d次)", t, c))
	}
	var challenging []string
	for t, c := range expCounts {
		challenging = append(challenging, fmt.Sprintf("%s (%d次错误)", t, c))
	}

	return gin.H{
		"analysis": gin.H{
			"summary":                 fmt.Sprintf("共 %d 条诊断记录，AI 分析暂时不可用，已展示统计数据。", len(diagnoses)),
			"error_patterns":          errorPatterns,
			"teaching_suggestions":    []string{"建议重点关注高频错误类型，针对性地进行课堂讲解。"},
			"challenging_experiments": challenging,
		},
		"total_students":    totalStudents,
		"total_submissions": totalSubmissions,
		"average_score":     fmt.Sprintf("%.1f", avgScore),
		"diagnosis_count":   len(diagnoses),
	}
}

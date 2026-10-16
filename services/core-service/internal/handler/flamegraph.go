package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/evaluator"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/repository"
)

// FlameGraphHandler handles flame graph generation and retrieval for submissions.
type FlameGraphHandler struct {
	subRepo           *repository.SubmissionRepo
	expRepo           *repository.ExperimentRepo
	flamegraphService string // URL of host-side flame graph server
	cacheHandler      *ExperimentCacheHandler
}

// NewFlameGraphHandler creates a new FlameGraphHandler.
func NewFlameGraphHandler(subRepo *repository.SubmissionRepo, expRepo *repository.ExperimentRepo, flamegraphService string, cacheHandler *ExperimentCacheHandler) *FlameGraphHandler {
	return &FlameGraphHandler{
		subRepo:           subRepo,
		expRepo:           expRepo,
		flamegraphService: flamegraphService,
		cacheHandler:      cacheHandler,
	}
}

// flamegraphRequest is the request sent to the host-side flame graph server.
type flamegraphRequest struct {
	Code         string   `json:"code"`
	Language     string   `json:"language"`
	CompileFlags []string `json:"compile_flags"`
	Duration     int      `json:"duration"`
}

// flamegraphResponse is the response from the host-side flame graph server.
type flamegraphResponse struct {
	Success       bool                `json:"success"`
	Error         string              `json:"error,omitempty"`
	UserSVG       string              `json:"user_svg,omitempty"`
	KernelSVG     string              `json:"kernel_svg,omitempty"`
	HasUser       bool                `json:"has_user"`
	HasKernel     bool                `json:"has_kernel"`
	ElapsedSec    float64             `json:"elapsed_sec"`
	Summary       string              `json:"summary,omitempty"`
	HotFunctions  []flamegraphHotFunc `json:"hot_functions,omitempty"`
	UserPercent   float64             `json:"user_percent"`
	KernelPercent float64             `json:"kernel_percent"`
}

// flamegraphHotFunc represents a single hotspot function in the flame graph analysis.
type flamegraphHotFunc struct {
	Name    string  `json:"name"`
	Percent float64 `json:"percent"`
	Module  string  `json:"module"`
}

// cachedFlameGraphData is the structure stored in the cache.
type cachedFlameGraphData struct {
	SubmissionID   string              `json:"submission_id"`
	UserSVG        string              `json:"user_svg"`
	KernelSVG      string              `json:"kernel_svg"`
	HasUser        bool                `json:"has_user"`
	HasKernel      bool                `json:"has_kernel"`
	ElapsedSec     float64             `json:"elapsed_sec"`
	Summary        string              `json:"summary"`
	HotFunctions   []flamegraphHotFunc `json:"hot_functions"`
	UserPercent    float64             `json:"user_percent"`
	KernelPercent  float64             `json:"kernel_percent"`
	Duration       int                 `json:"duration"`
	GeneratedAt    time.Time           `json:"generated_at"`
}

// GenerateFlameGraph handles POST /api/v1/submissions/:id/flamegraph
func (h *FlameGraphHandler) GenerateFlameGraph(c *gin.Context) {
	submissionID := c.Param("id")

	duration := 10
	if d := c.Query("duration"); d != "" {
		if parsed, ok := parseInt(d); ok && parsed >= 3 && parsed <= 30 {
			duration = parsed
		}
	}

	sub, err := h.subRepo.GetByID(c, submissionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "submission not found"})
		return
	}

	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)
	if role != "teacher" && role != "admin" && sub.StudentID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only teachers or the submission owner can generate flame graphs"})
		return
	}

	if sub.Code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "submission has no code"})
		return
	}

	exp, err := h.expRepo.GetByID(c, sub.ExperimentID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "experiment not found"})
		return
	}

	strategy := evaluator.GetStrategy(exp.Category)
	compileFlags := strategy.CompileFlags()

	reqBody := flamegraphRequest{
		Code:         sub.Code,
		Language:     sub.Language,
		CompileFlags: compileFlags,
		Duration:     duration,
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to marshal request"})
		return
	}

	client := &http.Client{Timeout: time.Duration(duration+20) * time.Second}
	serviceURL := h.flamegraphService + "/generate"

	resp, err := client.Post(serviceURL, "application/json", bytes.NewReader(reqJSON))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "flame_graph_service_unavailable",
			"details": fmt.Sprintf("failed to reach flame graph service: %v", err),
			"hint":    "请确保宿主机上的火焰图服务已启动 (python3 ebpf/scripts/flamegraph_server.py --port 8765)",
		})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read service response"})
		return
	}

	var fgResp flamegraphResponse
	if err := json.Unmarshal(body, &fgResp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse service response"})
		return
	}

	if !fgResp.Success {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":         fgResp.Error,
			"compile_error": fgResp.Error,
		})
		return
	}

	result := gin.H{
		"submission_id":  submissionID,
		"user_svg":       fgResp.UserSVG,
		"kernel_svg":     fgResp.KernelSVG,
		"has_user":       fgResp.HasUser,
		"has_kernel":     fgResp.HasKernel,
		"elapsed_sec":    fgResp.ElapsedSec,
		"summary":        fgResp.Summary,
		"duration":       duration,
		"hot_functions":  fgResp.HotFunctions,
		"user_percent":   fgResp.UserPercent,
		"kernel_percent": fgResp.KernelPercent,
	}

	// Save to cache for memory
	cacheData := cachedFlameGraphData{
		SubmissionID:  submissionID,
		UserSVG:       fgResp.UserSVG,
		KernelSVG:     fgResp.KernelSVG,
		HasUser:       fgResp.HasUser,
		HasKernel:     fgResp.HasKernel,
		ElapsedSec:    fgResp.ElapsedSec,
		Summary:       fgResp.Summary,
		HotFunctions:  fgResp.HotFunctions,
		UserPercent:   fgResp.UserPercent,
		KernelPercent: fgResp.KernelPercent,
		Duration:      duration,
		GeneratedAt:   time.Now(),
	}
	h.cacheHandler.SaveTypedCache(c.Request.Context(), sub.ExperimentID, submissionID, userID, "flamegraph", cacheData)

	c.JSON(http.StatusOK, result)
}

// GetFlameGraph handles GET /api/v1/submissions/:id/flamegraph
// Returns cached flame graph data if available.
func (h *FlameGraphHandler) GetFlameGraph(c *gin.Context) {
	submissionID := c.Param("id")

	sub, err := h.subRepo.GetByID(c, submissionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "submission not found"})
		return
	}

	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)
	if role != "teacher" && role != "admin" && sub.StudentID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "only teachers or the submission owner can view flame graphs"})
		return
	}

	// Try to read from cache
	var dataJSON json.RawMessage
	err = h.cacheHandler.db.QueryRow(c.Request.Context(), `
		SELECT data FROM experiment_cache
		WHERE experiment_id = $1 AND submission_id = $2 AND user_id = $3 AND cache_type = 'flamegraph' AND expires_at > NOW()
		ORDER BY created_at DESC LIMIT 1
	`, sub.ExperimentID, submissionID, userID).Scan(&dataJSON)

	if err == nil {
		var cached cachedFlameGraphData
		if json.Unmarshal(dataJSON, &cached) == nil {
			c.JSON(http.StatusOK, gin.H{
				"submission_id":  cached.SubmissionID,
				"user_svg":       cached.UserSVG,
				"kernel_svg":     cached.KernelSVG,
				"has_user":       cached.HasUser,
				"has_kernel":     cached.HasKernel,
				"elapsed_sec":    cached.ElapsedSec,
				"summary":        cached.Summary,
				"duration":       cached.Duration,
				"hot_functions":  cached.HotFunctions,
				"user_percent":   cached.UserPercent,
				"kernel_percent": cached.KernelPercent,
				"from_cache":     true,
				"generated_at":   cached.GeneratedAt,
			})
			return
		}
	}

	// No cache hit
	c.JSON(http.StatusOK, gin.H{
		"submission_id": submissionID,
		"status":        "not_generated",
		"hint":          "Use POST to generate a flame graph for this submission",
	})
}

// DiffFlameGraph handles GET /api/v1/submissions/:id/flamegraph/diff?baseline=<baselineId>
// Compares flame graph data between current and baseline submissions.
func (h *FlameGraphHandler) DiffFlameGraph(c *gin.Context) {
	submissionID := c.Param("id")
	baselineID := c.Query("baseline")

	if baselineID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "baseline query parameter is required"})
		return
	}

	// Fetch current submission
	sub, err := h.subRepo.GetByID(c, submissionID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "submission not found"})
		return
	}

	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)
	if role != "teacher" && role != "admin" && sub.StudentID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return
	}

	// Fetch baseline submission
	baseline, err := h.subRepo.GetByID(c, baselineID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "baseline submission not found"})
		return
	}

	// Read cached flamegraph data for both
	currentFG := h.getCachedFlameGraph(c, sub.ExperimentID, submissionID, userID)
	baselineFG := h.getCachedFlameGraph(c, baseline.ExperimentID, baselineID, userID)

	if currentFG == nil || baselineFG == nil {
		c.JSON(http.StatusOK, gin.H{
			"submission_id":  submissionID,
			"baseline_id":    baselineID,
			"status":         "insufficient_data",
			"hint":           "Both submissions need flame graphs generated first (POST /flamegraph)",
		})
		return
	}

	// Compare hot functions
	currentFuncs := make(map[string]float64)
	for _, f := range currentFG.HotFunctions {
		currentFuncs[f.Name] = f.Percent
	}
	baselineFuncs := make(map[string]float64)
	for _, f := range baselineFG.HotFunctions {
		baselineFuncs[f.Name] = f.Percent
	}

	type FuncDiff struct {
		Name            string  `json:"name"`
		CurrentPercent  float64 `json:"current_percent"`
		BaselinePercent float64 `json:"baseline_percent"`
		Delta           float64 `json:"delta"`
		Improved        bool    `json:"improved"`
	}

	var diffs []FuncDiff
	seen := make(map[string]bool)

	for name, curPct := range currentFuncs {
		basePct := baselineFuncs[name]
		delta := curPct - basePct
		diffs = append(diffs, FuncDiff{
			Name:            name,
			CurrentPercent:  curPct,
			BaselinePercent: basePct,
			Delta:           delta,
			Improved:        delta < 0, // lower percent = less CPU = improved
		})
		seen[name] = true
	}
	for name, basePct := range baselineFuncs {
		if !seen[name] {
			diffs = append(diffs, FuncDiff{
				Name:            name,
				CurrentPercent:  0,
				BaselinePercent: basePct,
				Delta:           -basePct,
				Improved:        true,
			})
		}
	}

	// Sort by absolute delta descending
	for i := 0; i < len(diffs)-1; i++ {
		for j := i + 1; j < len(diffs); j++ {
			if abs(diffs[j].Delta) > abs(diffs[i].Delta) {
				diffs[i], diffs[j] = diffs[j], diffs[i]
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"submission_id":    submissionID,
		"baseline_id":      baselineID,
		"current_duration": currentFG.Duration,
		"baseline_duration": baselineFG.Duration,
		"func_diffs":       diffs,
		"user_percent_delta":   currentFG.UserPercent - baselineFG.UserPercent,
		"kernel_percent_delta": currentFG.KernelPercent - baselineFG.KernelPercent,
		"current_user_percent":   currentFG.UserPercent,
		"baseline_user_percent":  baselineFG.UserPercent,
		"current_kernel_percent": currentFG.KernelPercent,
		"baseline_kernel_percent": baselineFG.KernelPercent,
		"current_elapsed_sec":  currentFG.ElapsedSec,
		"baseline_elapsed_sec":  baselineFG.ElapsedSec,
	})
}

// getCachedFlameGraph fetches cached flamegraph data from the database.
func (h *FlameGraphHandler) getCachedFlameGraph(c *gin.Context, experimentID, submissionID, userID string) *cachedFlameGraphData {
	var dataJSON json.RawMessage
	err := h.cacheHandler.db.QueryRow(c.Request.Context(), `
		SELECT data FROM experiment_cache
		WHERE experiment_id = $1 AND submission_id = $2 AND user_id = $3 AND cache_type = 'flamegraph' AND expires_at > NOW()
		ORDER BY created_at DESC LIMIT 1
	`, experimentID, submissionID, userID).Scan(&dataJSON)

	if err != nil {
		return nil
	}

	var cached cachedFlameGraphData
	if json.Unmarshal(dataJSON, &cached) != nil {
		return nil
	}
	return &cached
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func parseInt(s string) (int, bool) {
	var n int
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, false
		}
		n = n*10 + int(ch-'0')
	}
	return n, true
}

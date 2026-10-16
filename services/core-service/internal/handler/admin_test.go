package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/repository"
)

const testJWTSecret = "dev-secret-change-me"

func generateTestToken(role string) string {
	claims := middleware.Claims{
		UserID:   "test-user-id",
		Username: "testuser",
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, _ := token.SignedString([]byte(testJWTSecret))
	return signed
}

func setupTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, "postgres://traceos:traceos_dev@localhost:5432/traceos?sslmode=disable")
	if err != nil {
		t.Skipf("skipping test: cannot connect to DB: %v", err)
	}
	return pool
}

func setupTestRouter(pool *pgxpool.Pool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()

	subRepo := repository.NewSubmissionRepo(pool)
	expRepo := repository.NewExperimentRepo(pool)
	adminHandler := NewAdminHandler(pool, subRepo, expRepo)

	protected := r.Group("")
	protected.Use(middleware.Auth(testJWTSecret))

	adminGroup := protected.Group("")
	adminGroup.Use(middleware.RequireRole("admin"))
	{
		adminGroup.GET("/admin/db/overview", adminHandler.GetDBOverview)
		adminGroup.GET("/admin/submissions/queue", adminHandler.GetSubmissionQueue)
		adminGroup.POST("/admin/submissions/reset", adminHandler.BatchResetSubmissions)
		adminGroup.GET("/admin/experiments/config", adminHandler.GetExperimentConfigs)
		adminGroup.GET("/admin/experiments/:id/test-cases", adminHandler.ListTestCases)
		adminGroup.PUT("/admin/test-cases/:id", adminHandler.UpdateTestCase)
	}

	return r
}

func authHeader(role string) string {
	return "Bearer " + generateTestToken(role)
}

// ── Role Enforcement Tests (403) ──────────────────────────────────

func TestAdminRoutes_ForbiddenForTeacher(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	endpoints := []struct {
		method string
		path   string
		body   string
	}{
		{"GET", "/admin/db/overview", ""},
		{"GET", "/admin/submissions/queue", ""},
		{"POST", "/admin/submissions/reset", `{"submission_ids":["x"],"target_status":"pending"}`},
		{"GET", "/admin/experiments/config", ""},
		{"GET", "/admin/experiments/test-exp-id/test-cases", ""},
		{"PUT", "/admin/test-cases/test-tc-id", `{"is_public":true}`},
	}

	for _, ep := range endpoints {
		t.Run(ep.method+" "+ep.path, func(t *testing.T) {
			var req *http.Request
			if ep.body != "" {
				req = httptest.NewRequest(ep.method, ep.path, strings.NewReader(ep.body))
				req.Header.Set("Content-Type", "application/json")
			} else {
				req = httptest.NewRequest(ep.method, ep.path, nil)
			}
			req.Header.Set("Authorization", authHeader("teacher"))

			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != http.StatusForbidden {
				t.Errorf("expected 403 for teacher on %s %s, got %d", ep.method, ep.path, w.Code)
			}
		})
	}
}

// ── DB Overview ───────────────────────────────────────────────────

func TestGetDBOverview_Success(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	req := httptest.NewRequest("GET", "/admin/db/overview", nil)
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if _, ok := resp["users"]; !ok {
		t.Error("response should contain 'users'")
	}
	if _, ok := resp["submissions"]; !ok {
		t.Error("response should contain 'submissions'")
	}
}

func TestGetDBOverview_Unauthorized(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	req := httptest.NewRequest("GET", "/admin/db/overview", nil)
	// No auth header

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", w.Code)
	}
}

// ── Submission Queue ───────────────────────────────────────────────

func TestGetSubmissionQueue_Success(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	req := httptest.NewRequest("GET", "/admin/submissions/queue?stuck_minutes=5&page=1&page_size=10", nil)
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetSubmissionQueue_InvalidParams(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	req := httptest.NewRequest("GET", "/admin/submissions/queue?stuck_minutes=abc&page=-1", nil)
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Should still return 200 with defaults (Atoi returns 0 for "abc", then clamped)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

// ── Batch Reset Submissions ────────────────────────────────────────

func TestBatchResetSubmissions_Success(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	// Use a non-existent ID so we don't affect real data, expecting reset_count=0
	body := `{"submission_ids":["00000000-0000-0000-0000-000000000000"],"target_status":"pending"}`
	req := httptest.NewRequest("POST", "/admin/submissions/reset", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestBatchResetSubmissions_InvalidStatus(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	body := `{"submission_ids":["x"],"target_status":"invalid_status"}`
	req := httptest.NewRequest("POST", "/admin/submissions/reset", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestBatchResetSubmissions_EmptyIDs(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	body := `{"submission_ids":[],"target_status":"pending"}`
	req := httptest.NewRequest("POST", "/admin/submissions/reset", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestBatchResetSubmissions_InvalidJSON(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	req := httptest.NewRequest("POST", "/admin/submissions/reset", strings.NewReader("not-json"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

// ── Experiment Configs ─────────────────────────────────────────────

func TestGetExperimentConfigs_Success(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	req := httptest.NewRequest("GET", "/admin/experiments/config?page=1&page_size=10", nil)
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetExperimentConfigs_WithCategory(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	req := httptest.NewRequest("GET", "/admin/experiments/config?category=process", nil)
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ── List Test Cases ────────────────────────────────────────────────

func TestListTestCases_NotFound(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	req := httptest.NewRequest("GET", "/admin/experiments/nonexistent-id/test-cases", nil)
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	// Should return 200 with empty results, not an error
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ── Update Test Case ───────────────────────────────────────────────

func TestUpdateTestCase_NoFields(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	req := httptest.NewRequest("PUT", "/admin/test-cases/test-id", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for no fields, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateTestCase_InvalidJSON(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	req := httptest.NewRequest("PUT", "/admin/test-cases/test-id", strings.NewReader("bad"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestUpdateTestCase_ValidUpdate(t *testing.T) {
	pool := setupTestDB(t)
	defer pool.Close()
	router := setupTestRouter(pool)

	// Update a non-existent test case should succeed with 0 rows affected
	body := `{"is_public": true, "score_weight": 5}`
	req := httptest.NewRequest("PUT", "/admin/test-cases/00000000-0000-0000-0000-000000000000", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", authHeader("admin"))

	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

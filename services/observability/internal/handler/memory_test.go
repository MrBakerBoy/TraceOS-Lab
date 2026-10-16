package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/observability/internal/model"
)

// mockFetcher is a test double for MemoryLayoutFetcher.
type mockFetcher struct {
	snapshots []model.MemoryLayoutSnapshot
	err       error
	lastID    string
}

func (m *mockFetcher) GetMemoryLayout(_ context.Context, submissionID string) ([]model.MemoryLayoutSnapshot, error) {
	m.lastID = submissionID
	if m.err != nil {
		return nil, m.err
	}
	return m.snapshots, nil
}

func newTestRouter(fetcher MemoryLayoutFetcher) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewMemoryLayoutHandler(fetcher)
	r.GET("/api/obs/analysis/memory-layout/:submission_id", h.GetMemoryLayout)
	return r
}

func TestGetMemoryLayout_OK(t *testing.T) {
	fetcher := &mockFetcher{
		snapshots: []model.MemoryLayoutSnapshot{
			{
				TextStart: 0x400000, TextSize: 0x1000,
				HeapStart: 0x600000, HeapSize: 0x2000,
				MmapRegions: []model.MmapRegion{
					{Start: 0x700000, End: 0x701000, Size: 0x1000, Perms: "rw-p", Category: "mmap"},
				},
			},
		},
	}
	r := newTestRouter(fetcher)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/obs/analysis/memory-layout/abc-123", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if fetcher.lastID != "abc-123" {
		t.Errorf("fetcher received submission_id = %q, want abc-123", fetcher.lastID)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp["submission_id"] != "abc-123" {
		t.Errorf("submission_id = %v, want abc-123", resp["submission_id"])
	}
	snapshots, ok := resp["snapshots"].([]interface{})
	if !ok || len(snapshots) != 1 {
		t.Fatalf("snapshots = %v, want 1 entry", resp["snapshots"])
	}
	if resp["total"] != float64(1) {
		t.Errorf("total = %v, want 1", resp["total"])
	}
}

func TestGetMemoryLayout_Empty(t *testing.T) {
	fetcher := &mockFetcher{snapshots: nil}
	r := newTestRouter(fetcher)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/obs/analysis/memory-layout/none", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["total"] != float64(0) {
		t.Errorf("total = %v, want 0 for empty result", resp["total"])
	}
}

func TestGetMemoryLayout_RepoError(t *testing.T) {
	fetcher := &mockFetcher{err: context.DeadlineExceeded}
	r := newTestRouter(fetcher)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/obs/analysis/memory-layout/err", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", w.Code)
	}
	var resp map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if _, hasErr := resp["error"]; !hasErr {
		t.Error("expected error field in response")
	}
}

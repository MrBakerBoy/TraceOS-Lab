package handler

import (
	"math"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/model"
	"github.com/traceos-lab/core-service/internal/repository"
)

type ExperimentHandler struct {
	experimentRepo   *repository.ExperimentRepo
	submissionRepo   *repository.SubmissionRepo
	codeTemplateRepo *repository.CodeTemplateRepo
}

func NewExperimentHandler(experimentRepo *repository.ExperimentRepo, submissionRepo *repository.SubmissionRepo, codeTemplateRepo *repository.CodeTemplateRepo) *ExperimentHandler {
	return &ExperimentHandler{experimentRepo: experimentRepo, submissionRepo: submissionRepo, codeTemplateRepo: codeTemplateRepo}
}

func (h *ExperimentHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	filters := map[string]string{
		"category":     c.Query("category"),
		"difficulty":   c.Query("difficulty"),
		"course_id":    c.Query("course_id"),
		"is_published": c.Query("is_published"),
	}

	role := middleware.GetUserRole(c)
	if role == "" || role == "student" {
		filters["is_published"] = "true"
	}

	experiments, total, err := h.experimentRepo.List(c, filters, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, model.PaginatedResponse{
		Data:       experiments,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: int(math.Ceil(float64(total) / float64(pageSize))),
	})
}

func (h *ExperimentHandler) Get(c *gin.Context) {
	id := c.Param("id")
	exp, err := h.experimentRepo.GetByID(c, id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "experiment not found"})
		return
	}

	testCases, _ := h.experimentRepo.GetTestCases(c, id)
	role := middleware.GetUserRole(c)
	canViewAnswer := false

	// Load per-language code templates
	templates, _ := h.codeTemplateRepo.GetByExperiment(c, id)
	if templates == nil {
		templates = []model.CodeTemplate{}
	}

	if role == "" || role == "student" {
		// 只显示公开测试用例
		var publicCases []model.TestCase
		for _, tc := range testCases {
			if tc.IsPublic {
				publicCases = append(publicCases, tc)
			}
		}
		testCases = publicCases

		// 检查学生是否有通过的提交
		userID := middleware.GetUserID(c)
		passed, _ := h.submissionRepo.HasPassedSubmission(c, id, userID)
		if passed {
			canViewAnswer = true
		} else {
			exp.ReferenceSolution = nil
			exp.AnswerExplanation = nil
			// Clear reference solutions in all templates too
			for i := range templates {
				templates[i].ReferenceSolution = nil
			}
		}
	} else {
		// 教师和管理员可以直接查看
		canViewAnswer = true
	}

	exp.Templates = templates

	c.JSON(http.StatusOK, gin.H{
		"experiment":      exp,
		"test_cases":      testCases,
		"can_view_answer": canViewAnswer,
	})
}

func (h *ExperimentHandler) Create(c *gin.Context) {
	var input repository.CreateExperimentInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := middleware.GetUserID(c)
	exp, err := h.experimentRepo.Create(c, &input, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, exp)
}

func (h *ExperimentHandler) Update(c *gin.Context) {
	id := c.Param("id")
	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	delete(updates, "id")
	delete(updates, "created_at")
	delete(updates, "created_by")

	exp, err := h.experimentRepo.Update(c, id, updates)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, exp)
}

func (h *ExperimentHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.experimentRepo.SoftDelete(c, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (h *ExperimentHandler) ListByCourse(c *gin.Context) {
	courseID := c.Param("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}

	filters := map[string]string{
		"course_id":    courseID,
		"is_published": "true",
	}

	experiments, total, err := h.experimentRepo.List(c, filters, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, model.PaginatedResponse{
		Data:       experiments,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: int(math.Ceil(float64(total) / float64(pageSize))),
	})
}

// ── Test Case CRUD ──────────────────────────────────────────────────────

func (h *ExperimentHandler) CreateTestCase(c *gin.Context) {
	var input repository.CreateTestCaseInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tc, err := h.experimentRepo.CreateTestCase(c, &input)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, tc)
}

func (h *ExperimentHandler) UpdateTestCase(c *gin.Context) {
	id := c.Param("id")
	var updates map[string]interface{}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	delete(updates, "id")
	delete(updates, "experiment_id")
	delete(updates, "created_at")

	tc, err := h.experimentRepo.UpdateTestCase(c, id, updates)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, tc)
}

func (h *ExperimentHandler) DeleteTestCase(c *gin.Context) {
	id := c.Param("id")
	if err := h.experimentRepo.DeleteTestCase(c, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

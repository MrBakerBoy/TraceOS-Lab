package handler

import (
	"crypto/rand"
	"time"
	"encoding/hex"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/model"
	"github.com/traceos-lab/core-service/internal/repository"
)

type CourseHandler struct {
	courseRepo *repository.CourseRepo
}

func NewCourseHandler(courseRepo *repository.CourseRepo) *CourseHandler {
	return &CourseHandler{courseRepo: courseRepo}
}

// ── Course CRUD ────────────────────────────────────────────────────

func (h *CourseHandler) ListMyCourses(c *gin.Context) {
	userID := middleware.GetUserID(c)
	role := middleware.GetUserRole(c)

	if role == "teacher" || role == "admin" {
		courses, total, err := h.courseRepo.List(c, 1, 100, &userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, model.PaginatedResponse{
			Data: courses, Total: total, Page: 1, PageSize: 100, TotalPages: 1,
		})
		return
	}

	// Student: enrolled courses
	courses, err := h.courseRepo.GetEnrolledCourses(c, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, model.PaginatedResponse{
		Data: courses, Total: len(courses), Page: 1, PageSize: 100, TotalPages: 1,
	})
}

func (h *CourseHandler) Create(c *gin.Context) {
	userID := middleware.GetUserID(c)
	var req model.CreateCourseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	code := generateCode(8)
	course := &model.Course{
		Code:        code,
		Name:        req.Name,
		Description: &req.Description,
		TeacherID:   &userID,
		IsPublished: true,
	}

	if err := h.courseRepo.Create(c, course); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, course)
}

func (h *CourseHandler) GetStudents(c *gin.Context) {
	courseID := c.Param("id")
	students, err := h.courseRepo.GetCourseStudents(c, courseID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"students": students})
}

// ── Invite Codes ───────────────────────────────────────────────────

func (h *CourseHandler) CreateInviteCode(c *gin.Context) {
	userID := middleware.GetUserID(c)
	var req model.CreateInviteCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ic := &model.InviteCode{
		CourseID:  req.CourseID,
		Code:      generateCode(10),
		CreatedBy: userID,
		MaxUses:   req.MaxUses,
		ExpiresAt: req.ExpiresAt,
	}

	if err := h.courseRepo.CreateInviteCode(c, ic); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, ic)
}

func (h *CourseHandler) ListInviteCodes(c *gin.Context) {
	courseID := c.Param("id")
	codes, err := h.courseRepo.ListInviteCodes(c, courseID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"invite_codes": codes})
}

func (h *CourseHandler) DisableInviteCode(c *gin.Context) {
	id := c.Param("codeId")
	if err := h.courseRepo.DisableInviteCode(c, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "invite code disabled"})
}

func (h *CourseHandler) JoinByInviteCode(c *gin.Context) {
	userID := middleware.GetUserID(c)
	var req model.JoinByInviteCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ic, err := h.courseRepo.GetInviteCode(c, req.Code)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "邀请码无效或已过期"})
		return
	}

	if !ic.IsActive {
		c.JSON(http.StatusGone, gin.H{"error": "邀请码已失效"})
		return
	}

	if ic.MaxUses > 0 && ic.CurrentUses >= ic.MaxUses {
		c.JSON(http.StatusGone, gin.H{"error": "邀请码使用次数已达上限"})
		return
	}

	if ic.ExpiresAt != nil && ic.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "邀请码已过期"})
		return
	}

	if err := h.courseRepo.Enroll(c, ic.CourseID, userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	_ = h.courseRepo.IncrementInviteCodeUse(c, req.Code)

	c.JSON(http.StatusOK, gin.H{
		"message":     "加入班级成功",
		"course_id":   ic.CourseID,
		"course_name": ic.CourseName,
	})
}

func generateCode(length int) string {
	b := make([]byte, length)
	rand.Read(b)
	return hex.EncodeToString(b)[:length]
}

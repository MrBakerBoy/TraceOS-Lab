package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/repository"
)

type ProgressHandler struct {
	progressRepo *repository.ProgressRepo
	courseRepo   *repository.CourseRepo
}

func NewProgressHandler(progressRepo *repository.ProgressRepo, courseRepo *repository.CourseRepo) *ProgressHandler {
	return &ProgressHandler{progressRepo: progressRepo, courseRepo: courseRepo}
}

func (h *ProgressHandler) GetExperimentProgress(c *gin.Context) {
	experimentID := c.Param("experiment_id")
	studentID := c.Query("student_id")

	role := middleware.GetUserRole(c)
	if role == "student" {
		studentID = middleware.GetUserID(c)
	}
	if studentID == "" {
		studentID = middleware.GetUserID(c)
	}

	progress, err := h.progressRepo.Get(c, studentID, experimentID)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"student_id":        studentID,
			"experiment_id":     experimentID,
			"best_score":        0,
			"total_submissions": 0,
		})
		return
	}
	c.JSON(http.StatusOK, progress)
}

func (h *ProgressHandler) GetMyProgress(c *gin.Context) {
	userID := middleware.GetUserID(c)
	role := middleware.GetUserRole(c)

	// Student: show personal progress
	if role == "student" {
		progress, err := h.progressRepo.GetByStudent(c, userID)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"data": []interface{}{}})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": progress})
		return
	}

	// Teacher: show progress grouped by courses they teach
	if role == "teacher" {
		grouped, err := h.progressRepo.GetGroupedByCourses(c, &userID)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"data": []interface{}{}, "grouped": true})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": grouped, "grouped": true})
		return
	}

	// Admin: show all progress grouped by all courses
	if role == "admin" {
		grouped, err := h.progressRepo.GetGroupedByCourses(c, nil)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"data": []interface{}{}, "grouped": true})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": grouped, "grouped": true})
		return
	}

	// Fallback
	c.JSON(http.StatusOK, gin.H{"data": []interface{}{}})
}

// GetCourseProgress returns progress for a specific course (teacher/admin).
func (h *ProgressHandler) GetCourseProgress(c *gin.Context) {
	courseID := c.Param("id")
	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)

	// Verify teacher owns this course (or admin)
	if role == "teacher" {
		course, err := h.courseRepo.GetByID(c, courseID)
		if err != nil || (course.TeacherID != nil && *course.TeacherID != userID) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}
	}

	details, err := h.progressRepo.GetByCourse(c, courseID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": details})
}

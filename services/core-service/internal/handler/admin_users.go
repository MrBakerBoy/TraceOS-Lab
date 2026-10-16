package handler

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/model"
	"github.com/traceos-lab/core-service/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

// AdminUserHandler handles user management endpoints under /admin/users.
type AdminUserHandler struct {
	userRepo *repository.UserRepo
	auditLog *repository.AuditLogRepo
}

func NewAdminUserHandler(userRepo *repository.UserRepo, auditLog *repository.AuditLogRepo) *AdminUserHandler {
	return &AdminUserHandler{userRepo: userRepo, auditLog: auditLog}
}

const (
	adminMinPasswordLen = 6
	adminMaxPasswordLen = 128
)

var validRoles = map[string]bool{"student": true, "teacher": true, "admin": true}

// genRandomPassword generates an 8-char alphanumeric password.
func genRandomPassword() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
	b := make([]byte, 8)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			b[i] = chars[i%len(chars)]
			continue
		}
		b[i] = chars[n.Int64()]
	}
	return string(b)
}

func (h *AdminUserHandler) audit(c *gin.Context, action, resourceID, summary string, status int) {
	uid := middleware.GetUserID(c)
	s := status
	rt := "user"
	rid := resourceID
	ip := c.ClientIP()
	ua := c.Request.UserAgent()
	h.auditLog.LogAction(c.Request.Context(), &uid, action, &rt, &rid, &ip, &ua, &s)
	_ = summary
}

// ListUsers GET /admin/users
func (h *AdminUserHandler) ListUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	q := model.AdminListUsersQuery{
		Page:     page,
		PageSize: pageSize,
		Role:     c.Query("role"),
		Class:    c.Query("class"),
		Q:        c.Query("q"),
	}
	if v := c.Query("is_active"); v != "" {
		if v == "true" || v == "1" {
			t := true
			q.IsActive = &t
		} else if v == "false" || v == "0" {
			f := false
			q.IsActive = &f
		}
	}
	items, total, err := h.userRepo.ListForAdmin(c, q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	totalPages := 0
	if pageSize > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	c.JSON(http.StatusOK, gin.H{
		"data":        items,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": totalPages,
	})
}

// CreateUser POST /admin/users
func (h *AdminUserHandler) CreateUser(c *gin.Context) {
	var req model.AdminCreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据格式不正确"})
		return
	}
	if len(req.Username) < 2 || len(req.Username) > 50 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户名需为 2-50 个字符"})
		return
	}
	if !strings.Contains(req.Email, "@") || len(req.Email) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "邮箱格式不正确"})
		return
	}
	role := req.Role
	if role == "" {
		role = "student"
	}
	if !validRoles[role] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的角色"})
		return
	}
	if role == "student" && (req.StudentNo == "" || req.ClassName == "") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "学生必须填写学号和班级"})
		return
	}
	if role == "teacher" && len(req.TeachingClasses) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "教师至少指定一个所带班级"})
		return
	}

	// duplicates
	if _, _, err := h.userRepo.GetByUsername(c, req.Username); err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "用户名已存在"})
		return
	}
	if _, err := h.userRepo.GetByEmail(c, req.Email); err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "邮箱已存在"})
		return
	}

	initialPassword := req.Password
	generated := false
	if initialPassword == "" {
		initialPassword = genRandomPassword()
		generated = true
	}
	if len(initialPassword) < adminMinPasswordLen || len(initialPassword) > adminMaxPasswordLen {
		c.JSON(http.StatusBadRequest, gin.H{"error": "密码需为 6-128 个字符"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(initialPassword), 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	var fullName *string
	if req.FullName != "" {
		fn := req.FullName
		fullName = &fn
	}
	var studentNo, className *string
	if req.StudentNo != "" {
		sn := req.StudentNo
		studentNo = &sn
	}
	if req.ClassName != "" {
		cn := req.ClassName
		className = &cn
	}
	user := &model.User{
		Username:        req.Username,
		Email:           req.Email,
		FullName:        fullName,
		Role:            role,
		IsActive:        true,
		StudentNo:       studentNo,
		ClassName:       className,
		TeachingClasses: req.TeachingClasses,
	}
	if err := h.userRepo.Create(c, user, string(hash)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建用户失败", "detail": err.Error()})
		return
	}

	h.audit(c, "user.create", user.ID, fmt.Sprintf("create %s/%s", role, req.Username), http.StatusCreated)
	c.JSON(http.StatusCreated, gin.H{
		"user":             user,
		"initial_password": initialPassword,
		"generated":        generated,
		"message":          "请妥善保存初始密码并转告用户，此密码仅展示一次",
	})
}

// UpdateUser PUT /admin/users/:id
func (h *AdminUserHandler) UpdateUser(c *gin.Context) {
	id := c.Param("id")
	var req model.AdminUpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据格式不正确"})
		return
	}
	if req.Role != nil && !validRoles[*req.Role] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的角色"})
		return
	}
	if req.Email != nil && (!strings.Contains(*req.Email, "@") || len(*req.Email) > 100) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "邮箱格式不正确"})
		return
	}
	if err := h.userRepo.Update(c, id, req.Email, req.FullName, req.Role, req.StudentNo, req.ClassName, req.TeachingClasses); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.audit(c, "user.update", id, "update", http.StatusOK)
	c.JSON(http.StatusOK, gin.H{"id": id, "updated": true})
}

// ResetPassword PUT /admin/users/:id/password
func (h *AdminUserHandler) ResetPassword(c *gin.Context) {
	id := c.Param("id")
	var req model.ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据格式不正确"})
		return
	}
	if len(req.Password) < adminMinPasswordLen || len(req.Password) > adminMaxPasswordLen {
		c.JSON(http.StatusBadRequest, gin.H{"error": "密码需为 6-128 个字符"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}
	if err := h.userRepo.SetPassword(c, id, string(hash)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.audit(c, "user.reset_password", id, "reset_password", http.StatusOK)
	c.JSON(http.StatusOK, gin.H{"id": id, "reset": true})
}

// SetStatus PUT /admin/users/:id/status
func (h *AdminUserHandler) SetStatus(c *gin.Context) {
	id := c.Param("id")
	var req model.SetStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据格式不正确"})
		return
	}
	if err := h.userRepo.SetActive(c, id, req.IsActive); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	action := "user.set_status_active"
	if !req.IsActive {
		action = "user.set_status_disabled"
	}
	h.audit(c, action, id, "set_status", http.StatusOK)
	c.JSON(http.StatusOK, gin.H{"id": id, "is_active": req.IsActive})
}

// DeleteUser DELETE /admin/users/:id
func (h *AdminUserHandler) DeleteUser(c *gin.Context) {
	id := c.Param("id")
	// Prevent self-deletion
	if middleware.GetUserID(c) == id {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能删除当前登录的管理员账号"})
		return
	}
	if err := h.userRepo.Delete(c, id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.audit(c, "user.delete", id, "delete", http.StatusOK)
	c.JSON(http.StatusOK, gin.H{"id": id, "deleted": true})
}

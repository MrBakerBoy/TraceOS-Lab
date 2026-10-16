package handler

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/traceos-lab/core-service/internal/middleware"
	"github.com/traceos-lab/core-service/internal/model"
	"github.com/traceos-lab/core-service/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	userRepo  *repository.UserRepo
	jwtSecret string
}

func NewAuthHandler(userRepo *repository.UserRepo, jwtSecret string) *AuthHandler {
	return &AuthHandler{userRepo: userRepo, jwtSecret: jwtSecret}
}

type tokenResponse struct {
	AccessToken  string      `json:"access_token"`
	RefreshToken string      `json:"refresh_token"`
	ExpiresIn    int         `json:"expires_in"`
	User         model.User  `json:"user"`
}

const (
	maxUsernameLen = 50
	maxEmailLen    = 100
	maxFullNameLen = 100
	minPasswordLen = 6
	maxPasswordLen = 128
)

func (h *AuthHandler) Register(c *gin.Context) {
	var req model.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据格式不正确，请检查输入"})
		return
	}

	// 输入校验
	if len(req.Username) < 2 || len(req.Username) > maxUsernameLen {
		c.JSON(http.StatusBadRequest, gin.H{"error": "用户名需为 2-50 个字符"})
		return
	}
	if len(req.Email) > maxEmailLen || !strings.Contains(req.Email, "@") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "邮箱格式不正确"})
		return
	}
	if len(req.Password) < minPasswordLen || len(req.Password) > maxPasswordLen {
		c.JSON(http.StatusBadRequest, gin.H{"error": "密码需为 6-128 个字符"})
		return
	}
	if req.FullName != "" && len(req.FullName) > maxFullNameLen {
		c.JSON(http.StatusBadRequest, gin.H{"error": "姓名过长，最多100个字符"})
		return
	}
	// Validate role
	validRoles := map[string]bool{"student": true, "teacher": true, "admin": true}
	if req.Role != "" && !validRoles[req.Role] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的身份类型，可选 student/teacher/admin"})
		return
	}

	if _, _, err := h.userRepo.GetByUsername(c, req.Username); err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "用户名已存在"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败，请重试"})
		return
	}

	role := req.Role
	if role == "" {
		role = "student"
	}
	var fullName *string
	if req.FullName != "" {
		fullName = &req.FullName
	}

	user := &model.User{
		Username: req.Username,
		Email:    req.Email,
		FullName: fullName,
		Role:     role,
		IsActive: true,
	}

	if err := h.userRepo.Create(c, user, string(hash)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建用户失败，请重试", "detail": err.Error()})
		return
	}

	accessToken, err := h.generateToken(user, 1*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "令牌生成失败，请重试"})
		return
	}
	refreshToken, err := h.generateToken(user, 7*24*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "刷新令牌生成失败，请重试"})
		return
	}

	_ = h.userRepo.UpdateLastLogin(c, user.ID)

	c.JSON(http.StatusCreated, tokenResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    3600,
		User:         *user,
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req model.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据格式不正确，请检查输入"})
		return
	}

	log.Printf("[AUTH] Login request: username=%q", req.Username)
	user, hash, err := h.userRepo.GetByEmailOrUsername(c, req.Username)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	if !user.IsActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "账号已被禁用"})
		return
	}

	log.Printf("[AUTH] Login attempt: username=%q", req.Username)
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	accessToken, err := h.generateToken(user, 1*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "令牌生成失败，请重试"})
		return
	}
	refreshToken, err := h.generateToken(user, 7*24*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "刷新令牌生成失败，请重试"})
		return
	}

	_ = h.userRepo.UpdateLastLogin(c, user.ID)

	c.JSON(http.StatusOK, tokenResponse{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    3600,
		User:         *user,
	})
}

func (h *AuthHandler) RefreshToken(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求数据格式不正确"})
		return
	}

	claims := &middleware.Claims{}
	token, err := jwt.ParseWithClaims(req.RefreshToken, claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(h.jwtSecret), nil
	})
	if err != nil || !token.Valid {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "刷新令牌无效或已过期"})
		return
	}

	user, err := h.userRepo.GetByID(c, claims.UserID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户不存在"})
		return
	}

	newAccessToken, err := h.generateToken(user, 1*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "令牌生成失败，请重试"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token": newAccessToken,
		"expires_in":   3600,
	})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "已退出登录"})
}

func (h *AuthHandler) Me(c *gin.Context) {
	userID := middleware.GetUserID(c)
	user, err := h.userRepo.GetByID(c, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "用户不存在"})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (h *AuthHandler) generateToken(user *model.User, duration time.Duration) (string, error) {
	claims := middleware.Claims{
		UserID:   user.ID,
		Username: user.Username,
		Role:     user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(duration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(h.jwtSecret))
}

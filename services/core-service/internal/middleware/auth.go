package middleware

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

func Auth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Support three auth sources (checked in priority order):
		//   1. Cookie "token"        — SSE/EventSource (no URL leak)
		//   2. ?token= query param   — legacy SSE fallback
		//   3. Authorization header  — standard fetch/XHR
		tokenStr := ""
		log.Printf("[AUTH DEBUG] %s %s | Auth=%q | Cookie=%q", c.Request.Method, c.Request.URL.Path, c.GetHeader("Authorization"), c.GetHeader("Cookie"))
		if cookie, err := c.Cookie("token"); err == nil && cookie != "" {
			tokenStr = cookie
		}
		if tokenStr == "" {
			tokenStr = c.Query("token")
		}
		if tokenStr == "" {
			authHeader := c.GetHeader("Authorization")
			if authHeader == "" {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization"})
				return
			}
			tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
			if tokenStr == authHeader {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization format"})
				return
			}
		}
		// Strip Bearer prefix if present (query param or cookie may include it)
		tokenStr = strings.TrimPrefix(tokenStr, "Bearer ")

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Set("role", claims.Role)
		c.Next()
	}
}

func RequireRole(roles ...string) gin.HandlerFunc {
	roleMap := make(map[string]bool)
	for _, r := range roles {
		roleMap[r] = true
	}
	return func(c *gin.Context) {
		role, exists := c.Get("role")
		if !exists || !roleMap[role.(string)] {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
			return
		}
		c.Next()
	}
}

func GetUserID(c *gin.Context) string {
	id, exists := c.Get("user_id")
	if !exists {
		return ""
	}
	return id.(string)
}

func GetUserRole(c *gin.Context) string {
	role, exists := c.Get("role")
	if !exists {
		return ""
	}
	return role.(string)
}

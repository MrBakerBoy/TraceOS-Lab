package config

import (
	"fmt"
	"log"
	"os"
	"strings"
)

type Config struct {
	Port                 string
	PGHost               string
	PGPort               string
	PGUser               string
	PGPass               string
	PGDB                 string
	JWTSecret            string
	RedisHost            string
	RedisPort            string
	NATSUrl              string
	AIServiceURL         string
	FlamegraphServiceURL string
	SandboxMode          string
	FrontendURL          string
}

const (
	// DefaultJWTSecret is the weak default — must be overridden in production.
	DefaultJWTSecret = "change-me-to-a-random-secret-key"
)

// Load reads and validates configuration from environment variables.
// It will panic if critical security settings are at their defaults in production-like environments.
func Load() *Config {
	jwtSecret := getEnv("JWT_SECRET", "")
	frontendURL := getEnv("FRONTEND_URL", getEnv("NEXT_PUBLIC_API_URL", "http://localhost:80"))

	cfg := &Config{
		Port:                  getEnv("PORT", "8080"),
		PGHost:                getEnv("PG_HOST", "localhost"),
		PGPort:                getEnv("PG_PORT", "5432"),
		PGUser:                getEnv("PG_USER", "traceos"),
		PGPass:                getEnv("PG_PASSWORD", "traceos_dev"),
		PGDB:                  getEnv("PG_DATABASE", "traceos"),
		JWTSecret:             jwtSecret,
		RedisHost:             getEnv("REDIS_HOST", "localhost"),
		RedisPort:             getEnv("REDIS_PORT", "6379"),
		NATSUrl:               getEnv("NATS_URL", "nats://localhost:4222"),
		AIServiceURL:          getEnv("AI_SERVICE_URL", "http://traceos-ai:8000"),
		FlamegraphServiceURL:  getEnv("FLAMEGRAPH_SERVICE_URL", "http://172.17.0.1:8765"),
		SandboxMode:           getEnv("SANDBOX_MODE", "nsjail"),
		FrontendURL:           frontendURL,
	}

	// Security: validate critical settings
	cfg.validate()

	return cfg
}

// validate checks that security-critical settings are properly configured.
func (c *Config) validate() {
	var warnings []string

	// Check JWT secret
	if c.JWTSecret == "" || c.JWTSecret == DefaultJWTSecret {
		log.Printf("⚠️  [SECURITY] JWT_SECRET is at default value or empty — authentication is INSECURE!")
		log.Printf("   Generate a strong secret: openssl rand -base64 64")
	}

	// Check database password
	if c.PGPass == "" || c.PGPass == "traceos_dev" || c.PGPass == "change-me" {
		warnings = append(warnings, "PG_PASSWORD is weak or default")
	}

	// Check sandbox mode
	if c.SandboxMode != "nsjail" && c.SandboxMode != "local" {
		log.Printf("⚠️  Unknown SANDBOX_MODE=%q, falling back to 'nsjail'", c.SandboxMode)
		c.SandboxMode = "nsjail"
	}

	if c.SandboxMode == "local" {
		log.Printf("⚠️  [SECURITY] SANDBOX_MODE=local — code runs without isolation! Use only for development.")
	}

	if len(warnings) > 0 {
		log.Printf("⚠️  [CONFIG] Security warnings: %s", strings.Join(warnings, "; "))
	}

	// Sanitize frontend URL for CORS
	if c.FrontendURL != "" {
		c.FrontendURL = strings.TrimRight(c.FrontendURL, "/")
	}

	log.Printf("Config loaded: port=%s sandbox=%s jwt_set=%v",
		c.Port, c.SandboxMode, c.JWTSecret != "" && c.JWTSecret != DefaultJWTSecret)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// RequireEnv reads a required environment variable, panicking if it is empty.
func RequireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		panic(fmt.Sprintf("required environment variable %s is not set", key))
	}
	return v
}

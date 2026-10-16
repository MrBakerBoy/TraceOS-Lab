package config

import "os"

type Config struct {
	Port    string
	PGHost  string
	PGPort  string
	PGUser  string
	PGPass  string
	PGDB    string
}

func Load() *Config {
	return &Config{
		Port:   getEnv("PORT", "9091"),
		PGHost: getEnv("PG_HOST", "localhost"),
		PGPort: getEnv("PG_PORT", "5432"),
		PGUser: getEnv("PG_USER", "traceos"),
		PGPass: getEnv("PG_PASSWORD", "traceos_dev"),
		PGDB:   getEnv("PG_DATABASE", "traceos"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

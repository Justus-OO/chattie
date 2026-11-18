package config

import (
	"strings"
	"testing"
)

func TestLoadConfigRequiresJWTSecretOfAtLeast32Bytes(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/chattie")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 31))

	if _, err := LoadConfig(); err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Fatalf("LoadConfig() error = %v, want JWT_SECRET configuration error", err)
	}
}

func TestLoadConfigLoadsRequiredValues(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/chattie")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	t.Setenv("PORT", "")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("LoadConfig() error = %v", err)
	}
	if cfg.DBUrl != "postgres://localhost/chattie" {
		t.Errorf("DBUrl = %q, want configured database URL", cfg.DBUrl)
	}
	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want default 8080", cfg.Port)
	}
}

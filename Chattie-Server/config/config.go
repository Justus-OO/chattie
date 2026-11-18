package config

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Port  string
	DBUrl string
}

func LoadConfig() (*Config, error) {
	// Attempt to load the .env file.
	// We log but don't crash on error, allowing the app to run in
	// production containers where variables are injected by the host.
	if err := godotenv.Load(); err != nil {
		log.Println("Note: No .env file found, relying on system environment variables")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL must be configured")
	}

	if len([]byte(strings.TrimSpace(os.Getenv("JWT_SECRET")))) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must contain at least 32 bytes")
	}

	return &Config{Port: port, DBUrl: dbURL}, nil
}

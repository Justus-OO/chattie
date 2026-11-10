package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port  string
	DBUrl string
}

func LoadConfig() *Config {
	// Attempt to load the .env file.
	// We log but don't crash on error, allowing the app to run in
	// production containers where variables are injected by the host.
	if err := godotenv.Load(); err != nil {
		log.Println("Note: No .env file found, relying on system environment variables or defaults")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbUrl := os.Getenv("DATABASE_URL")
	if dbUrl == "" {
		// Note: It is best practice to eventually remove passwords from source code,
		// but keeping this as a local development fallback is fine for now.
		dbUrl = "postgres://postgres:Jussy1234!@localhost:5432/chattie_database?sslmode=disable"
	}

	return &Config{
		Port:  port,
		DBUrl: dbUrl,
	}
}

package config

import "os"

type Config struct {
	Port  string
	DBUrl string
}

func LoadConfig() *Config {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbUrl := os.Getenv("DATABASE_URL")
	if dbUrl == "" {
		// PostgreSQL connection string format: postgres://user:password@host:port/dbname?sslmode=disable
		// Replace "password" with your actual Postgres password!
		dbUrl = "postgres://postgres:Jussy1234!@localhost:5432/chattie_db?sslmode=disable"
	}

	return &Config{
		Port:  port,
		DBUrl: dbUrl,
	}
}

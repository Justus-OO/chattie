package database

import (
	"database/sql"
	"log"
	"time"

	_ "github.com/lib/pq" // PostgreSQL driver
)

func ConnectDB(dataSourceName string) *sql.DB {
	db, err := sql.Open("postgres", dataSourceName)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	// Connection Pool Settings: Prevents connection leaks and resource exhaustion
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(25)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err = db.Ping(); err != nil {
		log.Fatalf("Database unreachable: %v", err)
	}

	//log.Println("POSTGRESQL DATABASE CONNECTED SUCCESSFULLY.")
	return db
}

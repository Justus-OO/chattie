package database

import (
	"database/sql"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func ConnectDB(dataSourceName string) *sql.DB {
	config, err := pgx.ParseConfig(dataSourceName)
	if err != nil {
		log.Fatalf("Failed to parse database configuration: %v", err)
	}

	// Avoid cached prepared statements so transaction-pooling endpoints remain compatible.
	config.DefaultQueryExecMode = pgx.QueryExecModeExec
	db := stdlib.OpenDB(*config)

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(25)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err = db.Ping(); err != nil {
		log.Fatalf("Database unreachable: %v", err)
	}

	//log.Println("POSTGRESQL DATABASE CONNECTED SUCCESSFULLY.")
	return db
}

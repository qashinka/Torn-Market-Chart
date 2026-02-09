package main

import (
	"context"
	"fmt"
	"os"

	"github.com/akagifreeez/torn-market-chart/pkg/database"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://postgres:password@localhost:5432/torn_market"
	}

	db, err := database.NewDB(databaseURL)
	if err != nil {
		fmt.Printf("Failed to connect: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	rows, err := db.Pool.Query(context.Background(),
		"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users'")
	if err != nil {
		fmt.Printf("Query failed: %v\n", err)
		os.Exit(1)
	}
	defer rows.Close()

	fmt.Println("Users Table Schema:")
	for rows.Next() {
		var name, dtype string
		rows.Scan(&name, &dtype)
		fmt.Printf("- %s (%s)\n", name, dtype)
	}
}

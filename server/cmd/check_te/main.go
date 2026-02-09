package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

func main() {
	client := &http.Client{Timeout: 10 * time.Second}

	testURL("https://tornexchange.com/api/prices", client)
	fmt.Println("---")
	testURL("https://tornexchange.com/api/te_price?item_id=206", client)
}

func testURL(url string, client *http.Client) {
	fmt.Printf("Testing URL: %s\n", url)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("User-Agent", "TornMarketChart/1.0")

	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	fmt.Printf("Status: %s\n", resp.Status)

	// Try to format JSON
	var jsonData interface{}
	if err := json.Unmarshal(body, &jsonData); err == nil {
		formatted, _ := json.MarshalIndent(jsonData, "", "  ")
		if len(formatted) > 1000 {
			fmt.Printf("Body (first 1000 chars):\n%s\n...", string(formatted)[:1000])
		} else {
			fmt.Printf("Body:\n%s\n", string(formatted))
		}
	} else {
		fmt.Printf("Body (raw):\n%s\n", string(body))
	}
}

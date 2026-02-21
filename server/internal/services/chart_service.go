package services

import (
	"bytes"
	"fmt"
	"time"

	"github.com/akagifreeez/torn-market-chart/internal/models"
	"github.com/wcharczuk/go-chart/v2"
	"github.com/wcharczuk/go-chart/v2/drawing"
)

// ChartService provides methods to generate chart images
type ChartService struct{}

func NewChartService() *ChartService {
	return &ChartService{}
}

// GeneratePriceChartPNG takes a history of item records and creates a line chart PNG
func (s *ChartService) GeneratePriceChartPNG(itemName string, history []models.Item) ([]byte, error) {
	if len(history) < 2 {
		return nil, fmt.Errorf("not enough data points to generate a chart")
	}

	var xValues []time.Time
	var yValuesMarket []float64

	for _, h := range history {
		xValues = append(xValues, h.LastUpdatedAt)
		yValuesMarket = append(yValuesMarket, float64(h.LastMarketPrice))
	}

	graph := chart.Chart{
		Title: itemName + " - 24h Price History",
		TitleStyle: chart.Style{
			FontColor: drawing.ColorWhite,
			FontSize:  16,
		},
		Background: chart.Style{
			FillColor: drawing.ColorFromHex("2c2f33"), // Discord dark theme color
		},
		Canvas: chart.Style{
			FillColor: drawing.ColorFromHex("23272a"),
		},
		XAxis: chart.XAxis{
			Name: "Time",
			NameStyle: chart.Style{
				FontColor: drawing.ColorWhite,
			},
			Style: chart.Style{
				FontColor:   drawing.ColorWhite,
				StrokeColor: drawing.ColorWhite,
			},
			ValueFormatter: chart.TimeValueFormatterWithFormat("15:04"),
		},
		YAxis: chart.YAxis{
			Name: "Price ($)",
			NameStyle: chart.Style{
				FontColor: drawing.ColorWhite,
			},
			Style: chart.Style{
				FontColor:   drawing.ColorWhite,
				StrokeColor: drawing.ColorWhite,
			},
			ValueFormatter: func(v interface{}) string {
				if typed, ok := v.(float64); ok {
					if typed >= 1000000 {
						return fmt.Sprintf("$%.1fM", typed/1000000)
					}
					if typed >= 1000 {
						return fmt.Sprintf("$%.1fK", typed/1000)
					}
					return fmt.Sprintf("$%.0f", typed)
				}
				return ""
			},
		},
		Series: []chart.Series{
			chart.TimeSeries{
				Name:    "Market Price",
				XValues: xValues,
				YValues: yValuesMarket,
				Style: chart.Style{
					StrokeColor: drawing.ColorFromHex("5865F2"), // Blurple
					StrokeWidth: 3.0,
				},
			},
		},
	}

	buffer := bytes.NewBuffer([]byte{})
	err := graph.Render(chart.PNG, buffer)
	if err != nil {
		return nil, err
	}

	return buffer.Bytes(), nil
}

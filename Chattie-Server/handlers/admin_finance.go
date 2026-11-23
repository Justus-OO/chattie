package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"
)

func adminFinancePeriodStart(period string, now time.Time) (time.Time, bool) {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	switch period {
	case "7D":
		return today.AddDate(0, 0, -6), true
	case "30D":
		return today.AddDate(0, 0, -29), true
	case "90D":
		return today.AddDate(0, 0, -89), true
	case "YTD":
		return time.Date(now.Year(), time.January, 1, 0, 0, 0, 0, now.Location()), true
	default:
		return time.Time{}, false
	}
}

func (h *AdminHandler) GetFinanceAnalytics(w http.ResponseWriter, r *http.Request) {
	period := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("period")))
	if period == "" {
		period = "30D"
	}
	since, ok := adminFinancePeriodStart(period, time.Now())
	if !ok {
		http.Error(w, localized(r.Context(), "ErrUnsupportedFinancePeriodUse7D30D90DOrYTD", "Unsupported finance period. Use 7D, 30D, 90D, or YTD."), http.StatusBadRequest)
		return
	}

	analytics, err := h.Repo.GetFinanceAnalytics(r.Context(), since)
	if err != nil {
		log.Printf("Failed to load admin finance analytics: %v", err)
		http.Error(w, localized(r.Context(), "ErrFailedToLoadFinanceAnalytics", "Failed to load finance analytics"), http.StatusInternalServerError)
		return
	}
	analytics.Period = period
	analytics.PeriodStart = since
	analytics.GeneratedAt = time.Now()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(analytics); err != nil {
		log.Printf("Failed to encode admin finance analytics: %v", err)
	}
}

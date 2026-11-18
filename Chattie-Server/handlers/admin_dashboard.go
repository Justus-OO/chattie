package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

func (h *AdminHandler) GetDashboardTelemetry(w http.ResponseWriter, r *http.Request) {
	telemetry, err := h.Repo.GetDashboardTelemetry(r.Context())
	if err != nil {
		log.Printf("Failed to load admin dashboard telemetry: %v", err)
		http.Error(w, "Failed to load dashboard data", http.StatusInternalServerError)
		return
	}
	telemetry.GeneratedAt = time.Now()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(telemetry); err != nil {
		log.Printf("Failed to encode admin dashboard telemetry: %v", err)
	}
}

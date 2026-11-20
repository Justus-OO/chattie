package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"time"
)

const exchangeRateAPIURL = "https://open.er-api.com/v6/latest/USD"

type FXRateWorker struct {
	DB     *sql.DB
	Mpesa  *MpesaGateway
	Client *http.Client
}

type exchangeRateResponse struct {
	Result             string             `json:"result"`
	BaseCode           string             `json:"base_code"`
	TimeLastUpdateUnix int64              `json:"time_last_update_unix"`
	Rates              map[string]float64 `json:"rates"`
}

func NewFXRateWorker(db *sql.DB, mpesa *MpesaGateway) *FXRateWorker {
	return &FXRateWorker{
		DB: db, Mpesa: mpesa, Client: &http.Client{Timeout: 15 * time.Second},
	}
}

func (w *FXRateWorker) Start(ctx context.Context) {
	if w == nil || w.DB == nil || w.Mpesa == nil {
		log.Printf("[FX] Exchange-rate worker is not configured")
		return
	}
	if err := w.loadLatest(ctx); err != nil {
		log.Printf("[FX] Could not load the saved USD/KES rate: %v", err)
	}
	refreshCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	if err := w.refresh(refreshCtx); err != nil {
		log.Printf("[FX] Initial USD/KES refresh failed: %v", err)
	}
	cancel()
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := w.refresh(ctx); err != nil {
					log.Printf("[FX] Hourly USD/KES refresh failed: %v", err)
				}
			}
		}
	}()
}

func (w *FXRateWorker) loadLatest(ctx context.Context) error {
	var rate float64
	var asOf time.Time
	err := w.DB.QueryRowContext(ctx, `
		SELECT rate, provider_updated_at
		FROM exchange_rates
		WHERE base_currency = 'USD' AND quote_currency = 'KES'
	`).Scan(&rate, &asOf)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if rate <= 0 || time.Since(asOf) > 36*time.Hour {
		return nil
	}
	w.Mpesa.SetUSDToKESRate(rate, asOf)
	return nil
}

func (w *FXRateWorker) refresh(ctx context.Context) error {
	if w.Client == nil {
		w.Client = &http.Client{Timeout: 15 * time.Second}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, exchangeRateAPIURL, nil)
	if err != nil {
		return fmt.Errorf("create exchange-rate request: %w", err)
	}
	response, err := w.Client.Do(request)
	if err != nil {
		return fmt.Errorf("fetch exchange rates: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("exchange-rate provider returned status %d", response.StatusCode)
	}
	var result exchangeRateResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil {
		return fmt.Errorf("decode exchange-rate response: %w", err)
	}
	rate := result.Rates["KES"]
	asOf := time.Unix(result.TimeLastUpdateUnix, 0).UTC()
	if result.Result != "success" || result.BaseCode != "USD" || !validUSDToKESRate(rate) ||
		result.TimeLastUpdateUnix <= 0 || time.Since(asOf) > 36*time.Hour || asOf.After(time.Now().Add(5*time.Minute)) {
		return errors.New("exchange-rate provider returned an invalid or stale USD/KES rate")
	}
	if _, err := w.DB.ExecContext(ctx, `
		INSERT INTO exchange_rates (base_currency, quote_currency, rate, provider, provider_updated_at, fetched_at)
		VALUES ('USD', 'KES', $1, 'exchange-rate-api', $2, CURRENT_TIMESTAMP)
		ON CONFLICT (base_currency, quote_currency) DO UPDATE
		SET rate = EXCLUDED.rate, provider = EXCLUDED.provider,
		    provider_updated_at = EXCLUDED.provider_updated_at, fetched_at = CURRENT_TIMESTAMP
	`, rate, asOf); err != nil {
		return fmt.Errorf("save USD/KES exchange rate: %w", err)
	}
	w.Mpesa.SetUSDToKESRate(rate, asOf)
	return nil
}

func validUSDToKESRate(rate float64) bool {
	return !math.IsNaN(rate) && !math.IsInf(rate, 0) && rate >= 1 && rate <= 1000
}

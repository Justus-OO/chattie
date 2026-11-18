package models

import "time"

type AdminFinanceRevenueTotal struct {
	Source       string `json:"source"`
	Currency     string `json:"currency"`
	AmountMinor  int64  `json:"amountMinor"`
	PaymentCount int64  `json:"paymentCount"`
}

type AdminFinanceDailyRevenue struct {
	Date         string `json:"date"`
	Source       string `json:"source"`
	Currency     string `json:"currency"`
	AmountMinor  int64  `json:"amountMinor"`
	PaymentCount int64  `json:"paymentCount"`
}

type AdminFinancePayoutStatus struct {
	Status       string `json:"status"`
	RequestCount int64  `json:"requestCount"`
	AmountMinor  int64  `json:"amountMinor"`
}

type AdminFinanceAnalytics struct {
	Period                  string                     `json:"period"`
	PeriodStart             time.Time                  `json:"periodStart"`
	GeneratedAt             time.Time                  `json:"generatedAt"`
	RevenueBySource         []AdminFinanceRevenueTotal `json:"revenueBySource"`
	DailyRevenue            []AdminFinanceDailyRevenue `json:"dailyRevenue"`
	ActiveMainSubscriptions int64                      `json:"activeMainSubscriptions"`
	ActiveADSubscriptions   int64                      `json:"activeAfterDarkSubscriptions"`
	CreatorPayouts          []AdminFinancePayoutStatus `json:"creatorPayouts"`
	AfterDarkWithdrawals    []AdminFinancePayoutStatus `json:"afterDarkWithdrawals"`
}

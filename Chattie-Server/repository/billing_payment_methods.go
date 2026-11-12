package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

type BillingSavedPaymentMethod struct {
	ID                      string
	UserID                  string
	Provider                string
	ProviderMethodID        string
	ProviderCustomerID      string
	AuthorizationCiphertext []byte
	CardBrand               string
	Last4                   string
	ExpMonth                int
	ExpYear                 int
	BankName                string
	CreatedAt               time.Time
}

type BillingSavedPaymentMethodSummary struct {
	ID        string    `json:"id"`
	Provider  string    `json:"provider"`
	CardBrand string    `json:"card_brand"`
	Last4     string    `json:"last4"`
	ExpMonth  int       `json:"exp_month"`
	ExpYear   int       `json:"exp_year"`
	BankName  string    `json:"bank_name,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func (r *Repository) SaveBillingPaymentMethod(
	ctx context.Context,
	userID, provider, providerMethodID, providerCustomerID string,
	authorizationCiphertext []byte,
	cardBrand, last4 string,
	expMonth, expYear int,
	bankName string,
) error {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(providerMethodID) == "" || len(last4) != 4 {
		return fmt.Errorf("invalid saved payment method")
	}
	if provider == "stripe" && (strings.TrimSpace(providerCustomerID) == "" || len(authorizationCiphertext) != 0) {
		return fmt.Errorf("invalid Stripe payment method details")
	}
	if provider == "paystack" && len(authorizationCiphertext) == 0 {
		return fmt.Errorf("missing encrypted Paystack authorization")
	}
	if provider != "stripe" && provider != "paystack" {
		return fmt.Errorf("unsupported payment provider")
	}
	_, err := r.DB.ExecContext(ctx, `
		INSERT INTO billing_saved_payment_methods
			(id, user_id, provider, provider_method_id, provider_customer_id, authorization_ciphertext,
			 card_brand, last4, exp_month, exp_year, bank_name)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, $9, $10, $11)
		ON CONFLICT (user_id, provider, provider_method_id) DO UPDATE SET
			provider_customer_id = EXCLUDED.provider_customer_id,
			authorization_ciphertext = EXCLUDED.authorization_ciphertext,
			card_brand = EXCLUDED.card_brand,
			last4 = EXCLUDED.last4,
			exp_month = EXCLUDED.exp_month,
			exp_year = EXCLUDED.exp_year,
			bank_name = EXCLUDED.bank_name`,
		uuid.NewString(), userID, provider, providerMethodID, providerCustomerID,
		authorizationCiphertext, cardBrand, last4, expMonth, expYear, bankName)
	if err != nil {
		return fmt.Errorf("save billing payment method: %w", err)
	}
	return nil
}

func (r *Repository) ListBillingPaymentMethods(ctx context.Context, userID string) ([]BillingSavedPaymentMethodSummary, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id::text, provider, card_brand, last4, exp_month, exp_year, bank_name, created_at
		FROM billing_saved_payment_methods
		WHERE user_id = $1
		ORDER BY created_at DESC, id`,
		userID)
	if err != nil {
		return nil, fmt.Errorf("list billing payment methods: %w", err)
	}
	defer rows.Close()

	methods := make([]BillingSavedPaymentMethodSummary, 0)
	for rows.Next() {
		var method BillingSavedPaymentMethodSummary
		if err := rows.Scan(
			&method.ID, &method.Provider, &method.CardBrand, &method.Last4,
			&method.ExpMonth, &method.ExpYear, &method.BankName, &method.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan billing payment method: %w", err)
		}
		methods = append(methods, method)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate billing payment methods: %w", err)
	}
	return methods, nil
}

func (r *Repository) GetBillingStripeCustomerID(ctx context.Context, userID string) (string, error) {
	var customerID string
	err := r.DB.QueryRowContext(ctx, `
		SELECT provider_customer_id
		FROM billing_saved_payment_methods
		WHERE user_id = $1 AND provider = 'stripe' AND provider_customer_id IS NOT NULL
		ORDER BY created_at DESC
		LIMIT 1`,
		userID).Scan(&customerID)
	return customerID, err
}

func (r *Repository) GetBillingPaymentMethod(ctx context.Context, id, userID string) (*BillingSavedPaymentMethod, error) {
	var method BillingSavedPaymentMethod
	err := r.DB.QueryRowContext(ctx, `
		SELECT id::text, user_id::text, provider, provider_method_id,
		       COALESCE(provider_customer_id, ''), authorization_ciphertext,
		       card_brand, last4, exp_month, exp_year, bank_name, created_at
		FROM billing_saved_payment_methods
		WHERE id = $1 AND user_id = $2`,
		id, userID).Scan(
		&method.ID, &method.UserID, &method.Provider, &method.ProviderMethodID,
		&method.ProviderCustomerID, &method.AuthorizationCiphertext,
		&method.CardBrand, &method.Last4, &method.ExpMonth, &method.ExpYear,
		&method.BankName, &method.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &method, nil
}

func (r *Repository) DeleteBillingPaymentMethod(ctx context.Context, id, userID string) error {
	result, err := r.DB.ExecContext(ctx, `
		DELETE FROM billing_saved_payment_methods WHERE id = $1 AND user_id = $2`,
		id, userID)
	if err != nil {
		return fmt.Errorf("delete billing payment method: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check billing payment method deletion: %w", err)
	}
	if rows != 1 {
		return fmt.Errorf("billing payment method was not found")
	}
	return nil
}

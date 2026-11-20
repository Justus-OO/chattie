package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type MpesaGateway struct {
	ConsumerKey           string
	ConsumerSecret        string
	Shortcode             string
	Passkey               string
	B2CInitiatorName      string
	B2CSecurityCredential string
	B2CCommandID          string
	B2CResultURL          string
	B2CTimeoutURL         string
	CallbackURL           string
	AfterDarkCallbackURL  string
	BaseURL               string
	USDToKESRate          float64
	HTTPClient            *http.Client
	rateMu                sync.RWMutex
	rateAsOf              time.Time
}

type MpesaSTKSession struct {
	MerchantRequestID string `json:"merchant_request_id"`
	CheckoutRequestID string `json:"checkout_request_id"`
	CustomerMessage   string `json:"customer_message"`
	AmountKES         int64  `json:"amount_kes"`
}

type MpesaB2CTransfer struct {
	ConversationID           string
	OriginatorConversationID string
}

var ErrInvalidMpesaPhone = errors.New("enter a valid Kenyan M-Pesa phone number")

func NewMpesaGateway() *MpesaGateway {
	baseURL := "https://sandbox.safaricom.co.ke"
	environment := strings.ToLower(strings.TrimSpace(os.Getenv("MPESA_ENV")))
	if environment == "production" {
		baseURL = "https://api.safaricom.co.ke"
	} else if environment != "" && environment != "sandbox" {
		baseURL = ""
	}

	return &MpesaGateway{
		ConsumerKey:           os.Getenv("MPESA_CONSUMER_KEY"),
		ConsumerSecret:        os.Getenv("MPESA_CONSUMER_SECRET"),
		Shortcode:             os.Getenv("MPESA_SHORTCODE"),
		Passkey:               os.Getenv("MPESA_PASSKEY"),
		B2CInitiatorName:      strings.TrimSpace(os.Getenv("MPESA_B2C_INITIATOR_NAME")),
		B2CSecurityCredential: strings.TrimSpace(os.Getenv("MPESA_B2C_SECURITY_CREDENTIAL")),
		B2CCommandID:          strings.TrimSpace(os.Getenv("MPESA_B2C_COMMAND_ID")),
		B2CResultURL:          strings.TrimSpace(os.Getenv("MPESA_B2C_RESULT_URL")),
		B2CTimeoutURL:         strings.TrimSpace(os.Getenv("MPESA_B2C_TIMEOUT_URL")),
		CallbackURL:           strings.TrimSpace(os.Getenv("MPESA_CALLBACK_URL")),
		AfterDarkCallbackURL:  strings.TrimSpace(os.Getenv("MPESA_AFTERDARK_CALLBACK_URL")),
		BaseURL:               baseURL,
		HTTPClient:            &http.Client{Timeout: 15 * time.Second},
	}
}

func (m *MpesaGateway) SetUSDToKESRate(rate float64, asOf time.Time) {
	m.rateMu.Lock()
	m.USDToKESRate = rate
	m.rateAsOf = asOf
	m.rateMu.Unlock()
}

func (m *MpesaGateway) GetUSDToKESRate() float64 {
	m.rateMu.RLock()
	defer m.rateMu.RUnlock()
	if m.USDToKESRate <= 0 {
		return 0
	}
	if !m.rateAsOf.IsZero() && time.Since(m.rateAsOf) > 36*time.Hour {
		return 0
	}
	return m.USDToKESRate
}

func (m *MpesaGateway) CreateSubscription(context.Context, string, string, float64, int) (*CheckoutSession, error) {
	return nil, fmt.Errorf("M-Pesa checkout requires a phone number and billing reference")
}

func (m *MpesaGateway) VerifyPayment(ctx context.Context, checkoutRequestID string) (bool, error) {
	status, err := m.GetPaymentStatus(ctx, checkoutRequestID)
	return status == "paid", err
}

func (m *MpesaGateway) CreateSTKPush(ctx context.Context, phoneNumber, accountReference string, amountKES int64) (*MpesaSTKSession, error) {
	return m.createSTKPush(ctx, phoneNumber, accountReference, amountKES, m.CallbackURL)
}

func (m *MpesaGateway) CreateADSTKPush(ctx context.Context, phoneNumber, accountReference string, amountKES int64) (*MpesaSTKSession, error) {
	return m.createSTKPush(ctx, phoneNumber, accountReference, amountKES, m.AfterDarkCallbackURL)
}

func (m *MpesaGateway) SendB2C(ctx context.Context, phoneNumber, reference string, amountKES int64) (*MpesaB2CTransfer, error) {
	if err := m.ValidateB2CConfig(); err != nil {
		return nil, &PayoutNotSubmittedError{Err: err}
	}
	phone, err := normalizeMpesaPhone(phoneNumber)
	if err != nil {
		return nil, &PayoutNotSubmittedError{Err: err}
	}
	shortcode, err := strconv.ParseInt(m.Shortcode, 10, 64)
	if err != nil {
		return nil, &PayoutNotSubmittedError{Err: fmt.Errorf("M-Pesa shortcode must be numeric")}
	}
	recipient, err := strconv.ParseInt(phone, 10, 64)
	if err != nil {
		return nil, &PayoutNotSubmittedError{Err: ErrInvalidMpesaPhone}
	}
	if amountKES < 1 || strings.TrimSpace(reference) == "" {
		return nil, &PayoutNotSubmittedError{Err: fmt.Errorf("invalid M-Pesa B2C transfer details")}
	}
	token, err := m.accessToken(ctx)
	if err != nil {
		return nil, &PayoutNotSubmittedError{Err: err}
	}
	commandID := m.B2CCommandID
	if commandID == "" {
		commandID = "BusinessPayment"
	}
	payload := struct {
		InitiatorName      string `json:"InitiatorName"`
		SecurityCredential string `json:"SecurityCredential"`
		CommandID          string `json:"CommandID"`
		Amount             int64  `json:"Amount"`
		PartyA             int64  `json:"PartyA"`
		PartyB             int64  `json:"PartyB"`
		Remarks            string `json:"Remarks"`
		QueueTimeOutURL    string `json:"QueueTimeOutURL"`
		ResultURL          string `json:"ResultURL"`
		Occasion           string `json:"Occasion"`
	}{
		InitiatorName: m.B2CInitiatorName, SecurityCredential: m.B2CSecurityCredential,
		CommandID: commandID, Amount: amountKES, PartyA: shortcode, PartyB: recipient,
		Remarks: "Creator earnings payout", QueueTimeOutURL: m.B2CTimeoutURL,
		ResultURL: m.B2CResultURL, Occasion: reference,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode M-Pesa B2C request: %w", err)
	}
	var response struct {
		ConversationID           string `json:"ConversationID"`
		OriginatorConversationID string `json:"OriginatorConversationID"`
		ResponseCode             string `json:"ResponseCode"`
		ResponseDescription      string `json:"ResponseDescription"`
	}
	if err := m.postJSON(ctx, "/mpesa/b2c/v1/paymentrequest", token, body, &response); err != nil {
		return nil, err
	}
	if response.ResponseCode != "0" {
		return nil, &PayoutRejectedError{Message: fmt.Sprintf("M-Pesa B2C did not accept the payout: %s", response.ResponseDescription)}
	}
	if response.OriginatorConversationID == "" {
		return nil, fmt.Errorf("M-Pesa returned an incomplete payout acceptance response")
	}
	return &MpesaB2CTransfer{
		ConversationID:           response.ConversationID,
		OriginatorConversationID: response.OriginatorConversationID,
	}, nil
}

func (m *MpesaGateway) createSTKPush(ctx context.Context, phoneNumber, accountReference string, amountKES int64, callbackURL string) (*MpesaSTKSession, error) {
	if err := m.validateConfig(); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(strings.ToLower(callbackURL), "https://") {
		return nil, fmt.Errorf("M-Pesa callback URL must be a publicly reachable HTTPS URL")
	}
	phone, err := normalizeMpesaPhone(phoneNumber)
	if err != nil {
		return nil, err
	}
	shortcode, err := strconv.ParseInt(m.Shortcode, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("M-Pesa shortcode must be numeric")
	}
	phoneNumberInt, _ := strconv.ParseInt(phone, 10, 64)
	if amountKES < 1 {
		return nil, fmt.Errorf("M-Pesa amount must be at least one shilling")
	}

	token, err := m.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	timestamp := mpesaTimestamp()
	password := base64.StdEncoding.EncodeToString([]byte(m.Shortcode + m.Passkey + timestamp))

	payload := struct {
		BusinessShortCode int64  `json:"BusinessShortCode"`
		Password          string `json:"Password"`
		Timestamp         string `json:"Timestamp"`
		TransactionType   string `json:"TransactionType"`
		Amount            int64  `json:"Amount"`
		PartyA            int64  `json:"PartyA"`
		PartyB            int64  `json:"PartyB"`
		PhoneNumber       int64  `json:"PhoneNumber"`
		CallBackURL       string `json:"CallBackURL"`
		AccountReference  string `json:"AccountReference"`
		TransactionDesc   string `json:"TransactionDesc"`
	}{
		BusinessShortCode: shortcode,
		Password:          password,
		Timestamp:         timestamp,
		TransactionType:   "CustomerPayBillOnline",
		Amount:            amountKES,
		PartyA:            phoneNumberInt,
		PartyB:            shortcode,
		PhoneNumber:       phoneNumberInt,
		CallBackURL:       callbackURL,
		AccountReference:  accountReference,
		TransactionDesc:   "Chattie VIP",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode M-Pesa request: %w", err)
	}

	var response struct {
		MerchantRequestID string `json:"MerchantRequestID"`
		CheckoutRequestID string `json:"CheckoutRequestID"`
		ResponseCode      string `json:"ResponseCode"`
		ResponseDesc      string `json:"ResponseDescription"`
		CustomerMessage   string `json:"CustomerMessage"`
	}
	if err := m.postJSON(ctx, "/mpesa/stkpush/v1/processrequest", token, body, &response); err != nil {
		return nil, err
	}
	if response.ResponseCode != "0" || response.CheckoutRequestID == "" {
		return nil, fmt.Errorf("M-Pesa did not accept the payment request: %s", response.ResponseDesc)
	}
	return &MpesaSTKSession{
		MerchantRequestID: response.MerchantRequestID,
		CheckoutRequestID: response.CheckoutRequestID,
		CustomerMessage:   response.CustomerMessage,
		AmountKES:         amountKES,
	}, nil
}

func (m *MpesaGateway) GetPaymentStatus(ctx context.Context, checkoutRequestID string) (string, error) {
	if err := m.validateConfig(); err != nil {
		return "", err
	}
	if strings.TrimSpace(checkoutRequestID) == "" {
		return "", fmt.Errorf("missing M-Pesa checkout request ID")
	}
	token, err := m.accessToken(ctx)
	if err != nil {
		return "", err
	}
	shortcode, err := strconv.ParseInt(m.Shortcode, 10, 64)
	if err != nil {
		return "", fmt.Errorf("M-Pesa shortcode must be numeric")
	}
	timestamp := mpesaTimestamp()
	password := base64.StdEncoding.EncodeToString([]byte(m.Shortcode + m.Passkey + timestamp))
	body, err := json.Marshal(struct {
		BusinessShortCode int64  `json:"BusinessShortCode"`
		Password          string `json:"Password"`
		Timestamp         string `json:"Timestamp"`
		CheckoutRequestID string `json:"CheckoutRequestID"`
	}{
		BusinessShortCode: shortcode,
		Password:          password,
		Timestamp:         timestamp,
		CheckoutRequestID: checkoutRequestID,
	})
	if err != nil {
		return "", fmt.Errorf("encode M-Pesa status request: %w", err)
	}

	var response struct {
		ResponseCode string          `json:"ResponseCode"`
		ResultCode   json.RawMessage `json:"ResultCode"`
		ResultDesc   string          `json:"ResultDesc"`
	}
	if err := m.postJSON(ctx, "/mpesa/stkpushquery/v1/query", token, body, &response); err != nil {
		return "", err
	}
	if response.ResponseCode != "0" {
		return "", fmt.Errorf("M-Pesa status query rejected: %s", response.ResultDesc)
	}
	resultCode := strings.TrimSpace(string(response.ResultCode))
	var resultCodeString string
	if json.Unmarshal(response.ResultCode, &resultCodeString) == nil {
		resultCode = resultCodeString
	}
	if resultCode == "0" {
		return "paid", nil
	}
	if resultCode == "" || resultCode == "null" {
		return "pending", nil
	}
	return "failed", nil
}

func (m *MpesaGateway) KESAmount(usd float64) (int64, error) {
	rate := m.GetUSDToKESRate()
	if rate <= 0 {
		return 0, fmt.Errorf("USD/KES exchange rate is unavailable or stale")
	}
	amount := int64(math.Round(usd * rate))
	if amount < 1 {
		return 0, fmt.Errorf("converted M-Pesa amount is below one shilling")
	}
	return amount, nil
}

func (m *MpesaGateway) validateConfig() error {
	if m.ConsumerKey == "" || m.ConsumerSecret == "" || m.Shortcode == "" || m.Passkey == "" {
		return fmt.Errorf("M-Pesa is not configured; set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, and MPESA_PASSKEY")
	}
	if m.BaseURL == "" {
		return fmt.Errorf("MPESA_ENV must be either sandbox or production")
	}
	if _, err := strconv.ParseInt(m.Shortcode, 10, 64); err != nil {
		return fmt.Errorf("MPESA_SHORTCODE must be numeric")
	}
	if m.HTTPClient == nil {
		return fmt.Errorf("M-Pesa HTTP client is not configured")
	}
	return nil
}

func (m *MpesaGateway) ValidateB2CConfig() error {
	if m == nil || m.ConsumerKey == "" || m.ConsumerSecret == "" || m.Shortcode == "" || m.BaseURL == "" {
		return fmt.Errorf("M-Pesa B2C is not configured")
	}
	if m.B2CInitiatorName == "" || m.B2CSecurityCredential == "" || m.B2CResultURL == "" || m.B2CTimeoutURL == "" {
		return fmt.Errorf("M-Pesa B2C requires MPESA_B2C_INITIATOR_NAME, MPESA_B2C_SECURITY_CREDENTIAL, MPESA_B2C_RESULT_URL, and MPESA_B2C_TIMEOUT_URL")
	}
	if !strings.HasPrefix(strings.ToLower(m.B2CResultURL), "https://") || !strings.HasPrefix(strings.ToLower(m.B2CTimeoutURL), "https://") {
		return fmt.Errorf("M-Pesa B2C callback URLs must be publicly reachable HTTPS URLs")
	}
	return nil
}

func (m *MpesaGateway) accessToken(ctx context.Context) (string, error) {
	url := m.BaseURL + "/oauth/v1/generate?grant_type=client_credentials"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(m.ConsumerKey+":"+m.ConsumerSecret)))
	resp, err := m.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("M-Pesa authentication request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("M-Pesa authentication returned HTTP %d", resp.StatusCode)
	}
	var result struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode M-Pesa authentication response: %w", err)
	}
	if result.AccessToken == "" {
		return "", fmt.Errorf("M-Pesa authentication response did not contain an access token")
	}
	return result.AccessToken, nil
}

func (m *MpesaGateway) postJSON(ctx context.Context, path, token string, body []byte, target interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, m.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := m.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("M-Pesa request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, resp.Body)
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return &PayoutRejectedError{Message: fmt.Sprintf("M-Pesa request was rejected with HTTP %d", resp.StatusCode)}
		}
		return fmt.Errorf("M-Pesa request returned HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
		return fmt.Errorf("decode M-Pesa response: %w", err)
	}
	return nil
}

func normalizeMpesaPhone(phone string) (string, error) {
	// 1. Strip non-digit characters
	phone = strings.NewReplacer("+", "", " ", "", "-", "", "(", "", ")", "").Replace(strings.TrimSpace(phone))

	// 2. Handle 13-digit entries with accidental leading zero after 254 (e.g. 25407...)
	if strings.HasPrefix(phone, "2540") && len(phone) == 13 {
		phone = "254" + phone[4:]
	}

	// 3. Handle local 10-digit numbers starting with 0 (e.g. 07... or 01...)
	if strings.HasPrefix(phone, "0") && len(phone) == 10 {
		phone = "254" + phone[1:]
	}

	// 4. Handle local 9-digit numbers starting with 7 or 1 (e.g. 7... or 1...)
	if len(phone) == 9 && (strings.HasPrefix(phone, "7") || strings.HasPrefix(phone, "1")) {
		phone = "254" + phone
	}

	// 5. Final strict validation (must be exactly 12 digits, start with 254, and have 7 or 1 as the 4th digit)
	if len(phone) != 12 || !strings.HasPrefix(phone, "254") {
		return "", ErrInvalidMpesaPhone
	}

	for _, digit := range phone {
		if digit < '0' || digit > '9' {
			return "", ErrInvalidMpesaPhone
		}
	}

	if phone[3] != '7' && phone[3] != '1' {
		return "", ErrInvalidMpesaPhone
	}

	return phone, nil
}

func NormalizeMpesaPhone(phone string) (string, error) {
	return normalizeMpesaPhone(phone)
}

func mpesaTimestamp() string {
	return time.Now().In(time.FixedZone("EAT", 3*60*60)).Format("20060102150405")
}

package models

import "time"

type ADViewerProfile struct {
	UserID            string     `json:"user_id"`
	Alias             string     `json:"alias"`
	ExplicitConsentAt *time.Time `json:"explicit_consent_at"`
	AgeVerifiedAt     *time.Time `json:"age_verified_at"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type PerformerProfile struct {
	ID                             string    `json:"id"`
	UserID                         string    `json:"user_id"`
	DisplayName                    string    `json:"display_name"`
	Username                       string    `json:"username"`
	Bio                            string    `json:"bio"`
	Website                        string    `json:"website"`
	Location                       string    `json:"location"`
	AvatarAssetID                  string    `json:"avatar_asset_id"`
	CoverAssetID                   string    `json:"cover_asset_id"`
	AvatarURL                      string    `json:"avatar_url,omitempty"`
	CoverURL                       string    `json:"cover_url,omitempty"`
	Status                         string    `json:"status"`
	DMControl                      string    `json:"dm_control"`
	SubscriptionPriceCents         int64     `json:"subscription_price_cents"`
	SubscriptionPriceCentsProvided bool      `json:"-"`
	WelcomeMessage                 string    `json:"welcome_message,omitempty"`
	WelcomeMessageProvided         bool      `json:"-"`
	IsVerified                     bool      `json:"is_verified"`
	IsLive                         bool      `json:"is_live"`
	SubscriberCount                int       `json:"subscriber_count"`
	PostCount                      int       `json:"post_count"`
	LikeCount                      int       `json:"like_count"`
	CreatedAt                      time.Time `json:"created_at"`
	UpdatedAt                      time.Time `json:"updated_at"`
}

type PerformerApplication struct {
	ID                 string     `json:"id"`
	UserID             string     `json:"user_id"`
	IsCreator          bool       `json:"is_creator"`
	CreatorAlias       string     `json:"creator_alias"`
	Status             string     `json:"status"`
	VerificationRef    string     `json:"verification_ref"`
	PayoutMethodID     string     `json:"payout_method_id"`
	PolicyVersion      string     `json:"policy_version"`
	DecisionReasonCode string     `json:"decision_reason_code,omitempty"`
	SubmittedAt        time.Time  `json:"submitted_at"`
	ReviewedAt         *time.Time `json:"reviewed_at,omitempty"`
}

type AdminPerformerApplication struct {
	ID                  string    `json:"id"`
	UserID              string    `json:"user_id"`
	Username            string    `json:"username"`
	Email               string    `json:"email"`
	CreatorAlias        string    `json:"creator_alias"`
	Status              string    `json:"status"`
	PolicyVersion       string    `json:"policy_version"`
	DecisionReasonCode  string    `json:"decision_reason_code,omitempty"`
	AISummary           string    `json:"ai_triage_summary"`
	IdentityVerified    bool      `json:"identity_verified"`
	AgeVerified         bool      `json:"age_verified"`
	ConsentsVerified    bool      `json:"consents_verified"`
	ProfileComplete     bool      `json:"profile_complete"`
	HasExistingApproval bool      `json:"has_existing_approval"`
	EligibleForApproval bool      `json:"eligible_for_approval"`
	SubmittedAt         time.Time `json:"submitted_at"`
}

type PerformerConsent struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	ConsentType   string    `json:"consent_type"`
	PolicyVersion string    `json:"policy_version"`
	AcceptedAt    time.Time `json:"accepted_at"`
}

// models/subscription.go
package models

type SubscriptionTier struct {
	ID                    int    `json:"id"`
	Name                  string `json:"name"`
	MaxDailySwipes        int    `json:"max_daily_swipes"`
	MaxDailySuperLikes    int    `json:"max_daily_super_likes"`
	CanSeeLikes           bool   `json:"can_see_likes"`
	CanUseAdvancedFilters bool   `json:"can_use_advanced_filters"`
	CanUndo               bool   `json:"can_undo"`
}

type UserUsageContext struct {
	Tier           SubscriptionTier `json:"tier"`
	SwipesUsed     int              `json:"swipes_used"`
	SuperLikesUsed int              `json:"super_likes_used"`
}

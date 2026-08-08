// models/discover.go
package models

// GridFilters holds the query parameters sent from the Grid Browse page
type GridFilters struct {
	Intent      string `query:"intent"`
	Status      string `query:"status"`
	MinAge      int    `query:"min_age"`
	MaxAge      int    `query:"max_age"`
	SearchQuery string `query:"q"`
	SortBy      string `query:"sort"`
	Limit       int    `query:"limit"`
	Offset      int    `query:"offset"`
}

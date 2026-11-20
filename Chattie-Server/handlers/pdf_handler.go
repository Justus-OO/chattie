package handlers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"chattie-backend/middlewares"
	"chattie-backend/repository"
	"chattie-backend/services"
)

type PDFHandler struct {
	Repo      *repository.Repository
	Templates *template.Template
}

func NewPDFHandler(repo *repository.Repository) *PDFHandler {
	// Parse all HTML templates once on startup
	tmpl := template.Must(template.ParseGlob("templates/*.html"))
	return &PDFHandler{
		Repo:      repo,
		Templates: tmpl,
	}
}

// ============================================================================
// DATA MODELS FOR REPORTS
// ============================================================================

type UserAuditReport struct {
	Title       string
	GeneratedAt string
	RequestedBy string
	User        AuditUserDetail
	ActionLogs  []AuditLogEntry
	ModHistory  []ModerationEvent
}

type AuditUserDetail struct {
	ID            string
	Username      string
	Email         string
	Role          string
	Status        string
	RiskScore     int
	LifetimeSpend string
	JoinedAt      string
}

type AuditLogEntry struct {
	Time   string
	Action string
	IP     string
}

type ModerationEvent struct {
	Date   string
	Type   string
	Reason string
}

type FinancialLedgerReport struct {
	Title        string
	GeneratedAt  string
	Period       string
	GrossRevenue string
	NetRevenue   string
	TotalPayouts string
	Transactions []TransactionRecord
	TopEarners   []TopEarner
}

type TransactionRecord struct {
	ID     string
	Date   string
	Type   string
	Amount string
	Status string
}

type TopEarner struct {
	Username string
	Revenue  string
	Cut      string
}

type SecurityReport struct {
	Title         string
	GeneratedAt   string
	ActiveBans    int
	FirewallDrops int
	HighRiskUsers int
	RecentThreats []ThreatAlert
}

type ThreatAlert struct {
	Timestamp string
	IP        string
	Severity  string
	Detail    string
}

type ModerationReport struct {
	Title           string
	GeneratedAt     string
	OpenReports     int
	ResolvedReports int
	Recent          []ModerationReportEntry
}

type ModerationReportEntry struct {
	ID       string
	Date     string
	Target   string
	Reporter string
	Status   string
	Reason   string
}

type PlatformOverviewReport struct {
	Title            string
	GeneratedAt      string
	TotalUsers       int
	TotalCreators    int
	ActiveUsers24h   int
	PendingReports   int
	OpenRooms        int
	PaidCheckouts24h int
}

// ============================================================================
// REPORT GENERATORS
// ============================================================================

// GenerateUserReport builds a deep audit profile for a specific user
func (h *PDFHandler) GenerateUserReport(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	user, err := h.Repo.GetUserByID(r.Context(), adminID)
	if err != nil || user.Role != "admin" {
		http.Error(w, localized(r.Context(), "ErrForbiddenAdminRequired", "Forbidden: Admin access required"), http.StatusForbidden)
		return
	}

	targetUserID := chi.URLParam(r, "userId")
	if targetUserID == "" {
		http.Error(w, localized(r.Context(), "ErrUserIdRequired", "User ID required"), http.StatusBadRequest)
		return
	}

	auditData, err := h.Repo.GetUserAuditProfile(targetUserID)
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrUserNotFound", "User not found"), http.StatusNotFound)
		return
	}

	actionLogs := make([]AuditLogEntry, 0)
	for _, log := range auditData.ActionLogs {
		actionLogs = append(actionLogs, AuditLogEntry{
			Time:   log.Time.Format("3:04 PM"),
			Action: log.Action,
			IP:     log.IP,
		})
	}

	modHistory := make([]ModerationEvent, 0)
	for _, evt := range auditData.ModerationEvents {
		modHistory = append(modHistory, ModerationEvent{
			Date:   evt.Date.Format("2006-01-02"),
			Type:   evt.Type,
			Reason: evt.Reason,
		})
	}

	data := UserAuditReport{
		Title:       "Comprehensive User Audit",
		GeneratedAt: time.Now().Format("January 02, 2006 15:04:05"),
		RequestedBy: adminID,
		User: AuditUserDetail{
			ID:            auditData.UserID,
			Username:      auditData.Username,
			Email:         auditData.Email,
			Role:          auditData.Role,
			Status:        auditData.Status,
			RiskScore:     auditData.RiskScore,
			LifetimeSpend: fmt.Sprintf("$%.2f", auditData.LifetimeSpend),
			JoinedAt:      auditData.JoinedAt.Format("2006-01-02"),
		},
		ActionLogs: actionLogs,
		ModHistory: modHistory,
	}

	// FIX: Passed 'r' into renderAndStreamPDF
	shortID := targetUserID
	if len(shortID) > 8 {
		shortID = shortID[:8]
	}
	h.renderAndStreamPDF(w, r, "user_audit.html", data, fmt.Sprintf("audit_%s.pdf", shortID))
}

// GenerateFinancialLedger builds the platform's revenue and payout statements
func (h *PDFHandler) GenerateFinancialLedger(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	user, err := h.Repo.GetUserByID(r.Context(), adminID)
	if err != nil || user.Role != "admin" {
		http.Error(w, localized(r.Context(), "ErrForbiddenAdminRequired", "Forbidden: Admin access required"), http.StatusForbidden)
		return
	}

	now := time.Now()
	ledger, err := h.Repo.GetFinancialLedger(now.Year(), int(now.Month()))
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedFetchFinancialData", "Failed to fetch financial data"), http.StatusInternalServerError)
		return
	}

	transactions := make([]TransactionRecord, 0)
	for _, tx := range ledger.Transactions {
		transactions = append(transactions, TransactionRecord{
			ID:     tx.ID,
			Date:   fmt.Sprintf("%v", tx.Date),
			Type:   tx.Type,
			Amount: fmt.Sprintf("$%.2f", tx.Amount),
			Status: tx.Status,
		})
	}

	topEarners := make([]TopEarner, 0)
	for _, earner := range ledger.TopEarners {
		topEarners = append(topEarners, TopEarner{
			Username: earner.Username,
			Revenue:  fmt.Sprintf("$%.2f", earner.Revenue),
			Cut:      "70%",
		})
	}

	data := FinancialLedgerReport{
		Title:        "Platform Financial Ledger",
		GeneratedAt:  time.Now().Format("January 02, 2006 15:04:05"),
		Period:       ledger.Period,
		GrossRevenue: fmt.Sprintf("$%.2f", ledger.GrossRevenue),
		NetRevenue:   fmt.Sprintf("$%.2f (30%%)", ledger.NetRevenue),
		TotalPayouts: fmt.Sprintf("$%.2f", ledger.TotalPayouts),
		Transactions: transactions,
		TopEarners:   topEarners,
	}

	// FIX: Passed 'r' into renderAndStreamPDF
	h.renderAndStreamPDF(w, r, "financial_ledger.html", data, "financial_ledger_"+ledger.Period+".pdf")
}

// GenerateSecurityReport builds a telemetry readout of platform defenses
func (h *PDFHandler) GenerateSecurityReport(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		http.Error(w, localized(r.Context(), "ErrUnauthorized", "Unauthorized"), http.StatusUnauthorized)
		return
	}

	user, err := h.Repo.GetUserByID(r.Context(), adminID)
	if err != nil || user.Role != "admin" {
		http.Error(w, localized(r.Context(), "ErrForbiddenAdminRequired", "Forbidden: Admin access required"), http.StatusForbidden)
		return
	}

	telem, err := h.Repo.GetSecurityTelemetry()
	if err != nil {
		http.Error(w, localized(r.Context(), "ErrFailedFetchSecurityData", "Failed to fetch security data"), http.StatusInternalServerError)
		return
	}

	threats := make([]ThreatAlert, 0)
	for _, incident := range telem.RecentIncidents {
		threats = append(threats, ThreatAlert{
			Timestamp: incident.Timestamp.Format("Jan 02, 15:04"),
			IP:        incident.IP,
			Severity:  incident.Severity,
			Detail:    incident.Detail,
		})
	}

	data := SecurityReport{
		Title:         "System Security & Telemetry Report",
		GeneratedAt:   time.Now().Format("January 02, 2006 15:04:05"),
		ActiveBans:    telem.ActiveBans,
		FirewallDrops: telem.FirewallDrops,
		HighRiskUsers: telem.HighRiskUsers,
		RecentThreats: threats,
	}

	// FIX: Passed 'r' into renderAndStreamPDF
	h.renderAndStreamPDF(w, r, "security_report.html", data, "security_telemetry.pdf")
}

// GenerateModerationReport summarizes open, resolved, and recent user reports.
func (h *PDFHandler) GenerateModerationReport(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	admin, err := h.Repo.GetUserByID(r.Context(), adminID)
	if err != nil || admin.Role != "admin" {
		http.Error(w, "Forbidden: Admin access required", http.StatusForbidden)
		return
	}

	ctx := r.Context()
	openReports := 0
	resolvedReports := 0
	_ = h.Repo.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM reports WHERE LOWER(COALESCE(status, '')) IN ('open','pending','investigating')`).Scan(&openReports)
	_ = h.Repo.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM reports WHERE LOWER(COALESCE(status, '')) IN ('resolved','closed','dismissed')`).Scan(&resolvedReports)

	rows, err := h.Repo.DB.QueryContext(ctx, `
		SELECT id::text, created_at,
		       COALESCE(reported_id::text, 'Unknown'), COALESCE(reporter_id::text, 'System'),
		       COALESCE(status, 'open'), COALESCE(reason, 'No reason supplied')
		FROM reports ORDER BY created_at DESC LIMIT 100`)
	if err != nil {
		http.Error(w, "Failed to fetch moderation report", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	entries := make([]ModerationReportEntry, 0)
	for rows.Next() {
		var entry ModerationReportEntry
		var date time.Time
		if err := rows.Scan(&entry.ID, &date, &entry.Target, &entry.Reporter, &entry.Status, &entry.Reason); err == nil {
			entry.Date = date.Format("2006-01-02 15:04")
			entries = append(entries, entry)
		}
	}

	data := ModerationReport{
		Title:           "Moderation & Incident Report",
		GeneratedAt:     time.Now().Format("January 02, 2006 15:04:05"),
		OpenReports:     openReports,
		ResolvedReports: resolvedReports,
		Recent:          entries,
	}
	h.renderAndStreamPDF(w, r, "moderation_report.html", data, "moderation_report.pdf")
}

// GeneratePlatformOverview provides a concise executive operational snapshot.
func (h *PDFHandler) GeneratePlatformOverview(w http.ResponseWriter, r *http.Request) {
	adminID, ok := r.Context().Value(middlewares.UserIDKey).(string)
	if !ok || adminID == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	admin, err := h.Repo.GetUserByID(r.Context(), adminID)
	if err != nil || admin.Role != "admin" {
		http.Error(w, "Forbidden: Admin access required", http.StatusForbidden)
		return
	}

	data := PlatformOverviewReport{Title: "Platform Operations Overview", GeneratedAt: time.Now().Format("January 02, 2006 15:04:05")}
	ctx := r.Context()
	_ = h.Repo.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&data.TotalUsers)
	_ = h.Repo.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE role = 'model'`).Scan(&data.TotalCreators)
	_ = h.Repo.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_action_logs WHERE action_type IN ('LOGIN_SUCCESS','WS_CONNECT') AND created_at > NOW() - INTERVAL '24 hours'`).Scan(&data.ActiveUsers24h)
	_ = h.Repo.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM reports WHERE LOWER(COALESCE(status,'')) IN ('open','pending','investigating')`).Scan(&data.PendingReports)
	_ = h.Repo.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM chat_rooms WHERE COALESCE(status,'') = 'active'`).Scan(&data.OpenRooms)
	_ = h.Repo.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM transactions WHERE status = 'COMPLETED' AND created_at > NOW() - INTERVAL '24 hours'`).Scan(&data.PaidCheckouts24h)
	h.renderAndStreamPDF(w, r, "platform_overview.html", data, "platform_overview.pdf")
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

// FIX: Added 'r *http.Request' to the parameter list
func (h *PDFHandler) renderAndStreamPDF(w http.ResponseWriter, r *http.Request, templateName string, data interface{}, filename string) {
	if len(filename) == 0 || len(templateName) == 0 {
		http.Error(w, "Invalid report parameters", http.StatusBadRequest)
		return
	}
	var htmlBuffer bytes.Buffer
	if err := h.Templates.ExecuteTemplate(&htmlBuffer, templateName, data); err != nil {
		log.Printf("Template execution error: %v", err)
		http.Error(w, localized(r.Context(), "ErrFailedRenderTemplate", "Failed to render template. Ensure "+templateName+" exists in /templates."), http.StatusInternalServerError)
		return
	}

	pdfBytes, err := services.GeneratePDF(htmlBuffer.String())
	if err != nil {
		log.Printf("PDF Generation error: %v", err)
		status := http.StatusInternalServerError
		message := localized(r.Context(), "ErrFailedGeneratePdf", "Failed to generate PDF document")
		if errors.Is(err, services.ErrPDFBrowserUnavailable) {
			status = http.StatusServiceUnavailable
			message = "PDF generation is unavailable. Install Chrome or Chromium, or configure CHROME_BIN."
		} else if errors.Is(err, context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
			message = "PDF generation timed out. Retry the report shortly."
		}
		http.Error(w, message, status)
		return
	}

	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `inline; filename="`+filename+`"`)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(pdfBytes)))
	w.WriteHeader(http.StatusOK)

	w.Write(pdfBytes)
}

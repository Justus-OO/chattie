package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"chattie-backend/models"
)

var ErrSupportTicketResolved = errors.New("support ticket is resolved")

type SupportRepository struct {
	DB *sql.DB
}

func NewSupportRepository(db *sql.DB) *SupportRepository {
	return &SupportRepository{DB: db}
}

func (r *SupportRepository) CreateTicket(ctx context.Context, userID, subject, content string) (*models.SupportTicket, *models.SupportMessage, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("begin support ticket: %w", err)
	}
	defer tx.Rollback()

	ticket := &models.SupportTicket{UserID: userID, Subject: subject, Status: "open", Priority: "normal", Category: "general"}
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO support_tickets (user_id, subject)
		VALUES ($1, $2)
		RETURNING id::text, status, priority, category, human_requested, updated_at
	`, userID, subject).Scan(&ticket.ID, &ticket.Status, &ticket.Priority, &ticket.Category, &ticket.HumanRequested, &ticket.UpdatedAt); err != nil {
		return nil, nil, fmt.Errorf("create support ticket: %w", err)
	}

	message := &models.SupportMessage{TicketID: ticket.ID, SenderID: userID, SenderType: "user", Content: content}
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO support_messages (ticket_id, sender_id, sender_type, content)
		VALUES ($1, $2, 'user', $3)
		RETURNING id::text, created_at
	`, ticket.ID, userID, content).Scan(&message.ID, &message.CreatedAt); err != nil {
		return nil, nil, fmt.Errorf("save initial support message: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, fmt.Errorf("commit support ticket: %w", err)
	}
	return ticket, message, nil
}

func (r *SupportRepository) ListUserTickets(ctx context.Context, userID string) ([]models.SupportTicket, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT ticket.id::text, ticket.user_id::text, ticket.subject, ticket.status,
		       ticket.priority, ticket.category, ''::text, ticket.human_requested,
		       COALESCE(latest.content, ''), ticket.updated_at
		FROM support_tickets ticket
		LEFT JOIN LATERAL (
			SELECT content FROM support_messages
			WHERE ticket_id = ticket.id
			ORDER BY created_at DESC, id DESC
			LIMIT 1
		) latest ON TRUE
		WHERE ticket.user_id = $1
		ORDER BY ticket.updated_at DESC, ticket.id DESC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("list user support tickets: %w", err)
	}
	defer rows.Close()
	return scanSupportTickets(rows)
}

func (r *SupportRepository) ListAdminTickets(ctx context.Context) ([]models.SupportTicket, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT ticket.id::text, ticket.user_id::text,
		       COALESCE(profile.display_name, users.username, 'User'),
		       ticket.subject, ticket.status, ticket.priority, ticket.category,
		       ticket.ai_summary, ticket.human_requested,
		       COALESCE(latest.content, ''), ticket.updated_at
		FROM support_tickets ticket
		JOIN users ON users.id = ticket.user_id
		LEFT JOIN user_profiles profile ON profile.user_id = users.id
		LEFT JOIN LATERAL (
			SELECT content FROM support_messages
			WHERE ticket_id = ticket.id
			ORDER BY created_at DESC, id DESC
			LIMIT 1
		) latest ON TRUE
		ORDER BY CASE ticket.priority
		           WHEN 'urgent' THEN 0
		           WHEN 'high' THEN 1
		           WHEN 'normal' THEN 2
		           ELSE 3
		         END,
		         ticket.updated_at DESC, ticket.id DESC
		LIMIT 200
	`)
	if err != nil {
		return nil, fmt.Errorf("list admin support tickets: %w", err)
	}
	defer rows.Close()

	var tickets []models.SupportTicket
	for rows.Next() {
		var ticket models.SupportTicket
		if err := rows.Scan(
			&ticket.ID, &ticket.UserID, &ticket.UserName, &ticket.Subject, &ticket.Status,
			&ticket.Priority, &ticket.Category, &ticket.AISummary, &ticket.HumanRequested,
			&ticket.LastMessage, &ticket.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan admin support ticket: %w", err)
		}
		tickets = append(tickets, ticket)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate admin support tickets: %w", err)
	}
	return tickets, nil
}

func scanSupportTickets(rows *sql.Rows) ([]models.SupportTicket, error) {
	var tickets []models.SupportTicket
	for rows.Next() {
		var ticket models.SupportTicket
		if err := rows.Scan(
			&ticket.ID, &ticket.UserID, &ticket.Subject, &ticket.Status, &ticket.Priority,
			&ticket.Category, &ticket.AISummary, &ticket.HumanRequested,
			&ticket.LastMessage, &ticket.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan support ticket: %w", err)
		}
		tickets = append(tickets, ticket)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate support tickets: %w", err)
	}
	return tickets, nil
}

func (r *SupportRepository) GetTicket(ctx context.Context, ticketID, userID string, admin bool) (*models.SupportTicket, error) {
	query := `
		SELECT ticket.id::text, ticket.user_id::text, ticket.subject, ticket.status,
		       ticket.priority, ticket.category, ''::text, ticket.human_requested,
		       ticket.updated_at, ''
		FROM support_tickets ticket
		WHERE ticket.id = $1
	`
	if admin {
		query = `
			SELECT ticket.id::text, ticket.user_id::text, ticket.subject, ticket.status,
			       ticket.priority, ticket.category, ticket.ai_summary, ticket.human_requested,
			       ticket.updated_at, COALESCE(profile.display_name, users.username, 'User')
			FROM support_tickets ticket
			JOIN users ON users.id = ticket.user_id
			LEFT JOIN user_profiles profile ON profile.user_id = users.id
			WHERE ticket.id = $1
		`
	}
	args := []interface{}{ticketID}
	if !admin {
		query += " AND ticket.user_id = $2"
		args = append(args, userID)
	}
	var ticket models.SupportTicket
	err := r.DB.QueryRowContext(ctx, query, args...).Scan(
		&ticket.ID, &ticket.UserID, &ticket.Subject, &ticket.Status, &ticket.Priority,
		&ticket.Category, &ticket.AISummary, &ticket.HumanRequested, &ticket.UpdatedAt, &ticket.UserName,
	)
	if err != nil {
		return nil, err
	}
	return &ticket, nil
}

func (r *SupportRepository) ListMessages(ctx context.Context, ticketID string) ([]models.SupportMessage, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id::text, ticket_id::text, COALESCE(sender_id::text, ''),
		       sender_type, content, created_at
		FROM support_messages
		WHERE ticket_id = $1
		ORDER BY created_at, id
	`, ticketID)
	if err != nil {
		return nil, fmt.Errorf("list support messages: %w", err)
	}
	defer rows.Close()
	var messages []models.SupportMessage
	for rows.Next() {
		var message models.SupportMessage
		if err := rows.Scan(&message.ID, &message.TicketID, &message.SenderID, &message.SenderType, &message.Content, &message.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan support message: %w", err)
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate support messages: %w", err)
	}
	return messages, nil
}

func (r *SupportRepository) AddUserMessage(ctx context.Context, ticketID, userID, content string) (*models.SupportMessage, bool, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("begin support reply: %w", err)
	}
	defer tx.Rollback()

	var status string
	var humanRequested bool
	if err := tx.QueryRowContext(ctx, `
		SELECT status, human_requested
		FROM support_tickets
		WHERE id = $1 AND user_id = $2
		FOR UPDATE
	`, ticketID, userID).Scan(&status, &humanRequested); err != nil {
		return nil, false, err
	}
	if status == "resolved" {
		return nil, false, ErrSupportTicketResolved
	}

	message := &models.SupportMessage{TicketID: ticketID, SenderID: userID, SenderType: "user", Content: content}
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO support_messages (ticket_id, sender_id, sender_type, content)
		VALUES ($1, $2, 'user', $3)
		RETURNING id::text, created_at
	`, ticketID, userID, content).Scan(&message.ID, &message.CreatedAt); err != nil {
		return nil, false, fmt.Errorf("save user support reply: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, ticketID); err != nil {
		return nil, false, fmt.Errorf("update support ticket activity: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, false, fmt.Errorf("commit support reply: %w", err)
	}
	return message, status == "open" && !humanRequested, nil
}

func (r *SupportRepository) AddAIMessage(ctx context.Context, ticketID, content string) (*models.SupportMessage, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin AI support reply: %w", err)
	}
	defer tx.Rollback()

	var eligible bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM support_tickets
			WHERE id = $1 AND status = 'open' AND human_requested = FALSE
			FOR UPDATE
		)
	`, ticketID).Scan(&eligible); err != nil {
		return nil, fmt.Errorf("validate AI support ticket: %w", err)
	}
	if !eligible {
		return nil, sql.ErrNoRows
	}

	message := &models.SupportMessage{TicketID: ticketID, SenderType: "assistant", Content: content}
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO support_messages (ticket_id, sender_type, content)
		VALUES ($1, 'assistant', $2)
		RETURNING id::text, created_at
	`, ticketID, content).Scan(&message.ID, &message.CreatedAt); err != nil {
		return nil, fmt.Errorf("save AI support reply: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`, ticketID); err != nil {
		return nil, fmt.Errorf("update ticket after AI support reply: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit AI support reply: %w", err)
	}
	return message, nil
}

func (r *SupportRepository) RequestHuman(ctx context.Context, ticketID, userID string) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin support handoff: %w", err)
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
		UPDATE support_tickets
		SET status = 'waiting_human',
		    human_requested = TRUE,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND user_id = $2 AND status <> 'resolved'
	`, ticketID, userID)
	if err != nil {
		return fmt.Errorf("request human support: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check support handoff: %w", err)
	}
	if updated != 1 {
		return ErrSupportTicketResolved
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO support_messages (ticket_id, sender_type, content)
		VALUES ($1, 'system', 'Your request has been sent to our support team.')
	`, ticketID)
	if err != nil {
		return fmt.Errorf("record support handoff: %w", err)
	}
	return tx.Commit()
}

func (r *SupportRepository) AddAdminMessage(ctx context.Context, ticketID, adminID, content string) (*models.SupportMessage, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin admin support reply: %w", err)
	}
	defer tx.Rollback()

	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM support_tickets WHERE id = $1)`, ticketID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("validate support ticket: %w", err)
	}
	if !exists {
		return nil, sql.ErrNoRows
	}
	message := &models.SupportMessage{TicketID: ticketID, SenderID: adminID, SenderType: "admin", Content: content}
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO support_messages (ticket_id, sender_id, sender_type, content)
		VALUES ($1, $2, 'admin', $3)
		RETURNING id::text, created_at
	`, ticketID, adminID, content).Scan(&message.ID, &message.CreatedAt); err != nil {
		return nil, fmt.Errorf("save admin support reply: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE support_tickets
		SET status = 'in_progress', assigned_to = COALESCE(assigned_to, $2), updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, ticketID, adminID); err != nil {
		return nil, fmt.Errorf("update support ticket after admin reply: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit admin support reply: %w", err)
	}
	return message, nil
}

func (r *SupportRepository) SetTicketStatus(ctx context.Context, ticketID, status string) error {
	switch status {
	case "open", "waiting_human", "in_progress", "resolved":
	default:
		return errors.New("support ticket status is invalid")
	}
	result, err := r.DB.ExecContext(ctx, `
		UPDATE support_tickets
		SET status = $2, updated_at = CURRENT_TIMESTAMP,
		    human_requested = CASE WHEN $2 = 'resolved' THEN human_requested ELSE FALSE END
		WHERE id = $1
	`, ticketID, status)
	if err != nil {
		return fmt.Errorf("update support ticket status: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check support ticket status: %w", err)
	}
	if updated != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func NormalizeSupportText(value string, maxRunes int) string {
	if maxRunes <= 0 {
		return ""
	}
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maxRunes {
		return string(runes[:maxRunes])
	}
	return value
}

-- Retained for legacy template consumers; NotificationService renders support-ticket
-- updates from the locale catalogs and escapes dynamic ticket values.
INSERT INTO email_templates (name, subject, body_html) VALUES
    ('support_ticket_update', 'Update to your Chattie support ticket', '<h1>Support ticket update</h1><p>Your ticket "{{.TicketSubject}}" is now {{.TicketStatus}}.</p><p><a href="{{.ActionURL}}">{{.ActionLabel}}</a></p>')
ON CONFLICT (name) DO UPDATE
SET subject = EXCLUDED.subject,
    body_html = EXCLUDED.body_html,
    updated_at = CURRENT_TIMESTAMP;

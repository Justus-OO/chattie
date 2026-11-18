package workers

import (
	"context"
	"log"
	"time"

	"chattie-backend/repository"
	"chattie-backend/services"
)

type CreatorProfileAssignmentWorker struct {
	Repo       *repository.Repository
	Events     *services.EventHandler
	Interval   time.Duration
	IdleAfter  time.Duration
	BatchSize  int
	MaxManaged int
}

func NewCreatorProfileAssignmentWorker(repo *repository.Repository, events *services.EventHandler) *CreatorProfileAssignmentWorker {
	return &CreatorProfileAssignmentWorker{
		Repo:       repo,
		Events:     events,
		Interval:   5 * time.Minute,
		IdleAfter:  5 * time.Hour,
		BatchSize:  25,
		MaxManaged: repository.MaxManagedProfilesPerOperator,
	}
}

func (w *CreatorProfileAssignmentWorker) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(w.Interval)
		defer ticker.Stop()

		w.reassignIdleProfiles(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				w.reassignIdleProfiles(ctx)
			}
		}
	}()
}

func (w *CreatorProfileAssignmentWorker) reassignIdleProfiles(ctx context.Context) {
	assignments, err := w.Repo.ReassignIdleCreatorProfiles(
		ctx,
		int64(w.IdleAfter.Seconds()),
		w.BatchSize,
		w.MaxManaged,
	)
	if err != nil {
		log.Printf("[CREATOR PROFILE WORKER] Failed to reassign idle profiles: %v", err)
		return
	}

	for _, assignment := range assignments {
		log.Printf(
			"[CREATOR PROFILE WORKER] Assigned profile %s (%s) from %s to %s with %d pending reply/replies",
			assignment.ProfileID,
			assignment.ProfileName,
			assignment.PreviousManager,
			assignment.NewManager,
			assignment.PendingReplies,
		)
		if w.Events == nil {
			log.Printf("[CREATOR PROFILE WORKER] Notification service is not configured for profile %s", assignment.ProfileID)
			continue
		}

		w.Events.ProcessEvent(ctx, services.AppEvent{
			RecipientID: assignment.NewManager,
			WSEventType: "CREATOR_PROFILE_ASSIGNED",
			WSPayload: map[string]interface{}{
				"title":           "A profile was assigned to you",
				"message":         assignment.ProfileName + " was assigned to you because your recent activity meets the creator eligibility rules.",
				"profile_id":      assignment.ProfileID,
				"profile_name":    assignment.ProfileName,
				"pending_replies": assignment.PendingReplies,
			},
		})
		if assignment.PreviousManager != "" {
			w.Events.ProcessEvent(ctx, services.AppEvent{
				RecipientID: assignment.PreviousManager,
				WSEventType: "CREATOR_PROFILE_REASSIGNED",
				WSPayload: map[string]interface{}{
					"title":           "A profile was reassigned",
					"message":         assignment.ProfileName + " was reassigned after five hours without a reply to its clients.",
					"profile_id":      assignment.ProfileID,
					"profile_name":    assignment.ProfileName,
					"pending_replies": assignment.PendingReplies,
				},
			})
		}
	}
}

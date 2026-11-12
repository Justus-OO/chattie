package workers

import (
	"context"
	"log"
	"time"

	"chattie-backend/repository"
)

type ADCreatorApplicationWorker struct {
	Repo     *repository.ADPerformerRepository
	Interval time.Duration
}

func NewADCreatorApplicationWorker(repo *repository.ADPerformerRepository) *ADCreatorApplicationWorker {
	return &ADCreatorApplicationWorker{Repo: repo, Interval: 15 * time.Second}
}

func (w *ADCreatorApplicationWorker) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(w.Interval)
		defer ticker.Stop()

		w.processEligibleApplications(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				w.processEligibleApplications(ctx)
			}
		}
	}()
}

func (w *ADCreatorApplicationWorker) processEligibleApplications(ctx context.Context) {
	approved, err := w.Repo.ApproveEligibleApplications(ctx)
	if err != nil {
		log.Printf("[AFTER DARK APPLICATION WORKER] Failed to process applications: %v", err)
		return
	}
	if approved > 0 {
		log.Printf("[AFTER DARK APPLICATION WORKER] Auto-approved %d eligible creator application(s)", approved)
	}
}

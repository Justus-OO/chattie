package workers

import (
	"context"
	"log"
	"time"

	"chattie-backend/repository"
)

type ADPayoutRecoveryWorker struct {
	Repo     *repository.ADFinanceRepository
	Interval time.Duration
	Batch    int
}

func NewADPayoutRecoveryWorker(repo *repository.ADFinanceRepository) *ADPayoutRecoveryWorker {
	return &ADPayoutRecoveryWorker{
		Repo:     repo,
		Interval: time.Minute,
		Batch:    100,
	}
}

func (w *ADPayoutRecoveryWorker) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(w.Interval)
		defer ticker.Stop()

		w.recover(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				w.recover(ctx)
			}
		}
	}()
}

func (w *ADPayoutRecoveryWorker) recover(ctx context.Context) {
	failed, err := w.Repo.RecoverFailedWithdrawalReversals(ctx, w.Batch)
	if err != nil {
		log.Printf("[AFTER DARK PAYOUT RECOVERY] Could not reconcile failed withdrawals: %v", err)
		return
	}
	unsubmitted, err := w.Repo.RecoverStaleUnsubmittedWithdrawals(ctx, w.Batch)
	if err != nil {
		log.Printf("[AFTER DARK PAYOUT RECOVERY] Could not release stale unsubmitted withdrawals: %v", err)
		return
	}
	if failed > 0 || unsubmitted > 0 {
		log.Printf("[AFTER DARK PAYOUT RECOVERY] Reversed %d failed and %d never-submitted withdrawals", failed, unsubmitted)
	}
}

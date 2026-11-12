package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"chattie-backend/config"
	"chattie-backend/database"
	"chattie-backend/handlers"
	"chattie-backend/middlewares"
	"chattie-backend/models"
	"chattie-backend/repository"
	"chattie-backend/services"
	"chattie-backend/workers"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func main() {
	// =======================================================
	// 1. LOAD CONFIGURATION, LOCALIZATION & DATABASE
	// =======================================================
	cfg := config.LoadConfig()

	if err := services.InitI18n(); err != nil {
		log.Fatalf("Failed to load translations: %v", err)
	}

	db := database.ConnectDB(cfg.DBUrl)
	defer db.Close()

	handlers.ReloadFilters(db)

	// =======================================================
	// 2. INITIALIZE ALL REPOSITORIES FIRST
	// =======================================================
	repo := repository.NewRepository(db)
	settingsRepo := repository.NewSettingsRepository(db)
	roomRepo := repository.NewRoomRepository(db)
	chatRepo := repository.NewChatRepository(db)
	adminTSRepo := repository.NewAdminRepository(db)

	// After Dark Repositories
	adPerformerRepo := repository.NewADPerformerRepository(db)
	adProfileRepo := repository.NewADProfileRepository(db)
	adMediaRepo := repository.NewADMediaRepository(db)
	adDiscoveryRepo := repository.NewADDiscoveryRepository(db)
	adBillingRepo := repository.NewADBillingRepository(db)
	adInteractionsRepo := repository.NewADInteractionsRepository(db)
	adChatRepo := repository.NewADChatRepository(db)
	adFinanceRepo := repository.NewADFinanceRepository(db)
	adSubscriptionRepo := repository.NewADSubscriptionRepository(db)
	adLiveRepo := repository.NewADLiveRepository(db)
	adSettingsRepo := repository.NewADSettingsRepository(db)
	// =======================================================
	// 3. INITIALIZE CORE SERVICES & EVENT HUB
	// =======================================================
	// Storage Service (Backblaze B2)
	uploadService := services.NewUploadService()

	// AWS SDK Configuration (Required for Rekognition)
	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Fatalf("CRITICAL: Failed to load AWS config for Verification Service: %v", err)
	}
	verificationService := services.NewVerificationService(awsCfg)

	// Chat & WebSockets
	chatHub := handlers.NewHub(chatRepo)
	go chatHub.Run()
	chatHandler := handlers.NewWebSocketHandler(chatHub, chatRepo)

	// Email Engine
	emailClient := services.NewEmailClient()
	emailClient.ConfigureQueue(repo)
	go emailClient.ProcessQueue(context.Background())
	emailHandler := handlers.NewEmailHandler(repo, emailClient)

	// SMS Engine
	smsClient := services.NewSMSClient()
	smsClient.ConfigureQueue(repo)
	go smsClient.ProcessQueue(context.Background())

	// Dynamic Billing Router
	stripeGateway := services.NewStripeGateway()
	paystackGateway := services.NewPaystackGateway()
	mpesaGateway := services.NewMpesaGateway()
	billingRouter := services.NewBillingRouter(stripeGateway, paystackGateway, mpesaGateway)

	// Notification Engine & Event Handler
	notifService := services.NewNotificationService(repo, emailClient, chatHub)
	eventHandler := services.NewEventHandler(repo, notifService)

	// =======================================================
	// 4. START BACKGROUND WORKERS
	// =======================================================
	go handlers.StartActionLogger(repo)
	go handlers.ProcessActionJobs(context.Background(), repo)
	go handlers.ProcessExportJobs(context.Background(), repo, settingsRepo, emailHandler)

	cronWorker := workers.NewCronWorker(repo, notifService)
	cronWorker.Start(context.Background())
	adCreatorApplicationWorker := workers.NewADCreatorApplicationWorker(adPerformerRepo)
	adCreatorApplicationWorker.Start(context.Background())

	// =======================================================
	// 5. INITIALIZE HTTP HANDLERS
	// =======================================================
	// Onboarding & Auth Handlers
	otpHandler := handlers.NewOTPHandler(repo, smsClient, emailHandler)
	onboardingHandler := handlers.NewOnboardingHandler(repo, emailHandler, uploadService)
	authHandler := handlers.NewAuthHandler(repo, eventHandler)
	authHandler.Email = emailHandler
	authHandler.SMS = smsClient

	// Core Handlers
	discoverHandler := handlers.NewDiscoverHandler(repo)
	gridHandler := handlers.NewGridHandler(repo)
	interactionHandler := handlers.NewInteractionHandler(repo, eventHandler)
	roomHandler := handlers.NewRoomHandler(roomRepo, eventHandler)
	notificationHandler := handlers.NewNotificationHandler(repo, eventHandler.Push)

	// Settings & Billing Handlers
	billingHandler := handlers.NewBillingHandler(repo, billingRouter, eventHandler)
	extrasHandler := handlers.NewExtrasHandler(repo, eventHandler)
	settingsHandler := handlers.NewSettingsHandler(settingsRepo, uploadService, emailHandler, eventHandler, verificationService)
	creatorHandler := handlers.NewCreatorHandler(repo, eventHandler)

	// After Dark Handlers
	adPerformerHandler := handlers.NewADPerformerHandler(adPerformerRepo)
	adProfileHandler := handlers.NewADProfileHandler(adProfileRepo)
	adMediaHandler := handlers.NewADMediaHandler(adMediaRepo, uploadService)
	adDiscoveryHandler := handlers.NewADDiscoveryHandler(adDiscoveryRepo)
	adBillingHandler := handlers.NewADBillingHandler(adBillingRepo)
	adInteractionsHandler := handlers.NewADInteractionsHandler(adInteractionsRepo, eventHandler)
	adChatHandler := handlers.NewADChatHandler(adChatRepo, adMediaRepo, uploadService, chatHub, eventHandler)
	adFinanceHandler := handlers.NewADFinanceHandler(adFinanceRepo, mpesaGateway, paystackGateway)
	adSubscriptionHandler := handlers.NewADSubscriptionHandler(adSubscriptionRepo)
	adLiveHandler := handlers.NewADLiveHandler(adLiveRepo, adFinanceRepo)
	adPaymentsHandler := handlers.NewADPaymentsHandler(adFinanceRepo, repo, eventHandler, paystackGateway, mpesaGateway, adLiveHandler.RoomClient)
	adSettingsHandler := handlers.NewADSettingsHandler(adSettingsRepo)
	// adMediaHandler := handlers.NewADMediaHandler(adMediaRepo, uploadService) // Ready for Phase 2 completion

	// Admin Infrastructure Handlers
	adminCreatorHandler := handlers.NewAdminCreatorHandler(repo, eventHandler)
	adminClientHandler := handlers.NewAdminClientHandler(repo, eventHandler)
	adminMediaHandler := handlers.NewAdminMediaHandler(repo)
	adminRoomHandler := handlers.NewAdminRoomHandler(repo, chatHub)
	pdfHandler := handlers.NewPDFHandler(repo)
	adminTSHandler := handlers.NewAdminHandler(adminTSRepo, eventHandler)

	// =======================================================
	// 6. SETUP ROUTER & MIDDLEWARES
	// =======================================================
	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "Accept-Language"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	// Security & Localization Middlewares
	r.Use(middlewares.IPBanMiddleware(db))
	r.Use(services.I18nMiddleware)

	// Public API Routes
	r.Post("/api/auth/register", authHandler.Register)
	r.Post("/api/auth/login", authHandler.Login)
	r.Post("/api/auth/login/verify", authHandler.VerifyLoginTwoFactor)
	r.Post("/api/auth/password-reset/request", authHandler.RequestPasswordReset)
	r.Post("/api/auth/password-reset/complete", authHandler.CompletePasswordReset)
	r.Post("/api/auth/google", authHandler.GoogleSignIn)
	r.Post("/api/auth/apple", authHandler.AppleSignIn)
	r.Get("/ws", chatHandler.HandleWebSocket)
	r.Post("/api/subscriptions/mpesa/callback", billingHandler.MpesaCallback)
	r.Post("/api/afterdark/payments/mpesa/callback", adPaymentsHandler.MpesaCallback)
	r.Post("/api/afterdark/payments/paystack/webhook", adPaymentsHandler.PaystackWebhook)
	r.Post("/api/afterdark/payouts/mpesa/result", adFinanceHandler.MpesaB2CResult)
	r.Post("/api/afterdark/payouts/mpesa/timeout", adFinanceHandler.MpesaB2CTimeout)

	// Protected API Routes (Requires JWT Authentication)
	r.Group(func(r chi.Router) {
		r.Use(middlewares.AuthMiddlewareWithDB(db))
		r.Get("/api/auth/two-factor", authHandler.GetTwoFactorSettings)
		r.Post("/api/auth/two-factor/setup", authHandler.RequestTwoFactorChange)
		r.Post("/api/auth/two-factor/verify", authHandler.VerifyTwoFactorChange)

		// -----------------------------------------------------
		// AFTER DARK (AD) ROUTES
		// -----------------------------------------------------
		r.Route("/api/afterdark", func(r chi.Router) {
			// Onboarding & Consents
			r.Post("/me/creator-application", adPerformerHandler.SubmitApplication)
			r.Get("/me/creator-application", adPerformerHandler.GetMyApplication)

			// Creator Profile Management
			r.Get("/me/creator-profile", adProfileHandler.GetMyPerformerProfile)
			r.Patch("/me/creator-profile", adProfileHandler.UpdateMyPerformerProfile)
			r.Post("/me/creator-profile/{kind}-upload", adMediaHandler.UploadCreatorImage)

			r.Get("/me/posts", adMediaHandler.GetVaultPosts)
			r.Post("/me/posts", adMediaHandler.CreatePost)
			r.Patch("/me/posts/{postId}", adMediaHandler.UpdatePost)

			r.Get("/creators", adDiscoveryHandler.GetDirectory)
			r.Get("/creators/{creatorId}", adDiscoveryHandler.GetCreatorProfile)
			r.Get("/feed", adDiscoveryHandler.GetFeed)
			r.Get("/posts/{postId}/media-url", adMediaHandler.GetPostMediaURL)

			r.Get("/wallet", adBillingHandler.GetWallet)
			r.Post("/checkout-intents", adBillingHandler.UnlockPostWithWallet)
			r.Post("/payments/checkout", adPaymentsHandler.CreateCheckout)
			r.Get("/payments/{intentId}", adPaymentsHandler.GetPaymentStatus)
			r.Get("/checkout-intents/{intentId}", adFinanceHandler.GetCheckoutIntent)

			r.Post("/posts/{postId}/likes", adInteractionsHandler.ToggleLike)
			r.Get("/posts/{postId}/comments", adInteractionsHandler.GetComments)
			r.Post("/posts/{postId}/comments", adInteractionsHandler.AddComment)
			r.Post("/moderation/reports", adInteractionsHandler.SubmitReport)

			r.Post("/conversations", adChatHandler.InitConversation)
			r.Get("/conversations", adChatHandler.GetConversations)
			r.Post("/conversations/{conversationId}/attachments", adChatHandler.UploadAttachment)
			r.Get("/conversations/{conversationId}/messages", adChatHandler.GetMessages)
			r.Post("/conversations/{conversationId}/messages", adChatHandler.SendMessage)
			r.Post("/conversations/{conversationId}/block", adChatHandler.SetConversationBlock)
			r.Post("/conversations/{conversationId}/unlock", adChatHandler.UnlockChat)

			r.Post("/wallet/deposits", adFinanceHandler.InitiateDeposit)
			r.Post("/wallet/withdrawals", adFinanceHandler.RequestWithdrawal)

			r.Post("/creators/{creatorId}/subscriptions", adSubscriptionHandler.Subscribe)
			r.Post("/creators/{creatorId}/tips", adFinanceHandler.SendTip)
			r.Get("/me/subscriptions", adSubscriptionHandler.GetMySubscriptions)

			r.Get("/live-sessions", adLiveHandler.GetLiveSessions)
			r.Post("/live-sessions", adLiveHandler.StartLive)
			r.Post("/live-sessions/{sessionId}/host-token", adLiveHandler.RefreshHostToken)
			r.Post("/live-sessions/{sessionId}/leave", adLiveHandler.LeaveLive)
			r.Post("/live-sessions/{sessionId}/join", adLiveHandler.JoinLive)
			r.Post("/live-sessions/{sessionId}/tips", adLiveHandler.TipLiveSession)
			r.Post("/live-sessions/{sessionId}/end", adLiveHandler.EndLive)
			r.Post("/live-sessions/{sessionId}/guest-requests", adLiveHandler.RequestStage)
			r.Post("/live-sessions/{sessionId}/guest-requests/{viewerId}/approve", adLiveHandler.ApproveGuest)
			r.Post("/live-sessions/{sessionId}/guest-requests/{viewerId}/deny", adLiveHandler.DenyGuest)

			r.Post("/me/creator-pause", adSettingsHandler.PauseCreator)
			r.Delete("/me/creator-pause", adSettingsHandler.ResumeCreator)
			r.Delete("/me/creator-status", adSettingsHandler.DeactivateCreator)
			r.Patch("/me/settings", adSettingsHandler.UpdateSettings)
			r.Post("/me/data-export", adSettingsHandler.RequestDataExport)

			r.Get("/stories", adDiscoveryHandler.GetStories)
			r.Delete("/me/posts/{postId}", adMediaHandler.DeletePost)
			r.Post("/conversations/{conversationId}/read", adChatHandler.MarkRead)
			r.Post("/live-sessions/{sessionId}/stage/{participantId}/remove", adLiveHandler.RemoveGuest)

			r.Post("/creators/{creatorId}/follow", adDiscoveryHandler.ToggleFollow)
			r.Post("/share-links", adDiscoveryHandler.CreateShareLink)
			r.Post("/me/payout-methods", adFinanceHandler.AddPayoutMethod)
			r.Get("/payout-methods/paystack/banks", adFinanceHandler.GetPaystackBanks)

			r.Get("/me/settings", adSettingsHandler.GetSettings)
			r.Get("/wallet/history", adFinanceHandler.GetTransactionHistory)
			r.Get("/wallet/transactions", adFinanceHandler.GetTransactionHistory)
			r.Get("/me/payout-methods", adFinanceHandler.GetPayoutMethods)

			r.Get("/me/earnings", adFinanceHandler.GetEarnings)

			// 2. Fix for 405 on /wallet/withdrawals
			r.Get("/wallet/withdrawals", adFinanceHandler.GetWithdrawals)
			// Note: You should already have r.Post("/wallet/withdrawals", ...) defined.
			// The 405 means the POST exists but the GET is missing. Ensure both are there.

			// 3. Fix for 404 on /me/subscribers
			r.Get("/me/subscribers", adProfileHandler.GetSubscribers)

			// r.Post("/uploads", adMediaHandler.ReserveUpload)
			// r.Post("/uploads/{uploadId}/complete", adMediaHandler.CompleteUpload)
			// r.Get("/me/posts", adMediaHandler.GetVaultPosts)
			// r.Post("/me/posts", adMediaHandler.CreatePost)
		})

		// Profile & Onboarding Routes
		r.Route("/api/profile", func(r chi.Router) {
			r.Post("/request-otp", otpHandler.RequestOTP)
			r.Post("/verify-otp", onboardingHandler.VerifyOTP)
			r.Post("/media/initial", onboardingHandler.SetupInitialMedia)
			r.Post("/setup", onboardingHandler.SetupProfile)
			r.Post("/location", onboardingHandler.SetupLocation)
			r.Post("/preferences", onboardingHandler.SetupPreferences)
			r.Post("/activate", onboardingHandler.ActivateAccount)
		})

		// Settings & Account Routes
		r.Route("/api/settings", func(r chi.Router) {
			r.Get("/", settingsHandler.GetSettings)
			r.Put("/", settingsHandler.UpdateSettings)
			r.Post("/password", authHandler.ChangePassword)
			r.Delete("/account", settingsHandler.DeleteAccount)

			r.Get("/verification-config", settingsHandler.GetVerificationConfig)
			r.Post("/verify", settingsHandler.VerifyProfile)
			r.Post("/request-data", settingsHandler.RequestDataDownload)
			r.Post("/terminate-sessions", settingsHandler.TerminateOtherSessions)
			r.Get("/sessions", settingsHandler.GetActiveSessions)
			r.Delete("/sessions/{sessionId}", settingsHandler.RevokeActiveSession)
			r.Get("/blocked", settingsHandler.GetBlockedUsers)
			r.Delete("/blocked/{id}", settingsHandler.UnblockUser)

			r.Get("/media", settingsHandler.GetMediaVault)
			r.Post("/media", settingsHandler.UploadMedia)
			r.Delete("/media/{media_id}", settingsHandler.DeleteMedia)
			r.Put("/media/{media_id}/primary", settingsHandler.SetPrimaryMedia)
		})

		// Discovery Routes
		r.Get("/api/discover/deck", discoverHandler.GetSwipeDeck)
		r.Get("/api/grid", gridHandler.GetGridBrowse)

		// Interaction & Match Routes
		r.Route("/api/interactions", func(r chi.Router) {
			r.Post("/", interactionHandler.HandleAction)
			r.Get("/profile/{target_id}", interactionHandler.GetFullProfile)
			r.Post("/unmatch", interactionHandler.UnmatchUser)
			r.Post("/block", interactionHandler.BlockUser)
		})
		r.Get("/api/matches", interactionHandler.GetMatches)

		// Notifications Routes
		r.Route("/api/notifications", func(r chi.Router) {
			r.Get("/", notificationHandler.List)
			r.Patch("/read", notificationHandler.MarkAllRead)
			r.Patch("/{id}/read", notificationHandler.MarkRead)
			r.Delete("/{id}", notificationHandler.Delete)
			r.Get("/push/vapid", notificationHandler.GetVAPIDPublicKey)
			r.Post("/push/subscriptions", notificationHandler.SavePushSubscription)
			r.Delete("/push/subscriptions", notificationHandler.DeletePushSubscription)
		})

		// Rooms Routes
		r.Route("/api/rooms", func(r chi.Router) {
			r.Get("/", roomHandler.GetRooms)
			r.Post("/", roomHandler.CreateRoom)
			r.Post("/join", roomHandler.JoinRoom)
			r.Post("/voice-token", roomHandler.GenerateVoiceToken)
			r.Post("/request-access", roomHandler.RequestAccess)
			r.Get("/{roomId}/participants", roomHandler.GetRoomParticipants)
			r.Get("/{roomId}/admin-details", roomHandler.GetRoomAdminDetails)
			r.Post("/{roomId}/manage-request", roomHandler.ManageJoinRequest)
			r.Put("/{roomId}", roomHandler.UpdateRoom)
			r.Post("/{roomId}/leave", roomHandler.LeaveRoom)
			r.Post("/{roomId}/moderate", roomHandler.KickOrBanParticipant)
		})

		// Subscriptions & Monetization Routes
		r.Route("/api/subscriptions", func(r chi.Router) {
			r.Post("/upgrade", billingHandler.UpgradeTier)
			r.Get("/plans", billingHandler.GetPlans)
			r.Get("/verify", billingHandler.VerifyPayment)
			r.Get("/mpesa/status", billingHandler.MpesaPaymentStatus)
			r.Get("/payment-methods", billingHandler.GetPaymentMethods)
			r.Delete("/payment-methods/{id}", billingHandler.DeletePaymentMethod)
			r.Post("/kyc", settingsHandler.VerifyIdentityKYC)
			r.Post("/extras", extrasHandler.HandleUpgrade)
		})

		// Extras, Moderation & Guidelines Routes
		r.Route("/api/extras", func(r chi.Router) {
			r.Get("/admirers", extrasHandler.GetSecretAdmirers)
			r.Post("/undo", extrasHandler.UndoAction)
			r.Post("/report", extrasHandler.ReportUser)
			r.Post("/guidelines/agree", extrasHandler.HandleAgreeGuidelines)
		})

		// Admin Routes
		r.Route("/api/admin", func(r chi.Router) {
			r.Use(middlewares.RequireRole("admin"))

			r.Get("/afterdark/earnings-clearance", adFinanceHandler.GetPendingEarningsClearance)
			r.Post("/afterdark/earnings-clearance/{userId}", adFinanceHandler.ClearCreatorEarnings)

			r.Route("/media", func(r chi.Router) {
				r.Get("/vaults", adminMediaHandler.GetVaults)
				r.Get("/vaults/{id}/gallery", adminMediaHandler.GetVaultGallery)
				r.Patch("/vaults/{id}/primary/{mediaId}", adminMediaHandler.SetPrimary)
				r.Post("/vaults/{id}/inject", adminMediaHandler.InjectAssets)
				r.Delete("/assets/{mediaId}", adminMediaHandler.DeleteMedia)
				r.Get("/audit-logs", adminMediaHandler.GetAuditLogs)
			})

			r.Route("/rooms", func(r chi.Router) {
				r.Get("/", adminRoomHandler.GetRooms)
				r.Get("/knocks", adminRoomHandler.GetKnocks)
				r.Post("/knocks/{knockId}/resolve", adminRoomHandler.ResolveKnock)
				r.Delete("/{id}", adminRoomHandler.TerminateRoom)
				r.Get("/{id}/participants", adminRoomHandler.GetParticipants)
				r.Delete("/{id}/participants/{userId}", adminRoomHandler.KickParticipant)
			})

			r.Route("/moderation", func(r chi.Router) {
				r.Get("/queue", adminTSHandler.GetQueue)
				r.Post("/action", adminTSHandler.ResolveIncident)
				r.Get("/audit", adminTSHandler.GetAuditLogs)
				r.Get("/rules", adminTSHandler.GetFirewallRules)
				r.Post("/rules/toggle", adminTSHandler.ToggleFirewallRule)
			})

			r.Get("/operators", adminCreatorHandler.GetAdminRoster)
			r.Patch("/operators/{id}/commission", adminCreatorHandler.UpdateCommission)
			r.Patch("/operators/{id}/status", adminCreatorHandler.UpdateOperatorStatus)
			r.Patch("/operators/{id}/autopilot", adminCreatorHandler.ToggleAutoPilot)

			r.Post("/operators/{id}/personas/{personaId}", adminCreatorHandler.BindPersona)
			r.Delete("/operators/{id}/personas/{personaId}", adminCreatorHandler.UnbindPersona)

			r.Get("/personas-metrics", adminCreatorHandler.GetPersonasMetrics)
			r.Post("/creators/provision", adminCreatorHandler.CreateCreatorAccount)

			r.Get("/clients", adminClientHandler.GetClientDirectory)
			r.Get("/clients/{id}/telemetry", adminTSHandler.GetClientTelemetry)
			r.Patch("/clients/{id}/ban", adminClientHandler.ToggleBan)
			r.Patch("/clients/{id}/revoke-tier", adminClientHandler.RevokeTier)

			r.Post("/personas", adminCreatorHandler.CreatePersona)

			// Report Routes (PDF generation)
			r.Route("/reports", func(r chi.Router) {
				r.Get("/user/{userId}", pdfHandler.GenerateUserReport)
				r.Get("/financial", pdfHandler.GenerateFinancialLedger)
				r.Get("/security", pdfHandler.GenerateSecurityReport)
			})
		})

		// Creator / Model Routes
		r.Route("/api/creator", func(r chi.Router) {
			r.Use(middlewares.RequireRole("model"))

			r.Get("/profiles", creatorHandler.GetProfiles)
			r.Patch("/profiles/{profile_id}/status", creatorHandler.UpdateStatus)

			r.Get("/dashboard", creatorHandler.GetStats)
			r.Get("/queue", creatorHandler.GetQueue)
			r.Post("/queue/{request_id}/action", creatorHandler.ProcessQueueAction)
			r.Get("/ledger", creatorHandler.GetLedger)
			r.Post("/payout", creatorHandler.RequestPayout)
			r.Get("/profiles/{profile_id}/media", creatorHandler.GetProfileMedia)
			r.Get("/insights/{userId}", chatHandler.GetUserInsights)
		})

		// Chat & Inbox Routes
		r.Route("/api/chats", func(r chi.Router) {
			r.Post("/media", handlers.UploadChatMedia)
			r.Get("/inbox", chatHandler.GetInbox)

			r.Patch("/{target_id}/read", func(w http.ResponseWriter, r *http.Request) {
				targetID := chi.URLParam(r, "target_id")
				userID, ok := r.Context().Value(middlewares.UserIDKey).(string)

				if !ok || userID == "" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}

				err := chatRepo.MarkMessagesAsRead(userID, targetID)
				if err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					return
				}

				handlers.ActionLogQueue <- models.ActionLog{
					UserID:     userID,
					ActionType: "MESSAGES_READ_HTTP",
					TargetID:   targetID,
				}

				w.WriteHeader(http.StatusOK)
			})

			r.Get("/{target_id}", func(w http.ResponseWriter, r *http.Request) {
				targetID := chi.URLParam(r, "target_id")
				chatType := r.URL.Query().Get("type")

				userID, ok := r.Context().Value(middlewares.UserIDKey).(string)
				if !ok || userID == "" {
					w.WriteHeader(http.StatusUnauthorized)
					json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
					return
				}

				var messages []models.Message
				var err error

				if chatType == "dm" {
					messages, err = chatRepo.GetDirectMessages(userID, targetID, 50)
				} else {
					messages, err = chatRepo.GetRoomMessages(targetID, 50)
				}

				if err != nil {
					log.Printf("500 Error fetching chat history for target %s: %v\n", targetID, err)
					w.WriteHeader(http.StatusInternalServerError)
					json.NewEncoder(w).Encode(map[string]string{"error": "Could not fetch chat history"})
					return
				}

				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(messages)
			})
		})
	})

	// Static Assets Server
	workDir, _ := os.Getwd()
	filesDir := http.Dir(filepath.Join(workDir, "uploads"))
	r.Handle("/uploads/*", http.StripPrefix("/uploads/", http.FileServer(filesDir)))

	// =======================================================
	// 7. CONFIGURE & START SERVER
	// =======================================================
	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  15 * time.Second,
	}

	fmt.Printf("==========================================\n")
	fmt.Printf(" CHATTIE BACKEND ONLINE: PORT %s\n", cfg.Port)
	fmt.Printf("==========================================\n")

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server failed to start: %v", err)
	}
}

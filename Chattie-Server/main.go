package main

import (
	"chattie-backend/models"
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
	"chattie-backend/repository"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func main() {
	// 1. Load Configuration
	cfg := config.LoadConfig()

	// 2. Initialize PostgreSQL Database
	db := database.ConnectDB(cfg.DBUrl)
	defer db.Close()

	// 3. Initialize Repository and All Handlers
	repo := repository.NewRepository(db)
	authHandler := handlers.NewAuthHandler(repo)
	onboardingHandler := handlers.NewOnboardingHandler(repo)
	discoverHandler := handlers.NewDiscoverHandler(repo)
	gridHandler := handlers.NewGridHandler(repo)
	interactionHandler := handlers.NewInteractionHandler(repo)
	extrasHandler := handlers.NewExtrasHandler(repo)
	creatorHandler := handlers.NewCreatorHandler(repo)

	// Initialize Settings Infrastructure
	settingsRepo := repository.NewSettingsRepository(db)
	settingsHandler := handlers.NewSettingsHandler(settingsRepo)

	// Initialize Room Infrastructure
	roomRepo := repository.NewRoomRepository(db)
	roomHandler := handlers.NewRoomHandler(roomRepo)

	// Initialize Chat Infrastructure & WebSocket Hub
	chatRepo := repository.NewChatRepository(db)
	chatHub := handlers.NewHub()
	go chatHub.Run()
	chatHandler := handlers.NewWebSocketHandler(chatHub, chatRepo)

	// Initialize Admin Infrastructure
	adminCreatorHandler := handlers.NewAdminCreatorHandler(repo)
	adminClientHandler := handlers.NewAdminClientHandler(repo)
	adminMediaHandler := handlers.NewAdminMediaHandler(repo)
	adminRoomHandler := handlers.NewAdminRoomHandler(repo)

	// Initialize Trust & Safety Moderation Infrastructure
	adminTSRepo := repository.NewAdminRepository(db)
	adminTSHandler := handlers.NewAdminHandler(adminTSRepo)

	// 4. Setup Router
	r := chi.NewRouter()

	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// 5. Register Public API Routes
	r.Post("/api/auth/register", authHandler.Register)
	r.Post("/api/auth/login", authHandler.Login)

	// WebSocket Endpoint (Handles real-time communication protocol upgrade)
	r.Get("/ws", chatHandler.HandleWebSocket)

	// 6. Register Protected API Routes (Requires JWT Authentication)
	r.Group(func(r chi.Router) {
		r.Use(middlewares.AuthMiddleware) // Secures every route inside this group!

		// Profile & Onboarding Routes
		r.Route("/api/profile", func(r chi.Router) {
			r.Post("/setup", onboardingHandler.SetupProfile)
			r.Post("/location", onboardingHandler.SetupLocation)
			r.Post("/preferences", onboardingHandler.SetupPreferences)
			r.Post("/activate", onboardingHandler.ActivateAccount)
		})

		// Settings & Account Routes
		r.Route("/api/settings", func(r chi.Router) {
			r.Get("/", settingsHandler.GetSettings)
			r.Put("/", settingsHandler.UpdateSettings)
			r.Delete("/account", settingsHandler.DeleteAccount)

			// Media Vault Routes
			r.Get("/media", settingsHandler.GetMediaVault)
			r.Post("/media", settingsHandler.UploadMedia)
			r.Delete("/media/{media_id}", settingsHandler.DeleteMedia)
			r.Put("/media/{media_id}/primary", settingsHandler.SetPrimaryMedia)
		})

		// Discovery Routes
		r.Get("/api/discover/deck", discoverHandler.GetSwipeDeck)

		// Grid Discovery & Filter Routes
		r.Get("/api/grid", gridHandler.GetGridBrowse)

		// Interaction & Match Routes
		r.Route("/api/interactions", func(r chi.Router) {
			r.Post("/", interactionHandler.HandleAction)
			r.Get("/profile/{target_id}", interactionHandler.GetFullProfile)
			r.Post("/unmatch", interactionHandler.UnmatchUser)
			r.Post("/block", interactionHandler.BlockUser)
		})
		r.Get("/api/matches", interactionHandler.GetMatches)

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
		})

		// Subscriptions & Monetization Routes
		r.Route("/api/subscriptions", func(r chi.Router) {
			r.Post("/upgrade", extrasHandler.HandleUpgrade)
		})

		// Extras, Moderation & Guidelines Routes
		r.Route("/api/extras", func(r chi.Router) {
			r.Get("/admirers", extrasHandler.GetSecretAdmirers)
			r.Post("/undo", extrasHandler.UndoAction)
			r.Post("/report", extrasHandler.ReportUser)
			r.Post("/guidelines/agree", extrasHandler.HandleAgreeGuidelines)
		})

		r.Route("/api/admin", func(r chi.Router) {
			// Media Vault Management
			r.Route("/media", func(r chi.Router) {
				r.Get("/vaults", adminMediaHandler.GetVaults)
				r.Get("/vaults/{id}/gallery", adminMediaHandler.GetVaultGallery)
				r.Patch("/vaults/{id}/primary/{mediaId}", adminMediaHandler.SetPrimary)
				r.Post("/vaults/{id}/inject", adminMediaHandler.InjectAssets)
				r.Delete("/assets/{mediaId}", adminMediaHandler.DeleteMedia)
				r.Get("/audit-logs", adminMediaHandler.GetAuditLogs)
			})

			// Rooms Management (STATIC ROUTES PLACED ABOVE DYNAMIC ROUTES)
			r.Route("/rooms", func(r chi.Router) {
				r.Get("/", adminRoomHandler.GetRooms)
				r.Get("/knocks", adminRoomHandler.GetKnocks)
				r.Post("/knocks/{knockId}/resolve", adminRoomHandler.ResolveKnock)

				r.Delete("/{id}", adminRoomHandler.TerminateRoom)
				r.Get("/{id}/participants", adminRoomHandler.GetParticipants)
				r.Delete("/{id}/participants/{userId}", adminRoomHandler.KickParticipant)
			})

			// Trust & Safety / Moderation
			r.Route("/moderation", func(r chi.Router) {
				r.Get("/queue", adminTSHandler.GetQueue)
				r.Post("/action", adminTSHandler.ResolveIncident)
				r.Get("/audit", adminTSHandler.GetAuditLogs)
				r.Get("/rules", adminTSHandler.GetFirewallRules)
				r.Post("/rules/toggle", adminTSHandler.ToggleFirewallRule)
			})

			// Operator & Roster Management
			r.Get("/operators", adminCreatorHandler.GetAdminRoster)
			r.Patch("/operators/{id}/commission", adminCreatorHandler.UpdateCommission)
			r.Patch("/operators/{id}/status", adminCreatorHandler.UpdateOperatorStatus)
			r.Patch("/operators/{id}/autopilot", adminCreatorHandler.ToggleAutoPilot)

			// Persona Binding
			r.Post("/operators/{id}/personas/{personaId}", adminCreatorHandler.BindPersona)
			r.Delete("/operators/{id}/personas/{personaId}", adminCreatorHandler.UnbindPersona)

			// Metrics & Provisioning
			r.Get("/personas-metrics", adminCreatorHandler.GetPersonasMetrics)
			r.Post("/creators/provision", adminCreatorHandler.CreateCreatorAccount)

			// Client Directory & Telemetry
			r.Get("/clients", adminClientHandler.GetClientDirectory)
			r.Get("/clients/telemetry", adminClientHandler.GetClientTelemetry)
			r.Patch("/clients/{id}/ban", adminClientHandler.ToggleBan)
			r.Patch("/clients/{id}/revoke-tier", adminClientHandler.RevokeTier)

			r.Post("/personas", adminCreatorHandler.CreatePersona)
		})

		// =====================================================================
		// CREATOR / MODEL ROUTES (SECURED BY JWT + ROLE CHECK)
		// =====================================================================
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
		})

		// Chat & Inbox Routes
		r.Route("/api/chats", func(r chi.Router) {
			r.Get("/inbox", chatHandler.GetInbox)

			r.Patch("/{target_id}/read", func(w http.ResponseWriter, r *http.Request) {
				targetID := chi.URLParam(r, "target_id")
				userID, ok := r.Context().Value(middlewares.UserIDKey).(string)

				if !ok || userID == "" {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}

				_, err := db.Exec(`
                UPDATE messages 
                SET status = 'read' 
                WHERE recipient_id = $1 AND sender_id = $2 AND status = 'sent'
             `, userID, targetID)

				if err != nil {
					w.WriteHeader(http.StatusInternalServerError)
					return
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

	workDir, _ := os.Getwd()
	filesDir := http.Dir(filepath.Join(workDir, "uploads"))
	r.Handle("/uploads/*", http.StripPrefix("/uploads/", http.FileServer(filesDir)))

	// 7. Configure & Start Server
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

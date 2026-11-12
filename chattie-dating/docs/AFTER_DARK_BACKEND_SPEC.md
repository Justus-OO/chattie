# After Dark Backend Specification

## 1. Purpose and implementation boundary

This document inventories the After Dark UI currently present in the frontend and describes the backend needed to make its actions durable, authorized, and available across devices. It is a backend implementation specification, not a claim that those endpoints already exist.

The current frontend is a prototype. Most After Dark pages use generated/mock data, Zustand state persisted in the browser, `localStorage`, browser timers, or `BroadcastChannel`. Those mechanisms are useful for interaction design but are not an authorization boundary and must not be trusted for account identity, age verification, payment, wallet balances, subscriptions, content access, messages, live admission, moderation, or payouts.

The app already has a Go backend in the sibling `Chattie-Server` repository. Implement these capabilities there, following its existing authentication, router, migration, handler, service, repository, and response conventions. Keep After Dark server work in a bounded module/package and reuse shared users, authentication, settings, billing, notification, and payment infrastructure where appropriate. The current frontend contains generic settings service endpoints; see [Existing integration points](#4-existing-integration-points-and-gaps).

### Non-negotiable invariants

1. Authenticate every private request from the server-validated session/JWT. Never accept a client-supplied user ID as authority.
2. Verify age/identity and creator eligibility server-side before enabling creator tools or serving adult content.
3. Keep explicit media private at rest and in delivery. Authorize every original, preview, thumbnail, and download URL; use short-lived signed URLs or an equivalent protected media gateway.
4. Grant a paid entitlement only after a provider-signed webhook or another server-verified payment result. A redirect, client callback, toast, local state mutation, or client-supplied transaction reference is not proof of payment.
5. A creator subscription belongs to a creator and has a server-defined billing period/status. A one-time live pass belongs to one exact live session. It must not grant access to later sessions.
6. Every monetary operation is an atomic, idempotent ledger operation. Never calculate authoritative funds from a browser-provided balance.
7. Check ownership/role and entitlements on every content, chat, and live request, not just when rendering a page.
8. Respect creator pause/deactivation, block lists, DM controls, geo restrictions, moderation status, and revoked/refunded/expired purchases in all relevant authorization checks.
9. Keep an audit trail for consent, age/identity verification decisions, payment state changes, payout changes, moderation/report actions, and account lifecycle actions.
10. Do not retain dates of birth, payout details, identity documents, explicit uploads, or message attachments longer than required by policy and law. Apply access controls, retention limits, and encryption.

## 2. Route and source-file inventory

Routes are mounted under `/afterdark` in `src/App.jsx` inside the After Dark layout and a protected client/model route group:

| Route | Frontend page | Primary capability |
|---|---|---|
| `/afterdark/feed` | `src/pages/afterdark/AfterDarkFeed.jsx` | Feed, PPV unlocks, stories/live access, creator broadcast controls |
| `/afterdark/directory` | `src/pages/afterdark/AfterDarkDirectory.jsx` | Search, facet filters, sorting, creator quick view/profile navigation |
| `/afterdark/cprofile` | `src/pages/afterdark/AfterDarkCreatorProfile.jsx` | Creator profile, subscribe, tip, chat, profile posts and post unlocks |
| `/afterdark/chats` | `src/pages/afterdark/AfterDarkChatHub.jsx` | Paid private chats and creator/customer message UI |
| `/afterdark/channel` | `src/pages/afterdark/AfterDarkMyChannel.jsx` | Creator media vault, subscriber list, finance/payout history, channel settings |
| `/afterdark/settings` | `src/pages/afterdark/AfterDarkSettings.jsx` | Member and creator account settings, privacy, security, notification preferences |
| `/afterdark/wallet` | `src/pages/afterdark/AfterDarkWallet.jsx` | Wallet balance, deposits, withdrawals, transaction history/export |

Shared surfaces and state:

| File | Current responsibility |
|---|---|
| `src/components/afterdark/AfterDarkLayout.jsx` | Responsive shell, mobile sidebar open/close and route-change close |
| `src/components/afterdark/AfterDarkSidebar.jsx` | Route links, upload, creator onboarding, account links, balance shortcut |
| `src/components/afterdark/OptInGateModal.jsx` | Creator onboarding/age and consent flow |
| `src/components/afterdark/UploadExplicitModal.jsx` | Upload metadata, pricing, schedule, performer/compliance declarations |
| `src/components/afterdark/LockedPostCard.jsx` | Feed post display, media controls, content warning, likes, comments, report/share |
| `src/components/afterdark/MpesaPaystackModal.jsx` | PPV/subscription/private-chat checkout UI; current M-Pesa/card success is simulated |
| `src/components/afterdark/AfterDarkLiveViewingModal.jsx` | Live paywall, viewer room, chat/reactions, guest request and camera controls |
| `src/store/useAppStore.js` | Browser-persisted prototype user, wallet, creator, subscription, live-pass, chat-access, and chat-history state |
| `src/hooks/useAfterDarkCollection.js`, `src/mocks/afterdark.js` | Present in the tree; currently do not provide the page data/API layer used by the pages |

The following are also part of the backend contract even though they are not standalone After Dark routes:

- `src/components/afterdark/AfterDarkFeed.jsx` contains the creator live studio and inline legacy viewer code; the active viewer is `AfterDarkLiveViewingModal`.
- `src/components/afterdark/MpesaPaystackModal.jsx` is shared by feed PPV, live passes/subscriptions, and private-chat unlock flows.
- `src/api/settings.service.js` already exposes generic settings, account, KYC, archive, sessions, blocked-user, and media methods. These are not a complete After Dark API.

## 3. User flows and authorization logic

### 3.1 Viewer discovers and unlocks a post

1. `GET /afterdark/feed` returns only posts visible to this viewer, with safe preview metadata and access state.
2. The viewer can filter/search/paginate without changing server data.
3. A free post requires the appropriate explicit-content acknowledgement if marked explicit. A subscriber-only post requires an active subscription to that creator. A PPV post requires a successful post-specific purchase.
4. The viewer starts checkout for a post. The server creates a payment intent using the authoritative price and payer identity.
5. The provider redirects/prompts the payer. A verified webhook updates the payment and wallet ledger atomically and creates the matching entitlement.
6. The client refreshes access state. The API returns protected media URLs only after authorization.
7. Likes, comments, reports, and shareable links use the interaction APIs described below. The server validates that the caller may interact and prevents duplicate likes or spam.

### 3.2 Subscribe to a creator

1. `GET /afterdark/creators/{creatorId}` returns profile and current public subscription price/status.
2. `POST /afterdark/creators/{creatorId}/subscription-checkouts` requests a new or renewal checkout; the server locks the product/price snapshot and returns a payment intent.
3. Only a verified provider success creates/extends the subscription. Subscription records include `status`, `started_at`, `current_period_start`, `current_period_end`, `cancel_at_period_end`, `cancelled_at`, and provider identifiers.
4. Entitlement checks treat only `active` subscriptions whose current period has not ended as valid. Handle pending, failed, grace, canceled-but-paid-through, expired, refunded, and disputed states explicitly.
5. Subscription UI, subscriber lists, active counts, renewal dates, subscriber-only media, chat rules, and live access derive from the same server record.

### 3.3 Buy a one-time live pass

1. Feed presence lists an active live session with a unique, server-issued `sessionId`.
2. `POST /afterdark/live-sessions/{sessionId}/checkouts` creates a live-pass payment intent. Price and creator/session status are resolved on the server, not trusted from the client.
3. A verified payment creates an entitlement scoped to `(viewer_id, session_id)`.
4. Every live join request checks session status and either an active creator subscription or a valid pass for that exact session. A one-time pass does not carry to a later broadcast.
5. The server authorizes and issues short-lived SFU credentials only after the join check. Refreshing or changing clients re-runs authorization.
6. Ending a live, refunding/disputing a payment, suspending the account, or revoking an entitlement blocks future token issuance immediately and closes active connections where practical.

### 3.4 Paid private chat

1. Creator privacy settings determine whether the user may start a conversation (`all`, `subscribers`, or `none` in the current UI).
2. Viewer chooses a creator and, if not entitled, starts a private-chat checkout. The UI shows the creator's current `chatPrice`; the backend remains authoritative.
3. Verified payment creates chat access with the correct product/duration. Do not authorize based solely on `afterDarkChatAccess` browser state.
4. `GET /afterdark/conversations` lists only conversations visible to the caller. `GET /afterdark/conversations/{id}/messages` returns paginated history after authorization.
5. Text and media messages are sent to a server endpoint or WebSocket. The server validates participants, rate limits, attachment upload completion, moderation status, explicit labels, and DM policy; then persists and broadcasts to the other participant.
6. Explicit media has server-side labels and safe previews. Viewer reveal preference affects presentation only and never removes the warning metadata or server policy.

### 3.5 Creator onboarding

1. Load authenticated account profile and server verification status. The current dialog reads `settingsService.getSettings()` but that is not creator approval.
2. Submit creator alias, date-of-birth/age evidence or verified identity reference, payout destination, and explicit consent acknowledgements to a protected onboarding endpoint.
3. The server records policy version, timestamp, actor, and consent version; performs/queues KYC and compliance checks; validates payout destination using a protected provider workflow; returns `pending`, `approved`, `rejected`, or `action_required`.
4. Do not make creator mode active until the required eligibility checks pass. The local “Enable creator mode” button currently changes local state only.
5. Subsequent creator media/live/payout APIs check approved creator status, not a client flag.

### 3.6 Creator content publication

1. Request an upload reservation after validating creator status and metadata.
2. Server issues a short-lived upload URL to private object storage. Client uploads chunks/resumable data directly to storage.
3. Client calls completion with the upload ID; server verifies checksum, size, MIME/content detection, ownership, malware scan, transcoding, and moderation state.
4. Server stores caption/category/tags/pricing/teaser/watermark/schedule/co-performer references and compliance attestations. Treat co-performers as validated creator or talent records with verified consent/documentation; do not trust a typed username.
5. `published` posts become visible only after compliance/moderation checks. `scheduled` posts are released by a server worker at `publish_at`; do not publish from browser timers.
6. Edit, delete, share, and stats use persistent post IDs and ownership checks. Deleting a post must define the fate of prior entitlements and refunds.

### 3.7 Creator wallet, revenue, and payouts

1. Purchases, tips, subscriptions, PPV, live passes, fees, refunds, and chargebacks produce immutable balanced ledger entries.
2. Available, pending, reserved, and paid-out balances are derived from ledger entries. Never keep a mutable client balance as the source of truth.
3. Hold eligible earnings for the configured clearance period (the prototype shows seven days), and make fee/tax calculations explicit and versioned.
4. A creator requests payout; server validates available cleared balance, verified payout method, thresholds, limits, and anti-fraud checks; funds are reserved atomically and a payout record is created.
5. Provider callbacks/webhooks move payout through `requested`, `processing`, `paid`, `failed`, or `reversed`. Failure releases the reserve exactly once.
6. Payout receipts, wallet history, channel finance metrics, and CSV export are generated from the same authorized server data.

## 4. Existing integration points and gaps

- `src/api/settings.service.js` currently calls generic `/settings`, `/settings/account`, `/settings/request-data`, `/settings/terminate-sessions`, `/settings/blocked`, `/settings/media`, `/settings/verification-config`, and `/subscriptions/kyc` routes. Confirm the Go server implementations and their authorization/response behavior before reusing them.
- `OptInGateModal` calls `settingsService.getSettings()` on open to read profile/verification-related fields. Its DOB check, M-Pesa preview, four acknowledgements, completion step, and creator activation are still prototype behavior. Move authoritative eligibility and creator approval to a dedicated server flow.
- `useAppStore` persists `afterDarkSubscriptions`, `afterDarkLivePasses`, `afterDarkChatAccess`, `afterDarkConversations`, `walletBalance`, creator flags, and identity flags to local storage. These are presentation caches only after backend integration. Replace “grant” actions with server responses/refetches; do not use local state to make protected APIs succeed.
- `MpesaPaystackModal` simulates both M-Pesa and Paystack/card success with timers. It does not send an actual payment request. Saved numbers and receipt references are mock/local.
- `AfterDarkWallet`, creator profile subscribe/tip, creator channel withdrawal, feed PPV, live checkout, chat unlock, upload, settings, and reports are client-simulated or locally persisted.
- `AfterDarkFeed` stores live-session presence in `localStorage` and signals only with same-origin `BroadcastChannel`. This cannot serve multiple devices or Internet-scale broadcast. Use authenticated server signaling and an SFU (the project already depends on LiveKit packages; evaluate that or the selected infrastructure). A server-minted LiveKit/SFU token must be issued only after live authorization.
- Directory, feed, posts, creator profiles, subscribers, stats, messages, live activity, transaction history, and payouts include generated/mock data. Replace each source with a paginated, authenticated API.
- Do not infer identity or creator access from `isCreator`, `isIdentityVerified`, client route guards, cached profile state, or local storage.

### 4.1 How the existing profile/settings files connect

The dating profile settings already have a server-backed path. After Dark currently does not use it:

| Layer | Current file/route | What it does today |
|---|---|---|
| Dating profile UI | `src/pages/profile/MyProfile.jsx` | Loads and saves through `ChattieService`; local storage is used as a fallback/cache. |
| Shared frontend client | `src/api/chattie.service.js` and `src/api/settings.service.js` | Both expose generic settings calls to `GET /settings` and `PUT /settings`, plus account/media helpers. `src/api/client.js` supplies the shared API client/auth configuration. |
| Onboarding API wrapper | `src/api/profile.service.js` | Calls `/profile/*` setup, location, preferences, activation, and initial-media endpoints. These are onboarding operations, not the normal profile-settings update API. |
| Authenticated Go routes | `Chattie-Server/main.go` | Mounts `/api/settings/*` and `/api/profile/*` inside `AuthMiddleware`. No `/api/afterdark/*` route group is currently mounted. |
| Generic settings handler | `Chattie-Server/handlers/settings.go` | Gets the authenticated user ID from request context and handles settings, media, export, verification, session termination, and blocked-user requests. |
| Generic settings storage | `Chattie-Server/models/settings.go`, `Chattie-Server/repository/settings.go` | Defines the shared `SettingsPayload` and reads/writes existing user profile, location, discovery preference, tag, media, subscription, and generic settings records. |
| Shared database records | `Chattie-Server/database/init_db.sql` | Provides `users`, `user_profiles`, `user_locations`, `user_preferences`, `user_settings`, and related shared tables keyed by `user_id`. |
| After Dark settings UI | `src/pages/afterdark/AfterDarkSettings.jsx` | Reads/writes `localStorage` (`afterdark-settings`) and updates the client store. It does not call either settings service; save success is device-local. Session and blocked-user lists are mock data, and pause/deactivation/password actions are prototype-only. |

#### Reuse the shared account; keep the creator persona distinct

Use the authenticated Chattie `user_id` as the single account identity for both experiences. Reuse shared account-level values and services where their meaning is genuinely the same (for example, account avatar, account security, and block relationships). Store After Dark creator-specific public identity and controls in a separate creator-profile/settings record keyed by that same `user_id`; do not create a second login/account or copy shared values into an unrelated user record. Decide explicitly whether each public-facing field is shared or persona-specific: a creator display name, username, bio, website, and creator location may need to differ from the dating profile.

The current generic settings payload is not a drop-in After Dark DTO. Its JSON names include `name`, `avatar`, `cover`, `bio`, and `location`; the After Dark UI uses names such as `displayName`, `username`, `website`, `defaultPpv`, `autoWithdraw`, `watermarkEnabled`, `geoBlockEnabled`, `dmControl`, `showExplicitContent`, and `discoverable`. The Go payload/repository do not persist most of those After Dark fields (including username, website, age, After Dark notification categories, creator pause state, and creator monetization/privacy settings). Do not send the After Dark object to `PUT /settings` and assume it was saved: define a typed After Dark DTO and persist these fields in the After Dark module. Also avoid routing these fields through the onboarding `/profile/*` endpoints.

#### Current capability mapping

| Capability | Existing server support | Integration decision |
|---|---|---|
| Shared profile and account settings | Authenticated `GET/PUT /api/settings`; `SettingsHandler` reads the user ID from JWT middleware context. The repository persists a fixed set of fields and returns a generic `SettingsPayload`. | Keep this as the source for shared Chattie account fields. Add a deliberate field mapping/DTO at the frontend boundary; do not treat it as the After Dark settings store. |
| Creator public profile and settings | No After Dark routes or creator-settings record are currently mounted/defined in the inspected server files. | Add the proposed `/api/afterdark/me/settings` and creator-profile endpoints, scoped to the current authenticated user. Keep public creator persona fields distinct from shared account fields and validate updates server-side. |
| Profile images/media | `/api/settings/media` stores generic user media and returns a media URL; primary-media selection is available. The After Dark settings page currently previews selected images as browser data URLs and only saves them locally. | Upload images through an authenticated upload flow and persist asset/media IDs, not `FileReader` data URLs. Reuse generic media only for ordinary account/profile images after confirming its visibility and ownership semantics; use private, separately authorized assets for explicit creator content. |
| Blocked users | Authenticated `GET /api/settings/blocked` and `DELETE /api/settings/blocked/{id}` are mounted; blocking is also available through `POST /api/interactions/block`. | Use the same block records for Chattie and After Dark so a block is enforced consistently in discovery, profiles, DMs, and live access. Replace the After Dark mock list with these APIs; do not create an After Dark-only block list. |
| Sessions and password/2FA | `POST /api/settings/terminate-sessions` increments the user's token version to invalidate other sessions. There is no session-list/revoke-one-session, password-change, or 2FA settings route in the inspected router. | Keep “terminate other sessions” as the available broad action. Add explicit routes before presenting per-device session controls, password changes, or a 2FA toggle as persisted functionality. |
| Notifications | Shared `user_settings` has generic Chattie notification/privacy flags; it does not represent the After Dark categories shown in the UI (subscriptions, tips, unlocks, creator messages, mentions, marketing). | Add typed After Dark notification preferences or a validated extension to shared preferences, and connect them to the notification delivery service. Preserve existing Chattie values when updating either settings area. |
| Verification and creator lifecycle | Generic verification/KYC routes exist, but creator onboarding/approval, After Dark pause/resume, and creator deactivation are not mounted as After Dark operations. | Reuse verification infrastructure only as an input to a dedicated server-side eligibility/application decision. Add audited creator lifecycle transitions; never use the client creator flag or the generic verification badge alone as adult-content authorization. |
| Data export and account deletion | Generic export request and account deletion routes exist. The export currently builds a Chattie PDF in a background goroutine; it is not an After Dark export-job status/download API. | Extend the export to include authorized After Dark data and expose reliable job status/download behavior. Apply account deletion policy to After Dark entitlements, subscriptions, content, and retention requirements. |

#### Recommended request flow

1. After Dark loads shared account data from the existing settings service and After Dark creator/member preferences from the dedicated After Dark settings API. The server derives the account ID from authentication for both calls.
2. The UI keeps shared fields and After Dark-specific fields in separate typed client models. Map shared wire fields deliberately (`name` to the appropriate UI field, for example); do not spread an After Dark settings object into the generic full-payload `PUT /settings`.
3. Save shared fields through the existing generic API only when they are actually shared. Save persona, monetization, privacy, discoverability, and After Dark notification fields through the After Dark API. Validate each field and role on the server.
4. On success, update Zustand/UI caches from the server response. Keep local storage as a non-authoritative cache only; it must not show a successful durable save when the API failed.
5. Route blocks, account security, verification, and exports to shared services where their semantics match, while maintaining After Dark-specific authorization and auditing at the server boundary.

## 5. Proposed API contract

Use the existing API prefix/versioning/auth conventions in the Go server. The paths below are a proposal to map onto those conventions; they do not imply that these routes exist.

### Public discovery and creator profile

| Method and path | Purpose |
|---|---|
| `GET /afterdark/feed?cursor=&access=&media_type=&q=` | Personalized, authorized, cursor-paginated feed |
| `GET /afterdark/creators?cursor=&q=&verified=&online=&tier=&tags=&location=&sort=` | Directory search/facets/sorting |
| `GET /afterdark/creators/{creatorId}` | Profile, safe stats, prices, subscription state, visibility |
| `GET /afterdark/creators/{creatorId}/posts?cursor=&media_type=` | Creator profile posts filtered by type |
| `GET /afterdark/stories` | Active story/live cards visible to viewer |
| `POST /afterdark/creators/{creatorId}/follow` / `DELETE .../follow` | Follow toggle if retained as a distinct feature |
| `POST /afterdark/posts/{postId}/likes` / `DELETE .../likes` | Idempotent like/unlike |
| `GET /afterdark/posts/{postId}/comments?cursor=` | Authorized comments |
| `POST /afterdark/posts/{postId}/comments` | Add comment |
| `POST /afterdark/moderation/reports` | Report creator, post, comment, message, or live session with reason/details |
| `POST /afterdark/share-links` | Optional expiring share link; avoid encoding private content access in a public URL |

### Creator onboarding and profile

| Method and path | Purpose |
|---|---|
| `GET /afterdark/me/creator-application` | Current creator application/status |
| `POST /afterdark/me/creator-application` | Submit alias, eligibility/verification reference, payout setup, consent versions |
| `GET /afterdark/me/creator-profile` | Read creator profile |
| `PATCH /afterdark/me/creator-profile` | Save display name, username, bio, location, website, visibility |
| `POST /afterdark/me/creator-profile/avatar-upload` and `/cover-upload` | Protected image upload reservation/completion |
| `POST /afterdark/me/creator-pause` / `DELETE /afterdark/me/creator-pause` | Pause/resume; define subscription/live behavior and notify customers |
| `DELETE /afterdark/me/creator-status` | Deactivate creator profile after explicit confirmation and documented impact |
| `POST /afterdark/me/account-export` | Create export job; return job ID/status/download link |

### Media vault and publishing

| Method and path | Purpose |
|---|---|
| `GET /afterdark/me/posts?cursor=&status=` | Creator's media vault |
| `POST /afterdark/uploads` | Reserve upload; validates content type/size and returns upload instructions |
| `POST /afterdark/uploads/{uploadId}/complete` | Verify upload and start scan/transcode/moderation |
| `POST /afterdark/me/posts` | Create draft/publish/scheduled post from completed asset and metadata |
| `PATCH /afterdark/me/posts/{postId}` | Edit caption, strategy, price, tags or permitted metadata |
| `DELETE /afterdark/me/posts/{postId}` | Delete/archive with audit and entitlement/refund policy |
| `GET /afterdark/me/posts/{postId}/stats` | Views, likes, unlocks, net/gross revenue |

### Payments, subscriptions, chat access, and wallet

| Method and path | Purpose |
|---|---|
| `POST /afterdark/checkout-intents` | Create PPV, subscription, live-pass, chat-access, or tip intent from a product reference; server resolves price |
| `GET /afterdark/checkout-intents/{intentId}` | Read payment status for the current payer |
| `POST /billing/webhooks/{provider}` | Provider-signed, idempotent payment callback; never directly called by frontend |
| `GET /afterdark/me/subscriptions?cursor=&status=` | Viewer subscriptions / creator subscriber listing based on caller role |
| `POST /afterdark/creators/{creatorId}/subscriptions` | Start subscription checkout or renewal |
| `DELETE /afterdark/me/subscriptions/{subscriptionId}` | Cancel renewal; subscription remains active through paid period unless policy requires otherwise |
| `GET /afterdark/me/entitlements` | Current subscription, post, live-session, and chat access summary |
| `GET /afterdark/wallet` | Authoritative available/pending/reserved balance |
| `GET /afterdark/wallet/transactions?cursor=&type=` | Ledger-backed transaction history |
| `POST /afterdark/wallet/deposits` | Create provider deposit intent |
| `POST /afterdark/wallet/withdrawals` | Request payout; validates and reserves cleared funds |
| `GET /afterdark/wallet/withdrawals/{payoutId}` | Read payout state/receipt |
| `GET /afterdark/me/payout-methods` / `PUT /afterdark/me/payout-methods` | Read/change verified payout destination using protected workflows |

One checkout-intent request should contain a server-recognized product reference, not a trusted client amount:

```json
{
  "product_type": "post_unlock",
  "product_id": "post-id",
  "payment_method": "mpesa",
  "phone_number": "2547XXXXXXXX"
}
```

Possible `product_type` values based on current UI: `post_unlock`, `creator_subscription`, `live_pass`, `private_chat_access`, and `tip`. A response includes `intent_id`, `status`, `amount`, `currency`, `provider`, and provider-specific safe next-step fields. Never expose secret provider credentials.

### Conversations and explicit media

| Method and path | Purpose |
|---|---|
| `GET /afterdark/conversations?cursor=` | Authorized conversation list, latest-message preview, unread count |
| `POST /afterdark/conversations` | Create or retrieve a conversation after DM-policy/access checks |
| `GET /afterdark/conversations/{conversationId}/messages?before=&limit=` | Paginated history |
| `POST /afterdark/conversations/{conversationId}/uploads` | Reserve private attachment upload |
| `POST /afterdark/conversations/{conversationId}/messages` | Send text/media with explicit marker and idempotency key |
| `POST /afterdark/conversations/{conversationId}/read` | Update read cursor |
| WebSocket `/afterdark/realtime` | Authenticated message delivery and optional typing/presence; persist before broadcast |
| `PATCH /afterdark/me/preferences` | Explicit reveal preference and member discoverability |
| `GET /afterdark/me/blocked-users` / `DELETE /afterdark/me/blocked-users/{userId}` | Read/unblock users; add block endpoint if UI grows a block action |

The creator channel's “Message subscriber” modal and customer chats must use the same conversation resource and message history. Model participants using stable user IDs; do not construct durable conversation IDs by concatenating `creator:` or `subscriber:` strings.

### Live viewing and co-stream

| Method and path | Purpose |
|---|---|
| `POST /afterdark/live-sessions` | Start creator live after creator-status and device/session limits checks |
| `GET /afterdark/live-sessions?creator_id=&status=live` | Read active sessions for feed/story cards |
| `POST /afterdark/live-sessions/{sessionId}/join` | Verify session + subscription/live-pass entitlement; mint short-lived viewer SFU token |
| `POST /afterdark/live-sessions/{sessionId}/leave` | Record leave/presence where needed |
| `POST /afterdark/live-sessions/{sessionId}/end` | Creator-only end; revoke tokens and stop session |
| `POST /afterdark/live-sessions/{sessionId}/guest-requests` | Viewer requests on-stage participation |
| `POST /afterdark/live-sessions/{sessionId}/guest-requests/{requestId}/approve` | Host approves request |
| `POST /afterdark/live-sessions/{sessionId}/guest-requests/{requestId}/deny` | Host denies request |
| `POST /afterdark/live-sessions/{sessionId}/stage/{participantId}/remove` | Host removes guest |
| WebSocket `/afterdark/live-sessions/{sessionId}/events` | Authenticated live chat, reactions, guest-request state, viewer counts, stage events |
| Provider webhook for SFU events | Reconcile participant connect/disconnect and session termination |

Use an SFU rather than browser-to-browser mesh for real multi-viewer production. The host and approved guests publish media; viewers subscribe. The API authorization layer controls who receives a publish/subscribe token and whether a guest may publish. Camera/microphone permission remains browser-side, but stage state and publish rights are server-controlled. Validate event sender identity and membership on the server; ignore client-supplied names and viewer counts.

### Settings, security, notifications, and compliance

| Method and path | Purpose |
|---|---|
| `GET /afterdark/me/settings` / `PATCH /afterdark/me/settings` | Role-specific profile, monetization, privacy, explicit, discoverability, notification preferences |
| `GET /settings/sessions` / `DELETE /settings/sessions/{sessionId}` | List/revoke server sessions; current mock session removal is local |
| `POST /settings/password` | Authenticated password change with current-password/step-up checks |
| `GET /settings/blocked` / `DELETE /settings/blocked/{userId}` | Existing generic blocked-user pattern; ensure After Dark actions update same records |
| `POST /afterdark/me/data-export` / `GET /afterdark/me/data-export/{jobId}` | Export request/status/download |
| `DELETE /afterdark/me/account` | Account deletion workflow with confirmation, retention/legal holds, cancellation/refund policy |
| `GET /afterdark/me/verification` / `POST /afterdark/me/verification` | Age/KYC workflow; store provider/reviewer outcome, not raw client claims |
| `GET /afterdark/me/consents` / `POST /afterdark/me/consents` | Versioned creator/content/legal acknowledgements |
| `POST /afterdark/moderation/reports` | Report submission; same report service used by feed/profile/chat/live |

## 6. Suggested persistent data model

Use the project's current database conventions and migration style. The following entities/constraints define behavior; adapt exact names/types to the existing Go models.

| Entity | Important fields and constraints |
|---|---|
| `creator_profiles` | `user_id` unique FK, `alias`, normalized unique `username`, `bio`, `location`, `website`, `avatar_asset_id`, `cover_asset_id`, `status` (`pending`, `active`, `paused`, `suspended`, `deactivated`), `dm_control`, `created_at`, `updated_at` |
| `creator_applications` | `user_id`, `status`, `submitted_at`, `reviewed_at`, `reviewer_id`, `verification_ref`, `payout_method_id`, `policy_version`, `decision_reason_code`; audit every transition |
| `creator_consents` | `user_id`, `consent_type`, `policy_version`, `accepted_at`, `ip/device metadata` only as policy permits |
| `assets` | owner, private storage key, MIME, byte size, checksum, media type, scan/transcode/moderation status, metadata, retention/deletion state |
| `posts` | creator, asset, caption, category, `free`/`ppv`/`subscriber`, integer price in minor currency units, explicit flag, watermark settings, teaser duration, `draft`/`processing`/`published`/`scheduled`/`rejected`/`deleted`, publish time |
| `post_tags`, `post_performers`, `performer_consents` | normalized tag relations; validated performer identity and consent/document records, not arbitrary comma-separated names |
| `post_entitlements` | unique `(user_id, post_id, source_payment_id)` or suitable unique idempotency constraint; status/revocation/refund references |
| `subscriptions` | creator, subscriber, plan/price snapshot, provider refs, status, billing period, renewal/cancel timestamps; unique active subscription policy |
| `live_sessions` | creator, unique public/session ID, SFU room, status, price snapshot, started/ended timestamps, moderation state |
| `live_entitlements` | viewer, session, source payment, status, created/revoked timestamps; exact session scope |
| `live_stage_requests` | session, viewer, state (`requested`, `approved`, `denied`, `on_stage`, `removed`, `left`), created/updated timestamps |
| `conversations` / `conversation_participants` | stable conversation ID, participant IDs, access source, created/closed state; enforce participant uniqueness |
| `messages` / `message_assets` | sender, conversation, text, explicit flag, sent/edited/deleted timestamps, private attachment refs, moderation state, idempotency key |
| `wallet_accounts` / `ledger_entries` | owner, currency, immutable debit/credit entries, pending/available/reserved accounts, source type/ID, idempotency key, balance projection rebuilt from ledger |
| `payment_intents` / `provider_events` | payer, product ref, server price/currency snapshot, provider, status, safe client ref, raw webhook stored securely as needed, unique provider event ID |
| `payout_methods` / `payouts` | encrypted/tokenized destination, verification state, amount/currency, reserved ledger ref, provider refs, status and failure reason |
| `creator_reports` / `moderation_actions` | reporter, target type/ID, reason, details, status, reviewer, actions, audit timestamps |
| `user_settings` / `notification_preferences` | role-specific values with validation and versioning; avoid opaque unvalidated JSON for security-sensitive fields |
| `audit_events` | actor, action, resource, outcome, request correlation ID, timestamp; redact secrets and sensitive content |

All monetary amounts should be stored as integer minor units with an explicit ISO currency. If the UI continues to display KES whole shillings, convert only at the API boundary.

## 7. Frontend action inventory: behavior to implement

The action list below covers visible After Dark controls and what each must do server-side. Pure UI controls still need no write endpoint; they must query server data where indicated.

### 7.1 Layout and sidebar

Files: `AfterDarkLayout.jsx`, `AfterDarkSidebar.jsx`.

- Mobile **Open menu**, backdrop click, **Close**, and route-change auto-close: UI-only. Navigation destinations are Feed, Creators/Directory, Chats, Wallet, Settings, creator My Content, Customers, and Earnings/Finance tabs.
- **Upload content**: creator opens upload workflow; non-creator opens onboarding. Upload endpoint and creator approval must authorize independently.
- **Become a creator**: starts onboarding/eligibility workflow, not a local role toggle.
- **Balance** and wallet shortcut: read `/afterdark/wallet`; never render persisted local balance as authoritative.
- Creator avatar/name/profile shortcut and standard profile link: fetch permitted profile data; protect private settings.
- Log out/back to Chattie route actions: existing application/auth behavior, not After Dark domain mutations.
- Feed footer **Terms of Service**, **Privacy Policy**, **Creator Guidelines**, and **DMCA Notice** links currently use `href="#"`; resolve these to actual policy pages/documents before release, but they do not represent domain-write APIs.

### 7.2 Creator onboarding modal

File: `OptInGateModal.jsx`.

- Dialog close/backdrop, previous/next, progress, **Use Chattie name**, date-of-birth input, optional M-Pesa number, agreement toggles, final submit, and **Enable creator mode**.
- Load account display name and verification status. Current code calls `settingsService.getSettings()`; replace/augment with explicit server creator-application and age-verification contracts.
- Validate age, eligibility, alias uniqueness/length, payout destination, and consent on the server. Client checks are convenience only.
- Submit all required legal acknowledgements with policy versions. Return a durable application state; show pending/rejected/review-needed states. Never silently turn a failed verification request into approved creator mode.

### 7.3 Feed and live entry

File: `AfterDarkFeed.jsx`.

- Search, access filter (`all`/`free`/`PPV`), media type (`all`/image/video), **More filters**, clear filters, refresh, infinite scroll, empty-state clear, trending creator, **View vault**, directory link, creator navigation, and story selection are reads/navigation. Implement with server query parameters/cursors and stable ordering.
- **Your live/story** opens creator live studio or current session. **Creator live story** enters active broadcast; non-live creator story opens creator profile. Live state comes from server presence, never browser `localStorage`.
- Feed post card opens creator, pays PPV, subscribes for subscriber media, likes, comments, reports, copies share link, messages the creator, acknowledges explicit warning, and plays/seeks/mutes/fullscreens video. Implement the post-specific actions in [Locked post card](#727-locked-post-card).
- Creator profile tag chips are currently presentation-only despite hover styling; make them route/filter by tag only if that behavior is intended.
- Refresh/retries must expose loading and API errors; cursor pagination must avoid duplicated/missing posts when feed changes.

Creator live studio:

- **Start live** obtains camera/mic in browser then calls the server to create a live session and obtain authorized SFU publish credentials.
- **Turn camera off/on** and **Mute/unmute mic** change local tracks and publish state; report state to SFU/server as necessary.
- **End live** ends the server session, revokes authorization, emits end event, and closes provider room.
- Studio close only hides the studio; it must not end the live unless the user chooses the explicit end action.
- Live chat persists and broadcasts. Request list supports **Allow** and **Deny**. Guest **Remove** revokes publishing and updates every viewer. Viewer count comes from SFU/server events, not client announcements.
- Handle creator reconnect, browser termination, permissions denied, network loss, SFU disconnect, duplicate start/end, and stale sessions.

### 7.4 Live viewing modal

File: `AfterDarkLiveViewingModal.jsx`.

- Locked state: **This live** and **Monthly sub** choose product; **Use balance** starts an atomic wallet purchase; **Continue to checkout** starts provider checkout. Server rechecks entitlement on every join even if the UI reports access.
- **Close live room** and backdrop close: leave session and release SFU subscriptions; keep payment entitlement unless refunded/revoked.
- **Mute/unmute host audio**, volume controls, chat form, heart/reaction buttons, count display: send chat/reaction events through authenticated live channel and apply server rate limits.
- **Request to join**, pending state, retry after denial/removal, **Join stage**, browser camera/mic prompt, guest mic toggle, and **Leave stage**: use the guest-request state machine; only host approval plus server-issued publish capability allows guest tracks.
- **Manage live** opens the host's own studio. Ended sessions disable new messages/reactions/stage requests and release media resources.
- The local demo canvas and automatic approval are mock-only and must not become production access behavior. Real co-stream requires an SFU or provider integration, not BroadcastChannel/WebRTC peer mesh.

### 7.5 Directory

File: `AfterDarkDirectory.jsx`.

- Search creator display name/username/bio; verified-only and online-only toggles; tier, tag, and location selection; **Clear filters**; sort by popular/newest/price low/high; grid/list selection; responsive filters open/close; previous/numbered/next pagination.
- Creator card/profile click and **Quick view** open creator data; quick view close/profile action should use canonical creator IDs.
- The featured **Explore Vault** button currently relies on its parent banner click; it has no separate handler. Make it navigate to the same creator profile or remove its button styling if it is not intended to act.
- All 150 generated records and random availability/prices/tags must become API data. Online state should have a defined presence expiry. Return total/cursor info consistent with active filters and sort.

### 7.6 Creator profile

File: `AfterDarkCreatorProfile.jsx`.

- Back navigation, overflow menu, **Share profile**, **View standard profile**, and **Report creator**. Report endpoint stores reason/target/status and is reviewable; client confirmation is not report persistence.
- **Subscribe** starts subscription checkout; success must come from verified provider callback. **Subscribed** is a server-derived state.
- **Tip** presets/custom amount/message: server-side validation and wallet/payment intent, immutable ledger transaction, idempotency, confirmation and notification.
- **Paid chat** navigates with creator context and starts conversation/access checkout where needed.
- **All / Photos / Videos** tabs filter server posts; profile stats and creator bio/tags/online status are server sourced.
- Each post supports free/subscriber/PPV access. PPV is a one-time post entitlement, not a monthly subscription. Subscriber-only content checks active subscription.
- On checkout success refresh post/subscription entitlements; do not only mutate current page card state.

### 7.7 Locked post card

File: `LockedPostCard.jsx`.

- Creator header opens profile. **Follow** toggles follow state. Overflow actions: **Subscribe/unlock**, **Copy link**, **Report**.
- **Reveal media** records only the viewer's acknowledgement/preferences as appropriate; it never grants content access.
- **Unlock PPV** starts a post-specific checkout. **Subscribe** routes to creator subscription. The server returns a protected media URL after entitlement.
- Video **Play/Pause**, **Mute/Unmute**, **Fullscreen**, and seek are client media controls; serve suitable signed/authorized rendition URLs and enforce access on each asset request.
- **Like/unlike** is persistent, idempotent, and updates count from server response. Comments open/close, list comments, and submit new comment only when content access policy permits. Comment count and feed order must reconcile from server.
- Creator message button opens chat and enforces chat access/DM policy.

### 7.8 Upload and content compliance modal

File: `UploadExplicitModal.jsx`.

- Drag/drop/file picker, preview/remove, step navigation, caption, category, up to 10 normalized tags, free/PPV/subscriber pricing, PPV price, video teaser duration, watermark toggle, co-performer input, schedule toggle/time, consent checkbox, and **Secure publish to vault**.
- Validate actual file bytes/MIME, file-size cap, media transcoding, upload checksum, and content safety server-side. The current UI caps at 500 MB and accepts image/video formats.
- Require verified creator and current policy consent; collect performer identities and release evidence rather than trusting a free-text `modelsTagged`.
- Save draft/schedule/publish metadata; show processing and moderation outcomes. A scheduled post must be released by a backend worker.
- **Close**, cancel, back-step navigation, upload progress, and failure should preserve or deliberately discard the draft according to explicit UX rules.

### 7.9 Checkout modal

File: `MpesaPaystackModal.jsx`.

- Order summary displays product, server price, fees, tax, currency, and total; values must be server-calculated and immutable for that intent.
- **M-Pesa Express** and **Card/Paystack** choose provider. Phone input validates client-side; **Recent** selects a previously permitted number. Do not store sensitive payment secrets in browser storage.
- Submit initiates a server intent/provider request. Processing/polling must query server status; only signed provider webhook settles payment. Timeout/failure displays retry/support state; closing a pending intent must not mark it paid or cancel provider transaction without server flow.
- **Copy transaction reference** copies a safe reference only.
- Success screen distinguishes post unlock, live pass, subscription, chat access, and tip. Receipt/download actions use server transaction data.
- Current M-Pesa and card handlers simulate success with timers. Replace those rather than treating the callbacks as actual settlement.

### 7.10 Private chat hub

File: `AfterDarkChatHub.jsx`.

- Search contacts, select conversation, mobile back-to-list, back-to-feed, see latest message/date/unread state, scroll history, reveal explicit message/media, and choose explicit content preference.
- **Unlock private chat** starts chat-specific checkout. An active creator subscription may grant messaging only if policy says so; enforce creator DM rules as well.
- Text draft and Enter/send, attach image/video, preview/remove attachment, mark explicit, and send. Validate attachment size/type, upload to private storage, persist message before broadcast, and return a message ID/status.
- Creator side's customer list and viewer side's creator list must be based on actual authorized contacts/conversations, not hardcoded `CREATORS`/`CUSTOMERS`.

### 7.11 Creator channel

File: `AfterDarkMyChannel.jsx`.

- Tabs: **Media Vault**, **Subscribers**, **Finance & Payouts**, **Settings**; route query parameter controls selected tab.
- Vault status filters/search, cards/stats, **Edit**, **Share**, **Delete**. Edit modal updates caption, free/PPV/subscriber strategy and PPV price; validate against price floors and entitlement/refund policy. Share produces a safe public profile/post URL. Delete requires confirmation and is audited.
- Subscriber table search/status filters show active/expired, tier, dates, lifetime value; message button opens persistent per-user conversation and history.
- Finance displays available/pending/lifetime gross, **Withdraw to M-Pesa**, recent payout rows and **Download receipt**. Withdrawal status, fees, bank/M-Pesa destination, and receipts come from payout service.
- Channel settings edit monthly VIP price and automated welcome message; **Save channel settings** persists via creator settings endpoint.
- **Edit cover/avatar** navigate to settings; **Deactivate creator account** navigates to danger settings. Do not deactivate directly without confirmation and backend lifecycle policy.
- All current channel posts, subscribers, stats, payouts and balance are mock data/local state.

### 7.12 Wallet

File: `AfterDarkWallet.jsx`.

- **Add funds** opens deposit modal; amount, M-Pesa/card selection, phone, and **Simulate deposit** become a real provider deposit intent and verified ledger credit.
- **Withdraw** is creator-only; amount, **MAX**, and confirm produce payout request with atomic reserve; reject below KES 1,000 or above cleared balance. UI says registered M-Pesa number and prototype fee; real settings/payout method and fee policy must be authoritative.
- Transaction tabs **All / In / Out** query ledger; **Export CSV** exports only authorized ledger results. Each row's details/receipt should refer to a real transaction.
- **View payment methods** currently has no handler; backend/UI work must either implement payment-method management or remove/disable this button until it exists.
- Deposit/withdraw modal close/backdrop should be disabled while a provider operation is unresolved or correctly cancel it through backend.
- Pending clearance and transaction rows are currently hardcoded/mock; replace with ledger-backed data.

### 7.13 Settings

File: `AfterDarkSettings.jsx`.

- Role-aware tabs: creator profile, monetization, privacy/geo, security, notifications, danger; member account, privacy/content, security, notifications, data/account. URL query updates selected tab.
- Creator public profile: avatar/cover selection, display name, username, bio, location, external link; save via profile/settings APIs and upload workflow.
- Creator monetization: default PPV price, auto-withdraw toggle, withdrawal threshold. Validate and save, and ensure the payout worker honors settings.
- Creator privacy: watermark toggle/text, geo-block toggle/add/remove country or city, DM control (`all`, `subscribers`, `none`). Server filters discovery/content and checks location/DM authorization. Geo restrictions need trusted IP/location policy; client setting alone does nothing.
- Member account: avatar, show explicit after warning, discoverability. Persist preferences; explicit setting changes rendering, not age eligibility/access.
- Security: 2FA toggle, **Change password** dialog, revoke non-current session. Use security APIs, step-up verification and session revocation; current sessions are mock and password is page-session-only.
- Blocked users: **Unblock** calls common block service; current records are mock.
- Notifications: email/push toggles for creator subscriptions, tips/unlocks, messages, mentions, and marketing/platform updates. Save preferences; integrate delivery preferences with notification service.
- **Request data archive** creates export job; current code downloads an immediate local JSON. Archive must be authorized, audited, expire, and exclude data the user has no right to export.
- Creator **Pause/Resume** needs backend state transitions and rules for subscriptions/new purchases/lives; current confirmation only changes local setting.
- **Deactivate creator** requires explicit confirmation, role change, subscription/payout/content policy, audit, and navigation after server success. Member **Back to Chattie** is navigation only.
- Global **Save settings** persists all visible role-specific fields and displays server validation/conflict errors.

### 7.14 After Dark chats, media, wallet, settings and share actions in other components

- `SubscriberMessageModal` in `AfterDarkMyChannel.jsx`: close, history, text draft/send; use same conversation/message endpoints as chat hub.
- `EditPostModal`: cancel/close/save; save must patch creator-owned post.
- `WithdrawModal`: amount, **MAX**, confirm, close; initiate payout and reconcile server status.
- `QuickViewModal` / creator grid/list cards: close and profile navigation; no write actions.
- `AfterDarkLayout` mobile overlay and sidebar route matches are UI-only.

## 8. Suggested state machines and event behavior

### Payment intent

`created -> requires_action -> processing -> succeeded | failed | expired`

- Webhook processing must verify signature, provider account, amount, currency, reference, and expected intent.
- Use a unique `(provider, provider_event_id)` constraint and idempotency key for checkout creation.
- A success transaction atomically changes payment status, writes ledger entries, creates the exact product entitlement, and emits an outbox event.
- Refund/chargeback transitions create compensating ledger entries and revoke access according to product policy; never rewrite/delete ledger history.

### Post

`draft -> uploading -> processing -> moderation_pending -> published | scheduled | rejected`

`published | scheduled -> archived/deleted`

- Return machine-readable validation errors for missing asset, invalid PPV price, schedule in past, unverified performer, missing consent, or moderation rejection.
- Only `published` and eligible status posts are returned in feed/profile APIs.

### Subscription

`pending_payment -> active -> cancel_at_period_end -> expired`

Alternative transitions: `past_due`, `grace_period`, `suspended`, `refunded`, `disputed`.

### Live

Session: `scheduled? -> live -> ending -> ended | failed | suspended`.

Guest: `requested -> approved | denied -> on_stage -> left | removed`.

- Only creator/authorized moderators change session status or approve/remove participants.
- Guest `on_stage` requires a short-lived publish token scoped to one room and participant. Removal revokes or disconnects it.
- Publish chat, reaction, request, and state events with server event IDs and timestamps for replay/reconnect.

### Payout

`requested -> reserved -> processing -> paid | failed | canceled`

- Reserve funds atomically when accepting payout request. Failure/cancel releases reserve exactly once.
- Enforce payout KYC/ownership, risk/limits, minimum amount, fee, and idempotency.

## 9. Security, privacy, reliability, and operations

- Use role/ownership policies at service/repository boundaries. Test direct API requests that bypass React route guards.
- Add rate limits for login-adjacent onboarding, checkout attempts, comments, messages, tips, guest requests, reactions, reports, and upload reservations.
- Use CSRF protections if cookie auth is used; protect WebSocket upgrades; bind real-time identity to server auth.
- Strip/escape user-generated text and validate URL fields. Store explicit content metadata separately from generic user text.
- Signed media URLs should be short-lived and scoped to an authorized asset/rendition; prevent storage bucket public listing and avoid leaking original storage keys.
- Webhook handlers need signature validation, replay protection, timestamp tolerance, deduplication, and safe structured logs.
- Use transactional outbox/events for email/push, payment result updates, subscription events, live state, and moderation notifications.
- Audit settings changes, creator state changes, content publication/removal, user reports, entitlement creation/revocation, payout, and moderation decisions.
- Define cleanup for abandoned uploads, expired intents, dead live sessions, stale presence, old signed URLs, expired export archives, and retention expiry.
- Add metrics for payment success/failure, webhook lag, upload processing, content moderation queue, entitlement denials, live join failures, SFU usage, message delivery lag, and payout failure.
- Never log passwords, tokens, full phone numbers, card data, identity documents, signed media URLs, or explicit media contents.

## 10. Acceptance tests before switching frontend to backend

### Authorization and entitlement

- Unauthenticated requests cannot read private content, subscriber rosters, messages, settings, wallet, payouts, or live tokens.
- A viewer with no entitlement cannot retrieve original media or receive an SFU token by calling endpoints directly.
- A successful subscription unlocks subscriber-only content only for its active period and allows only the configured chat/live benefits.
- A PPV post purchase unlocks exactly that post; a live pass unlocks exactly one session and not the next session.
- Expired, refunded, disputed, or revoked entitlements are denied on subsequent requests; cached client entitlement cannot override the API.
- Creator-only operations reject viewers and creators attempting to access another creator's data.

### Payment and wallet

- Duplicate checkout requests with the same idempotency key do not double-charge.
- Duplicate/out-of-order webhooks do not double-credit, double-debit, create duplicate entitlements, or double-notify.
- Invalid webhook signature, wrong amount/currency/reference, or unknown payment cannot grant access.
- Concurrent wallet purchases/withdrawals cannot overspend; ledger entries balance and are immutable.
- Provider failure/timeout does not grant access; a late verified success reconciles according to policy.
- Refund and chargeback create auditable compensating entries and update entitlement.

### Creator content and compliance

- Non-creators, paused/suspended creators, and unverified creators cannot upload, publish, start lives, or request payouts.
- File spoofing, oversize upload, malware, incomplete upload, unconsented performer, invalid price, invalid schedule, and failed moderation are rejected safely.
- Scheduled publish runs server-side once, at the intended time and timezone.
- Deleted/archived content cannot be newly accessed; historical entitlement/refund behavior is consistent.

### Chat, moderation, and settings

- Non-participants cannot enumerate or read conversation messages.
- DM policy and paid-chat access are enforced at conversation creation and message send.
- Attachment URLs remain private; explicit warning and metadata persist on fetch.
- Report creates a reviewable server record; repeat submissions are rate-limited without suppressing valid reports.
- Revoking a session immediately blocks its future use; blocked-user rules apply to chat/live/discovery consistently.
- Privacy, notifications, geo-block, watermark, pause, export, and account deletion settings persist and are honored server-side.

### Live/realtime

- Only an active live session can be joined; stale/ended sessions reject.
- Viewer without active subscription or session pass gets no media token.
- Host can approve/deny requests; only approved guest can publish; removal disconnects and prevents rejoin without fresh approval.
- Viewer can subscribe to host and approved guest tracks; chat/reactions/viewer count reconcile after reconnect.
- Reconnect, duplicate events, browser close, host disconnect, session end, and SFU webhook replays do not leave orphan sessions or unauthorized publishers.

### Frontend migration

- For each action in [Frontend action inventory](#7-frontend-action-inventory-behavior-to-implement), replace local/mock mutation with API response/refetch and explicit loading/error/success states.
- Test browser refresh, second tab, second device, role switch, expired auth, network loss, and provider redirect/webhook delay.
- Keep demo mode unmistakably separate from production data and ensure it cannot create real entitlement or payment records.

## 11. Recommended backend implementation order

1. Confirm existing Go auth, users/roles, settings, database migration conventions, payment/webhook utilities, and notification infrastructure.
2. Add After Dark creator profile/application, verification/consent states, and authorization middleware/policies.
3. Add private asset upload/storage, processing/moderation lifecycle, and feed/profile/directory read APIs.
4. Add payment intents, verified provider webhook handling, immutable ledger, exact post/live/chat entitlements, subscriptions, and wallet APIs.
5. Add persistent conversations, access policy, private attachments, explicit flags, reports, block/session/settings APIs.
6. Add creator channel APIs: posts/vault, subscriber roster, metrics, payout method, withdrawal/payout state, receipts.
7. Add live-session control, authorized SFU credentials, stage-request state machine, chat/reaction events, participant lifecycle, and presence.
8. Add background jobs for scheduled publishing, subscription lifecycle, earnings clearance, payout, moderation, exports, retention, and notification delivery.
9. Add repository/service/handler tests for all invariants and run database migration/integration tests before changing frontend pages.
10. Introduce a dedicated frontend service layer and migrate one vertical flow at a time: profile/discovery -> post purchase -> subscription -> wallet -> chat -> creator publishing -> live -> settings/payout.

## 12. Current prototype-only behavior that must not be represented as production-complete

- Generated creators, posts, comments, subscriber lists, transaction rows, settings security sessions, blocked users, earnings and payout rows.
- `localStorage` and Zustand-persisted role, balance, chat history, chat access, subscriptions, live passes, settings, reports, and creator channel settings.
- Timed fake checkout, wallet deposits/withdrawals, tips, subscription, upload progress, post edits, and creator-mode enablement.
- `BroadcastChannel` signaling and `localStorage` live presence; demo canvas live video and simulated guest approval.
- Local media previews, CSV/JSON/receipt downloads based on mock rows.
- UI controls that are not wired at all, including the wallet's **View payment methods** button and some decorative/placeholder links.

Production status must be based on server-side outcomes. Keep this inventory updated as frontend controls change and link every new After Dark UI action to an endpoint, a deliberate UI-only classification, and an acceptance test.

## 13. After Dark page and control-by-control action map

This section maps the interactive surfaces currently found in `src/pages/afterdark/` and `src/components/afterdark/` to their expected behavior and backend path. Route names below are the proposed API contract in section 5, not routes confirmed to exist. For shared account operations, use the existing authenticated `/api/settings/*` routes described in section 4.1. Any prototype action identified below must not be presented as a completed server operation until its request succeeds.

### 13.1 Shared shell and sidebar

Found in `src/components/afterdark/AfterDarkLayout.jsx` and `src/components/afterdark/AfterDarkSidebar.jsx`.

| Control/action | Expected behavior | How the action should go through |
|---|---|---|
| Open menu, close menu, backdrop close, close on route change | Show/hide the responsive navigation only. | UI-only; no API call. |
| Feed, Creators, Chats, Wallet, Settings, My Content, Customers, Earnings navigation | Open the matching After Dark route/tab; creator-only links are visible only for eligible creators. | UI navigation only. Server endpoints on the destination page must still authenticate and authorize each request; hiding a link is not access control. |
| Upload content | Open the upload workflow for an approved creator; otherwise open creator onboarding. | Check creator application/status from `GET /afterdark/me/creator-application` before showing creator tools. Upload itself follows `POST /afterdark/uploads` and `/complete`; never grant creator status in the browser. |
| Become a creator | Start or resume the creator application. | Read application state, then submit to `POST /afterdark/me/creator-application`. Server validates age/identity, consent, eligibility, and payout onboarding and returns a pending/approved/rejected status. |
| Balance amount and wallet shortcut | Show authoritative available balance and navigate to Wallet. | Read `GET /afterdark/wallet`; replace the persisted Zustand amount as source of truth. |
| Account avatar/name footer | Open the authenticated user's own After Dark account/creator profile. | UI navigation only, but resolve the current user's own profile from the authenticated API; do not fall back to an unrelated/mock creator when no creator ID is present. |
| Exit After Dark icon | Return to Chattie Rooms; it is not an account logout. | UI navigation to `/rooms`. Use the shared authenticated logout/session-revocation flow only if the product intends to sign the user out. |

### 13.2 Feed — `/afterdark/feed`

Found in `src/pages/afterdark/AfterDarkFeed.jsx`, `src/components/afterdark/LockedPostCard.jsx`, and `src/components/afterdark/AfterDarkLiveViewingModal.jsx`.

| Control/action | Expected behavior | How the action should go through |
|---|---|---|
| Search, access filter (All/Free/PPV), media-type filter, advanced-filter toggle, reset filters | Search and refine the feed without changing content or entitlements. | Query `GET /afterdark/feed` with query/access/media/cursor parameters. Filter changes reset the cursor; reset clears query and filters. Server returns only visible posts and access state. |
| Refresh and infinite scroll | Reload the first feed page or fetch the next page. | Call `GET /afterdark/feed` with a cursor. Show loading/error/retry states; do not generate mock posts on request failure. |
| Story/live circles (own channel and other creators) | Open own live studio/current live, join another creator's active live, or view the creator profile/story destination. | Fetch active sessions/stories from `GET /afterdark/stories` and live-session reads. Own studio actions require creator authorization; joining a live always checks the session-specific entitlement and obtains a fresh authorized media token. |
| Creator avatar/name, trending creator card, creator suggestion, directory link | Open a creator profile or directory. | Navigate to `/afterdark/cprofile` or `/afterdark/directory`; creator details come from the corresponding authorized/public read endpoint, not route state. |
| Featured creator/view vault and rising creators list | Navigate to the selected creator's profile/vault; the featured banner currently selects a fixed mock creator. | Populate featured/trending creators from server responses and route by stable creator ID; do not hardcode a mock creator or derive popularity from client data. |
| Own live start/manage, close studio, camera, microphone, end stream | Start a live session, control local devices, and end the creator's current session. | Start/end through `POST /afterdark/live-sessions` and `POST /afterdark/live-sessions/{sessionId}/end`. Camera/microphone permissions are browser-side; session state and publish rights are server-controlled. Mint SFU credentials only after creator eligibility checks. |
| Join a live card/session, select one-time pass or monthly subscription, use wallet balance, continue checkout | Join only after the selected entitlement is active. A pass applies to that live session only. | Read live state, create a server-priced `live_pass` or `creator_subscription` checkout intent, then use the wallet/checkout flow. On verified payment/refreshed entitlement, call `POST /afterdark/live-sessions/{sessionId}/join` for a short-lived viewer token. A client success callback must not grant access. |
| Close live viewer and mute/unmute creator audio | Leave/close the viewer UI and mute local playback. | Close/leave records presence through `POST /afterdark/live-sessions/{sessionId}/leave`; mute is local UI only. Revoke/expire media credentials server-side as appropriate. |
| Live chat send and reaction | Publish a live message/reaction to participants. | Send authenticated events over `/afterdark/live-sessions/{sessionId}/events`; server binds sender to auth, validates session membership, rate-limits, assigns event ID/time, and broadcasts. |
| Request guest spot, turn camera on after approval, toggle guest mic, leave stage, request again after removal | Request stage access, publish only after host approval, then leave or retry under session rules. | Use guest-request create/approve/deny and stage remove endpoints in section 5. Mint a room-scoped, short-lived publish token only after approval; stop tracks and revoke/disconnect on leave/removal. |
| Post explicit-content reveal, play/pause, seek, mute media | Reveal acknowledged content or control local media playback. | Acknowledgement/playback controls are UI-only; fetch protected media only after server authorization. Record a consent/acknowledgement only if product policy requires it; never use the toggle as age verification. |
| Post unlock / subscribe | Purchase a PPV post or navigate to subscription. | Create `post_unlock` checkout intent for the post's server price, or start creator subscription checkout. Refresh the post entitlement after verified provider result; only then return protected media access. |
| Like/unlike and comment submit | Persist a like state/count or add a comment to an accessible post. | `POST/DELETE /afterdark/posts/{postId}/likes` and `POST /afterdark/posts/{postId}/comments`; refresh counts/comments from server. Enforce visibility, entitlement, duplicate prevention, validation, and rate limits. |
| Comment-level flag/report button | Report a specific comment for review. The current icon has no click handler. | Wire it to `POST /afterdark/moderation/reports` with target type `comment`, comment ID and reason; authenticate, rate-limit and provide confirmation/error states. If comment reporting is not supported, remove/disable the inert control. |
| Toggle comments, copy post link, open creator profile, tip, paid chat | Expand the comment panel, share the permitted URL, navigate, or start the selected purchase/conversation flow. | Panel/profile navigation are UI-only. Copy an expiring/public share link from `POST /afterdark/share-links` where appropriate. Tip uses a server-priced/validated `tip` checkout intent. Paid chat checks DM policy/access and creates or opens a stable conversation. |
| Follow control on subscriber-only card | Follow/unfollow a creator if the product retains follows as distinct from subscriptions. | Persist via `POST/DELETE /afterdark/creators/{creatorId}/follow`; if follow is not a supported product feature, remove the control rather than silently toggling local state. |
| Post menu: Subscribe, Copy Link, Report | Start subscription, copy share link, or report content. | Subscription uses the creator subscription flow. Link uses the share-link endpoint and must not grant access to paid media. Report uses `POST /afterdark/moderation/reports`, storing authenticated reporter, target, reason, and status; do not store reports only in local storage. |
| Creator-action callout (become creator / upload depending on role) | Open onboarding or upload modal. | Same application and upload authorization as the sidebar actions; role is determined by the server, not the client flag. |
| E2E/encryption and payment-security banner | Display only security properties that are actually implemented and independently verifiable. | Do not claim end-to-end encryption, screenshot monitoring, PCI compliance, or direct-provider processing unless the architecture and provider integration substantiate the claim. Use reviewed, accurate copy; a display banner itself is UI-only. |
| Terms, Privacy, Creator Guidelines, DMCA links | Open the corresponding current legal/policy documents. The current anchors use `#` and do not navigate to real documents. | Replace with approved application routes/URLs and version the applicable policy text. Disable/remove dead links until their destinations exist; record acceptance/version only through the appropriate server consent flow. |

### 13.3 Creator directory — `/afterdark/directory`

Found in `src/pages/afterdark/AfterDarkDirectory.jsx`.

| Control/action | Expected behavior | How the action should go through |
|---|---|---|
| Search creators | Match public creator name, username, and permitted profile fields. | Query `GET /afterdark/creators?q=...`; debounce requests and reset pagination when the query changes. |
| Open/close filter drawer; verified-only and online-only toggles | Show filters and narrow the result list. | Drawer is UI-only. Include verified/online facets in the directory API query; server supplies verified/online state and does not trust a client assertion. |
| Tier checkboxes, content-tag chips, location selector | Apply selected facets. | Include selected facets in `GET /afterdark/creators`; validate/normalize values and apply visibility, block, and geo rules server-side. |
| Sort by popular/newest/price | Reorder results by the selected supported sort. | Pass the selected `sort` to the server; popularity and subscription price are server-derived. |
| Grid/list toggle | Change presentation density only. | UI-only; preserve filters and results. |
| Creator card/profile link | Open creator profile. | Navigate using creator ID; load profile with `GET /afterdark/creators/{creatorId}` and never rely on mock/card route state for authorization. |
| Quick view open, close, and profile navigation | Show a creator summary and optionally navigate to the complete profile. | Summary comes from the same directory response or creator-profile endpoint; opening/closing is UI-only. |
| Reset all filters | Clear tiers, tags, location, verified/online toggles, and search. | Reset client filter state and request the first server page with default facets; close the drawer only if that matches the intended UX. |
| Featured creator banner and Explore Vault button | Navigate to the featured creator's profile. The button currently bubbles to the banner's profile navigation. | Populate the featured creator from the server and use its stable creator ID; keep keyboard/button behavior accessible and do not leave the CTA pointing at a hardcoded mock creator. |
| Previous/numbered/next page | Navigate result pages while retaining current facets/sort. | Use server pagination (`cursor`/`next_cursor`) or a documented server page/limit contract rather than slicing a fixed mock array. Return authoritative total/page metadata if numbered pages are retained. |

### 13.4 Creator profile — `/afterdark/cprofile`

Found in `src/pages/afterdark/AfterDarkCreatorProfile.jsx`.

| Control/action | Expected behavior | How the action should go through |
|---|---|---|
| Back | Return to the previous route. | UI navigation only. |
| Overflow menu: Share Profile, View Standard Profile, Report Creator | Share a permitted profile link, navigate to the linked Chattie profile, or file a report. | Share uses an expiring/public link as applicable. Chattie profile navigation is UI-only. Report through `POST /afterdark/moderation/reports`; server stores a reviewable report and applies rate limits. |
| Subscribe / subscribed status | Start a creator subscription or show current server status/renewal. | Create a creator subscription checkout intent; verified payment activates it. Read status from the creator profile/entitlement API. Do not mark subscribed or unlock subscriber posts based on a timer/local store. |
| Send Tip and amount presets/custom amount/message | Send a tip to the creator with an optional attached message. | Validate amount/currency and creator eligibility server-side; create a `tip` checkout intent and ledger entry. Deliver the attached message only under the chat/moderation policy. Reject insufficient wallet funds atomically when using wallet. |
| Message / paid chat | Open or request access to a conversation. | Apply creator DM control and any paid-chat access rule server-side; use a stable conversation ID and the chat endpoints in section 5. |
| All/Photos/Videos tabs | Filter the creator's posts. | Query `GET /afterdark/creators/{creatorId}/posts` with media type and cursor; tabs themselves are UI state. |
| Post-card actions | Same reveal, unlock, like, comment, tip, share, report, and paid-chat behavior as the Feed card. | Use the endpoints in section 13.2; enforce creator/post ownership and entitlements on every request. |

### 13.5 Chats — `/afterdark/chats`

Found in `src/pages/afterdark/AfterDarkChatHub.jsx` and `src/pages/afterdark/AfterDarkMyChannel.jsx` (`SubscriberMessageModal`).

| Control/action | Expected behavior | How the action should go through |
|---|---|---|
| Search conversations and choose contact | Filter the server conversation list and open the selected thread. | Load `GET /afterdark/conversations?cursor=&q=` and `GET /afterdark/conversations/{conversationId}/messages`; resolve participants from authenticated server records, not concatenated `creator:`/`subscriber:` IDs. |
| Back to conversations / open chat from creator profile | Change selected thread/route. | UI navigation only after the conversation's access has been validated by the server. |
| Conversation list preview, unread count, message timestamp and open/read state | Show latest authorized message and mark history read when the user opens a conversation. | Return preview/unread/read-cursor data from the conversation list; call `POST /afterdark/conversations/{conversationId}/read` on open. Do not treat a locally rendered checkmark as durable delivery/read proof. |
| Unlock private chat | Purchase required chat access if the creator's policy requires it. | Create `private_chat_access` checkout intent using server-resolved price; after verified payment, refresh access and open/create the conversation. |
| Compose/send text, Enter to send, mark explicit | Send a validated message with explicit-content metadata. | `POST /afterdark/conversations/{conversationId}/messages`; enforce membership, DM rules, blocks, entitlement, moderation and idempotency. Enter behavior is UI-only submission. |
| Attach image/video and remove attachment | Upload or discard a private attachment before sending. | Reserve/upload/complete a private asset; enforce size/type/scanning/authorization. Store an asset reference, not a browser data URL. Removing the draft is UI-only; never expose public storage URLs. |
| Reveal explicit message/media | Reveal blurred content for the current display. | UI-only acknowledgement. Return message/media metadata only to authorized participants and enforce the user's explicit-content preference without granting access to a non-participant. |
| Subscriber message modal: close, history, send | Open the same thread used by the chat hub and send a creator reply. | Use the same conversation/message API and stable IDs as the hub; no separate local conversation store. |

### 13.6 Wallet — `/afterdark/wallet`

Found in `src/pages/afterdark/AfterDarkWallet.jsx`.

| Control/action | Expected behavior | How the action should go through |
|---|---|---|
| Add Funds | Open a deposit form and initiate a wallet deposit. | Create `POST /afterdark/wallet/deposits` with server-validated amount/provider; credit only after verified provider webhook and ledger transaction. |
| Deposit M-Pesa/card choice, phone/amount entry, confirm, close | Select provider, collect required payment details, submit, or cancel. | Validate amount and phone format client-side for UX and again server-side. Use provider checkout/intent response; disable close while unresolved unless the server confirms cancellation. Do not credit wallet from the browser callback. |
| Withdraw / MAX / amount / confirm / close | Request payout of cleared funds and optionally fill the maximum available amount. | MAX is a UI convenience populated from current `GET /afterdark/wallet`; submit to `POST /afterdark/wallet/withdrawals`. Server checks KYC, destination ownership, limits/fees, available cleared balance, idempotency, and reserves funds atomically. |
| All/Credit/Debit filter | Filter displayed transaction rows. | Query `GET /afterdark/wallet/transactions?type=&cursor=` or filter a server page without changing ledger state. |
| Export transactions | Download authorized transaction history in CSV. | Export the server-returned ledger rows, respecting pagination and export authorization; never generate a financial record from mock rows. |
| View payment methods | This button currently has no handler. | Implement a protected payout/payment-method screen and verified destination workflow before enabling it, or remove/disable it. Use `/afterdark/me/payout-methods` for creator payout destinations; distinguish payer methods from creator payout methods. |
| Balance and pending-clearance displays | Show available, pending, reserved and paid-out values. | Read the authoritative wallet endpoint and ledger projection. Do not trust or update Zustand/local balances as funds. |

### 13.7 Creator channel — `/afterdark/channel`

Found in `src/pages/afterdark/AfterDarkMyChannel.jsx`.

| Control/action | Expected behavior | How the action should go through |
|---|---|---|
| Vault/Customers/Earnings/Settings tabs and sidebar deep links | Navigate between creator channel sections. | UI navigation; fetch each section from its creator-authorized endpoint. Reject the request if caller is not an approved creator or does not own the channel. |
| Vault status filter | Show all/published/scheduled posts. | Query creator-owned posts with `GET /afterdark/me/posts?status=`; do not filter only a mock array. |
| Edit post, cancel, save changes | Update caption, monetization strategy, or price for an owned post. | `PATCH /afterdark/me/posts/{postId}`; validate PPV price and state-specific edits, preserve purchase/entitlement history, and return canonical saved post. |
| Delete vault post and confirm dialog | Archive/delete creator-owned content after confirmation. The current action only removes the card from local state. | `DELETE /afterdark/me/posts/{postId}`; enforce ownership, audit the action, prevent new access, and apply the documented existing-entitlement/refund/retention policy. Show the post's server-returned state. |
| Share post | Copy a permitted public/share URL. | Use the share-link flow; never include private-media credentials in a reusable URL. |
| Subscriber search/status filter and subscriber cards | Find permitted subscriber records and current status. | Fetch `GET /afterdark/me/subscriptions?status=&q=&cursor=` with creator-only authorization and data minimization. |
| Message subscriber | Open the shared conversation thread with that subscriber. | Load/create the same conversation as the chat hub; send through the common message API. Respect blocks and account/DM restrictions. |
| Earnings/payout summary and withdrawal modal/MAX/confirm | Review available and pending earnings, request a payout, or populate the maximum amount. | Fetch ledger-backed channel finance/wallet data; submit payout via `POST /afterdark/wallet/withdrawals` and show server payout status. MAX must use currently available cleared funds, not include pending clearance. Modal close is UI-only unless payout is pending; do not optimistically report paid. |
| Payout-history status and Download receipt | Review the real payout state and download a receipt for a completed/eligible payout. The current modal also hardcodes a masked destination, 24-hour delivery, and KES 50 fee. | Fetch authorized payout records and a server-generated receipt (`GET /afterdark/wallet/withdrawals/{payoutId}` or a protected receipt endpoint); do not generate a receipt from mock payout fields or display all statuses as paid. Obtain destination, fee, delivery estimate and status from current server/provider policy; do not hardcode them. |
| Creator channel Settings: monthly subscription price, welcome message, Save | Edit creator's public subscription offer and automated welcome message. Price 0 is presented as free to follow. The current save stores values only in `localStorage`. | Save through validated creator-profile/plan settings and show success only after server confirmation. Server snapshots price for future checkouts and must not rewrite existing paid periods; explicitly support or reject a zero-price/free plan. Welcome-message delivery uses common conversation/message policy and opt-out/moderation rules. |
| Upload content | Open the upload and publish workflow. | Same protected upload path as section 13.1 and 13.9. |
| Deactivate creator account shortcut | Navigate to the After Dark settings danger tab; it does not itself deactivate the account. | UI navigation only. Perform the actual lifecycle transition only through the confirmed server operation in section 13.8. |

### 13.8 After Dark Settings — `/afterdark/settings`

Found in `src/pages/afterdark/AfterDarkSettings.jsx`. The UI currently reads/saves local `afterdark-settings`; treat all values as unsaved prototypes until the API reports success.

| Control/action | Expected behavior | How the action should go through |
|---|---|---|
| Role-specific tabs and URL tab selection | Switch between creator profile/monetization/privacy/security/notifications/danger and member account/privacy/security/notifications/data sections. | UI state/query-string only; determine role and allowed actions from the server application/profile response. |
| Creator avatar/cover and member avatar selection/preview | Select an image and preview it before saving. The current picker accepts images up to 5 MB but saves a browser data URL locally. | Upload through an authenticated image-asset endpoint; save an asset ID in creator-profile settings. Do not persist `FileReader` data URLs. Reuse shared account avatar only when the user explicitly edits the shared account avatar. |
| Creator display name, username, bio, location, website; member name/email display | Edit creator persona fields; the member name/email are currently read-only and managed by Chattie. | Save creator persona through `PATCH /afterdark/me/creator-profile`; if shared account edit controls are added, save truly shared fields through `/api/settings` with explicit field mapping. Validate username uniqueness, URL safety and limits; do not let an After Dark payload overwrite unrelated shared settings. |
| Default PPV price, automatic withdrawal, withdrawal threshold | Configure creator monetization defaults. | Save validated typed settings to the After Dark settings API. Enforce price/threshold/currency on the server and make withdrawal workers honor the persisted policy; a toggle does not authorize payouts. |
| Watermark toggle/text, geo-block toggle/regions, DM control | Configure content watermarking, availability restrictions, and who may message. | Persist typed values server-side; validate text/regions and apply them to media processing, discovery/content authorization, and conversation creation/message send. Geo decisions use the server's trusted location policy. |
| Add/remove geo-blocked country or city | Maintain the creator's blocked-region list. The current add action uses a browser prompt and tags are removed locally. | Replace free-form prompt input with validated region selection/search; save canonical region identifiers to creator settings. Ensure removal is persisted and enforce changes on discovery/content delivery using the server's trusted geo policy. |
| Explicit-content display preference and discoverability | Change rendering preference or profile visibility. | Persist preferences in the appropriate member/creator settings. Explicit display preference only affects presentation; it never waives adult-content entitlement or age checks. Discoverability must be applied by directory/feed services. |
| 2FA toggle | Enable/disable account second factor. | Do not toggle a local boolean. Add a secure enrollment/challenge/confirmation flow first; require step-up auth and recovery policy. |
| Change password dialog, new password, cancel/confirm | Change the authenticated account password. | Existing inspected router has no password-change route. Add a shared account endpoint with current-password/step-up checks, policy validation, audit, token/session handling, then wire submit; until then disable or label as unavailable, not “changed.” |
| Session list/revoke session / terminate other sessions | View active devices and revoke one or all other sessions. The current per-session Revoke action only removes a mock row in the browser. | Existing `POST /api/settings/terminate-sessions` invalidates sessions by token version. Use it for “terminate other sessions”; do not display fabricated per-device rows or claim one-session revocation until list/revoke APIs exist. |
| Blocked users / unblock | List and unblock accounts blocked by the current user. The current Unblock action only removes a mock row locally. | Replace mock rows with `GET /api/settings/blocked` and call `DELETE /api/settings/blocked/{id}`. Use common block records in After Dark discovery, chats and live authorization. |
| Email/push notification toggles | Configure creator New Subscribers, Tips & Unlocks, Direct Messages, Platform Updates (email), and Feed Mentions (push); members see Direct Messages and Platform Updates (email) plus Direct Messages (push). | Save validated notification categories to After Dark settings and connect delivery to the shared notification service. Keep existing Chattie notification flags intact; marketing consent/unsubscribe rules still apply. |
| Request data archive | The current “REQUEST DATA ARCHIVE” button immediately downloads JSON assembled from current local UI/mock values; it does not request a server export. | Replace with an authenticated export-job request covering eligible Chattie and After Dark records, return job ID/status, and provide an expiring authorized download. Existing Chattie export is a PDF workflow and is not equivalent to a complete After Dark archive. |
| Pause/resume creator account | Change creator availability/status under documented subscription/live rules. | Use `POST/DELETE /afterdark/me/creator-pause`, audit transition, update discovery, prevent new purchases/lives as policy dictates, and notify affected subscribers. |
| Deactivate creator status | Explicitly deactivate creator tools/profile after displaying effects. | `DELETE /afterdark/me/creator-status`; server applies subscriptions, pending earnings/payout, content, audit and retention rules. Change client role/navigation only after server success. |
| Delete account / return to Chattie | Delete the account or leave the After Dark route. | Account deletion uses authenticated shared delete flow extended for After Dark entitlements/content/retention. “Return to Chattie” is navigation only and does not delete/deactivate the account. |
| Save settings | Persist all changed fields and show validation/error/success states. | Submit only fields belonging to that settings domain; update UI/cache from canonical server response. Keep unsaved edits after failure and never toast “saved” based solely on `localStorage`. |
| Settings tab/query navigation | Change role-appropriate settings sections and keep the selected tab in the URL. | UI-only URL state; validate the requested tab against the server-confirmed role and avoid showing creator-only controls based solely on a persisted client flag. |

### 13.9 Creator onboarding — `OptInGateModal`

Found in `src/components/afterdark/OptInGateModal.jsx`, opened by “Become a creator” or non-creator upload action.

| Control/action | Expected behavior | How the action should go through |
|---|---|---|
| Close/backdrop close | Exit onboarding without submitting. | UI-only; retain or discard draft according to explicit UX choice. |
| Step navigation and previous/continue | Move through intro, details/age, payout preview, and rules with validation. | UI-only progress; authoritative checks remain on the server. A date of birth or existing generic verified badge from the client is not proof of adult eligibility. |
| Creator alias / use account name | Choose a public creator alias. | Validate and submit as application/profile data; ensure username/alias uniqueness and keep it separate from the shared dating profile as specified in section 4.1. |
| DOB/age details | Provide information needed for age/eligibility review. | Submit only via protected verification/application flow; minimize retention and never approve based only on browser-computed age. |
| Payout number/details | Enter payout setup data. | Use protected payout-method enrollment; tokenize/encrypt provider data and verify ownership before enabling payouts. Do not treat preview number as a verified destination. |
| Agreement checkboxes and submit | Record versioned required consents and submit application. | `POST /afterdark/me/creator-application`; server records policy versions/timestamps, verifies eligibility, and returns application status. |
| Enable creator mode / completion | Finish onboarding and expose creator UI when approved. | Refresh creator application/profile from server. Only an approved status enables creator tools; the present local `setCreatorStatus` callback is prototype behavior and must not grant permission. |
| Payout preview/number and status hints | Show the user how payout setup works and collect any initial payout details. | Clearly label preview values as estimates; verified payout-method creation must use its protected enrollment/verification workflow. Never treat a number entered in onboarding as a verified payout destination. |

### 13.10 Upload/publish modal — `UploadExplicitModal`

Found in `src/components/afterdark/UploadExplicitModal.jsx`, opened from feed/sidebar/channel.

| Control/action | Expected behavior | How the action should go through |
|---|---|---|
| Choose/drop/replace/remove image or video | Select a supported file and preview it. | Check creator approval and reserve a private upload at `POST /afterdark/uploads`; validate size/type on client and server, scan and transcode server-side. Remove only the local draft or cancel an upload reservation. |
| Media/Details/Monetize/Publish step tabs, next/back | Navigate through the upload wizard without skipping required validation. | UI-only navigation; server owns upload processing and publication state. |
| Caption, category, tags add/remove (Enter/comma to add) | Edit metadata and content classification. | Submit normalized, bounded fields to post creation; server validates categories/tags and escapes user-generated text. Tags added to a local draft are not persisted until post creation succeeds. |
| Free/subscriber/PPV pricing selection, price, teaser duration, watermark | Set post access/pricing and rendition options. | Persist a typed post request; server validates price/currency/teaser bounds, snapshots price, and applies watermark during private media processing. |
| Schedule toggle/date/time | Schedule publication. | Persist timezone-aware `publish_at`; worker publishes once after eligibility/moderation checks. Do not use a browser timer to publish. |
| Performer/model declarations and consent confirmation | Declare participants and compliance. | Submit stable performer references and consent evidence; server verifies identity/consent/compliance before publication. A checkbox or typed name alone is not proof. |
| Submit/upload progress/close | Complete upload and create/publish/schedule a post; prevent accidental close while uploading. | Complete upload through `/afterdark/uploads/{uploadId}/complete`, then create the draft/post through `/afterdark/me/posts`. Show server processing/moderation state; do not simulate progress to 100% as a successful upload. |

### 13.11 Checkout modal — `MpesaPaystackModal`

Found in `src/components/afterdark/MpesaPaystackModal.jsx`; shared by feed/profile/chat purchase flows.

| Control/action | Expected behavior | How the action should go through |
|---|---|---|
| M-Pesa/card tabs, phone/card entry, saved-number selection | Select payment method and provide provider-required fields. | Create a server checkout intent with product type/ID; server resolves amount, currency, payer and provider. Never send or store raw card details outside the provider's approved client flow; avoid storing saved phone numbers without consent/policy. |
| Submit checkout | Initiate provider action and show pending status. | Use the server intent response and provider SDK/STK prompt. Poll a protected intent-status endpoint or receive a trusted status update; only verified webhook processing creates entitlements/ledger credit. |
| Order subtotal/platform fee/tax/total display | Show a transparent final amount before confirmation. | Calculate and return the authoritative item price, fees, tax, currency, and total from the server checkout intent. Client display calculations are estimates only; reject any mismatch and never trust a client-supplied total. |
| Close/backdrop close | Cancel or dismiss checkout where safe. | Allow close only when no unresolved provider operation, or request server cancellation and reconcile status. Closing UI is not a payment failure/cancellation proof. |
| Copy transaction reference / success close | Copy a safe reference or close after showing confirmed result. | Show provider/server reference after verifying intent status; never use the copied/client-generated reference to grant access. |
| Retry / return after failure | Retry a failed/expired checkout or cancel. | Create/reuse an idempotent intent according to state; never duplicate-charge or grant access from retry UI state. |
| Saved M-Pesa numbers and polling timeout | Reuse an opted-in payment number and display pending/timeout status. | Store payment details only under explicit consent and approved retention/encryption policy; otherwise keep them session-only. Timeout is not proof of failure—query the server intent and reconcile late provider success before allowing retry or granting access. |

### 13.12 Live studio and viewer controls

Live controls are rendered in `AfterDarkFeed.jsx` and `AfterDarkLiveViewingModal.jsx`; their action mapping is detailed in section 13.2. Additional rules for control groups:

| Control group | Required behavior/route |
|---|---|
| Studio start/end/manage | Start and end only the authenticated creator's session; server creates durable session ID and state, checks eligibility, limits concurrent streams and revokes tokens on end. |
| Camera/microphone local toggles | Browser device controls only; publishing permissions remain scoped by server-issued SFU credentials. |
| Viewer connect/leave/reconnect | Join endpoint checks live status, blocks, geo policy and exact subscription/pass entitlement; leave endpoint/presence cleanup runs on close/disconnect. Reconnect must reauthorize. |
| Chat/reactions/viewer count | Authenticated realtime events; server assigns identity/counts and validates participant membership. No `BroadcastChannel` or client-reported viewer count is authoritative. |
| Guest request/approve/deny/remove | Persist guest-request state transitions. Only host/authorized moderator approves or removes; grant/revoke stage publish rights and disconnect the participant on removal. |
| Live studio guest Allow/Deny/Remove and live chat/watch count | Host reviews guest requests, controls current guests, and sees live activity. These controls currently signal through browser `BroadcastChannel` and locally mutate state. Call the host-authorized guest-request approve/deny and stage-remove endpoints; server issues/revokes publish rights and disconnects removed guests. Stream chat and viewer count must come from authenticated realtime events/provider callbacks, not local arrays or browser-reported presence. |

### 13.13 Shared rules for implementing these flows

1. Establish one authenticated Chattie account identity and use the server-derived user ID for every After Dark operation.
2. Read current role, creator application status, profile/settings and entitlement from the API at page load; cached values may improve display only and must be reconciled.
3. Use server-issued IDs, cursors, prices, balances, statuses and timestamps. Do not generate IDs/prices/transaction references or status transitions in React for production behavior.
4. For every write, show pending state, disable duplicate submission, report API validation/errors, and update state only from the response or a subsequent authoritative read.
5. After payment, refresh the exact entitlement and authorize the corresponding asset/chat/live operation; unrelated content or later live sessions remain locked.
6. For navigation, tab switches, reveal/playback, local device controls and modal dismissal, explicitly classify the action as UI-only unless product policy requires persistence.
7. Keep the related acceptance coverage in section 10 in sync with this map; add tests for the endpoint authorization and the corresponding UI's loading, failure, retry and success behavior.

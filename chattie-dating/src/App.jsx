import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Globe, SunMedium, Moon, Flame, MoreHorizontal, X } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import { useI18n } from './i18n';
import { settingsService } from './api/settings.service';
import { DialogProvider } from './components/modals/DialogProvider';

// Layout & Security
import ProtectedRoute from './components/ProtectedRoute';
import LanguageModal from './components/modals/LanguageModal';

const Login = lazy(() => import('./pages/auth/Login'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const Register = lazy(() => import('./pages/auth/Register'));
const Onboarding = lazy(() => import('./pages/auth/Onboarding'));
const AccountReview = lazy(() => import('./pages/AccountReview'));
const SwipeDeck = lazy(() => import('./pages/discovery/SwipeDeck'));
const GridBrowse = lazy(() => import('./pages/discovery/GridBrowse'));
const Likes = lazy(() => import('./pages/discovery/Likes'));
const RoomDirectory = lazy(() => import('./pages/chat/RoomDirectory'));
const LiveRoom = lazy(() => import('./pages/chat/LiveRoom'));
const PrivateInbox = lazy(() => import('./pages/chat/PrivateInbox'));
const DirectMessage = lazy(() => import('./pages/chat/DirectMessage'));
const MyProfile = lazy(() => import('./pages/profile/MyProfile'));
const UserSettings = lazy(() => import('./pages/profile/UserSettings'));
const PaymentMethods = lazy(() => import('./pages/profile/PaymentMethods'));
const Notifications = lazy(() => import('./components/NotificationModal'));
const PremiumUpgrade = lazy(() => import('./pages/monetization/PremiumUpgrade'));
const Guidelines = lazy(() => import('./pages/legal/Guidelines'));
const SupportPage = lazy(() => import('./pages/SupportPage'));
const ModelDashboard = lazy(() => import('./pages/model/ModelDashboard'));
const ModelChatQueue = lazy(() => import('./pages/model/ModelChatQueue'));
const ModelEarnings = lazy(() => import('./pages/model/ModelEarnings'));
const ModelSettings = lazy(() => import('./pages/model/ModelSettings'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminCreators = lazy(() => import('./pages/admin/AdminCreators'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminRoomManager = lazy(() => import('./pages/admin/AdminRoomManager'));
const AdminMediaVaults = lazy(() => import('./pages/admin/AdminMediaVaults'));
const AdminFinance = lazy(() => import('./pages/admin/AdminFinance'));
const AdminPayouts = lazy(() => import('./pages/admin/AdminPayouts'));
const AdminCreatorPayouts = lazy(() => import('./pages/admin/AdminCreatorPayouts'));
const AdminModerationQueue = lazy(() => import('./pages/admin/AdminModerationQueue'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));
const AdminAfterDarkPosts = lazy(() => import('./pages/admin/AdminAfterDarkPosts'));
const AdminSupportInbox = lazy(() => import('./pages/admin/AdminSupportInbox'));
const AdminCreatorApplications = lazy(() => import('./pages/admin/AdminCreatorApplications'));
const AdminReports = lazy(() => import('./pages/admin/AdminReports'));
const AfterDarkFeed = lazy(() => import('./pages/afterdark/AfterDarkFeed'));
const AfterDarkChatHub = lazy(() => import('./pages/afterdark/AfterDarkChatHub'));
const AfterDarkDirectory = lazy(() => import('./pages/afterdark/AfterDarkDirectory'));
const AfterDarkMyChannel = lazy(() => import('./pages/afterdark/AfterDarkMyChannel'));
const AfterDarkSettings = lazy(() => import('./pages/afterdark/AfterDarkSettings'));
const AfterDarkWallet = lazy(() => import('./pages/afterdark/AfterDarkWallet'));
const AfterDarkCreatorProfile = lazy(() => import('./pages/afterdark/AfterDarkCreatorProfile'));
const MainLayout = lazy(() => import('./components/MainLayout'));
const ModelLayout = lazy(() => import('./components/model/ModelLayout'));
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));
const AfterDarkLayout = lazy(() => import('./components/afterdark/AfterDarkLayout'));

const RoutePage = ({ component: Component }) => {
  const { t } = useI18n();
  return (
    <Suspense fallback={<div className="flex min-h-full items-center justify-center bg-black p-6 text-xs font-bold uppercase tracking-widest text-zinc-400" role="status">{t('loadingPage')}</div>}>
      <Component />
    </Suspense>
  );
};

export default function App() {
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [areGlobalActionsOpen, setAreGlobalActionsOpen] = useState(false);
  const theme = useAppStore((state) => state.userPreferences.theme);
  const updatePreferences = useAppStore((state) => state.updatePreferences);
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const { locale, language, languages, setLanguage, t } = useI18n();
  const languagePreferenceSyncAttempted = useRef(false);
  const languageSelectionVersion = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.lang = locale;
  }, [theme, locale]);

  useEffect(() => {
    if (!isAuthenticated) {
      languagePreferenceSyncAttempted.current = false;
      return;
    }
    if (languagePreferenceSyncAttempted.current) return;

    languagePreferenceSyncAttempted.current = true;
    const selectionVersion = languageSelectionVersion.current;
    const localLanguage = language;

    settingsService.getLanguagePreference()
      .then(({ language: preferredLanguage }) => {
        if (selectionVersion !== languageSelectionVersion.current) return;
        if (preferredLanguage) {
          setLanguage(preferredLanguage);
          return;
        }
        return settingsService.updateLanguagePreference(localLanguage);
      })
      .catch((error) => {
        console.error('Failed to load the account language preference:', error);
      });
  }, [isAuthenticated, language, setLanguage]);

  const toggleTheme = () => {
    updatePreferences({ theme: theme === 'dark' ? 'light' : 'dark' });
  };

  const handleLanguageChange = async (nextLanguage) => {
    const selectionVersion = ++languageSelectionVersion.current;
    if (!isAuthenticated) {
      setLanguage(nextLanguage);
      return;
    }

    try {
      await settingsService.updateLanguagePreference(nextLanguage);
      if (selectionVersion === languageSelectionVersion.current) {
        setLanguage(nextLanguage);
      }
    } catch (error) {
      console.error('Failed to save the account language preference:', error);
      throw error;
    }
  };

  return (
    <DialogProvider>
    <Router>
      <div className="app-global-actions" data-open={areGlobalActionsOpen}>
        <div className="app-global-actions__items" id="app-global-actions-items">
          {areGlobalActionsOpen && (
            <>
              <button type="button" onClick={() => { toggleTheme(); setAreGlobalActionsOpen(false); }} className="theme-toggle" aria-label={t('toggleTheme')}>
                {theme === 'dark' ? <SunMedium className="theme-toggle__icon" /> : <Moon className="theme-toggle__icon" />}
              </button>
              <button
                type="button"
                onClick={() => { setIsLanguageModalOpen(true); setAreGlobalActionsOpen(false); }}
                className="language-toggle"
                aria-label={t('selectLanguage')}
                title={t('selectLanguage')}
              >
                <Globe className="language-toggle__icon" />
              </button>
              <NavLink
                to="/afterdark"
                onClick={() => setAreGlobalActionsOpen(false)}
                aria-label={t('openAfterDark')}
                title={t('adultsOnlyBadge')}
                className={({ isActive }) => `app-global-actions__afterdark flex size-12 items-center justify-center border shadow-lg backdrop-blur transition-colors ${
                  isActive
                    ? 'border-amber-500 bg-amber-500 text-black'
                    : 'border-zinc-300 bg-white/90 text-zinc-700 hover:border-amber-500 hover:text-amber-600'
                }`}
              >
                <Flame className="h-5 w-5" />
                <span className="absolute -right-1 -top-1 border border-white bg-red-600 px-1 text-[8px] font-black leading-3 text-white">18+</span>
              </NavLink>
            </>
          )}
        </div>
        <button
          type="button"
          className="app-global-actions__toggle"
          onClick={() => setAreGlobalActionsOpen(open => !open)}
          aria-expanded={areGlobalActionsOpen}
          aria-controls="app-global-actions-items"
          aria-label={areGlobalActionsOpen ? t('closeQuickActions') : t('openQuickActions')}
          title={areGlobalActionsOpen ? t('closeQuickActions') : t('openQuickActions')}
        >
          {areGlobalActionsOpen ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
        </button>
      </div>
      <LanguageModal
        isOpen={isLanguageModalOpen}
        onClose={() => setIsLanguageModalOpen(false)}
        languages={languages}
        language={language}
        setLanguage={handleLanguageChange}
        title={t('selectLanguage')}
      />

      {/* Global Notifications - Theme aware */}
      <Toaster position="top-center" richColors theme={theme} toastOptions={{ className: 'theme-toast uppercase tracking-widest' }} />
      
      <Routes>
          {/* PUBLIC ROUTES */}
          <Route path="/login" element={<RoutePage component={Login} />} />
          <Route path="/forgot-password" element={<RoutePage component={ForgotPassword} />} />
          <Route path="/register" element={<RoutePage component={Register} />} />
          <Route path="/onboarding" element={<RoutePage component={Onboarding} />} />

          {/* PROTECTED ROUTES (Requires Authentication) */}
          <Route element={<ProtectedRoute />}>
            <Route path="/account-review" element={<RoutePage component={AccountReview} />} />
            
            {/* ==========================================
                CLIENT INTERFACE 
                ========================================== */}
            <Route element={<ProtectedRoute allowedRoles={['client']} />}>
              <Route path="/" element={<RoutePage component={MainLayout} />}>
                <Route index element={<Navigate to="/rooms" replace />} />

                {/* DISCOVERY */}
                <Route path="discover" element={<RoutePage component={SwipeDeck} />} />
                <Route path="browse" element={<RoutePage component={GridBrowse} />} />
                <Route path="likes" element={<RoutePage component={Likes} />} />
                
                {/* CHAT FACTORY */}
                <Route path="rooms" element={<RoutePage component={RoomDirectory} />} />
                <Route path="rooms/:roomId" element={<RoutePage component={LiveRoom} />} />
                <Route path="messages" element={<RoutePage component={PrivateInbox} />} />
                <Route path="messages/:userId" element={<RoutePage component={DirectMessage} />} />
                
                {/* PROFILE & SYSTEM */}
                <Route path="profile" element={<RoutePage component={MyProfile} />} />
                <Route path="settings" element={<RoutePage component={UserSettings} />} />
                <Route path="payment-methods" element={<RoutePage component={PaymentMethods} />} />
                <Route path="notifications" element={<RoutePage component={Notifications} />} />
                <Route path="upgrade" element={<RoutePage component={PremiumUpgrade} />} />
                <Route path="guidelines" element={<RoutePage component={Guidelines} />} />
                <Route path="support" element={<RoutePage component={SupportPage} />} />
              </Route>
            </Route>

            {/* ==========================================
                AFTER DARK INTERFACE (Explicit Creator Section)
                ========================================== */}
            <Route element={<ProtectedRoute allowedRoles={['client', 'model']} />}>
              <Route path="/afterdark" element={<RoutePage component={AfterDarkLayout} />}>
                <Route index element={<Navigate to="/afterdark/feed" replace />} />
                <Route path="feed" element={<RoutePage component={AfterDarkFeed} />} />
                <Route path="chats" element={<RoutePage component={AfterDarkChatHub} />} />
                <Route path="directory" element={<RoutePage component={AfterDarkDirectory} />} />
                <Route path="channel" element={<RoutePage component={AfterDarkMyChannel} />} />
                <Route path="settings" element={<RoutePage component={AfterDarkSettings} />} />
                <Route path="cprofile" element={<RoutePage component={AfterDarkSettings} />} />
                <Route path="cprofile/:id" element={<RoutePage component={AfterDarkCreatorProfile} />} />
                <Route path="wallet" element={<RoutePage component={AfterDarkWallet} />} />
                {/* Note: /afterdark/wallet and /afterdark/analytics would also go here if built out as separate pages */}
              </Route>
            </Route>

            {/* ==========================================
                CREATOR TERMINAL (MODEL INTERFACE)
                ========================================== */}
            <Route element={<ProtectedRoute allowedRoles={['model']} />}>
              <Route path="/model" element={<RoutePage component={ModelLayout} />}>
                <Route index element={<Navigate to="/model/dashboard" replace />} />
                <Route path="dashboard" element={<RoutePage component={ModelDashboard} />} />
                <Route path="queue" element={<RoutePage component={ModelChatQueue} />} />
                <Route path="earnings" element={<RoutePage component={ModelEarnings} />} />
                <Route path="settings" element={<RoutePage component={ModelSettings} />} />
              </Route>
            </Route>

            {/* ==========================================
                COMMAND CONTROL CENTER (ADMIN INTERFACE)
                ========================================== */}
            <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
              <Route path="/admin" element={<RoutePage component={AdminLayout} />}>
                <Route index element={<Navigate to="/admin/dashboard" replace />} />
                
                {/* Overview */}
                <Route path="dashboard" element={<RoutePage component={AdminDashboard} />} />
                
                {/* Operators & Accounts */}
                <Route path="creators" element={<RoutePage component={AdminCreators} />} />
                <Route path="users" element={<RoutePage component={AdminUsers} />} />
                
                {/* Content & Rooms */}
                <Route path="chatroom" element={<RoutePage component={AdminRoomManager} />} />
                <Route path="media" element={<RoutePage component={AdminMediaVaults} />} />
                
                {/* Finance & Trust */}
                <Route path="finance" element={<RoutePage component={AdminFinance} />} />
                <Route path="payouts" element={<RoutePage component={AdminPayouts} />} />
                <Route path="creator-payouts" element={<RoutePage component={AdminCreatorPayouts} />} />
                <Route path="afterdark-posts" element={<RoutePage component={AdminAfterDarkPosts} />} />
                <Route path="moderation" element={<RoutePage component={AdminModerationQueue} />} />
                <Route path="support" element={<RoutePage component={AdminSupportInbox} />} />
                <Route path="creator-applications" element={<RoutePage component={AdminCreatorApplications} />} />
                <Route path="reports" element={<RoutePage component={AdminReports} />} />
                <Route path="settings" element={<RoutePage component={AdminSettings} />} />
              </Route>
            </Route>

          </Route>
      </Routes>
    </Router>
    </DialogProvider>
  );
}
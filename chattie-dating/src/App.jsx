import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Globe, SunMedium, Moon, Flame, MoreHorizontal, X } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
import { useI18n } from './i18n';
import { DialogProvider } from './components/modals/DialogProvider';

// Layout & Security
import MainLayout from './components/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import LanguageModal from './components/modals/LanguageModal';

// Layouts (Model & Admin & AfterDark)
import ModelLayout from './components/model/ModelLayout';
import AdminLayout from './components/admin/AdminLayout';
import AfterDarkLayout from './components/afterdark/AfterDarkLayout'; // Added AfterDarkLayout

// Auth Pages
import Login from './pages/auth/Login';
import ForgotPassword from './pages/auth/ForgotPassword';
import Register from './pages/auth/Register';
import Onboarding from './pages/auth/Onboarding';
import AccountReview from './pages/AccountReview';

// Discovery Pages (Client)
import SwipeDeck from './pages/discovery/SwipeDeck';
import GridBrowse from './pages/discovery/GridBrowse';
import Likes from './pages/discovery/Likes';

// Chat Pages (Client)
import RoomDirectory from './pages/chat/RoomDirectory';
import LiveRoom from './pages/chat/LiveRoom';
import PrivateInbox from './pages/chat/PrivateInbox';
import DirectMessage from './pages/chat/DirectMessage';

// Profile & Settings (Client)
import MyProfile from './pages/profile/MyProfile';
import UserSettings from './pages/profile/UserSettings';
import PaymentMethods from './pages/profile/PaymentMethods';
import Notifications from './components/NotificationModal';

// Monetization & Legal
import PremiumUpgrade from './pages/monetization/PremiumUpgrade';
import Guidelines from './pages/legal/Guidelines';
import SupportPage from './pages/SupportPage';

// Model Pages
import ModelDashboard from './pages/model/ModelDashboard';
import ModelChatQueue from './pages/model/ModelChatQueue';
import ModelEarnings from './pages/model/ModelEarnings';
import ModelSettings from './pages/model/ModelSettings';

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminCreators from './pages/admin/AdminCreators';
import AdminUsers from './pages/admin/AdminUsers';
import AdminRoomManager from './pages/admin/AdminRoomManager';
import AdminMediaVaults from './pages/admin/AdminMediaVaults';
import AdminFinance from './pages/admin/AdminFinance';
import AdminPayouts from './pages/admin/AdminPayouts';
import AdminCreatorPayouts from './pages/admin/AdminCreatorPayouts';
import AdminModerationQueue from './pages/admin/AdminModerationQueue';
import AdminSettings from './pages/admin/AdminSettings';
import AdminAfterDarkPosts from './pages/admin/AdminAfterDarkPosts';
import AdminSupportInbox from './pages/admin/AdminSupportInbox';
import AdminCreatorApplications from './pages/admin/AdminCreatorApplications';

// After Dark Pages (Client/Creator Hybrid)
import AfterDarkFeed from './pages/afterdark/AfterDarkFeed';
import AfterDarkChatHub from './pages/afterdark/AfterDarkChatHub';
import AfterDarkDirectory from './pages/afterdark/AfterDarkDirectory';
import AfterDarkMyChannel from './pages/afterdark/AfterDarkMyChannel';
import AfterDarkSettings from './pages/afterdark/AfterDarkSettings';
import AfterDarkWallet from './pages/afterdark/AfterDarkWallet';
import AfterDarkCreatorProfile from './pages/afterdark/AfterDarkCreatorProfile';

export default function App() {
  const [isLanguageModalOpen, setIsLanguageModalOpen] = useState(false);
  const [areGlobalActionsOpen, setAreGlobalActionsOpen] = useState(false);
  const theme = useAppStore((state) => state.userPreferences.theme);
  const updatePreferences = useAppStore((state) => state.updatePreferences);
  const { locale, language, languages, setLanguage, t } = useI18n();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.lang = locale;
  }, [theme, locale]);

  const toggleTheme = () => {
    updatePreferences({ theme: theme === 'dark' ? 'light' : 'dark' });
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
                aria-label="Open After Dark, adults 18 and over"
                title="After Dark (18+)"
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
          aria-label={areGlobalActionsOpen ? 'Close quick actions' : 'Open quick actions'}
          title={areGlobalActionsOpen ? 'Close quick actions' : 'Open quick actions'}
        >
          {areGlobalActionsOpen ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
        </button>
      </div>
      <LanguageModal
        isOpen={isLanguageModalOpen}
        onClose={() => setIsLanguageModalOpen(false)}
        languages={languages}
        language={language}
        setLanguage={setLanguage}
        title={t('selectLanguage')}
      />

      {/* Global Notifications - Theme aware */}
      <Toaster position="top-center" richColors theme={theme} toastOptions={{ className: 'theme-toast uppercase tracking-widest' }} />
      
      <Routes>
          {/* PUBLIC ROUTES */}
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/register" element={<Register />} />
          <Route path="/onboarding" element={<Onboarding />} />

          {/* PROTECTED ROUTES (Requires Authentication) */}
          <Route element={<ProtectedRoute />}>
            <Route path="/account-review" element={<AccountReview />} />
            
            {/* ==========================================
                CLIENT INTERFACE 
                ========================================== */}
            <Route element={<ProtectedRoute allowedRoles={['client']} />}>
              <Route path="/" element={<MainLayout />}>
                <Route index element={<Navigate to="/rooms" replace />} />

                {/* DISCOVERY */}
                <Route path="discover" element={<SwipeDeck />} />
                <Route path="browse" element={<GridBrowse />} />
                <Route path="likes" element={<Likes />} />
                
                {/* CHAT FACTORY */}
                <Route path="rooms" element={<RoomDirectory />} />
                <Route path="rooms/:roomId" element={<LiveRoom />} />
                <Route path="messages" element={<PrivateInbox />} />
                <Route path="messages/:userId" element={<DirectMessage />} />
                
                {/* PROFILE & SYSTEM */}
                <Route path="profile" element={<MyProfile />} />
                <Route path="settings" element={<UserSettings />} />
                <Route path="payment-methods" element={<PaymentMethods />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="upgrade" element={<PremiumUpgrade />} />
                <Route path="guidelines" element={<Guidelines />} />
                <Route path="support" element={<SupportPage />} />
              </Route>
            </Route>

            {/* ==========================================
                AFTER DARK INTERFACE (Explicit Creator Section)
                ========================================== */}
            <Route element={<ProtectedRoute allowedRoles={['client', 'model']} />}>
              <Route path="/afterdark" element={<AfterDarkLayout />}>
                <Route index element={<Navigate to="/afterdark/feed" replace />} />
                <Route path="feed" element={<AfterDarkFeed />} />
                <Route path="chats" element={<AfterDarkChatHub />} />
                <Route path="directory" element={<AfterDarkDirectory />} />
                <Route path="channel" element={<AfterDarkMyChannel />} />
                <Route path="settings" element={<AfterDarkSettings />} />
                <Route path="cprofile" element={<AfterDarkSettings />} />
                <Route path="cprofile/:id" element={<AfterDarkCreatorProfile/>} />
                <Route path="wallet" element={<AfterDarkWallet />} />
                {/* Note: /afterdark/wallet and /afterdark/analytics would also go here if built out as separate pages */}
              </Route>
            </Route>

            {/* ==========================================
                CREATOR TERMINAL (MODEL INTERFACE)
                ========================================== */}
            <Route element={<ProtectedRoute allowedRoles={['model']} />}>
              <Route path="/model" element={<ModelLayout />}>
                <Route index element={<Navigate to="/model/dashboard" replace />} />
                <Route path="dashboard" element={<ModelDashboard />} />
                <Route path="queue" element={<ModelChatQueue />} />
                <Route path="earnings" element={<ModelEarnings />} />
                <Route path="settings" element={<ModelSettings />} />
              </Route>
            </Route>

            {/* ==========================================
                COMMAND CONTROL CENTER (ADMIN INTERFACE)
                ========================================== */}
            <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<Navigate to="/admin/dashboard" replace />} />
                
                {/* Overview */}
                <Route path="dashboard" element={<AdminDashboard />} />
                
                {/* Operators & Accounts */}
                <Route path="creators" element={<AdminCreators />} />
                <Route path="users" element={<AdminUsers />} />
                
                {/* Content & Rooms */}
                <Route path="chatroom" element={<AdminRoomManager />} />
                <Route path="media" element={<AdminMediaVaults />} />
                
                {/* Finance & Trust */}
                <Route path="finance" element={<AdminFinance />} />
                <Route path="payouts" element={<AdminPayouts />} />
                <Route path="creator-payouts" element={<AdminCreatorPayouts />} />
                <Route path="afterdark-posts" element={<AdminAfterDarkPosts />} />
                <Route path="moderation" element={<AdminModerationQueue />} />
                <Route path="support" element={<AdminSupportInbox />} />
                <Route path="creator-applications" element={<AdminCreatorApplications />} />
                <Route path="settings" element={<AdminSettings />} />
              </Route>
            </Route>

          </Route>
      </Routes>
    </Router>
    </DialogProvider>
  );
}
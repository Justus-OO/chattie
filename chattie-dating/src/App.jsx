import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { SunMedium, Moon } from 'lucide-react';
import { useAppStore } from './store/useAppStore';

// Layout & Security
import MainLayout from './components/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';

// Layouts (Model & Admin)
import ModelLayout from './components/model/ModelLayout';
import AdminLayout from './components/admin/AdminLayout';

// Auth Pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import Onboarding from './pages/auth/Onboarding';

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

// Monetization & Legal
import PremiumUpgrade from './pages/monetization/PremiumUpgrade';
import Guidelines from './pages/legal/Guidelines';

// Model Pages
import ModelDashboard from './pages/model/ModelDashboard';
import ModelChatQueue from './pages/model/ModelChatQueue';
import ModelEarnings from './pages/model/ModelEarnings';

// Admin Pages
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminCreators from './pages/admin/AdminCreators';
import AdminUsers from './pages/admin/AdminUsers';
import AdminRoomManager from './pages/admin/AdminRoomManager';
import AdminMediaVaults from './pages/admin/AdminMediaVaults';
import AdminFinance from './pages/admin/AdminFinance';
import AdminPayouts from './pages/admin/AdminPayouts';
import AdminModerationQueue from './pages/admin/AdminModerationQueue';

export default function App() {
  const theme = useAppStore((state) => state.userPreferences.theme);
  const updatePreferences = useAppStore((state) => state.updatePreferences);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const toggleTheme = () => {
    updatePreferences({ theme: theme === 'dark' ? 'light' : 'dark' });
  };

  return (
    <>
      <button type="button" onClick={toggleTheme} className="theme-toggle" aria-label="Toggle theme">
        {theme === 'dark' ? <SunMedium className="theme-toggle__icon" /> : <Moon className="theme-toggle__icon" />}
      </button>

      {/* Global Notifications - Theme aware */}
      <Toaster position="top-center" richColors theme={theme} toastOptions={{ className: 'theme-toast uppercase tracking-widest' }} />
      
      <Router>
        <Routes>
          {/* PUBLIC ROUTES */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/onboarding" element={<Onboarding />} />

          {/* PROTECTED ROUTES (Requires Authentication) */}
          <Route element={<ProtectedRoute />}>
            
            {/* ==========================================
                CLIENT INTERFACE 
                ========================================== */}
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
              <Route path="upgrade" element={<PremiumUpgrade />} />
              <Route path="guidelines" element={<Guidelines />} />
            </Route>

            {/* ==========================================
                CREATOR TERMINAL (MODEL INTERFACE)
                ========================================== */}
            <Route path="/model" element={<ModelLayout />}>
              <Route index element={<Navigate to="/model/dashboard" replace />} />
              <Route path="dashboard" element={<ModelDashboard />} />
              <Route path="queue" element={<ModelChatQueue />} />
              <Route path="earnings" element={<ModelEarnings />} />
            </Route>

            {/* ==========================================
                COMMAND CONTROL CENTER (ADMIN INTERFACE)
                ========================================== */}
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
              <Route path="moderation" element={<AdminModerationQueue />} />
            </Route>

          </Route>
        </Routes>
      </Router>
    </>
  );
}
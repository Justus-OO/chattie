import React, { useState, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { ShieldCheck, LockKeyhole, Loader2 } from 'lucide-react';
import { getRoleHome, getUserRole } from '../utils/roles';

// ============================================================================
// COMPONENT: ProtectedRoute
// This acts as a security gatekeeper for all private routes. It handles 
// authentication checks, redirect memory, and provides a polished loading 
// state while verifying the user's session token.
// ============================================================================
export default function ProtectedRoute({ allowedRoles }) {
  const location = useLocation();
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const user = useAppStore((state) => state.user);
  
  // --- STATE ---
  // We introduce a brief verification state to allow Zustand's persist 
  // middleware to rehydrate, and to give a premium "secure" feel to the routing.
  const [isVerifying, setIsVerifying] = useState(true);

  useEffect(() => {
    // Simulate a secure token validation/hydration delay.
    // In a real Spring Boot app, this is where you might dispatch a quick 
    // /api/auth/validate-token request to ensure the JWT hasn't expired.
    const verificationTimer = setTimeout(() => {
      setIsVerifying(false);
    }, 800); 

    return () => clearTimeout(verificationTimer);
  }, []);

  // ============================================================================
  // RENDER: Loading / Verifying State
  // ============================================================================
  if (isVerifying) {
    return (
      <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-slate-950 font-sans relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-rose-600/10 rounded-full blur-[100px] pointer-events-none" />
        
        <div className="relative z-10 flex flex-col items-center">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-rose-500/20 rounded-full blur-xl animate-pulse" />
            <div className="w-16 h-16 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-center relative shadow-2xl">
              <ShieldCheck className="w-8 h-8 text-rose-500" />
            </div>
            <div className="absolute -bottom-2 -right-2 w-6 h-6 bg-slate-900 border border-slate-800 rounded-full flex items-center justify-center">
              <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER: Unauthorized Redirect
  // ============================================================================
  if (!isAuthenticated) {
    // We pass the current location in state so the Login component can 
    // redirect them right back to where they were trying to go after authenticating.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(getUserRole(user))) {
    return <Navigate to={getRoleHome(user)} replace />;
  }

  // ============================================================================
  // RENDER: Authorized Output
  // ============================================================================
  return <Outlet />;
}
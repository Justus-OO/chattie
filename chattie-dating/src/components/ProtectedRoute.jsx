import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

export default function ProtectedRoute() {
  // Grab the authentication status from our global Zustand store
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);

  // If they aren't logged in, send them to the login page immediately
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // If they are logged in, render the child routes (which will be the MainLayout)
  return <Outlet />;
}
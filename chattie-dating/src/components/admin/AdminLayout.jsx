import React from 'react';
import { Outlet } from 'react-router-dom';
import AdminSidebar from './AdminSidebar'; // Adjust path to match your folder structure

export default function AdminLayout() {
  return (
    <div className="flex h-[100dvh] w-full bg-black text-zinc-300 overflow-hidden font-mono">
      {/* Sidebar Stays Fixed on the Left */}
      <AdminSidebar />

      {/* Main Content Area Renders the Active Sub-Route (e.g. AdminDashboard, AdminCreators, etc.) */}
      <main className="flex-1 flex flex-col h-full bg-black overflow-hidden relative">
        <Outlet />
      </main>
    </div>
  );
}
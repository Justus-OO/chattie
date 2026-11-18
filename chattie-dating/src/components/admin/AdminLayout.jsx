import React from 'react';
import { Outlet } from 'react-router-dom';
import AdminSidebar from './AdminSidebar'; // Adjust path to match your folder structure

export default function AdminLayout() {
  return (
    <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-black font-mono text-zinc-300">
      <AdminSidebar />
      <main className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black">
        <Outlet />
      </main>
    </div>
  );
}
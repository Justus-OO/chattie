import React from 'react';
import { Outlet } from 'react-router-dom';
import AdminSidebar from './AdminSidebar'; // Adjust path to match your folder structure

export default function AdminLayout() {
  return (
    <div className="flex h-[100dvh] w-full bg-black text-zinc-300 overflow-hidden font-mono">
      <AdminSidebar />
      <main className="flex-1 flex flex-col h-full bg-black overflow-hidden relative">
        <Outlet />
      </main>
    </div>
  );
}
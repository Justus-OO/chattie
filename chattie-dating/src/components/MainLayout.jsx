import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import Sidebar from './Sidebar';
import { MOCK_ROOMS, MOCK_MATCHES } from '../mocks/dummyData';
import { useI18n } from '../i18n';

export default function MainLayout() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('rooms');
  const [selectedRoom, setSelectedRoom] = useState(MOCK_ROOMS[0]);
  const [selectedProfile, setSelectedProfile] = useState(MOCK_MATCHES[0]);
  
  // Mobile Sidebar State
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();

  // Automatically close the mobile sidebar when the route changes (e.g. clicking a link)
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Prevent background scrolling when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
  }, [isMobileMenuOpen]);

  return (
    <div className="flex flex-col md:flex-row h-dvh w-full bg-black text-zinc-300 font-mono overflow-hidden">
      
      {/* MOBILE HEADER (Visible only on small screens) */}
      <header className="md:hidden flex items-center justify-between p-3 border-b-2 border-zinc-800 bg-zinc-950 shrink-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 border border-black animate-pulse"></div>
          <h1 className="font-bold text-lg text-white uppercase tracking-widest leading-none">
            Chattie
          </h1>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 border-2 border-zinc-800 bg-black text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
          aria-label={t('openMenu')}
        >
          <Menu className="w-5 h-5" />
        </button>
      </header>

      {/* MOBILE BACKDROP OVERLAY */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/90 z-40 md:hidden backdrop-blur-sm cursor-pointer"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* SIDEBAR WRAPPER (Responsive) */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-4/5 max-w-[320px] bg-black transform transition-transform duration-300 ease-out border-r-2 border-zinc-800
        md:relative md:translate-x-0 md:w-80 md:flex md:shrink-0
        ${isMobileMenuOpen ? 'translate-x-0 shadow-[20px_0_50px_rgba(0,0,0,0.8)]' : '-translate-x-full'}
      `}>
        {/* Mobile Close Button (Inside Sidebar) */}
        <button 
          onClick={() => setIsMobileMenuOpen(false)}
          className="md:hidden absolute top-4 right-4 z-50 p-1.5 border-2 border-zinc-800 bg-black text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* The Actual Sidebar Component */}
        <div className="w-full h-full">
          <Sidebar 
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            MOCK_ROOMS={MOCK_ROOMS}
            MOCK_MATCHES={MOCK_MATCHES}
            selectedRoom={selectedRoom}
            setSelectedRoom={setSelectedRoom}
            selectedProfile={selectedProfile}
            setSelectedProfile={setSelectedProfile}
          />
        </div>
      </div>
      
      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col w-full h-full overflow-hidden relative bg-black">
        <Outlet context={{ selectedRoom, selectedProfile }} />
      </main>

    </div>
  );
}
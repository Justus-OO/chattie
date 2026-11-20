import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, X, Sparkles } from 'lucide-react';
import AfterDarkSidebar from './AfterDarkSidebar';
import { useI18n } from '../../i18n';

export default function AfterDarkLayout() {
  const { t } = useI18n();
  // Mobile Sidebar State
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();

  // Automatically close the mobile sidebar when the route changes (e.g. clicking a link)
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  // Prevent background scrolling when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
  }, [isMobileMenuOpen]);

  return (
    <div className="afterdark-shell flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-black font-mono text-zinc-300 md:flex-row">
      
      {/* MOBILE HEADER (Visible only on small screens) */}
      <header className="md:hidden flex items-center justify-between p-3 border-b-2 border-zinc-800 bg-zinc-950 shrink-0 z-20">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-black border-2 border-zinc-600 flex items-center justify-center text-white">
            <Sparkles className="w-4 h-4" />
          </div>
          <h1 className="font-black text-lg text-white uppercase tracking-widest leading-none">
            AFTER DARK
          </h1>
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(true)}
          className="p-2 border-2 border-zinc-800 bg-black text-zinc-300 hover:text-white hover:border-yellow-500 transition-colors"
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
        fixed inset-y-0 left-0 z-50 w-[min(85vw,22rem)] bg-black transform transition-transform duration-300 ease-out border-r-2 border-zinc-800
        md:relative md:translate-x-0 md:w-[clamp(13rem,20vw,18rem)] md:flex md:shrink-0
        ${isMobileMenuOpen ? 'translate-x-0 shadow-[20px_0_50px_rgba(var(--shadow-rgb), 0.8)]' : '-translate-x-full'}
      `}>
        {/* Mobile Close Button (Inside Sidebar) */}
        <button 
          onClick={() => setIsMobileMenuOpen(false)}
          className="md:hidden absolute top-4 right-4 z-50 p-1.5 border-2 border-zinc-800 bg-black text-zinc-400 hover:text-white hover:border-yellow-500 transition-colors"
          aria-label={t('closeMenu')}
        >
          <X className="w-4 h-4" />
        </button>

        {/* The Actual After Dark Sidebar Component */}
        <div className="h-full min-h-0 w-full">
          <AfterDarkSidebar />
        </div>
      </div>
      
      {/* MAIN CONTENT AREA */}
      <main className="relative flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-black">
        <Outlet />
      </main>

    </div>
  );
}
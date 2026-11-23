import React, { useState, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Menu, Sparkles } from 'lucide-react';
import AfterDarkSidebar from './AfterDarkSidebar';
import { useI18n } from '../../i18n';

export default function AfterDarkLayout() {
  const { t } = useI18n();
  // Mobile Sidebar State
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const channelTab = new URLSearchParams(location.search).get('tab');
  const mobilePageTitle = location.pathname === '/afterdark/feed'
    ? t('adFeed')
    : location.pathname === '/afterdark/directory'
      ? t('creators')
      : location.pathname === '/afterdark/chats'
        ? t('adChats')
        : location.pathname === '/afterdark/wallet'
          ? t('adWallet')
          : location.pathname === '/afterdark/settings'
            ? t('adSettingsLink')
            : location.pathname === '/afterdark/cprofile'
              ? t('adCreatorSettings')
              : location.pathname.startsWith('/afterdark/cprofile/')
                ? t('afterDarkUiAvailableCreators')
                : location.pathname === '/afterdark/channel'
                  ? channelTab === 'subscribers'
                    ? t('adCustomers')
                    : channelTab === 'finance'
                      ? t('adEarnings')
                      : t('adMyContent')
                  : '';

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
      <header className="md:hidden grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b-2 border-zinc-800 bg-zinc-950 p-2.5 shrink-0 z-20">
        <Link
          to="/rooms"
          title={t('adExit')}
          aria-label={t('adExit')}
          className="flex min-w-0 items-center gap-2"
        >
          <div className="flex h-7 w-7 items-center justify-center border-2 border-zinc-600 bg-black text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="truncate font-black text-base text-white uppercase tracking-widest leading-none">
            AFTER DARK
          </span>
        </Link>
        <h1 className="max-w-[35vw] truncate text-center text-xs font-bold uppercase tracking-widest text-zinc-300 sm:text-sm">
          {mobilePageTitle}
        </h1>
        <button 
          onClick={() => setIsMobileMenuOpen(true)}
          className="justify-self-end border-2 border-zinc-800 bg-black p-2 text-zinc-300 transition-colors hover:border-yellow-500 hover:text-white"
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
        {/* The Actual After Dark Sidebar Component */}
        <div className="h-full min-h-0 w-full">
          <AfterDarkSidebar onClose={() => setIsMobileMenuOpen(false)} />
        </div>
      </div>
      
      {/* MAIN CONTENT AREA */}
      <main className="relative flex h-full min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-black">
        <Outlet />
      </main>

    </div>
  );
}
import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Flame, Users, Wallet, Settings, Sparkles, MessageCircle,
  Crown, ChevronRight, Image as ImageIcon,
  TrendingUp, ShieldAlert, LogOut, PlusSquare, Loader2
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import OptInGateModal from './OptInGateModal';
import UploadExplicitModal from './UploadExplicitModal';
import { toast } from 'sonner';
import { afterDarkService } from '../../api/afterdark.service';
import { useI18n } from '../../i18n';

export default function AfterDarkSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useI18n();
  const currentUser = useAppStore(state => state.user) || { 
    name: 'Guest User', 
    avatar: '', 
    tier: 'STANDARD',
    isCreator: false,
    walletBalance: 0
  };
  const isCreator = useAppStore(state => state.isCreator) || currentUser.isCreator;
  const walletBalance = useAppStore(state => state.walletBalance);
  const setCreatorStatus = useAppStore(state => state.setCreatorStatus);
  const setAfterDarkCreatorAlias = useAppStore(state => state.setAfterDarkCreatorAlias);
  const creatorApplicationStatus = useAppStore(state => state.afterDarkCreatorApplicationStatus);
  const setCreatorApplicationStatus = useAppStore(state => state.setAfterDarkCreatorApplicationStatus);

  // Local state for modals
  const [showOptIn, setShowOptIn] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [isCheckingCreator, setIsCheckingCreator] = useState(false);
  const creatorMode = isCreator;

  // Navigation structure
  const MAIN_LINKS = [
    { name: t('adFeed'), path: '/afterdark/feed', icon: Flame },
    { name: t('creators'), path: '/afterdark/directory', icon: Users },
    { name: t('adChats'), path: '/afterdark/chats', icon: MessageCircle },
    { name: t('adWallet'), path: '/afterdark/wallet', icon: Wallet },
  ];

  const CREATOR_LINKS = [
    { name: t('adMyContent'), path: '/afterdark/channel', icon: ImageIcon },
    { name: t('adCustomers'), path: '/afterdark/channel?tab=subscribers', icon: Users },
    { name: t('adEarnings'), path: '/afterdark/channel?tab=finance', icon: TrendingUp },
  ];

  const isItemActive = path => {
    const [linkPath, linkSearch = ''] = path.split('?');
    const targetParams = new URLSearchParams(linkSearch);
    const currentParams = new URLSearchParams(location.search);
    const matchesSearch = [...targetParams].every(([key, value]) => currentParams.get(key) === value);
    return location.pathname === linkPath && matchesSearch && (Boolean(linkSearch) || !currentParams.size);
  };

  const handleUploadClick = async () => {
    if (isCheckingCreator) return;
    if (!creatorMode && creatorApplicationStatus !== 'pending') {
      setShowOptIn(true);
      return;
    }

    setIsCheckingCreator(true);
    try {
      const response = await afterDarkService.getMyCreatorApplication();
      const application = response?.application || response;
      const status = String(application?.status || application?.application_status || application?.creator_status || '').toLowerCase();
      if (application?.is_creator || ['approved', 'active'].includes(status)) {
        setCreatorStatus(true);
        setCreatorApplicationStatus('approved');
        setShowUpload(true);
      } else {
        setCreatorStatus(false);
        setCreatorApplicationStatus(status || creatorApplicationStatus || 'pending');
        toast.info('Creator tools and uploads are available after your application is approved.');
      }
    } catch (error) {
      if (creatorApplicationStatus === 'pending') {
        toast.info('Your creator application is pending review. Uploading is unavailable until approval.');
      } else {
        toast.error(error?.response?.data?.error || (error instanceof Error ? error.message : 'Could not verify creator approval.'));
      }
    } finally {
      setIsCheckingCreator(false);
    }
  };

  // Reusable NavItem component preserving original CSS
  const NavItem = ({ item }) => {
    const { path, name, icon: Icon } = item;
    const isActive = isItemActive(path);

    return (
      <NavLink
        to={path}
        className={`flex items-center gap-3 border px-3 py-2 transition-colors text-xs font-bold uppercase
          ${isActive
            ? 'border-white bg-black text-white'
            : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-white hover:border-zinc-600'
          }
        `}
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center border ${isActive ? 'border-white bg-zinc-900' : 'border-zinc-800 bg-black'}`}>
          <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-zinc-500'}`} />
        </span>
        <span className="min-w-0 truncate">{name}</span>
      </NavLink>
    );
  };

  return (
    <aside className="w-full h-full flex flex-col bg-zinc-950 border-r border-zinc-800 font-mono text-zinc-300">
      
      {/* DESKTOP HEADER */}
      <div className="hidden md:flex items-center justify-between p-4 border-b border-zinc-800 bg-black shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-zinc-950 border border-zinc-700 flex items-center justify-center text-white">
            <Flame className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-black text-lg text-white uppercase tracking-widest leading-none">
              AFTER DARK
            </h1>
            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1 mt-1">
              <ShieldAlert className="w-3 h-3" /> {t('adAdultsOnly')}
            </span>
          </div>
        </div>
        <Sparkles className="w-4 h-4 text-zinc-600" aria-hidden="true" />
      </div>

      {/* CREATOR UPLOAD ACTION */}
      {creatorMode && (
        <div className="p-3 border-b border-zinc-800 bg-zinc-950 shrink-0">
          <button 
            onClick={handleUploadClick}
            disabled={isCheckingCreator}
            className="w-full border border-white bg-white py-2.5 text-xs font-black uppercase tracking-wide text-black transition-colors hover:bg-zinc-200 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isCheckingCreator ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusSquare className="w-4 h-4" />}
            {isCheckingCreator ? t('adCheckingApplication') : t('adUploadContent')}
          </button>
        </div>
      )}

      {/* NAVIGATION LINKS */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-1 bg-zinc-950">
        <div className="grid grid-cols-2 gap-1 border-b border-zinc-800 pb-3 mb-3">
          {MAIN_LINKS.map(({ name, path, icon: Icon }) => {
            const isActive = isItemActive(path);
            return (
              <NavLink
                key={path}
                to={path}
                className={`flex min-w-0 flex-col items-center justify-center gap-1 border p-2 text-center transition-colors ${
                  isActive
                    ? 'border-white bg-white text-black'
                    : 'border-zinc-800 bg-black text-zinc-500 hover:border-zinc-600 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="w-full truncate text-[8px] font-black uppercase tracking-wide">{name}</span>
              </NavLink>
            );
          })}
        </div>

        {/* CREATOR STUDIO SECTION */}
        {creatorMode && (
          <>
            <div className="px-1 mt-5 mb-2 border-t border-zinc-800 pt-4">
              <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                {t('adCreatorTools')} <Crown className="w-3 h-3 text-zinc-500" />
              </span>
            </div>
            <div className="space-y-1">
              {CREATOR_LINKS.map(link => <NavItem key={link.path} item={link} />)}
            </div>
          </>
        )}
        
        <div className="px-1 mt-5 mb-2 border-t border-zinc-800 pt-4">
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{t('adAccount')}</span>
        </div>
        
        <NavItem item={{ name: t('adSettingsLink'), path: '/afterdark/settings', icon: Settings }} />

        {!creatorMode && (
          <button
            type="button"
            onClick={handleUploadClick}
            disabled={isCheckingCreator}
            className="flex w-full items-center gap-3 border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-bold uppercase text-zinc-400 transition-colors hover:text-white hover:border-zinc-600"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-zinc-800 bg-black">
              {isCheckingCreator ? <Loader2 className="w-4 h-4 animate-spin text-zinc-500" /> : <PlusSquare className="w-4 h-4 text-zinc-500" />}
            </span>
            <span>
              {isCheckingCreator
                ? t('adCheckingApplication')
                : creatorApplicationStatus === 'pending' ? t('adCheckApplication') : t('adBecomeCreator')}
            </span>
          </button>
        )}
      </div>

      {/* WALLET BALANCE SUMMARY */}
      <div className="p-3 border-t border-zinc-800 bg-black shrink-0">
        <div className="flex items-center justify-between bg-zinc-950 border border-zinc-800 p-2.5">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{t('adBalance')}</span>
            <span className="text-xs font-black text-white">KES {(walletBalance || currentUser.walletBalance || 0).toFixed(2)}</span>
          </div>
          <button onClick={() => navigate('/afterdark/wallet')} aria-label={t('adWallet')} className="w-8 h-8 bg-black border border-zinc-800 flex items-center justify-center hover:border-white hover:text-white transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* USER PROFILE FOOTER */}
      <div className="p-3 border-t border-zinc-800 bg-zinc-950 shrink-0 flex items-center justify-between">
        <button type="button" className="flex min-w-0 items-center gap-3 text-left group" onClick={() => navigate('/afterdark/cprofile')}>
          <div className="relative">
            <img 
              src={currentUser.avatar || 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&q=80'} 
              alt="Profile" 
              className="w-9 h-9 object-cover border border-zinc-700 grayscale group-hover:grayscale-0 transition-all"
            />
            {creatorMode && (
              <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-white border-2 border-black flex items-center justify-center">
                <Crown className="w-2 h-2 text-black" />
              </div>
            )}
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-white truncate max-w-[120px]">
              {currentUser.name}
            </span>
            <span className="text-[9px] uppercase tracking-widest text-zinc-500">
              {creatorMode ? t('adCreator') : t('adMember')}
            </span>
          </div>
        </button>
        
        <button 
          onClick={() => navigate('/rooms')}
          className="p-2 text-zinc-500 hover:text-white border border-transparent hover:border-zinc-700 hover:bg-zinc-900 transition-colors"
          title={t('adExit')}
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* MODALS */}
      <OptInGateModal 
        isOpen={showOptIn} 
        onClose={() => setShowOptIn(false)} 
        onSuccess={({ creatorAlias, ...application }) => {
          setAfterDarkCreatorAlias(creatorAlias);
          const status = String(application.status || application.application_status || '').toLowerCase();
          if (application.is_creator || ['approved', 'active'].includes(status)) {
            setCreatorStatus(true);
            setCreatorApplicationStatus('approved');
            setShowUpload(true);
          } else {
            setCreatorStatus(false);
            setCreatorApplicationStatus(status || 'pending');
            toast.success('Your creator application was submitted. Creator tools will be available after approval.');
          }
          setShowOptIn(false);
        }}
      />

      <UploadExplicitModal
        isOpen={showUpload}
        onClose={() => setShowUpload(false)}
        onSuccess={(post) => navigate('/afterdark/channel', { state: { newPost: post } })}
      />
    </aside>
  );
}
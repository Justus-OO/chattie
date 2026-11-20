import React from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { 
  ShieldCheck, Activity, Users, UserCheck, 
  MessageSquare, Image, DollarSign, Flag, 
  CreditCard, Settings, Lock, Bell, Wallet, Flame, LifeBuoy, ClipboardCheck, FileText, LogOut
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { getUserRole } from '../../utils/roles';
import { useI18n } from '../../i18n';

export default function AdminSidebar() {
  const sessionUser = useAppStore((state) => state.user);
  const logout = useAppStore((state) => state.logout);
  const role = getUserRole(sessionUser);
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <aside 
      className="relative z-50 flex h-full w-[clamp(13rem,23vw,20rem)] shrink-0 flex-col justify-between font-mono text-zinc-300 rounded-none"
      style={{ backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)' }}
    >
      <div className="flex flex-col h-full overflow-hidden">
        
        {/* Branding Header */}
        <div className="p-4 flex items-center justify-between shrink-0" style={{ backgroundColor: 'var(--surface-strong)', borderBottom: '1px solid var(--border)' }}>
          <Link to="/admin/dashboard" className="flex items-center gap-3">
            <div className="p-2" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.12)', border: '1px solid rgba(var(--accent-rgb), 0.3)' }}>
              <ShieldCheck className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h1 className="font-bold text-base leading-none text-white tracking-widest uppercase">
                {t('platformAdmin')}
              </h1>
              <span className="text-[9px] tracking-widest uppercase font-bold text-zinc-500">{role} {t('adminUiWorkspace')}</span>
            </div>
          </Link>

          <Link
            to="/admin/moderation"
            className="relative p-2 transition-colors border"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}
            title={t('moderation')}
            aria-label={t('moderation')}
          >
            <Bell className="w-4 h-4" />
          </Link>
        </div>

        {/* Clean, File-Mapped Navigation Links */}
        <div className="p-4 flex flex-col gap-6 overflow-y-auto custom-scrollbar flex-1" style={{ backgroundColor: 'var(--surface)' }}>
          
          {/* Section 1: Overview */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest px-1 text-zinc-500">{t('overview')}</p>
            <NavLink to="/admin/dashboard" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <Activity className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('dashboard')}</span>
            </NavLink>
          </div>

          {/* Section 2: Operators & Accounts */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest px-1 text-zinc-500">{t('usersStaff')}</p>
            <NavLink to="/admin/creators" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <Users className="w-4 h-4" style={{ color: 'var(--accent-strong)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('creators')}</span>
            </NavLink>
            <NavLink to="/admin/users" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <UserCheck className="w-4 h-4" style={{ color: 'var(--warning)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('users')}</span>
            </NavLink>
          </div>

          {/* Section 3: Content & Rooms */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest px-1 text-zinc-500">{t('contentSpaces')}</p>
            <NavLink to="/admin/chatroom" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <MessageSquare className="w-4 h-4" style={{ color: 'var(--success)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('chatRooms')}</span>
            </NavLink>
            <NavLink to="/admin/media" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <Image className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('mediaVault')}</span>
            </NavLink>
            <NavLink to="/admin/afterdark-posts" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <Flame className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold uppercase tracking-widest">{t('adminUiAfterDarkPosts')}</span>
            </NavLink>
          </div>

          {/* Section 4: Finance & Safety */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest px-1 text-zinc-500">{t('financeTrust')}</p>
            <NavLink to="/admin/finance" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <DollarSign className="w-4 h-4" style={{ color: 'var(--success)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('finance')}</span>
            </NavLink>
            <NavLink to="/admin/payouts" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <CreditCard className="w-4 h-4" style={{ color: 'var(--accent-strong)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('payouts')}</span>
            </NavLink>
            <NavLink to="/admin/creator-payouts" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <Wallet className="w-4 h-4" style={{ color: 'var(--success)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('creatorCryptoPayouts')}</span>
            </NavLink>
            <NavLink to="/admin/moderation" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <Flag className="w-4 h-4" style={{ color: 'var(--warning)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('moderation')}</span>
            </NavLink>
            <NavLink to="/admin/support" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <LifeBuoy className="w-4 h-4" style={{ color: 'var(--warning)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('adminUiSupportInbox')}</span>
            </NavLink>
            <NavLink to="/admin/creator-applications" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <ClipboardCheck className="w-4 h-4" style={{ color: 'var(--warning)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('adminUiCreatorApplications')}</span>
            </NavLink>
            <NavLink to="/admin/reports" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <FileText className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">{t('adminUiReports')}</span>
            </NavLink>
          </div>

        </div>
      </div>

      {/* Admin Profile Footer */}
      <div className="p-3 flex items-center justify-between shrink-0" style={{ backgroundColor: 'var(--surface-strong)', borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center font-black text-[10px] uppercase rounded-none" style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.12)', color: 'var(--text-primary)', border: '1px solid rgba(var(--accent-rgb), 0.3)' }}>
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-white">{sessionUser?.username || sessionUser?.name || t('adminUiSuperAdmin')}</p>
            <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'var(--accent)' }}>{t('overview')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Link to="/admin/settings" className="p-2 transition-colors rounded-none text-zinc-400 hover:text-white" title={t('adminUiAdminSettings')} aria-label={t('adminUiAdminSettings')}>
            <Settings className="w-4 h-4" />
          </Link>
          <button
            type="button"
            onClick={() => { logout(); navigate('/login', { replace: true }); }}
            className="p-2 transition-colors rounded-none text-zinc-400 hover:text-white"
            title={t('adminUiSignOut')}
            aria-label={t('adminUiSignOut')}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { 
  ShieldCheck, Activity, Users, UserCheck, 
  MessageSquare, Image, DollarSign, Flag, 
  CreditCard, Settings, Lock
} from 'lucide-react';

export default function AdminSidebar() {
  return (
    <aside 
      className="w-80 flex flex-col justify-between h-full text-zinc-300 rounded-none z-50 relative shrink-0 font-mono"
      style={{ backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)' }}
    >
      <div className="flex flex-col h-full overflow-hidden">
        
        {/* Branding Header */}
        <div className="p-4 flex items-center justify-between shrink-0" style={{ backgroundColor: 'var(--surface-strong)', borderBottom: '1px solid var(--border)' }}>
          <Link to="/admin/dashboard" className="flex items-center gap-3">
            <div className="p-2" style={{ backgroundColor: 'rgba(210, 79, 116, 0.12)', border: '1px solid rgba(210, 79, 116, 0.3)' }}>
              <ShieldCheck className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h1 className="font-bold text-base leading-none text-white tracking-widest uppercase">
                Platform Admin
              </h1>
              <span className="text-[9px] tracking-widest uppercase font-bold text-zinc-500">Root Management Suite</span>
            </div>
          </Link>
        </div>

        {/* Clean, File-Mapped Navigation Links */}
        <div className="p-4 flex flex-col gap-6 overflow-y-auto custom-scrollbar flex-1" style={{ backgroundColor: 'var(--surface)' }}>
          
          {/* Section 1: Overview */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest px-1 text-zinc-500">Overview</p>
            <NavLink to="/admin/dashboard" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <Activity className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">Dashboard</span>
            </NavLink>
          </div>

          {/* Section 2: Operators & Accounts */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest px-1 text-zinc-500">Users & Staff</p>
            <NavLink to="/admin/creators" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <Users className="w-4 h-4" style={{ color: 'var(--accent-strong)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">Creators</span>
            </NavLink>
            <NavLink to="/admin/users" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <UserCheck className="w-4 h-4" style={{ color: 'var(--warning)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">Users</span>
            </NavLink>
          </div>

          {/* Section 3: Content & Rooms */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest px-1 text-zinc-500">Content & Spaces</p>
            <NavLink to="/admin/chatroom" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <MessageSquare className="w-4 h-4" style={{ color: 'var(--success)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">Chat Rooms</span>
            </NavLink>
            <NavLink to="/admin/media" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <Image className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">Media Vault</span>
            </NavLink>
          </div>

          {/* Section 4: Finance & Safety */}
          <div className="flex flex-col gap-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest px-1 text-zinc-500">Finance & Trust</p>
            <NavLink to="/admin/finance" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <DollarSign className="w-4 h-4" style={{ color: 'var(--success)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">Finance</span>
            </NavLink>
            <NavLink to="/admin/payouts" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <CreditCard className="w-4 h-4" style={{ color: 'var(--accent-strong)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">Payouts</span>
            </NavLink>
            <NavLink to="/admin/moderation" className={({isActive}) => `flex items-center gap-3 p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : 'hover:border-zinc-700'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
              <Flag className="w-4 h-4" style={{ color: 'var(--warning)' }} />
              <span className="text-xs font-bold uppercase tracking-widest">Moderation</span>
            </NavLink>
          </div>

        </div>
      </div>

      {/* Admin Profile Footer */}
      <div className="p-3 flex items-center justify-between shrink-0" style={{ backgroundColor: 'var(--surface-strong)', borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center font-black text-[10px] uppercase rounded-none" style={{ backgroundColor: 'rgba(210, 79, 116, 0.12)', color: 'var(--text-primary)', border: '1px solid rgba(210, 79, 116, 0.3)' }}>
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase text-white">Super Admin</p>
            <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'var(--accent)' }}>System Root</p>
          </div>
        </div>
        <Link to="/admin/settings" className="p-2 transition-colors rounded-none text-zinc-400 hover:text-white">
          <Settings className="w-4 h-4" />
        </Link>
      </div>
    </aside>
  );
}
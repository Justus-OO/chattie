import React, { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { 
  Video, ListOrdered, Wallet, Settings, Power, 
  ShieldCheck, Activity, Users, ChevronDown, ChevronUp, Bell, Loader2 
} from 'lucide-react';
import { toast } from 'sonner';

// Services
import { creatorService } from '../../api/creator.service';
import { useAppStore } from '../../store/useAppStore';
import { getUserRole } from '../../utils/roles';
import { useI18n } from '../../i18n';

export default function ModelSidebar({ activeProfileId: propActiveProfileId, setActiveProfileId: propSetActiveProfileId }) {
  const sessionUser = useAppStore((state) => state.user);
  const role = getUserRole(sessionUser);
  const { t } = useI18n();
  const [isGlobalOnline, setIsGlobalOnline] = useState(true);
  const [showSwitcher, setShowSwitcher] = useState(false);
  
  const [profiles, setProfiles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Local fallback state if parent layout didn't provide state props
  const [localProfileId, setLocalProfileId] = useState('');
  
  const activeProfileId = propActiveProfileId !== undefined ? propActiveProfileId : localProfileId;
  const setActiveProfileId = propSetActiveProfileId || setLocalProfileId;
  
  const location = useLocation();

  // --- FETCH MANAGED PROFILES FROM BACKEND ---
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const data = await creatorService.getAssignedProfiles();
        const profileList = Array.isArray(data) ? data : [];
        setProfiles(profileList);

        // If no active profile is set yet, default to the first one in the database
        if (profileList.length > 0 && !activeProfileId) {
          setActiveProfileId(profileList[0].id);
        }
      } catch (error) {
        console.error("Failed to load managed profiles:", error);
        toast.error(t('error'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfiles();
  }, [activeProfileId, setActiveProfileId]);

  // Derive active profile and network totals safely from state
  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0] || { id: '', name: 'Select Profile', pending: 0, status: 'offline' };
  const totalNetworkPending = profiles.reduce((acc, curr) => acc + (curr.pending || 0), 0);

  // Toggle individual profile status via backend call
  const toggleProfileStatus = async (e, id) => {
    e.stopPropagation(); 
    try {
      const target = profiles.find(p => p.id === id);
      if (!target) return;
      
      const newStatus = target.status === 'online' ? 'offline' : 'online';
      
      await creatorService.updateProfileStatus(id, newStatus);

      setProfiles(prevProfiles => 
        prevProfiles.map(p => 
          p.id === id ? { ...p, status: newStatus } : p
        )
      );
      toast.success(`${target.name} is now ${t(newStatus)}`);
    } catch (error) {
      console.error("Status update error:", error);
      toast.error(t('error'));
    }
  };

  if (isLoading) {
    return (
      <aside className="w-80 flex items-center justify-center h-full shrink-0" style={{ backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)', color: 'var(--text-muted)' }}>
        <Loader2 className="w-6 h-6 animate-spin" />
      </aside>
    );
  }

  return (
    <aside
      className="w-80 flex flex-col justify-between h-full text-zinc-300 relative shrink-0 overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
        borderRight: '1px solid var(--border)',
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.02)'
      }}
    >
      <div className="flex flex-col h-full overflow-hidden">
        <div className="p-4 shrink-0" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <Link to="/model/dashboard" className="flex items-center gap-3 group">
              <div className="p-2 rounded-xl shadow-sm" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', color: '#fff' }}>
                <Video className="w-4 h-4" />
              </div>
              <div>
                <h1 className="font-black text-xl leading-none uppercase tracking-[0.22em]" style={{ color: 'var(--text-primary)' }}>
                  {t('creator')}
                </h1>
                <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>{role} workspace</span>
              </div>
            </Link>

            <div className="flex items-center gap-2">
              <button
                onClick={() => toast.info(`${activeProfile.pending || 0} alerts for ${activeProfile.name}`)}
                className="relative p-2 border transition-colors"
                style={{ background: 'rgba(255,255,255,0.03)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                title={t('viewNotifications')}
              >
                <Bell className="w-4 h-4" />
                {activeProfile.pending > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-3.5 h-4 px-1 flex items-center justify-center text-[8px] font-black rounded-full" style={{ backgroundColor: 'var(--accent)', color: '#fff' }}>
                    {activeProfile.pending > 9 ? '9+' : activeProfile.pending}
                  </span>
                )}
              </button>

              <button
                onClick={() => setIsGlobalOnline(!isGlobalOnline)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] border transition-all"
                style={{
                  background: isGlobalOnline ? 'rgba(42, 156, 107, 0.08)' : 'rgba(210, 79, 116, 0.08)',
                  color: isGlobalOnline ? 'var(--success)' : 'var(--accent)',
                  borderColor: isGlobalOnline ? 'rgba(42, 156, 107, 0.35)' : 'rgba(210, 79, 116, 0.35)'
                }}
              >
                <Power className="w-3 h-3" />
                {isGlobalOnline ? t('online') : t('offline')}
              </button>
            </div>
          </div>
        </div>

        <div className="relative shrink-0" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))', borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => setShowSwitcher(!showSwitcher)}
            className="w-full p-4 flex items-center justify-between text-left transition-colors hover:brightness-105"
            style={{ color: 'var(--text-primary)' }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="relative w-12 h-12 flex items-center justify-center text-[10px] font-black uppercase tracking-[0.18em] rounded-2xl"
                style={{
                  background: 'linear-gradient(135deg, var(--surface-alt), rgba(255,255,255,0.06))',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)'
                }}
              >
                {activeProfile.name ? activeProfile.name.slice(0, 2).toUpperCase() : 'PR'}
                <span className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2`} style={{ backgroundColor: activeProfile.status === 'online' ? 'var(--success)' : 'var(--text-muted)', borderColor: 'var(--surface)' }} />
              </div>

              <div className="min-w-0">
                <p className="text-[9px] uppercase tracking-[0.22em]" style={{ color: 'var(--text-muted)' }}>{t('managingProfile')}</p>
                <p className="mt-1 text-sm font-black uppercase truncate" style={{ color: 'var(--text-primary)' }}>{activeProfile.name}</p>
              </div>
            </div>

            {showSwitcher ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
          </button>

          {showSwitcher && (
            <div className="absolute top-full left-0 right-0 z-50 shadow-2xl max-h-72 overflow-y-auto custom-scrollbar" style={{ background: 'linear-gradient(180deg, var(--surface-strong), var(--surface))', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
              <div className="px-3 py-2.5 flex items-center justify-between" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>{t('selectProfile')}</span>
                <span className="px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.12em]" style={{ background: 'rgba(210,79,116,0.14)', color: 'var(--accent)' }}>{totalNetworkPending} {t('pending')}</span>
              </div>

              {profiles.length === 0 ? (
                <div className="p-4 text-center text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>{t('noProfiles')}</div>
              ) : (
                profiles.map((profile) => {
                  const isSelected = activeProfileId === profile.id;

                  return (
                    <div
                      key={profile.id}
                      className="w-full px-3 py-2.5 border-b last:border-b-0 transition-all"
                      style={{
                        background: isSelected ? 'linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))' : 'transparent',
                        borderColor: 'var(--border)',
                        boxShadow: isSelected ? 'inset 3px 0 0 var(--accent)' : 'none'
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() => {
                            setActiveProfileId(profile.id);
                            setShowSwitcher(false);
                          }}
                          className="flex-1 flex items-center gap-2.5 text-left bg-transparent border-none outline-none cursor-pointer min-w-0"
                        >
                          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: profile.status === 'online' ? 'var(--success)' : 'var(--text-muted)' }} />
                          <span className="text-xs font-black uppercase tracking-[0.12em] truncate" style={{ color: 'var(--text-primary)' }}>{profile.name}</span>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          {profile.pending > 0 && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.12em]" style={{ backgroundColor: 'var(--accent)', color: '#fff' }}>
                              <Bell className="w-2.5 h-2.5" />
                              {profile.pending}
                            </span>
                          )}

                          <button
                            onClick={(e) => toggleProfileStatus(e, profile.id)}
                            className="px-2 py-1 text-[8px] font-black uppercase tracking-[0.18em] transition-colors border"
                            style={{
                              background: profile.status === 'online' ? 'rgba(42,156,107,0.08)' : 'rgba(255,255,255,0.04)',
                              borderColor: 'var(--border)',
                              color: profile.status === 'online' ? 'var(--success)' : 'var(--text-muted)'
                            }}
                          >
                            {profile.status === 'online' ? 'On' : 'Off'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="p-4 flex flex-col gap-2.5 shrink-0" style={{ backgroundColor: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
          <p className="text-[9px] font-black uppercase tracking-[0.22em]" style={{ color: 'var(--text-muted)' }}>{t('menu')}: {activeProfile.name}</p>

          <NavLink
            to="/model/dashboard"
            className={({ isActive }) => `flex items-center justify-between p-3 border transition-all ${isActive ? 'shadow-sm' : ''}`}
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)'
            }}
          >
            <div className="flex items-center gap-3">
              <Activity className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">{t('overview')}</span>
            </div>
          </NavLink>

          <NavLink
            to="/model/queue"
            className={({ isActive }) => `flex items-center justify-between p-3 border transition-all ${isActive ? 'shadow-sm' : ''}`}
            style={{
              background: location.pathname === '/model/queue' ? 'linear-gradient(135deg, rgba(210,79,116,0.14), rgba(255,255,255,0.04))' : 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
              borderColor: location.pathname === '/model/queue' ? 'rgba(210,79,116,0.35)' : 'var(--border)',
              color: 'var(--text-primary)',
              boxShadow: location.pathname === '/model/queue' ? '0 8px 24px rgba(210,79,116,0.12)' : 'inset 0 0 0 1px rgba(255,255,255,0.02)'
            }}
          >
            <div className="flex items-center gap-3">
              <ListOrdered className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">{t('chatRequests')}</span>
            </div>

            {activeProfile.pending > 0 && (
              <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.15em]" style={{ backgroundColor: 'rgba(42,156,107,0.12)', color: 'var(--success)', border: '1px solid rgba(42,156,107,0.3)' }}>
                {activeProfile.pending}
              </span>
            )}
          </NavLink>

          <NavLink
            to="/model/earnings"
            className={({ isActive }) => `flex items-center justify-between p-3 border transition-all ${isActive ? 'shadow-sm' : ''}`}
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)'
            }}
          >
            <div className="flex items-center gap-3">
              <Wallet className="w-4 h-4" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em]">{t('earnings')}</span>
            </div>
          </NavLink>
        </div>

        <div className="flex-1 p-4 overflow-y-auto custom-scrollbar" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))' }}>
            <p className="text-[9px] font-black uppercase tracking-[0.22em] mb-3" style={{ color: 'var(--text-muted)' }}>{t('liveFeed')}</p>
          <div className="space-y-2.5">
            <div className="p-3 text-[9px] uppercase tracking-[0.14em] rounded-xl" style={{ background: 'rgba(42,156,107,0.08)', color: 'var(--text-secondary)', borderLeft: '2px solid var(--success)' }}>
              <span className="font-black" style={{ color: 'var(--success)' }}>[14:02]</span> {activeProfile.name}: system synced
            </div>
            <div className="p-3 text-[9px] uppercase tracking-[0.14em] rounded-xl" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)', borderLeft: '2px solid var(--accent)' }}>
              <span className="font-black" style={{ color: 'var(--accent)' }}>[14:04]</span> network pulse stable
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 flex items-center justify-between shrink-0" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))', borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 flex items-center justify-center rounded-xl border" style={{ background: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <Users className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] truncate" style={{ color: 'var(--text-primary)' }}>
              Manager_Account
              <ShieldCheck className="inline w-3.5 h-3.5 ml-1" style={{ color: 'var(--accent-strong)' }} />
            </p>
            <p className="text-[8px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-muted)' }}>{t('agencyAccess')}</p>
          </div>
        </div>

        <Link to="/model/settings" className="p-2 border rounded-xl transition-colors" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)' }}>
          <Settings className="w-4 h-4" />
        </Link>
      </div>
    </aside>
  );
}
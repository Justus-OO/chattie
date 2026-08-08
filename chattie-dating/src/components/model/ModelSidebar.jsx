import React, { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { 
  Video, ListOrdered, Wallet, Settings, Power, 
  ShieldCheck, Activity, Users, ChevronDown, ChevronUp, Bell, Loader2 
} from 'lucide-react';
import { toast } from 'sonner';

// Services
import { creatorService } from '../../api/creator.service';

export default function ModelSidebar({ activeProfileId: propActiveProfileId, setActiveProfileId: propSetActiveProfileId }) {
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
        toast.error("Failed to load creator profiles");
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
      toast.success(`${target.name} is now ${newStatus.toUpperCase()}`);
    } catch (error) {
      console.error("Status update error:", error);
      toast.error("Failed to update profile status");
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
      className="w-80 flex flex-col justify-between h-full text-zinc-300 rounded-none z-50 relative shrink-0"
      style={{ backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)' }}
    >
      <div className="flex flex-col h-full overflow-hidden">
        
        {/* Branding Header */}
        <div className="p-4 flex items-center justify-between shrink-0" style={{ backgroundColor: 'var(--surface-strong)', borderBottom: '1px solid var(--border)' }}>
          <Link to="/model/dashboard" className="flex items-center gap-3">
            <div className="p-1.5" style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)' }}>
              <Video className="w-5 h-5 text-black" />
            </div>
            <div>
              <h1 className="font-bold text-xl leading-none text-white tracking-widest uppercase">
                Creator
              </h1>
              <span className="text-[10px] tracking-widest text-zinc-500 uppercase">Dashboard</span>
            </div>
          </Link>
          <button 
            onClick={() => setIsGlobalOnline(!isGlobalOnline)}
            className={`px-2 py-1 text-xs flex items-center gap-1 font-bold transition-colors uppercase rounded-none ${
              isGlobalOnline 
                ? '' 
                : ''
            }`}
            style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)', color: isGlobalOnline ? 'var(--success)' : 'var(--accent)' }}
          >
            <Power className="w-3 h-3" /> {isGlobalOnline ? 'ONLINE' : 'OFFLINE'}
          </button>
        </div>

        {/* Profile Switcher */}
        <div className="shrink-0 relative" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <button 
            onClick={() => setShowSwitcher(!showSwitcher)}
            className="w-full p-4 flex items-center justify-between transition-colors border-none outline-none cursor-pointer"
            style={{ color: 'var(--text-primary)' }}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center font-bold text-[10px] uppercase rounded-none" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                {activeProfile.name ? activeProfile.name.substring(0, 2) : 'PR'}
              </div>
              <div className="text-left">
                <p className="text-[9px] uppercase tracking-widest font-bold" style={{ color: 'var(--text-muted)' }}>Managing Profile</p>
                <p className="text-xs font-black uppercase flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                  {activeProfile.name} 
                  {activeProfile.status === 'online' && <span className="w-1.5 h-1.5 ml-1 animate-pulse" style={{ backgroundColor: 'var(--success)' }}></span>}
                </p>
              </div>
            </div>
            {showSwitcher ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> : <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
          </button>

          {/* Dropdown Menu */}
          {showSwitcher && (
            <div className="absolute top-full left-0 w-full shadow-2xl z-50 max-h-64 overflow-y-auto custom-scrollbar" style={{ backgroundColor: 'var(--surface-strong)', borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
              <div className="p-2 flex justify-between items-center" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
                <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Select Profile</span>
                <span className="text-[9px] px-1 font-black" style={{ backgroundColor: 'var(--accent)', color: 'var(--surface-strong)' }}>{totalNetworkPending} PENDING</span>
              </div>
              
              {profiles.length === 0 ? (
                <div className="p-4 text-center text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>No profiles assigned</div>
              ) : (
                profiles.map((profile) => (
                  <div
                    key={profile.id}
                    className={`w-full p-2 flex items-center justify-between transition-colors ${activeProfileId === profile.id ? '' : ''}`}
                    style={{ backgroundColor: activeProfileId === profile.id ? 'var(--surface-alt)' : 'var(--surface-strong)', borderBottom: '1px solid var(--border)', borderLeft: activeProfileId === profile.id ? '4px solid var(--accent)' : '4px solid transparent' }}
                  >
                    <button
                      onClick={() => {
                        setActiveProfileId(profile.id);
                        setShowSwitcher(false);
                      }}
                      className="flex-1 flex items-center gap-2 text-left bg-transparent border-none outline-none cursor-pointer"
                    >
                      <span className="w-2 h-2" style={{ backgroundColor: profile.status === 'online' ? 'var(--success)' : 'var(--text-muted)' }}></span>
                      <span className="text-xs font-bold uppercase" style={{ color: 'var(--text-primary)' }}>{profile.name}</span>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      {profile.pending > 0 && (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-none flex items-center gap-1" style={{ backgroundColor: 'var(--accent)', color: 'var(--surface-strong)', border: '1px solid rgba(210, 79, 116, 0.35)' }}>
                          <Bell className="w-2.5 h-2.5" /> {profile.pending}
                        </span>
                      )}
                      
                      <button
                        onClick={(e) => toggleProfileStatus(e, profile.id)}
                        className="px-2 py-1 text-[8px] font-black uppercase tracking-widest transition-colors w-10 flex justify-center cursor-pointer"
                        style={{ backgroundColor: 'var(--surface-strong)', border: '1px solid var(--border)', color: profile.status === 'online' ? 'var(--success)' : 'var(--text-muted)' }}
                      >
                        {profile.status === 'online' ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Global Navigation Links */}
        <div className="p-4 flex flex-col gap-2 shrink-0" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>Menu: {activeProfile.name}</p>
          
          <NavLink to="/model/dashboard" className={({isActive}) => `flex items-center justify-between p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : ''}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-widest">Overview</span>
            </div>
          </NavLink>

          <NavLink to="/model/queue" className={({isActive}) => `flex items-center justify-between p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : ''}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <div className="flex items-center gap-3">
              <ListOrdered className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-widest">Chat Requests</span>
            </div>
            {activeProfile.pending > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-none" style={{ border: '1px solid var(--border)', color: location.pathname === '/model/queue' ? 'var(--text-primary)' : 'var(--success)', backgroundColor: location.pathname === '/model/queue' ? 'var(--surface-strong)' : 'rgba(42, 156, 107, 0.08)' }}>
                {activeProfile.pending}
              </span>
            )}
          </NavLink>

          <NavLink to="/model/earnings" className={({isActive}) => `flex items-center justify-between p-3 border transition-colors rounded-none ${isActive ? 'bg-white text-black border-white' : ''}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5" />
              <span className="text-xs font-bold uppercase tracking-widest">Earnings</span>
            </div>
          </NavLink>
        </div>

        {/* Live Activity Feed */}
        <div className="flex-1 p-4 overflow-y-auto custom-scrollbar" style={{ backgroundColor: 'var(--surface-strong)' }}>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-muted)' }}>Live Feed</p>
          <div className="space-y-2">
            <div className="p-2 text-[10px] uppercase tracking-wider" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-secondary)', borderLeft: '2px solid var(--success)' }}>
              <span className="font-bold" style={{ color: 'var(--success)' }}>[14:02]</span> {activeProfile.name}: SYSTEM SYNCED
            </div>
          </div>
        </div>
      </div>

      {/* Account Manager Footer */}
      <div className="p-3 flex items-center justify-between shrink-0" style={{ backgroundColor: 'var(--surface-strong)', borderTop: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3 group cursor-pointer">
          <div className="w-8 h-8 flex items-center justify-center font-bold text-[10px] uppercase rounded-none" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
            <Users className="w-4 h-4" />
          </div>
          <div>
            <p className="text-xs font-bold flex items-center gap-1 uppercase" style={{ color: 'var(--text-primary)' }}>
              Manager_Account <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--accent-strong)' }} />
            </p>
            <p className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: 'var(--text-muted)' }}>AGENCY ACCESS</p>
          </div>
        </div>
        <Link to="/model/settings" className="p-2 transition-colors rounded-none" style={{ color: 'var(--text-secondary)' }}>
          <Settings className="w-4 h-4" />
        </Link>
      </div>
    </aside>
  );
}
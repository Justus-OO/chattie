import React, { useState, useEffect } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  Flame, Zap, Users, ShieldCheck, 
  Grid, MessageSquare, Settings, Loader2, Radio, Bell, LifeBuoy
} from 'lucide-react';

// Services
import { ChattieService } from '../api/chattie.service';
import { discoveryService } from '../api/discovery.service';
import { chatService } from '../api/chat.service';
import { useAppStore } from '../store/useAppStore';
import { getUserRole } from '../utils/roles';
import { useI18n } from '../i18n';

export default function Sidebar() {
  const [activeTab, setActiveTab] = useState('rooms');
  const sessionUser = useAppStore((state) => state.user);
  const role = getUserRole(sessionUser);
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  
  // Real State
  const [user, setUser] = useState({ name: '', avatar: '' });
  const [rooms, setRooms] = useState([]);
  const [roomsLoadError, setRoomsLoadError] = useState(false);
  const [matches, setMatches] = useState([]);
  
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [isLoadingList, setIsLoadingList] = useState(true);

  // ============================================================================
  // FETCH USER & SIDEBAR DATA FROM API
  // ============================================================================
  useEffect(() => {
    // 1. Fetch Logged-in User Profile for Footer
    const fetchUserProfile = async () => {
      try {
        const data = await ChattieService.getSettings();
        setUser({
          name: data.name || 'My Account',
          avatar: data.avatar || ''
        });
      } catch (err) {
        console.error('Failed to load user info in sidebar:', err);
      } finally {
        setIsLoadingUser(false);
      }
    };

    // 2. Fetch Live Rooms and Matches safely
    const fetchSidebarLists = async () => {
      setIsLoadingList(true);
      try {
        const [roomsRes, matchesRes] = await Promise.allSettled([
          // apiClient.get('/rooms'),
          chatService.getAllRooms(),
          discoveryService.getMatches()
        ]);

        if (roomsRes.status === 'fulfilled') {
          setRooms(roomsRes.value);
          setRoomsLoadError(false);
        } else {
          setRooms([]);
          setRoomsLoadError(true);
        }

        if (matchesRes.status === 'fulfilled') {
          const matchData = matchesRes.value;
          setMatches(Array.isArray(matchData) ? matchData : []);
        } else {
          setMatches([]);
        }
      } catch (err) {
        console.error('Error fetching sidebar data:', err);
      } finally {
        setIsLoadingList(false);
      }
    };

    fetchUserProfile();
    fetchSidebarLists();

    // ========================================================================
    // 3. BACKGROUND POLLER: Fetch live participant counts every 10 seconds
    // ========================================================================
    const intervalId = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        setRooms(await chatService.getAllRooms());
        setRoomsLoadError(false);
      } catch (error) {
        setRoomsLoadError(true);
        console.warn('Could not refresh sidebar rooms; keeping the last available list.', error);
      }
    }, 60000);

    return () => clearInterval(intervalId); // Cleanup on unmount
  }, []);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('notifications') === 'open') {
      navigate('/notifications', { replace: true });
    }
  }, [location.search, navigate]);

  return (
    <aside 
      className="flex h-full w-full shrink-0 flex-col justify-between text-zinc-300 rounded-none"
      style={{ backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)' }}
    >
      <div className="flex flex-col h-full overflow-hidden">
        
        {/* Branding Header */}
        <div className="p-4 flex items-center justify-between shrink-0" style={{ backgroundColor: 'var(--surface-strong)', borderBottom: '1px solid var(--border)' }}>
          <Link to="/rooms" className="flex items-center gap-3">
            <div className="p-1.5 border-2" style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
              <Flame className="w-5 h-5 text-black" />
            </div>
            <div>
              <h1 className="font-bold text-xl leading-none text-white tracking-widest uppercase">
                Chattie
              </h1>
              <span className="text-[10px] tracking-widest text-zinc-500 uppercase">{role} workspace</span>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/notifications')}
              title={t('viewNotifications')}
              aria-label={t('viewNotifications')}
              className="relative p-2 transition-colors hover:text-white"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5" style={{ backgroundColor: 'var(--accent)' }} aria-hidden="true" />
            </button>
            <Link to="/upgrade" className="px-2 py-1 text-xs flex items-center gap-1 font-bold transition-colors uppercase" style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--warning)', border: '1px solid rgba(var(--warning-rgb), 0.35)' }}>
              <Zap className="w-3 h-3" /> {t('vip')}
            </Link>
          </div>
        </div>

        {/* Global Navigation Links */}
        <div className="p-2 grid grid-cols-5 gap-1 shrink-0" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <NavLink to="/rooms" className={({isActive}) => `flex flex-col items-center gap-1 p-2 border transition-colors ${isActive ? 'bg-white text-black border-white' : 'text-zinc-500 hover:text-zinc-300'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
            <Users className="w-5 h-5" />
            <span className="text-[9px] font-bold uppercase">{t('rooms')}</span>
          </NavLink>
          <NavLink to="/discover" className={({isActive}) => `flex flex-col items-center gap-1 p-2 border transition-colors ${isActive ? 'bg-white text-black border-white' : 'text-zinc-500 hover:text-zinc-300'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
            <Flame className="w-5 h-5" />
            <span className="text-[9px] font-bold uppercase">{t('swipe')}</span>
          </NavLink>
          <NavLink to="/browse" className={({isActive}) => `flex flex-col items-center gap-1 p-2 border transition-colors ${isActive ? 'bg-white text-black border-white' : 'text-zinc-500 hover:text-zinc-300'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
            <Grid className="w-5 h-5" />
            <span className="text-[9px] font-bold uppercase">{t('browse')}</span>
          </NavLink>
          <NavLink to="/messages" className={({isActive}) => `flex flex-col items-center gap-1 p-2 border transition-colors ${isActive ? 'bg-white text-black border-white' : 'text-zinc-500 hover:text-zinc-300'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
            <MessageSquare className="w-5 h-5" />
            <span className="text-[9px] font-bold uppercase">{t('inbox')}</span>
          </NavLink>
          <NavLink to="/support" className={({isActive}) => `flex flex-col items-center gap-1 p-2 border transition-colors ${isActive ? 'bg-white text-black border-white' : 'text-zinc-500 hover:text-zinc-300'}`} style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}>
            <LifeBuoy className="w-5 h-5" />
            <span className="text-[9px] font-bold uppercase">Support</span>
          </NavLink>
        </div>

        {/* Sub-Tabs */}
        <div className="flex shrink-0" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <button 
            onClick={() => setActiveTab('rooms')} 
            className={`flex-1 py-2 text-xs font-bold uppercase transition-colors ${activeTab === 'rooms' ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
            style={{ backgroundColor: activeTab === 'rooms' ? 'var(--surface-alt)' : 'var(--surface)', borderRight: '1px solid var(--border)' }}
          >
            [ {t('liveRooms')} ]
          </button>
          <button 
            onClick={() => setActiveTab('matches')} 
            className={`flex-1 py-2 text-xs font-bold uppercase transition-colors ${activeTab === 'matches' ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
            style={{ backgroundColor: activeTab === 'matches' ? 'var(--surface-alt)' : 'var(--surface)' }}
          >
            [ {t('matches')} ]
          </button>
        </div>

        {/* Dynamic List (Scrollable) */}
        <div className="p-2 space-y-1 overflow-y-auto flex-1 custom-scrollbar" style={{ backgroundColor: 'var(--surface)' }}>
          {isLoadingList ? (
              <div className="p-6 text-center flex flex-col items-center justify-center gap-2" style={{ color: 'var(--text-muted)' }}>
              <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
              <span className="text-xs uppercase">{t('loading')}</span>
            </div>
          ) : activeTab === 'rooms' ? (
            roomsLoadError && rooms.length === 0 ? (
              <button
                type="button"
                onClick={async () => {
                  setIsLoadingList(true);
                  try {
                    setRooms(await chatService.getAllRooms());
                    setRoomsLoadError(false);
                  } catch {
                    setRoomsLoadError(true);
                  } finally {
                    setIsLoadingList(false);
                  }
                }}
                className="p-6 text-center text-xs uppercase border-2 border-dashed w-full"
                style={{ color: 'var(--warning)', borderColor: 'var(--border)' }}
              >
                {t('unableFetchGroups')} · Retry
              </button>
            ) : rooms.length === 0 ? (
              <div className="p-6 text-center text-xs uppercase border-2 border-dashed" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                {t('noActiveRooms')}
              </div>
            ) : (
              rooms.map((room) => {
                // Safely grab the participant count regardless of JSON casing
                const liveCount = room.active_count ?? room.activeCount ?? room.active ?? 0;
                const isPulse = liveCount > 0;

                return (
                  <NavLink 
                    key={room.id} 
                    to={`/rooms/${room.id}`} 
                    className={({isActive}) => `w-full flex items-center justify-between p-2 border transition-colors ${isActive ? 'text-white' : 'text-zinc-400'}`}
                    style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center gap-3">
                      <Radio className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide">{room.name}</p>
                        <p className="text-[10px] flex items-center gap-1.5 mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isPulse ? 'bg-green-500 animate-pulse' : 'bg-zinc-600'}`}></span>
                          {liveCount} {t('online').toUpperCase()}
                        </p>
                      </div>
                    </div>
                  </NavLink>
                );
              })
            )
          ) : (
            matches.length === 0 ? (
              <div className="p-6 text-center text-xs uppercase border-2 border-dashed" style={{ color: 'var(--text-muted)', borderColor: 'var(--border)' }}>
                {t('noMatches')}
              </div>
            ) : (
              matches.map((match) => (
                <button
                  key={match.id}
                  type="button"
                  onClick={() => navigate('/messages', { state: { selectedUserId: match.id, selectedMatchName: match.name || match.display_name } })}
                  className="w-full flex items-center justify-between p-2 border transition-colors text-zinc-400 hover:text-white"
                  style={{ backgroundColor: 'var(--surface-strong)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      {match.avatar || match.avatar_url ? (
                        <img 
                          src={match.avatar || match.avatar_url} 
                          alt={match.name || match.display_name} 
                          className="w-8 h-8 object-cover grayscale border-2 border-zinc-700" 
                        />
                      ) : (
                        <div className="w-8 h-8 flex items-center justify-center text-xs font-bold" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                          {(match.name || match.display_name || 'U').charAt(0).toUpperCase()}
                        </div>
                      )}
                      {match.status === 'online' && (
                        <span className="w-2 h-2 absolute -bottom-1 -right-1" style={{ backgroundColor: 'var(--success)', border: '2px solid var(--surface)' }}></span>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase">{match.name || match.display_name}</p>
                      <p className="text-[10px] uppercase" style={{ color: 'var(--text-muted)' }}>
                        {match.matchPct || match.match_pct || '100'}% {t('match')}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )
          )}
        </div>
      </div>

      {/* User Mini Profile Footer */}
      <div className="p-3 flex items-center justify-between shrink-0" style={{ backgroundColor: 'var(--surface-strong)', borderTop: '1px solid var(--border)' }}>
        <Link to="/profile" className="flex items-center gap-3 group">
          {isLoadingUser ? (
            <div className="w-8 h-8 flex items-center justify-center" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
              <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : user.avatar ? (
            <img 
              src={user.avatar} 
              alt={user.name} 
              className="w-8 h-8 object-cover transition-colors" 
              style={{ border: '1px solid var(--border-strong)' }}
            />
          ) : (
            <div className="w-8 h-8 flex items-center justify-center font-bold text-[10px] uppercase group-hover:bg-zinc-300 transition-colors" style={{ backgroundColor: 'var(--surface-strong)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}>
              {user.name ? user.name.charAt(0).toUpperCase() : 'YOU'}
            </div>
          )}
          <div>
            <p className="max-w-[clamp(5rem,10vw,8rem)] truncate text-xs font-bold uppercase flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
              {user.name || 'My Account'} <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
            </p>
            <p className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: 'var(--success)' }}>Online</p>
          </div>
        </Link>
        <Link to="/settings" className="p-2 transition-colors" style={{ color: 'var(--text-secondary)' }}>
          <Settings className="w-4 h-4" />
        </Link>
      </div>
    </aside>
  );
}
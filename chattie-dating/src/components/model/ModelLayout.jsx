import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import ModelSidebar from './ModelSidebar';
import { creatorService } from '../../api/creator.service';

export default function ModelLayout() {
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState('');
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesLoadError, setProfilesLoadError] = useState('');
  const [isGlobalOnline, setIsGlobalOnline] = useState(false);
  const [modelSettings, setModelSettings] = useState({ is_online: false, ai_drafts_enabled: false });
  const [modelSettingsLoadError, setModelSettingsLoadError] = useState('');

  // Keep the sidebar and settings screens synchronized with backend state.
  useEffect(() => {
    let active = true;
    const loadModelWorkspace = async () => {
      const [profilesResult, settingsResult] = await Promise.allSettled([
        creatorService.getAssignedProfiles(),
        creatorService.getModelSettings(),
      ]);

      if (!active) return;
      if (profilesResult.status === 'fulfilled') {
        const profileList = Array.isArray(profilesResult.value) ? profilesResult.value : [];
        setProfiles(profileList);
        setActiveProfileId((current) => current || profileList[0]?.id || '');
        setProfilesLoadError('');
      } else {
        console.error('Failed to load model profiles:', profilesResult.reason);
        setProfilesLoadError('Could not load assigned profiles. Please refresh and try again.');
      }

      if (settingsResult.status === 'fulfilled') {
        setModelSettings(settingsResult.value);
        setIsGlobalOnline(settingsResult.value.is_online === true);
        setModelSettingsLoadError('');
      } else {
        console.error('Failed to load model settings:', settingsResult.reason);
        setModelSettingsLoadError('Could not load model preferences. Availability and AI settings may be out of date.');
      }
      setProfilesLoading(false);
    };
    void loadModelWorkspace();
    return () => { active = false; };
  }, []);

  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0] || { id: '', name: 'Select Profile', pending: 0, status: 'offline' };

  return (
    <div 
      className="flex h-dvh min-h-0 w-full overflow-hidden bg-black font-mono text-zinc-300 rounded-none"
    >
      {/* Sidebar with synchronized profile state */}
      <ModelSidebar 
        profiles={profiles}
        setProfiles={setProfiles}
        profilesLoading={profilesLoading}
        activeProfileId={activeProfileId} 
        setActiveProfileId={setActiveProfileId} 
        isGlobalOnline={isGlobalOnline}
        setIsGlobalOnline={setIsGlobalOnline}
      />
      
      {/* Main viewport rendering Outlet with shared profile context */}
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-black">
        <Outlet context={{
          activeProfileId,
          activeProfile,
          profiles,
          setProfiles,
          profilesLoading,
          profilesLoadError,
          isGlobalOnline,
          setIsGlobalOnline,
          modelSettings,
          setModelSettings,
          modelSettingsLoadError,
        }} />
      </main>
    </div>
  );
}
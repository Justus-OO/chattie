import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import ModelSidebar from './ModelSidebar';
import { creatorService } from '../../api/creator.service';

export default function ModelLayout() {
  const [profiles, setProfiles] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState('');

  // Fetch profiles at the layout level so sidebar and views share the exact same state
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const data = await creatorService.getAssignedProfiles();
        const profileList = Array.isArray(data) ? data : [];
        setProfiles(profileList);

        if (profileList.length > 0 && !activeProfileId) {
          setActiveProfileId(profileList[0].id);
        }
      } catch (error) {
        console.error("Failed to load profiles in layout:", error);
      }
    };
    fetchProfiles();
  }, []);

  const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0] || { id: '', name: 'Select Profile', pending: 0, status: 'offline' };

  return (
    <div 
      className="flex h-screen w-screen bg-black overflow-hidden font-mono text-zinc-300 rounded-none"
    >
      {/* Sidebar with synchronized profile state */}
      <ModelSidebar 
        profiles={profiles}
        setProfiles={setProfiles}
        activeProfileId={activeProfileId} 
        setActiveProfileId={setActiveProfileId} 
      />
      
      {/* Main viewport rendering Outlet with shared profile context */}
      <main className="flex-1 overflow-hidden relative flex flex-col bg-black">
        <Outlet context={{ activeProfileId, activeProfile }} />
      </main>
    </div>
  );
}
export const MOCK_ROOMS = [
  { id: 1, name: '🔥 Singles Lounge 21+', active: 142, icon: '🔥' },
  { id: 2, name: '⚡ Speed Dating Alley', active: 89, icon: '⚡' },
  { id: 3, name: '🌙 Night Owls & Late Flirts', active: 310, icon: '🌙' },
  { id: 4, name: '☕ Coffee & Deep Chats', active: 45, icon: '☕' },
];

export const MOCK_MATCHES = [
  { id: 101, name: 'Elena', age: 24, location: '3 miles away', matchPct: '98%', status: 'online', avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=250' },
  { id: 102, name: 'Marcus', age: 27, location: '1 mile away', matchPct: '92%', status: 'offline', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=250' },
  { id: 103, name: 'Sophia', age: 23, location: '5 miles away', matchPct: '89%', status: 'online', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=250' },
];

export const MOCK_MESSAGES = [
  { id: 1, sender: 'Elena', text: 'Hey there! Loved your bio about midnight drives 🚗✨', time: '10:42 PM', isMe: false, badge: 'PRO' },
  { id: 2, sender: 'You', text: 'Haha thanks! Always down for late-night city views. What about you?', time: '10:44 PM', isMe: true },
  { id: 3, sender: 'Elena', text: 'Definitely a night owl! Are you coming to the Singles Lounge room tonight?', time: '10:45 PM', isMe: false, badge: 'PRO' },
];

const EXTENDED_ROOMS = [
  { id: '1', name: 'Late Night Chill', icon: '🌙', active: 142, category: 'Chill', tags: ['music', 'vibes', 'chat'], isPrivate: false, desc: 'A laid back room for night owls. Grab a drink and vibe.' },
  { id: '2', name: 'Spring Boot Builders', icon: '🍃', active: 89, category: 'Tech & Code', tags: ['java', 'backend', 'api'], isPrivate: false, desc: 'Discussing architecture, REST APIs, and database configs.' },
  { id: '3', name: 'Local Singles (NYC)', icon: '🍎', active: 315, category: 'Dating', tags: ['nyc', 'meetup', 'dating'], isPrivate: false, desc: 'Find people in the five boroughs looking to connect.' },
  { id: '4', name: 'React Native Devs', icon: '⚛️', active: 64, category: 'Tech & Code', tags: ['frontend', 'mobile', 'ui'], isPrivate: false, desc: 'Building hybrid apps and sharing component strategies.' },
  { id: '5', name: 'Elden Ring Co-op', icon: '⚔️', active: 210, category: 'Gaming', tags: ['pc', 'ps5', 'coop'], isPrivate: false, desc: 'Need help with a boss? Drop your summon sign here.' },
  { id: '6', name: 'Coffee Addicts', icon: '☕', active: 45, category: 'Chill', tags: ['espresso', 'morning', 'chat'], isPrivate: false, desc: 'Discussing the best roasts and brewing methods.' },
  { id: '7', name: 'VIP Lounge', icon: '💎', active: 12, category: 'Exclusive', tags: ['vip', 'premium'], isPrivate: true, desc: 'Exclusive access for premium members only.' },
  { id: '8', name: 'Indie Rock Fans', icon: '🎸', active: 78, category: 'Music', tags: ['indie', 'vinyl', 'concerts'], isPrivate: false, desc: 'Sharing Spotify playlists and local gig recommendations.' },
];
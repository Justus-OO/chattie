import { http, HttpResponse, delay } from 'msw';
import { MOCK_ROOMS, MOCK_MATCHES, MOCK_MESSAGES } from './dummyData';

export const handlers = [
  // ==========================================================================
  // AUTHENTICATION & ONBOARDING ENDPOINTS
  // ==========================================================================
  
  // POST /api/auth/login
  http.post('/api/auth/login', async ({ request }) => {
    await delay(800); // Simulate network latency
    const body = await request.json().catch(() => ({}));
    const { email, password } = body;
    
    if (email && password) {
      return HttpResponse.json({
        user: { 
          id: 'usr_999', 
          username: 'Alex Pro', 
          email: email,
          role: 'client',
          avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=400&q=80'
        },
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake_jwt_token_chattie_gold'
      });
    }
    return new HttpResponse(JSON.stringify({ error: 'Invalid credentials' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }),

  // POST /api/auth/register
  http.post('/api/auth/register', async ({ request }) => {
    await delay(1000);
    const body = await request.json().catch(() => ({}));
    
    return HttpResponse.json({
      success: true,
      message: 'User registered successfully. Proceed to onboarding.',
      tempToken: 'temp_reg_token_xyz'
    }, { status: 201 });
  }),

  // POST /api/users/onboarding (Multipart Form Data)
  http.post('/api/users/onboarding', async ({ request }) => {
    await delay(1500);
    // In a real browser worker, formData can be inspected or parsed if needed
    return HttpResponse.json({
      success: true,
      message: 'Onboarding profile saved successfully.'
    });
  }),

  // ==========================================================================
  // ROOMS & DIRECTORY ENDPOINTS
  // ==========================================================================

  // GET /api/rooms
  http.get('/api/rooms', async () => {
    await delay(400);
    return HttpResponse.json(EXTENDED_ROOMS);
  }),

  // GET /api/rooms/:roomId/messages
  http.get('/api/rooms/:roomId/messages', async ({ params }) => {
    await delay(300);
    const { roomId } = params;
    // Return mock messages scoped or defaulted
    return HttpResponse.json(MOCK_MESSAGES);
  }),

  // ==========================================================================
  // MATCHING & DISCOVERY ENDPOINTS
  // ==========================================================================

  // GET /api/matches
  http.get('/api/matches', async () => {
    await delay(500);
    return HttpResponse.json(MOCK_MATCHES);
  }),

  // POST /api/matches/:id/like
  http.post('/api/matches/:id/like', async ({ params }) => {
    await delay(400);
    const { id } = params;
    
    // Simulate a 50% chance of an instant mutual match for testing UX
    const isMatch = Math.random() > 0.5;

    return HttpResponse.json({
      success: true,
      isMutualMatch: isMatch,
      matchedUser: isMatch ? MOCK_MATCHES.find(m => m.id === id) || MOCK_MATCHES[0] : null
    });
  }),

  // ==========================================================================
  // USER PROFILE & SETTINGS ENDPOINTS
  // ==========================================================================

  // PUT /api/users/profile
  http.put('/api/users/profile', async () => {
    await delay(800);
    return HttpResponse.json({
      success: true,
      message: 'Profile updated successfully.'
    });
  }),

  // PUT /api/users/settings
  http.put('/api/users/settings', async ({ request }) => {
    await delay(400);
    const settings = await request.json().catch(() => ({}));
    return HttpResponse.json({
      success: true,
      settings
    });
  })
];
import React, { useState } from 'react';
import { Flame, Lock, Mail, Loader2, Eye, EyeOff, Code, Globe } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom'; 
import { useAppStore } from '../../store/useAppStore';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';

// Import our authenticated API client
import { authService } from '../../api/auth.service';

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================
const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function Login() {
  const navigate = useNavigate();
  
  // Zustand store action
  const login = useAppStore((state) => state.login);
  
  // --- STATE ---
  const [isLoading, setIsLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(null); // 'google' | 'apple' | null
  const [showPassword, setShowPassword] = useState(false);

  // --- FORM HOOK ---
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(loginSchema),
  });

  // --- HANDLERS ---
  const onSubmit = async (data) => {
    setIsLoading(true);
    
    try {
      // 1. Call Go Backend to Login
      const loginData = await authService.login(data.email, data.password);
      
      // 2. Save session into Zustand (which your Axios interceptor uses)
      login(loginData.user, loginData.token);
      
      // 3. Optional: Sync with localStorage if you use it as a backup
      if (authService.saveToken) {
        authService.saveToken(loginData.token);
      }
      
      toast.success('WELCOME BACK!');
      
      // 4. Traffic Control: Route based on database status
      if (loginData.user.status === 'onboarding') {
        navigate('/onboarding');
      } else {
        navigate('/discover');
      }
      
    } catch (error) {
      toast.error(error.message?.toUpperCase() || 'INVALID EMAIL OR PASSWORD.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = (provider) => {
    setSocialLoading(provider);
    // Simulate OAuth redirect delay
    setTimeout(() => {
      setSocialLoading(null);
      toast.error(`${provider.toUpperCase()} AUTH IS NOT CONFIGURED YET.`);
    }, 1200);
  };

  // ============================================================================
  // RENDER (UI remains completely unchanged)
  // ============================================================================
  return (
    <div className="min-h-dvh flex bg-black font-mono text-zinc-300 overflow-hidden rounded-none">
      
      {/* =====================================================================
          LEFT PANE: HERO IMAGE (Desktop Only)
          ===================================================================== */}
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center overflow-hidden bg-black border-r-2 border-zinc-800">
        {/* Background Image */}
        <img 
          src="https://images.unsplash.com/photo-1555529771-835f59bfc50c?auto=format&fit=crop&w=1200&q=80" 
          alt="Nightlife Vibe" 
          className="absolute inset-0 w-full h-full object-cover grayscale opacity-30"
        />
        
        {/* Overlay */}
        <div className="absolute inset-0 bg-black/40" />

        {/* Hero Content */}
        <div className="relative z-10 p-12 max-w-lg text-left mt-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border-2 border-white text-white text-[10px] font-bold uppercase tracking-widest mb-8 bg-black">
            <Flame className="w-4 h-4" /> Chattie Premium
          </div>
          <h1 className="text-4xl xl:text-5xl font-black text-white mb-6 uppercase tracking-widest leading-tight">
            Stop Swiping. <br />
            Start Connecting.
          </h1>
          <p className="text-xs text-zinc-400 uppercase tracking-widest leading-relaxed font-bold">
            Join the most exclusive chatting platform. Real-time conversations, secure direct messages, and high-fidelity matchmaking.
          </p>
        </div>
      </div>

      {/* =====================================================================
          RIGHT PANE: LOGIN FORM
          ===================================================================== */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center px-6 sm:px-12 md:px-20 lg:px-24 relative z-10 bg-black">
        
        <div className="w-full max-w-md mx-auto relative z-20">
          
          {/* Header */}
          <div className="flex flex-col items-start mb-10">
            <div className="w-12 h-12 bg-black border-2 border-white flex items-center justify-center mb-6 lg:hidden">
              <Flame className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-2 uppercase tracking-widest">Welcome Back</h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Enter your details to access your account.</p>
          </div>

          {/* Social Logins */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <button 
              type="button"
              onClick={() => handleSocialLogin('Google')}
              disabled={isLoading || socialLoading !== null}
              className="py-3 px-4 bg-black border-2 border-zinc-800 hover:border-zinc-500 hover:bg-zinc-950 text-zinc-300 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {socialLoading === 'Google' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
              Google
            </button>
            <button 
              type="button"
              onClick={() => handleSocialLogin('Apple')}
              disabled={isLoading || socialLoading !== null}
              className="py-3 px-4 bg-black border-2 border-zinc-800 hover:border-zinc-500 hover:bg-zinc-950 text-zinc-300 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {socialLoading === 'Apple' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Code className="w-4 h-4" />}
              Apple
            </button>
          </div>

          <div className="relative flex items-center py-4 mb-4">
            <div className="grow border-t-2 border-zinc-800"></div>
            <span className="shrink-0 px-4 text-[10px] text-zinc-600 font-bold uppercase tracking-widest bg-black">Or continue with email</span>
            <div className="grow border-t-2 border-zinc-800"></div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            
            {/* Email Field */}
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">Email Address</label>
              <div className="relative">
                <Mail className={`w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${errors.email ? 'text-red-500' : 'text-zinc-600'}`} />
                <input 
                  {...register('email')}
                  type="email" 
                  placeholder="NAME@EXAMPLE.COM"
                  disabled={isLoading}
                  className={`
                    w-full bg-black border-2 rounded-none pl-11 pr-4 py-3 text-[10px] font-bold text-white uppercase tracking-widest placeholder:text-zinc-700 transition-colors outline-none
                    ${errors.email 
                      ? 'border-red-500 focus:border-red-400' 
                      : 'border-zinc-800 focus:border-white'
                    } 
                    disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                />
              </div>
              {errors.email && (
                <p className="text-[9px] text-red-500 mt-2 font-bold uppercase tracking-widest flex items-center gap-1.5">
                  <span className="w-1 h-1 bg-red-500 border border-black" /> {errors.email.message}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">Password</label>
              <div className="relative">
                <Lock className={`w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${errors.password ? 'text-red-500' : 'text-zinc-600'}`} />
                <input 
                  {...register('password')}
                  type={showPassword ? "text" : "password"} 
                  placeholder="••••••••"
                  disabled={isLoading}
                  className={`
                    w-full bg-black border-2 rounded-none pl-11 pr-12 py-3 text-[10px] font-bold text-white uppercase tracking-widest placeholder:text-zinc-700 transition-colors outline-none
                    ${errors.password 
                      ? 'border-red-500 focus:border-red-400' 
                      : 'border-zinc-800 focus:border-white'
                    } 
                    disabled:opacity-50 disabled:cursor-not-allowed
                  `}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-white transition-colors disabled:opacity-50"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-[9px] text-red-500 mt-2 font-bold uppercase tracking-widest flex items-center gap-1.5">
                  <span className="w-1 h-1 bg-red-500 border border-black" /> {errors.password.message}
                </p>
              )}
            </div>

            {/* Options Row */}
            <div className="flex items-center justify-between py-2">
              <label className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest cursor-pointer hover:text-white transition-colors">
                <input 
                  type="checkbox" 
                  className="w-3.5 h-3.5 accent-zinc-500 rounded-none bg-black border-2 border-zinc-800 cursor-pointer disabled:opacity-50" 
                  disabled={isLoading} 
                /> 
                Remember Me
              </label>
              <Link to="/forgot-password" className="text-[10px] font-bold text-white uppercase tracking-widest hover:text-zinc-400 transition-colors border-b border-transparent hover:border-zinc-400 pb-0.5">
                Forgot Password?
              </Link>
            </div>

            {/* Submit Button */}
            <button 
              type="submit" 
              disabled={isLoading || socialLoading !== null}
              className="w-full py-4 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 disabled:opacity-50 disabled:bg-zinc-800 disabled:border-zinc-800 disabled:text-zinc-500 flex items-center justify-center gap-2 transition-colors mt-6"
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Authenticating...</>
              ) : (
                <><Flame className="w-4 h-4" /> Log In</>
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-8 text-center text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
            Don't have an account?{' '}
            <Link to="/register" className="text-white hover:text-zinc-300 transition-colors border-b-2 border-white pb-0.5 ml-1">
              Create Account
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
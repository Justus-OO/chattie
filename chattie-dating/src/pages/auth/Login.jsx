import React, { useState } from 'react';
import { Flame, Lock, Mail, Loader2, Eye, EyeOff, Globe } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom'; 
import { useAppStore } from '../../store/useAppStore';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';

// Social Login Imports
import { useGoogleLogin } from '@react-oauth/google';
// import AppleSignin from 'react-apple-signin-auth'; // PAUSED FOR NOW

// Import our authenticated API client
import { authService } from '../../api/auth.service';
import { apiClient } from '../../api/client';
import { getRoleHome } from '../../utils/roles';
import { useI18n } from '../../i18n';

const createLoginSchema = (t) => z.object({
  email: z.string().min(1, t('emailRequired')).email(t('invalidEmail')),
  password: z.string().min(8, t('passwordLength')),
});

export default function Login() {
  const navigate = useNavigate();
  const login = useAppStore((state) => state.login);
  const { t } = useI18n();
  
  const [isLoading, setIsLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(null); 
  const [showPassword, setShowPassword] = useState(false);
  const [twoFactorChallenge, setTwoFactorChallenge] = useState(null);
  const [verificationCode, setVerificationCode] = useState('');

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(createLoginSchema(t)),
  });

  const processAuthSuccess = (response) => {
    const user = response.user || response.data?.user;
    let token = response.token || response.data?.token || '';

    if (!token || typeof token !== 'string') {
        throw new Error("CRITICAL: Invalid token format received from server.");
    }

    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    
    login(user, cleanToken);
    apiClient.defaults.headers.Authorization = `Bearer ${cleanToken}`;
    
    if (authService.saveToken) {
      authService.saveToken(cleanToken);
    }
    
    toast.success(t('loginSuccess'));
    
    if (user?.status === 'onboarding') {
      navigate('/onboarding');
    } else {
      navigate(getRoleHome(user));
    }
  };

  const handleAuthResponse = (response) => {
    if (response.requires_two_factor) {
      setTwoFactorChallenge(response);
      setVerificationCode('');
      setSocialLoading(null);
      toast.info(response.message || 'Enter your security code to continue.');
      return true;
    }
    return false;
  };

  const onSubmit = async (data) => {
    setIsLoading(true);
    try {
      const response = await authService.login(data.email, data.password);
      if (!handleAuthResponse(response)) processAuthSuccess(response);
    } catch (error) {
      toast.error(error.message || t('invalidCredentials'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyTwoFactor = async (event) => {
    event.preventDefault();
    if (!twoFactorChallenge) return;
    setIsLoading(true);
    try {
      const response = await authService.verifyLoginCode(twoFactorChallenge.challenge_id, verificationCode);
      processAuthSuccess(response);
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || 'Verification failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setSocialLoading('Google');
      try {
        const response = await authService.googleLogin(tokenResponse.access_token);
        if (!handleAuthResponse(response)) processAuthSuccess(response);
      } catch (error) {
        toast.error(error.message || t('googleLoginFailed'));
        setSocialLoading(null);
      }
    },
    onError: () => toast.error(t('googleLoginCancelled')),
  });

  return (
    <div className="min-h-dvh flex bg-black font-mono text-zinc-300 overflow-x-hidden rounded-none">
      
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center overflow-hidden bg-black border-r-2 border-zinc-800">
        <img 
          src="https://images.unsplash.com/photo-1555529771-835f59bfc50c?auto=format&fit=crop&w=1200&q=80" 
          alt={t('nightlifeVibe')}
          className="absolute inset-0 w-full h-full object-cover grayscale opacity-30"
        />
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative z-10 p-12 max-w-lg text-left mt-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border-2 border-white text-white text-[10px] font-bold uppercase tracking-widest mb-8 bg-black">
            <Flame className="w-4 h-4" /> Chattie Premium
          </div>
          <h1 className="text-4xl xl:text-5xl font-black text-white mb-6 uppercase tracking-widest leading-tight">
            {t('stopSwiping')}<br />
            {t('startConnecting')}
          </h1>
          <p className="text-xs text-zinc-400 uppercase tracking-widest leading-relaxed font-bold">
            {t('loginHeroCopy')}
          </p>
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex flex-col justify-center px-6 sm:px-12 md:px-20 lg:px-24 relative z-10 bg-black">
        <div className="w-full max-w-md mx-auto relative z-20">
          
          <div className="flex flex-col items-start mb-10">
            <div className="w-12 h-12 bg-black border-2 border-white flex items-center justify-center mb-6 lg:hidden">
              <Flame className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-2 uppercase tracking-widest">{t('loginHeading')}</h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('loginIntro')}</p>
          </div>

          {!twoFactorChallenge && <div className="flex flex-col gap-4 mb-8">
            {/* GOOGLE BUTTON (Now takes full width) */}
            <button 
              type="button"
              onClick={() => handleGoogleLogin()}
              disabled={isLoading || socialLoading !== null}
              className="w-full py-3 px-4 bg-black border-2 border-zinc-800 hover:border-zinc-500 hover:bg-zinc-950 text-zinc-300 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {socialLoading === 'Google' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
              {t('loginWithGoogle')}
            </button>

            {/* APPLE BUTTON - PAUSED FOR NOW */}
            {/* 
            <AppleSignin
              authOptions={{
                clientId: import.meta.env.VITE_APPLE_CLIENT_ID,
                scope: 'email name',
                redirectURI: 'https://yourwebsite.com', 
                state: 'state',
                nonce: 'nonce',
                usePopup: true 
              }}
              onSuccess={async (response) => { ... }}
              onError={(error) => toast.error('Apple login cancelled')}
              render={(props) => (
                <button 
                  type="button"
                  onClick={props.onClick}
                  disabled={isLoading || socialLoading !== null}
                  className="w-full py-3 px-4 bg-black border-2 border-zinc-800 hover:border-zinc-500 hover:bg-zinc-950 text-zinc-300 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {socialLoading === 'Apple' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Code className="w-4 h-4" />}
                  Apple
                </button>
              )}
            /> 
            */}
          </div>}

          {!twoFactorChallenge && <div className="relative flex items-center py-4 mb-4">
            <div className="grow border-t-2 border-zinc-800"></div>
            <span className="shrink-0 px-4 text-[10px] text-zinc-600 font-bold uppercase tracking-widest bg-black">{t('continueWithEmail')}</span>
            <div className="grow border-t-2 border-zinc-800"></div>
          </div>}

          {twoFactorChallenge ? (
            <form onSubmit={handleVerifyTwoFactor} className="space-y-5">
              <div className="border-2 border-zinc-800 bg-zinc-950 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white">Security code required</p>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Sent by {twoFactorChallenge.channel}{twoFactorChallenge.destination ? ` to ${twoFactorChallenge.destination}` : ''}.
                </p>
              </div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Verification code
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value)}
                  disabled={isLoading}
                  className="mt-2 w-full border-2 border-zinc-800 bg-black px-4 py-3 text-sm font-bold tracking-[0.4em] text-white outline-none focus:border-white"
                  required
                />
              </label>
              <button type="submit" disabled={isLoading || verificationCode.length < 6} className="w-full py-4 border-2 border-white bg-white text-[10px] font-bold uppercase tracking-widest text-black disabled:opacity-50">
                {isLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Verify and sign in'}
              </button>
              <button type="button" onClick={() => { setTwoFactorChallenge(null); setVerificationCode(''); }} className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white">
                Return to login
              </button>
            </form>
          ) : <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('emailAddressLabel')}</label>
              <div className="relative">
                <Mail className={`w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${errors.email ? 'text-red-500' : 'text-zinc-600'}`} />
                <input 
                  {...register('email')}
                  type="email" 
                  placeholder="NAME@EXAMPLE.COM"
                  disabled={isLoading}
                  className={`
                    w-full bg-black border-2 rounded-none pl-11 pr-4 py-3 text-[10px] font-bold text-white uppercase tracking-widest placeholder:text-zinc-700 transition-colors outline-none
                    ${errors.email ? 'border-red-500 focus:border-red-400' : 'border-zinc-800 focus:border-white'} 
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

            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('passwordLabel')}</label>
              <div className="relative">
                <Lock className={`w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${errors.password ? 'text-red-500' : 'text-zinc-600'}`} />
                <input 
                  {...register('password')}
                  type={showPassword ? "text" : "password"} 
                  placeholder="••••••••"
                  disabled={isLoading}
                  className={`
                    w-full bg-black border-2 rounded-none pl-11 pr-12 py-3 text-[10px] font-bold text-white uppercase tracking-widest placeholder:text-zinc-700 transition-colors outline-none
                    ${errors.password ? 'border-red-500 focus:border-red-400' : 'border-zinc-800 focus:border-white'} 
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

            <div className="flex items-center justify-between py-2">
              <label className="flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest cursor-pointer hover:text-white transition-colors">
                <input 
                  type="checkbox" 
                  className="w-3.5 h-3.5 accent-zinc-500 rounded-none bg-black border-2 border-zinc-800 cursor-pointer disabled:opacity-50" 
                  disabled={isLoading} 
                /> 
                {t('rememberMe')}
              </label>
              <Link to="/forgot-password" className="text-[10px] font-bold text-white uppercase tracking-widest hover:text-zinc-400 transition-colors border-b border-transparent hover:border-zinc-400 pb-0.5">
                {t('forgotPassword')}
              </Link>
            </div>

            <button 
              type="submit" 
              disabled={isLoading || socialLoading !== null}
              className="w-full py-4 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 disabled:opacity-50 disabled:bg-zinc-800 disabled:border-zinc-800 disabled:text-zinc-500 flex items-center justify-center gap-2 transition-colors mt-6"
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> {t('authenticating')}</>
              ) : (
                <><Flame className="w-4 h-4" /> {t('logIn')}</>
              )}
            </button>
          </form>}

          <div className="mt-8 text-center text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
            {t('noAccount')}{' '}
            <Link to="/register" className="text-white hover:text-zinc-300 transition-colors border-b-2 border-white pb-0.5 ml-1">
              {t('createAccountLink')}
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
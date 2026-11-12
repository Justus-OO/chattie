import React, { useState, useEffect } from 'react';
import { Flame, Lock, Mail, User, Loader2, Eye, EyeOff, Code, Globe, ShieldCheck } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';

// Social Login Imports
import { useGoogleLogin } from '@react-oauth/google';
import AppleSignin from 'react-apple-signin-auth';

// API Services
import { authService } from '../../api/auth.service'; 
import { apiClient } from '../../api/client';
import { useI18n } from '../../i18n';

// ============================================================================
// FORTIFIED VALIDATION SCHEMA
// ============================================================================
const createRegisterSchema = (t) => z.object({
  username: z.string().min(3, t('username')).max(20, t('username')).regex(/^[a-zA-Z0-9_]+$/, t('username')),
  email: z.string().min(1, t('emailRequired')).email(t('invalidEmail')),
  password: z.string().min(8, t('passwordLength')),
  confirmPassword: z.string().min(1, t('confirmPassword')),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: t('acceptTerms') }) })
}).refine((data) => data.password === data.confirmPassword, { message: t('passwordsMismatch'), path: ['confirmPassword'] });

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function Register() {
  const navigate = useNavigate();
  const login = useAppStore((state) => state.login);
  const { t } = useI18n();
  
  // --- STATE ---
  const [isLoading, setIsLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordScore, setPasswordScore] = useState(0);

  // --- FORM HOOK ---
  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    resolver: zodResolver(createRegisterSchema(t)),
    defaultValues: { acceptTerms: false }
  });

  const watchPassword = watch("password", "");

  // --- PASSWORD STRENGTH LOGIC ---
  useEffect(() => {
    let score = 0;
    if (!watchPassword) {
      setPasswordScore(0);
      return;
    }
    if (watchPassword.length >= 8) score += 1;
    if (/[A-Z]/.test(watchPassword)) score += 1;
    if (/[0-9]/.test(watchPassword)) score += 1;
    if (/[^A-Za-z0-9]/.test(watchPassword)) score += 1;
    setPasswordScore(score);
  }, [watchPassword]);

  // ============================================================================
  // SHARED SESSION HANDLER
  // ============================================================================
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
    
    toast.success(t('accountCreated'));
    navigate('/onboarding');
  };

  // ============================================================================
  // AUTHENTICATION METHODS
  // ============================================================================
  
  // 1. Email/Password Registration
  const onSubmit = async (data) => {
    setIsLoading(true);
    try {
      await authService.register(data.username, data.email, data.password);
      // Auto-login to fetch JWT token after successful registration
      const response = await authService.login(data.email, data.password);
      processAuthSuccess(response);
    } catch (error) {
      toast.error(error.message || t('createAccountFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Google OAuth
  const handleGoogleRegister = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setSocialLoading('Google');
      try {
        const response = await authService.googleLogin(tokenResponse.access_token);
        processAuthSuccess(response);
      } catch (error) {
        toast.error(error.message || t('googleRegistrationFailed'));
        setSocialLoading(null);
      }
    },
    onError: () => toast.error(t('googleRegistrationCancelled')),
  });

  // Brutalist password strength bar colors
  const getScoreColor = (index) => {
    if (passwordScore <= index) return 'bg-zinc-800';
    if (passwordScore === 1) return 'bg-red-500';
    if (passwordScore === 2) return 'bg-yellow-500';
    if (passwordScore === 3) return 'bg-green-500';
    return 'bg-white';
  };

  // ============================================================================
  // RENDER 
  // ============================================================================
  return (
    <div className="min-h-[100dvh] flex bg-black font-mono text-zinc-300 overflow-hidden rounded-none">
      
      {/* LEFT PANE */}
      <div className="hidden lg:flex lg:w-1/2 relative items-center justify-center overflow-hidden bg-black border-r-2 border-zinc-800">
        <img 
          src="https://images.unsplash.com/photo-1573152143286-0c422b4d2175?auto=format&fit=crop&w=1200&q=80" 
          alt={t('connectionVibe')}
          className="absolute inset-0 w-full h-full object-cover grayscale opacity-30"
        />
        
        <div className="absolute inset-0 bg-black/40" />
        
        <div className="relative z-10 p-12 max-w-lg text-left mt-20">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border-2 border-white text-white text-[10px] font-bold uppercase tracking-widest mb-8 bg-black">
            <ShieldCheck className="w-4 h-4" /> {t('securePrivate')}
          </div>
          <h1 className="text-4xl xl:text-5xl font-black text-white mb-6 uppercase tracking-widest leading-tight">
            {t('joinUltimate')}<br />
            {t('chatPlatform')}
          </h1>
          <ul className="space-y-4 text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-relaxed">
            <li className="flex items-center gap-3">
              <span className="w-2 h-2 bg-white"></span> {t('instantMessaging')}
            </li>
            <li className="flex items-center gap-3">
              <span className="w-2 h-2 bg-white"></span> {t('secureRooms')}
            </li>
            <li className="flex items-center gap-3">
              <span className="w-2 h-2 bg-white"></span> {t('matchingAlgorithm')}
            </li>
          </ul>
        </div>
      </div>

      {/* RIGHT PANE */}
      <div className="w-full lg:w-1/2 flex flex-col relative z-10 h-[100dvh] bg-black">
        
        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 sm:px-12 md:px-20 lg:px-24 py-12 flex flex-col justify-center">
          <div className="w-full max-w-md mx-auto relative z-20 my-auto">
            
            <div className="flex flex-col items-start mb-8">
              <div className="w-12 h-12 bg-black border-2 border-white flex items-center justify-center mb-6 lg:hidden">
                <Flame className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-2 uppercase tracking-widest">{t('registrationHeading')}</h2>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('registrationIntro')}</p>
            </div>

            {/* Social Logins */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <button 
                type="button"
                onClick={() => handleGoogleRegister()}
                disabled={isLoading || socialLoading !== null}
                className="py-3 px-4 bg-black border-2 border-zinc-800 hover:border-zinc-500 hover:bg-zinc-950 text-zinc-300 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {socialLoading === 'Google' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                Google
              </button>
              
              <AppleSignin
                authOptions={{
                  clientId: import.meta.env.VITE_APPLE_CLIENT_ID,
                  scope: 'email name',
                  redirectURI: 'https://yourwebsite.com', 
                  state: 'state',
                  nonce: 'nonce',
                  usePopup: true 
                }}
                onSuccess={async (response) => {
                  setSocialLoading('Apple');
                  try {
                    const apiResponse = await authService.appleLogin(response.authorization.id_token);
                    processAuthSuccess(apiResponse);
                  } catch (error) {
                    toast.error(error.message || t('appleRegistrationFailed'));
                    setSocialLoading(null);
                  }
                }}
                onError={() => toast.error(t('appleRegistrationCancelled'))}
                render={(props) => (
                  <button 
                    type="button"
                    onClick={props.onClick}
                    disabled={isLoading || socialLoading !== null}
                    className="py-3 px-4 bg-black border-2 border-zinc-800 hover:border-zinc-500 hover:bg-zinc-950 text-zinc-300 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {socialLoading === 'Apple' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Code className="w-4 h-4" />}
                    Apple
                  </button>
                )}
              />
            </div>

            <div className="relative flex items-center py-2 mb-4">
              <div className="flex-grow border-t-2 border-zinc-800"></div>
              <span className="shrink-0 px-4 text-[10px] text-zinc-600 font-bold uppercase tracking-widest bg-black">{t('registrationWithEmail')}</span>
              <div className="flex-grow border-t-2 border-zinc-800"></div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('usernameLabel')}</label>
                <div className="relative">
                  <User className={`w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${errors.username ? 'text-red-500' : 'text-zinc-600'}`} />
                  <input 
                    {...register('username')}
                    type="text" 
                    placeholder={t('usernameExample')}
                    disabled={isLoading}
                    className={`
                      w-full bg-black border-2 rounded-none pl-11 pr-4 py-3 text-[10px] font-bold text-white uppercase tracking-widest placeholder:text-zinc-700 transition-colors outline-none
                      ${errors.username ? 'border-red-500 focus:border-red-400' : 'border-zinc-800 focus:border-white'} 
                      disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                  />
                </div>
                {errors.username && <p className="text-[9px] text-red-500 mt-2 font-bold uppercase tracking-widest flex items-center gap-1.5"><span className="w-1 h-1 bg-red-500 border border-black" /> {errors.username.message}</p>}
              </div>

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
                {errors.email && <p className="text-[9px] text-red-500 mt-2 font-bold uppercase tracking-widest flex items-center gap-1.5"><span className="w-1 h-1 bg-red-500 border border-black" /> {errors.email.message}</p>}
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('passwordLabel')}</label>
                <div className="relative mb-3">
                  <Lock className={`w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${errors.password ? 'text-red-500' : 'text-zinc-600'}`} />
                  <input 
                    {...register('password')}
                    type={showPassword ? "text" : "password"} 
                    placeholder={t('minimumCharacters')}
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
                
                <div className="flex gap-1 h-1.5 mt-2">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className={`flex-1 rounded-none transition-colors duration-300 ${getScoreColor(i)}`} />
                  ))}
                </div>
                {errors.password && <p className="text-[9px] text-red-500 mt-2 font-bold uppercase tracking-widest flex items-center gap-1.5"><span className="w-1 h-1 bg-red-500 border border-black" /> {errors.password.message}</p>}
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest block mb-2">{t('confirmPasswordLabel')}</label>
                <div className="relative">
                  <Lock className={`w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${errors.confirmPassword ? 'text-red-500' : 'text-zinc-600'}`} />
                  <input 
                    {...register('confirmPassword')}
                    type={showConfirmPassword ? "text" : "password"} 
                    placeholder={t('repeatPassword')}
                    disabled={isLoading}
                    className={`
                      w-full bg-black border-2 rounded-none pl-11 pr-12 py-3 text-[10px] font-bold text-white uppercase tracking-widest placeholder:text-zinc-700 transition-colors outline-none
                      ${errors.confirmPassword ? 'border-red-500 focus:border-red-400' : 'border-zinc-800 focus:border-white'} 
                      disabled:opacity-50 disabled:cursor-not-allowed
                    `}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    disabled={isLoading}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-white transition-colors disabled:opacity-50"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.confirmPassword && <p className="text-[9px] text-red-500 mt-2 font-bold uppercase tracking-widest flex items-center gap-1.5"><span className="w-1 h-1 bg-red-500 border border-black" /> {errors.confirmPassword.message}</p>}
              </div>

              <div className="pt-2">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center mt-0.5 shrink-0">
                    <input 
                      {...register('acceptTerms')}
                      type="checkbox" 
                      disabled={isLoading}
                      className="peer appearance-none w-4 h-4 border-2 border-zinc-800 rounded-none bg-black checked:bg-white checked:border-white transition-colors disabled:opacity-50 cursor-pointer"
                    />
                    <div className="w-2 h-2 bg-black absolute opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" />
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-widest leading-relaxed transition-colors mt-0.5 ${errors.acceptTerms ? 'text-red-500' : 'text-zinc-500 group-hover:text-zinc-300'}`}>
                    {t('termsAgreement')} <Link to="/guidelines" className="text-white hover:text-zinc-300 border-b border-white pb-0.5 transition-colors">{t('termsOfService')}</Link> {t('and')} <span className="text-white hover:text-zinc-300 border-b border-white pb-0.5 transition-colors cursor-pointer">{t('privacyPolicy')}</span>.
                  </span>
                </label>
              </div>

              <button 
                type="submit" 
                disabled={isLoading || socialLoading !== null}
                className="w-full py-4 bg-white text-black border-2 border-white text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-200 flex items-center justify-center gap-2 mt-6 transition-colors disabled:opacity-50 disabled:bg-zinc-800 disabled:border-zinc-800 disabled:text-zinc-500 rounded-none"
              >
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {t('creatingProfile')}</>
                ) : (
                  <><Flame className="w-4 h-4" /> {t('createAccountButton')}</>
                )}
              </button>
            </form>

            <div className="mt-8 text-center text-[10px] font-bold text-zinc-600 uppercase tracking-widest pb-8">
              {t('alreadyHaveAccount')}{' '}
              <Link to="/login" className="text-white hover:text-zinc-300 transition-colors border-b-2 border-white pb-0.5 ml-1">
                {t('logInHere')}
              </Link>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
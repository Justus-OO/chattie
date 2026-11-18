import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Flame, Loader2, Mail, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { authService } from '../../api/auth.service';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [channel, setChannel] = useState('email');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const requestCode = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    try {
      const result = await authService.requestPasswordReset(email, channel);
      setChallengeId(result.challenge_id);
      toast.success(result.message || 'If an eligible account matches, a code has been sent.');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Could not request a reset code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      toast.error('The passwords do not match.');
      return;
    }
    setIsLoading(true);
    try {
      await authService.completePasswordReset(challengeId, code, password);
      toast.success('Password updated. You can now sign in.');
      window.location.assign('/login');
    } catch (error) {
      toast.error(error.response?.data?.error || 'The code is invalid or expired. Request a new code and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-dvh overflow-x-hidden bg-black font-mono text-zinc-300">
      <aside className="relative hidden min-h-dvh w-1/2 items-center justify-center overflow-hidden border-r-2 border-zinc-800 bg-black lg:flex">
        <img
          src="https://images.unsplash.com/photo-1555529771-835f59bfc50c?auto=format&fit=crop&w=1200&q=80"
          alt="Nightlife scene"
          className="absolute inset-0 h-full w-full object-cover grayscale opacity-30"
        />
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative z-10 max-w-lg p-8 text-left xl:p-12">
          <div className="mb-8 inline-flex items-center gap-2 border-2 border-white bg-black px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white">
            <Flame className="h-4 w-4" /> Chattie Premium
          </div>
          <h2 className="mb-6 text-4xl font-black uppercase leading-tight tracking-widest text-white xl:text-5xl">
            Secure your account
          </h2>
          <p className="text-xs font-bold uppercase leading-relaxed tracking-widest text-zinc-400">
            Reset your password with a secure one-time code and get back to your conversations.
          </p>
        </div>
      </aside>

      <div className="flex min-h-dvh w-full flex-col justify-center bg-black px-4 py-8 sm:px-8 md:px-12 lg:w-1/2 lg:px-16">
      <section className="mx-auto w-full max-w-md">
        <div className="mb-8 flex h-12 w-12 items-center justify-center border-2 border-white">
          <Flame className="h-6 w-6 text-white" />
        </div>
        <h1 className="text-2xl font-black uppercase tracking-widest text-white">Reset password</h1>
        <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
          {challengeId ? 'Enter the one-time code and choose a new password.' : 'Receive a secure one-time code by email or SMS.'}
        </p>

        {!challengeId ? (
          <form onSubmit={requestCode} className="mt-8 space-y-5">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Email address
              <span className="relative mt-2 block">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full border-2 border-zinc-800 bg-black py-3 pl-10 pr-3 text-xs font-bold text-white outline-none focus:border-white"
                />
              </span>
            </label>
            <fieldset>
              <legend className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Send code using</legend>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'email', label: 'Email', Icon: Mail },
                  { value: 'sms', label: 'SMS', Icon: Smartphone },
                ].map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={channel === value}
                    onClick={() => setChannel(value)}
                    className={`flex items-center justify-center gap-2 border-2 p-3 text-[10px] font-bold uppercase tracking-widest ${channel === value ? 'border-white text-white' : 'border-zinc-800 text-zinc-500'}`}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <button type="submit" disabled={isLoading} className="flex w-full items-center justify-center gap-2 border-2 border-white bg-white py-4 text-[10px] font-bold uppercase tracking-widest text-black disabled:opacity-50">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send reset code'}
            </button>
          </form>
        ) : (
          <form onSubmit={resetPassword} className="mt-8 space-y-5">
            <p className="border-2 border-zinc-800 bg-zinc-950 p-3 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              If the account and selected recovery method are eligible, a code was sent.
            </p>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Verification code
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="mt-2 w-full border-2 border-zinc-800 bg-black px-3 py-3 text-sm font-bold tracking-[0.4em] text-white outline-none focus:border-white"
              />
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              New password
              <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full border-2 border-zinc-800 bg-black px-3 py-3 text-xs text-white outline-none focus:border-white" />
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              Confirm new password
              <input type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 w-full border-2 border-zinc-800 bg-black px-3 py-3 text-xs text-white outline-none focus:border-white" />
            </label>
            <button type="submit" disabled={isLoading} className="flex w-full items-center justify-center gap-2 border-2 border-white bg-white py-4 text-[10px] font-bold uppercase tracking-widest text-black disabled:opacity-50">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update password'}
            </button>
            <button type="button" onClick={() => { setChallengeId(''); setCode(''); }} className="w-full py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white">Request another code</button>
          </form>
        )}

        <Link to="/login" className="mt-8 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to login
        </Link>
      </section>
        </div>
    </main>
  );
}
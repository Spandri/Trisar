import React from 'react';
import { TRISAR_LOGO_URL } from '../../../shared/ui/icons';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import { useI18n } from '../../../i18n';

const LoginView = ({ email, password, setEmail, setPassword, onLogin, authError }) => {
  const { t } = useI18n();
  return (
  <div className="min-h-screen bg-[#0a0a0a] text-white relative overflow-hidden">
    <div className="min-h-screen flex items-center justify-center p-4 pb-16">
      <div className="w-full max-w-sm bg-[#161618] border border-[#222224] rounded-[36px] p-8">
        <div className="text-center mb-6">
          <img src={TRISAR_LOGO_URL} alt="Trisar" className="h-12 w-auto mx-auto" />
          <p className="text-xs text-slate-400 font-bold mt-2">{t('misc.loginWithDriverAccount')}</p>
        </div>
        <form onSubmit={onLogin} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('misc.email')}
            className="w-full bg-[#222224] rounded-2xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-[#d4ff28]"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('misc.password')}
            className="w-full bg-[#222224] rounded-2xl px-4 py-3 text-sm font-bold text-white focus:outline-none focus:ring-1 focus:ring-[#d4ff28]"
          />
          <button type="submit" className="w-full bg-[#d4ff28] text-black rounded-2xl py-3 text-sm font-black uppercase">
            {t('misc.login')}
          </button>
        </form>
        {authError && <p className="mt-4 text-xs text-red-400 font-bold text-center">{authError}</p>}
      </div>
    </div>
    <TrisarFooter className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-30" />
  </div>
  );
};

export default LoginView;

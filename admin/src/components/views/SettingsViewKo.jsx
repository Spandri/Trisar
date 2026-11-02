import React, { useEffect, useRef, useState } from 'react';
import TrisarFooter from '../ui/TrisarFooter';
import BackCircleButton from '../ui/BackCircleButton';
import { useI18n } from '../../i18n';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 873;

const LANGUAGE_OPTIONS = ['Deutsch', 'English', 'Français', 'Italiano', 'Español', 'Türkçe'];

const screenBg = {
  backgroundImage: "url('/icon/_Icon_Schwarz/screen-bg-radial.svg')",
};

const Box = ({ x, y, w, h = 56, children, className = '' }) => (
  <div className={`absolute border-2 border-[#e3f654] ${className}`} style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}>
    {children}
  </div>
);

const normalizePhone = (phone = '') => {
  const value = String(phone || '').trim();
  if (!value) return { country: '+49', local: '' };
  const match = value.match(/^(\+\d{1,4})\s*(.*)$/);
  if (match) return { country: match[1], local: match[2] || '' };
  return { country: '+49', local: value };
};

const readFileAsDataUrl = (file, t) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error(t('assist.fileReadError')));
  reader.readAsDataURL(file);
});

const loadImageFromDataUrl = (dataUrl, t) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(t('assist.imageLoadError')));
  image.src = dataUrl;
});

const prepareAvatarDataUrl = async (file, t) => {
  const sourceDataUrl = await readFileAsDataUrl(file, t);
  const image = await loadImageFromDataUrl(sourceDataUrl, t);
  const maxSide = 720;
  const width = Number(image.width || 0);
  const height = Number(image.height || 0);
  if (!width || !height) throw new Error(t('assist.invalidImageFile'));

  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('assist.imageProcessingUnavailable'));
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const preferredMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const preferredDataUrl = preferredMime === 'image/png'
    ? canvas.toDataURL(preferredMime)
    : canvas.toDataURL(preferredMime, 0.84);

  if (preferredDataUrl.length <= 2_200_000) return preferredDataUrl;
  return canvas.toDataURL('image/jpeg', 0.76);
};

export default function SettingsViewKo({ setView, onLogout = () => {}, profileData = {}, onSaveProfile }) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [showAvatarMenu, setShowAvatarMenu] = useState(false);
  const [showAvatarPreview, setShowAvatarPreview] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarError, setAvatarError] = useState('');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+49');
  const [phone, setPhone] = useState('');
  const [street, setStreet] = useState('');
  const [streetNumber, setStreetNumber] = useState('');
  const [city, setCity] = useState('');
  const [zip, setZip] = useState('');
  const [language, setLanguage] = useState('Deutsch');

  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const phoneRef = useRef(null);
  const streetRef = useRef(null);
  const streetNumberRef = useRef(null);
  const cityRef = useRef(null);
  const zipRef = useRef(null);
  const avatarInputRef = useRef(null);
  const avatarControlRef = useRef(null);

  useEffect(() => {
    const updateScale = () => setScale(Math.min(window.innerWidth / BASE_WIDTH, 1));
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const prevHtmlOverflow = html.style.overflow;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    const prevRootOverflow = root ? root.style.overflow : '';
    const prevRootOverscroll = root ? root.style.overscrollBehavior : '';

    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    if (root) {
      root.style.overflow = 'hidden';
      root.style.overscrollBehavior = 'none';
    }

    return () => {
      html.style.overflow = prevHtmlOverflow;
      html.style.overscrollBehavior = prevHtmlOverscroll;
      body.style.overflow = prevBodyOverflow;
      body.style.overscrollBehavior = prevBodyOverscroll;
      if (root) {
        root.style.overflow = prevRootOverflow;
        root.style.overscrollBehavior = prevRootOverscroll;
      }
    };
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const p = normalizePhone(profileData?.phone || '');
    setFirstName(profileData?.firstName || '');
    setLastName(profileData?.lastName || '');
    setEmail(profileData?.email || '');
    setCountryCode(p.country || '+49');
    setPhone(p.local || '');
    setStreet(profileData?.street || '');
    setStreetNumber(profileData?.streetNumber || '');
    setCity(profileData?.city || '');
    setZip(profileData?.zip || '');
    setLanguage(profileData?.language || 'Deutsch');
    setAvatarUrl(profileData?.avatarUrl || '');
    setAvatarError('');
  }, [profileData]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!showAvatarMenu) return undefined;
    const onPointerDown = (event) => {
      if (!avatarControlRef.current) return;
      if (!avatarControlRef.current.contains(event.target)) {
        setShowAvatarMenu(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [showAvatarMenu]);

  useEffect(() => {
    if (!avatarError) return undefined;
    const timeoutId = window.setTimeout(() => setAvatarError(''), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [avatarError]);

  const inputClass =
    'absolute left-4 right-14 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90';

  const savePatch = async (patch) => {
    if (!onSaveProfile) return;
    await onSaveProfile(patch);
  };

  const savePhone = async (nextCountry = countryCode, nextPhone = phone) => {
    const combined = `${(nextCountry || '+49').trim()} ${(nextPhone || '').trim()}`.trim();
    await savePatch({ phone: combined });
  };

  const handleAvatarRemove = async () => {
    setAvatarUrl('');
    setShowAvatarPreview(false);
    setShowAvatarMenu(false);
    setAvatarError('');
    await savePatch({ avatarUrl: '' });
  };

  const handleAvatarFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      setAvatarError(t('assist.pickImageFile'));
      return;
    }

    try {
      const nextAvatarUrl = await prepareAvatarDataUrl(file, t);
      setAvatarUrl(nextAvatarUrl);
      setShowAvatarMenu(false);
      setAvatarError('');
      await savePatch({ avatarUrl: nextAvatarUrl });
    } catch (error) {
      setAvatarError(error?.message || t('assist.profileImageLoadFailed'));
    }
  };

  const initials = `${String(firstName || '').trim().charAt(0)}${String(lastName || '').trim().charAt(0)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 2) || 'P';

  return (
    <>
    <div
      className="h-dvh w-full bg-black overflow-hidden flex justify-center overscroll-none"
      style={{ WebkitTextSizeAdjust: 'none', WebkitOverflowScrolling: 'touch', textSizeAdjust: 'none', fontFamily: 'Space Grotesk, sans-serif' }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${BASE_HEIGHT * scale}px` }}>
        <div className="absolute left-0 top-0 w-[402px] origin-top-left" style={{ ...screenBg, transform: `scale(${scale})`, height: `${BASE_HEIGHT}px` }}>
          <BackCircleButton onClick={() => setView('profilKoordinator')} className="absolute left-5 top-[60px]" marker="einstellungen-zurueck" />
          <div ref={avatarControlRef} className="absolute right-5 top-[60px] z-40">
            <button
              type="button"
              onClick={() => setShowAvatarMenu((prev) => !prev)}
              className="w-14 h-14 rounded-full border-2 border-[#e3f654] bg-black overflow-hidden flex items-center justify-center"
              aria-label={t('assist.avatarOptions')}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={t('assist.profileImage')} className="w-full h-full object-cover" />
              ) : (
                <span className="text-[#e3f654] text-[18px] font-bold tracking-wide">{initials}</span>
              )}
            </button>

            {showAvatarMenu ? (
              <div className="absolute right-0 top-[64px] w-[228px] bg-black border-2 border-[#e3f654]">
                <button
                  type="button"
                  onClick={() => {
                    setShowAvatarMenu(false);
                    if (avatarUrl) setShowAvatarPreview(true);
                    if (!avatarUrl) setAvatarError(t('assist.noProfileImage'));
                  }}
                  className="w-full h-12 px-4 text-left text-[#e3f654] text-[14px] font-medium border-b border-[#5d6620]"
                >
                  {t('assist.showProfileImage')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAvatarMenu(false);
                    avatarInputRef.current?.click();
                  }}
                  className="w-full h-12 px-4 text-left text-[#e3f654] text-[14px] font-medium border-b border-[#5d6620]"
                >
                  {t('assist.uploadProfileImage')}
                </button>
                <button
                  type="button"
                  onClick={handleAvatarRemove}
                  className="w-full h-12 px-4 text-left text-[#f55757] text-[14px] font-medium"
                >
                  {t('assist.removeProfileImage')}
                </button>
              </div>
            ) : null}
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarFileChange}
            className="hidden"
          />

          <div className="absolute left-0 top-0 w-[402px]">
            <h1 className="absolute left-5 top-[140px] text-[#e2f754] text-[42px] leading-[42px] tracking-[-0.5px] font-bold whitespace-nowrap">
              {t('assist.settingsTitle')}
            </h1>

            <Box x={20} y={206} w={178}>
            <input
              ref={firstNameRef}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              onBlur={() => savePatch({ firstName: firstName.trim() })}
              placeholder={t('assist.firstName')}
              className={inputClass}
            />
            <button type="button" onClick={() => firstNameRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
            </button>
            </Box>

            <Box x={204} y={206} w={178}>
            <input
              ref={lastNameRef}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              onBlur={() => savePatch({ lastName: lastName.trim() })}
              placeholder={t('assist.lastName')}
              className={inputClass}
            />
            <button type="button" onClick={() => lastNameRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
            </button>
            </Box>

            <Box x={20} y={274} w={362}>
            <input
              ref={emailRef}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => savePatch({ email: email.trim() })}
              placeholder={t('assist.emailPlaceholder')}
              className="absolute left-10 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <img src="/icon/_Icon_Lime/Mail_Trisar_Icons_01_Lime.svg" alt="" className="absolute left-3 top-1/2 -translate-y-1/2 w-[10px] h-[13px] scale-[1.2]" />
            <button type="button" onClick={() => emailRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
            </button>
            </Box>

            <Box x={20} y={342} w={85}>
            <input
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              onBlur={() => savePhone(countryCode, phone)}
              placeholder="+49"
              className="absolute left-4 right-2 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            </Box>

            <Box x={111} y={342} w={271}>
            <input
              ref={phoneRef}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => savePhone(countryCode, phone)}
              placeholder={t('assist.phone')}
              className="absolute left-10 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <img src="/icon/_Icon_Schwarz/contact-phone.svg" alt="" className="absolute left-3 top-1/2 -translate-y-1/2 w-[12px] h-[12px] object-contain" />
            <button type="button" onClick={() => phoneRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
            </button>
            </Box>

            <Box x={20} y={410} w={271}>
            <input
              ref={streetRef}
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              onBlur={() => savePatch({ street: street.trim() })}
              placeholder={t('assist.street')}
              className="absolute left-4 right-12 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <button type="button" onClick={() => streetRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
            </button>
            </Box>

            <Box x={297} y={410} w={85}>
            <input
              ref={streetNumberRef}
              value={streetNumber}
              onChange={(e) => setStreetNumber(e.target.value)}
              onBlur={() => savePatch({ streetNumber: streetNumber.trim() })}
              placeholder={t('assist.streetNumber')}
              className="absolute left-4 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <button type="button" onClick={() => streetNumberRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
            </button>
            </Box>

            <Box x={20} y={478} w={362}>
            <input
              ref={cityRef}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onBlur={() => savePatch({ city: city.trim() })}
              placeholder={t('assist.city')}
              className="absolute left-4 right-12 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <button type="button" onClick={() => cityRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
            </button>
            </Box>

            <Box x={20} y={546} w={178}>
            <input
              ref={zipRef}
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              onBlur={() => savePatch({ zip: zip.trim() })}
              placeholder={t('assist.zip')}
              className="absolute left-4 right-12 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <button type="button" onClick={() => zipRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
            </button>
            </Box>

            <Box x={204} y={546} w={178} className="z-20">
            <button
              type="button"
              onClick={() => setShowLanguageMenu((v) => !v)}
              className="absolute inset-0 text-left"
            >
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium whitespace-nowrap">
                {language || t('assist.language')}
              </span>
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="absolute right-3 top-1/2 -translate-y-1/2 w-[10px] h-[13px] rotate-90" />
            </button>
            {showLanguageMenu && (
              <div className="absolute left-0 right-0 top-[58px] bg-black border-2 border-[#e3f654] z-30 max-h-48 overflow-y-auto">
                {LANGUAGE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setLanguage(option);
                      setShowLanguageMenu(false);
                      savePatch({ language: option });
                    }}
                    className="w-full text-left px-4 py-2 text-[#8a9728] text-[16px]"
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            </Box>

            <button
              type="button"
              onClick={onLogout}
              className="absolute left-5 top-[626px] w-[362px] h-14 border border-[#7f8a2b] text-[#7f8a2b] text-[16px] leading-6 tracking-[0.5px] font-medium"
            >
              {t('assist.logout')}
            </button>

            <div className="absolute left-1/2 -translate-x-1/2 top-[694px] w-[362px] text-center text-[#e3f654] opacity-35 text-[12px] leading-6 tracking-[0.5px] font-medium">
              {t('assist.deleteAccount')}
            </div>

          </div>
        </div>

        {showAvatarPreview ? (
          <div className="absolute inset-0 z-[60] bg-black/85 flex items-center justify-center px-5">
            <div className="w-[360px] border-2 border-[#e3f654] bg-black p-4">
              <div className="text-[#e3f654] text-[18px] font-bold leading-6">{t('assist.profileImage')}</div>
              <div className="mt-4 w-full aspect-square border border-[#5d6620] bg-[#101108] overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={t('assist.profileImageLarge')} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#798321] text-[14px]">{t('assist.noImage')}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowAvatarPreview(false)}
                className="mt-4 w-full h-12 bg-[#e3f654] text-[#0e1008] text-[16px] font-medium"
              >
                {t('assist.close')}
              </button>
            </div>
          </div>
        ) : null}

        {avatarError ? (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-[64px] z-[70] px-4 py-2 border border-[#f55757] bg-[#220f0f] text-[#ff8e8e] text-[12px] font-medium">
            {avatarError}
          </div>
        ) : null}
      </div>
    </div>
    {/* Footer fest am unteren Rand — ausserhalb des skalierten Inhalts, weil
        position: fixed sich sonst am transform-Elternteil ausrichten wuerde. */}
    <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-[70]" />
    </>
  );
}

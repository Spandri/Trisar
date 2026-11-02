import React, { useEffect, useMemo, useRef, useState } from 'react';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import { SETTINGS_EDIT_ICON_URL, SETTINGS_ENVELOPE_ICON_URL } from '../../../shared/ui/icons';
import { useI18n } from '../../../i18n';
import ZurueckKnopf from '../../../components/ui/ZurueckKnopf';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 873;

const LANGUAGE_OPTIONS = ['Deutsch', 'English', 'Français', 'Italiano', 'Español', 'Türkçe'];

const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 873' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 87.3 -40.2 18.469 0 0)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
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
  reader.onerror = () => reject(new Error(t('screens.fileReadError')));
  reader.readAsDataURL(file);
});

const loadImageFromDataUrl = (dataUrl, t) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(t('screens.imageLoadError')));
  image.src = dataUrl;
});

const prepareAvatarDataUrl = async (file, t) => {
  const sourceDataUrl = await readFileAsDataUrl(file, t);
  const image = await loadImageFromDataUrl(sourceDataUrl, t);
  const maxSide = 720;
  const width = Number(image.width || 0);
  const height = Number(image.height || 0);
  if (!width || !height) throw new Error(t('screens.invalidImageFile'));

  const scale = Math.min(1, maxSide / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('screens.imageProcessingUnavailable'));
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  const preferredMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const preferredDataUrl = preferredMime === 'image/png'
    ? canvas.toDataURL(preferredMime)
    : canvas.toDataURL(preferredMime, 0.84);

  if (preferredDataUrl.length <= 2_200_000) return preferredDataUrl;
  return canvas.toDataURL('image/jpeg', 0.76);
};

export default function SettingsFahrer({ setView, onLogout, profileData, onSaveProfile }) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);
  const [viewportHeight, setViewportHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : BASE_HEIGHT,
  );
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
    const updateScale = () => {
      const nextViewportHeight = window.innerHeight || BASE_HEIGHT;
      setViewportHeight(nextViewportHeight);
      setScale(Math.min(window.innerWidth / BASE_WIDTH, nextViewportHeight / BASE_HEIGHT, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const frameHeight = useMemo(() => {
    const safeScale = Math.max(scale, 0.01);
    return Math.max(BASE_HEIGHT, Math.ceil(viewportHeight / safeScale));
  }, [scale, viewportHeight]);

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
      setAvatarError(t('screens.pickImageFile'));
      return;
    }

    try {
      const nextAvatarUrl = await prepareAvatarDataUrl(file, t);
      setAvatarUrl(nextAvatarUrl);
      setShowAvatarMenu(false);
      setAvatarError('');
      await savePatch({ avatarUrl: nextAvatarUrl });
    } catch (error) {
      setAvatarError(error?.message || t('screens.avatarLoadError'));
    }
  };

  const initials = `${String(firstName || '').trim().charAt(0)}${String(lastName || '').trim().charAt(0)}`
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 2) || 'P';

  return (
    <div
      className="h-dvh w-full bg-black overflow-hidden overscroll-none flex justify-center"
      style={{ WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none', fontFamily: 'Space Grotesk, sans-serif' }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${frameHeight * scale}px` }}>
        <div className="absolute left-0 top-0 w-[402px] origin-top-left" style={{ ...screenBg, transform: `scale(${scale})`, height: `${frameHeight}px` }}>
          <ZurueckKnopf onClick={() => setView('profilFahrer')} marker="einstellungen-zurueck" />
          <div ref={avatarControlRef} className="absolute right-5 top-[60px] z-40">
            <button
              type="button"
              onClick={() => setShowAvatarMenu((prev) => !prev)}
              className="w-[50px] h-[50px] rounded-full border border-[#8b8b8d] bg-black overflow-hidden flex items-center justify-center"
              aria-label={t('screens.avatarOptions')}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={t('screens.avatar')} className="w-full h-full object-cover" />
              ) : (
                <span className="text-[#e3f654] text-[16px] font-bold tracking-wide">{initials}</span>
              )}
            </button>

            {showAvatarMenu ? (
              <div className="absolute right-0 top-[56px] w-[228px] bg-black border-2 border-[#e3f654]">
                <button
                  type="button"
                  onClick={() => {
                    setShowAvatarMenu(false);
                    if (avatarUrl) setShowAvatarPreview(true);
                    if (!avatarUrl) setAvatarError(t('screens.noAvatar'));
                  }}
                  className="w-full h-12 px-4 text-left text-[#e3f654] text-[14px] font-medium border-b border-[#5d6620]"
                >
                  {t('screens.showAvatar')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAvatarMenu(false);
                    avatarInputRef.current?.click();
                  }}
                  className="w-full h-12 px-4 text-left text-[#e3f654] text-[14px] font-medium border-b border-[#5d6620]"
                >
                  {t('screens.uploadAvatar')}
                </button>
                <button
                  type="button"
                  onClick={handleAvatarRemove}
                  className="w-full h-12 px-4 text-left text-[#f55757] text-[14px] font-medium"
                >
                  {t('screens.removeAvatar')}
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

          <h1 className="absolute left-5 top-[140px] text-[#e2f754] text-[42px] leading-[42px] tracking-[-0.5px] font-bold whitespace-nowrap">
            {t('screens.settings')}
          </h1>

          <Box x={20} y={190} w={178}>
            <input
              ref={firstNameRef}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              onBlur={() => savePatch({ firstName: firstName.trim() })}
              placeholder={t('screens.firstName')}
              className={inputClass}
            />
            <button type="button" onClick={() => firstNameRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src={SETTINGS_EDIT_ICON_URL} alt="" className="w-[10px] h-[13px]" />
            </button>
          </Box>

          <Box x={204} y={190} w={178}>
            <input
              ref={lastNameRef}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              onBlur={() => savePatch({ lastName: lastName.trim() })}
              placeholder={t('screens.lastName')}
              className={inputClass}
            />
            <button type="button" onClick={() => lastNameRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src={SETTINGS_EDIT_ICON_URL} alt="" className="w-[10px] h-[13px]" />
            </button>
          </Box>

          <Box x={21} y={254} w={360}>
            <input
              ref={emailRef}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => savePatch({ email: email.trim() })}
              placeholder={t('screens.email')}
              className="absolute left-10 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <img src={SETTINGS_ENVELOPE_ICON_URL} alt="" className="absolute left-3 top-1/2 -translate-y-1/2 w-[10px] h-[13px] scale-[1.2]" />
            <button type="button" onClick={() => emailRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src={SETTINGS_EDIT_ICON_URL} alt="" className="w-[10px] h-[13px]" />
            </button>
          </Box>

          <Box x={20} y={322} w={85}>
            <input
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
              onBlur={() => savePhone(countryCode, phone)}
              placeholder="+49"
              className="absolute left-4 right-2 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
          </Box>

          <Box x={111} y={322} w={270}>
            <input
              ref={phoneRef}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => savePhone(countryCode, phone)}
              placeholder={t('screens.phone')}
              className="absolute left-10 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <img src="/icon/_Icon_Schwarz/contact-phone.svg" alt="" className="absolute left-3 top-1/2 -translate-y-1/2 w-[12px] h-[12px] object-contain" />
            <button type="button" onClick={() => phoneRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src={SETTINGS_EDIT_ICON_URL} alt="" className="w-[10px] h-[13px]" />
            </button>
          </Box>

          <Box x={20} y={390} w={270}>
            <input
              ref={streetRef}
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              onBlur={() => savePatch({ street: street.trim() })}
              placeholder={t('screens.street')}
              className="absolute left-4 right-12 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <button type="button" onClick={() => streetRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src={SETTINGS_EDIT_ICON_URL} alt="" className="w-[10px] h-[13px]" />
            </button>
          </Box>

          <Box x={296} y={390} w={85}>
            <input
              ref={streetNumberRef}
              value={streetNumber}
              onChange={(e) => setStreetNumber(e.target.value)}
              onBlur={() => savePatch({ streetNumber: streetNumber.trim() })}
              placeholder={t('screens.streetNumber')}
              className="absolute left-4 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <button type="button" onClick={() => streetNumberRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src={SETTINGS_EDIT_ICON_URL} alt="" className="w-[10px] h-[13px]" />
            </button>
          </Box>

          <Box x={20} y={458} w={361}>
            <input
              ref={cityRef}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onBlur={() => savePatch({ city: city.trim() })}
              placeholder={t('screens.city')}
              className="absolute left-4 right-12 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <button type="button" onClick={() => cityRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src={SETTINGS_EDIT_ICON_URL} alt="" className="w-[10px] h-[13px]" />
            </button>
          </Box>

          <Box x={20} y={526} w={178}>
            <input
              ref={zipRef}
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              onBlur={() => savePatch({ zip: zip.trim() })}
              placeholder={t('screens.zip')}
              className="absolute left-4 right-12 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
            />
            <button type="button" onClick={() => zipRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
              <img src={SETTINGS_EDIT_ICON_URL} alt="" className="w-[10px] h-[13px]" />
            </button>
          </Box>

          <Box x={204} y={526} w={177} className="z-20">
            <button
              type="button"
              onClick={() => setShowLanguageMenu((v) => !v)}
              data-tutorial="einstellungen-sprache"
              className="absolute inset-0 text-left"
            >
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium whitespace-nowrap">
                {language || t('screens.language')}
              </span>
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="absolute right-3 top-1/2 -translate-y-1/2 w-[10px] h-[13px] rotate-90" />
            </button>
            {showLanguageMenu && (
              <div className="absolute left-0 right-0 top-[58px] bg-black border-2 border-[#e3f654] z-30 max-h-48 overflow-y-auto overscroll-none">
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
            data-tutorial="einstellungen-abmelden"
            className="absolute left-5 top-[607px] w-[362px] h-14 border border-[#7f8a2b] text-[#7f8a2b] text-[16px] leading-6 tracking-[0.5px] font-medium"
          >
            {t('screens.logout')}
          </button>

          <div className="absolute left-1/2 -translate-x-1/2 top-[682px] w-[362px] text-center text-[#e3f654] opacity-35 text-[12px] leading-6 tracking-[0.5px] font-medium">
            {t('screens.deleteAccount')}
          </div>

          <TrisarFooter className="absolute left-0 right-0 bottom-0 h-10 bg-black" />
        </div>

        {showAvatarPreview ? (
          <div className="absolute inset-0 z-[60] bg-black/85 flex items-center justify-center px-5">
            <div className="w-[360px] border-2 border-[#e3f654] bg-black p-4">
              <div className="text-[#e3f654] text-[18px] font-bold leading-6">{t('screens.avatar')}</div>
              <div className="mt-4 w-full aspect-square border border-[#5d6620] bg-[#101108] overflow-hidden">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={t('screens.avatarLarge')} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[#798321] text-[14px]">{t('screens.noImage')}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowAvatarPreview(false)}
                className="mt-4 w-full h-12 bg-[#e3f654] text-[#0e1008] text-[16px] font-medium"
              >
                {t('screens.close')}
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
  );
}

import { useEffect, useRef, useState } from 'react';
import TrisarFooter from '../ui/TrisarFooter';
import BackCircleButton from '../ui/BackCircleButton';
import { supabase, supabaseAdmin } from '../../services/supabase';
import FahrerAutocomplete from '../ui/FahrerAutocomplete';
import { useI18n } from '../../i18n';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 913;
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

const isValidEmailFormat = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());

const resolveDriverPasswordSetupRedirect = () => {
  const configured = String(import.meta.env.VITE_FAHRER_APP_URL || '').trim();
  if (configured) return configured;
  try {
    const url = new URL(window.location.origin);
    if (url.hostname === 'koordinator.trisar.de' || url.hostname === 'admin.trisar.de') {
      return `${url.protocol}//fahrer.trisar.de`;
    }
    if (url.port === '5175' || url.port === '5177') {
      url.port = '5173';
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    // Fall back to default driver domain.
  }
  return 'https://fahrer.trisar.de';
};

export default function FahrerErstellenView({ setView, initialDriver = null }) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [showVehicleMenu, setShowVehicleMenu] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');

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
  const [vehicleId, setVehicleId] = useState('');
  const [driverNumber, setDriverNumber] = useState('');
  const [driverNumberWarning, setDriverNumberWarning] = useState('');
  const [originalEmail, setOriginalEmail] = useState('');
  const isEditMode = Boolean(initialDriver?.id);

  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const phoneRef = useRef(null);
  const streetRef = useRef(null);
  const streetNumberRef = useRef(null);
  const cityRef = useRef(null);
  const zipRef = useRef(null);
  const driverNumberRef = useRef(null);

  useEffect(() => {
    const updateScale = () => setScale(Math.min(window.innerWidth / BASE_WIDTH, 1));
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadVehicles = async () => {
      setLoadingVehicles(true);
      try {
        let result = await supabase.from('vehicles').select('*').order('brand_model', { ascending: true });
        if (result.error && /brand_model/i.test(result.error.message || '')) {
          result = await supabase.from('vehicles').select('*').order('created_at', { ascending: false });
        }
        if (!mounted) return;
        if (result.error) throw result.error;
        setVehicles(result.data || []);
      } catch (error) {
        if (!mounted) return;
        setVehicles([]);
        setFeedback(t('erstellen.vehiclesLoadError', { error: error.message }));
      }
      if (mounted) setLoadingVehicles(false);
    };
    loadVehicles();
    return () => {
      mounted = false;
    };
  }, []);

  const inputClass =
    'absolute left-4 right-14 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90';

  const selectedVehicleLabel = (() => {
    const selected = vehicles.find((v) => v.id === vehicleId);
    if (!selected) return t('erstellen.linkVehicle');
    const brandModel = String(selected.brand_model || '').trim();
    const plate = String(selected.license_plate || '').trim();
    if (brandModel && plate) return `${brandModel} (${plate})`;
    return brandModel || plate || t('erstellen.vehicle');
  })();

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setEmail('');
    const normalized = normalizePhone('');
    setCountryCode(normalized.country);
    setPhone(normalized.local);
    setStreet('');
    setStreetNumber('');
    setCity('');
    setZip('');
    setLanguage('Deutsch');
    setVehicleId('');
    setDriverNumber('');
    setOriginalEmail('');
    setShowLanguageMenu(false);
    setShowVehicleMenu(false);
  };

  useEffect(() => {
    let mounted = true;

    const hydrateDriver = async () => {
      if (!isEditMode) {
        resetForm();
        return;
      }

      setFeedback('');
      setFirstName(String(initialDriver?.firstName || '').trim());
      setLastName(String(initialDriver?.lastName || '').trim());
      setDriverNumber(initialDriver?.driverNumber != null ? String(initialDriver.driverNumber) : '');
      const initialMail = String(initialDriver?.email || '').trim();
      setEmail(initialMail);
      setOriginalEmail(initialMail.toLowerCase());
      const phoneParts = normalizePhone('');
      setCountryCode(phoneParts.country);
      setPhone(phoneParts.local);
      setStreet('');
      setStreetNumber('');
      setCity('');
      setZip('');
      setLanguage('Deutsch');
      setVehicleId('');

      try {
        const withAuthRelation = await supabase
          .from('profiles')
          .select('*, auth_user:auth.users!profiles_id_fkey(email)')
          .eq('id', initialDriver.id)
          .maybeSingle();
        const fallbackSimple = withAuthRelation.error
          ? await supabase.from('profiles').select('*').eq('id', initialDriver.id).maybeSingle()
          : withAuthRelation;
        if (!mounted) return;
        if (fallbackSimple.error) throw fallbackSimple.error;
        const data = fallbackSimple.data;
        if (!data) return;

        const normalizedPhone = normalizePhone(data.phone || '');
        setFirstName(String(data.first_name || initialDriver?.firstName || '').trim());
        setLastName(String(data.last_name || initialDriver?.lastName || '').trim());
        const relationMail =
          data?.auth_user?.email
          || data?.auth_users?.email
          || data?.user?.email
          || data?.users?.email
          || '';
        const profileMail = String(data.email || relationMail || initialDriver?.email || '').trim();
        if (profileMail) {
          setEmail(profileMail);
          setOriginalEmail(profileMail.toLowerCase());
        }
        setCountryCode(normalizedPhone.country);
        setPhone(normalizedPhone.local);
        setStreet(String(data.street || '').trim());
        setStreetNumber(String(data.street_number || '').trim());
        setCity(String(data.city || '').trim());
        setZip(String(data.zip || '').trim());
        setLanguage(String(data.language || 'Deutsch').trim() || 'Deutsch');
        setVehicleId(String(data.vehicle_id || '').trim());
        setDriverNumber(data.driver_number != null ? String(data.driver_number) : (initialDriver?.driverNumber != null ? String(initialDriver.driverNumber) : ''));
      } catch (error) {
        if (!mounted) return;
        setFeedback(t('erstellen.driverLoadError', { error: error.message }));
      }

      try {
        const authUser = await supabaseAdmin.auth.admin.getUserById(initialDriver.id);
        if (!mounted) return;
        const authEmail = String(authUser?.data?.user?.email || '').trim();
        if (authEmail) {
          setEmail(authEmail);
          setOriginalEmail(authEmail.toLowerCase());
        }
      } catch (error) {
        if (!mounted) return;
        if (!email.trim()) {
          setFeedback(t('erstellen.authEmailLoadError', { error: error.message }));
        }
      }
    };

    hydrateDriver();
    return () => {
      mounted = false;
    };
  }, [isEditMode, initialDriver]);

  const createDriver = async () => {
    console.log('🚗 createDriver wurde aufgerufen');
    console.log('Daten:', { firstName, lastName, email, driverNumber, isEditMode });
    if (!firstName.trim() || !lastName.trim()) {
      setFeedback(t('erstellen.errorNameRequired'));
      return;
    }
    if (!isEditMode && !email.trim()) {
      setFeedback(t('erstellen.errorEmailRequired'));
      return;
    }
    if (!driverNumber.trim()) {
      setFeedback(t('erstellen.errorDriverNumberRequired'));
      return;
    }
    const parsedDriverNumber = Number(driverNumber);
    if (!Number.isInteger(parsedDriverNumber) || parsedDriverNumber <= 0) {
      setFeedback(t('erstellen.errorDriverNumberInvalid'));
      return;
    }

    setIsSubmitting(true);
    setFeedback('');

    const normalizedEmail = email.trim().toLowerCase();
    if (!isEditMode && !isValidEmailFormat(normalizedEmail)) {
      setFeedback(t('erstellen.errorEmailInvalid'));
      setIsSubmitting(false);
      return;
    }
    const emailForProfile = normalizedEmail || (isEditMode ? (originalEmail || null) : null);
    console.log('📝 Erstelle Profil-Payload...');
    const profilePayload = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: emailForProfile,
      phone: `${countryCode.trim()} ${phone.trim()}`.trim(),
      street: street.trim() || null,
      street_number: streetNumber.trim() || null,
      city: city.trim() || null,
      zip: zip.trim() || null,
      language: language || 'Deutsch',
      role: 'fahrer',
      is_dispo: false,
      vehicle_id: vehicleId || null,
      driver_number: parsedDriverNumber,
    };
    console.log('Profil-Payload:', profilePayload);

    try {
      if (isEditMode) {
        console.log('✏️  Edit-Modus: Aktualisiere bestehenden Fahrer...');
        const targetId = String(initialDriver?.id || '').trim();
        if (!targetId) throw new Error(t('erstellen.errorDriverIdMissing'));

        const updateProfile = async (client, payload) => {
          let nextPayload = payload;
          for (let i = 0; i < 2; i += 1) {
            const result = await client
              .from('profiles')
              .update(nextPayload)
              .eq('id', targetId)
              .select('id, first_name, last_name, phone, street, street_number, city, zip, language, vehicle_id, driver_number')
              .maybeSingle();
            if (!result.error) {
              if (!result.data?.id) {
                return new Error(t('erstellen.errorProfileNotUpdated'));
              }
              return null;
            }
            const missingEmailColumn = /column .*email|could not find the ['"]?email['"]? column/i.test(result.error.message || '');
            if (missingEmailColumn && Object.prototype.hasOwnProperty.call(nextPayload, 'email')) {
              const { email: _email, ...withoutEmail } = nextPayload;
              nextPayload = withoutEmail;
              continue;
            }
            return result.error;
          }
          return null;
        };

        const adminProfileError = await updateProfile(supabaseAdmin, profilePayload);
        if (adminProfileError) {
          const publicProfileError = await updateProfile(supabase, profilePayload);
          if (publicProfileError) {
            throw new Error(t('erstellen.errorSaveFailedAdminPublic', { admin: adminProfileError.message, public: publicProfileError.message }));
          }
        }

        console.log('✅ Fahrer erfolgreich aktualisiert!');
        setFeedback(t('erstellen.driverSaved'));
        setOriginalEmail(normalizedEmail || originalEmail);
        return;
      }

      console.log('➕ Erstelle neuen Fahrer...');
      let userId = null;
      let profileClient = supabaseAdmin;
      const redirectTo = resolveDriverPasswordSetupRedirect();

      const adminCreate = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
        redirectTo,
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          role: 'fahrer',
          password_setup_required: true,
        },
      });

      if (adminCreate.error) {
        if (/invalid format|unable to validate email address/i.test(adminCreate.error.message || '')) {
          throw new Error(t('erstellen.errorEmailInvalid'));
        }
        const jwtOrPermissionIssue = /invalid jwt|signature is invalid|user not allowed|not allowed/i.test(adminCreate.error.message || '');
        if (!jwtOrPermissionIssue) {
          throw new Error(t('erstellen.errorInviteMailFailed', { error: adminCreate.error.message }));
        }

        const fallbackCreate = await supabaseAdmin.auth.admin.createUser({
          email: normalizedEmail,
          email_confirm: true,
          user_metadata: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            role: 'fahrer',
            password_setup_required: true,
          },
        });
        if (fallbackCreate.error) {
          throw new Error(t('erstellen.errorAuthUserCreateFailed', { error: fallbackCreate.error.message }));
        }
        if (!fallbackCreate.data?.user?.id) {
          throw new Error(t('erstellen.errorAuthUserMissingId'));
        }
        userId = fallbackCreate.data.user.id;

        const resetEmail = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
        if (resetEmail.error) {
          throw new Error(t('erstellen.errorResetMailFailed', { error: resetEmail.error.message }));
        }
      } else {
        if (!adminCreate.data?.user?.id) {
          throw new Error(t('erstellen.errorAuthUserMissingId'));
        }
        userId = adminCreate.data.user.id;
      }

      if (!userId) {
        throw new Error(t('erstellen.errorAuthUserMissingId'));
      }

      const upsertProfile = async (client, row) => {
        let nextRow = row;
        for (let i = 0; i < 2; i += 1) {
          const result = await client.from('profiles').upsert([nextRow]);
          if (!result.error) return null;
          const missingEmailColumn = /column .*email|could not find the ['"]?email['"]? column/i.test(result.error.message || '');
          if (missingEmailColumn && Object.prototype.hasOwnProperty.call(nextRow, 'email')) {
            const { email: _email, ...withoutEmail } = nextRow;
            nextRow = withoutEmail;
            continue;
          }
          return result.error;
        }
        return null;
      };

      const upsertRow = { id: userId, ...profilePayload };
      let upsertError = await upsertProfile(profileClient, upsertRow);
      if (upsertError && profileClient === supabaseAdmin) {
        const shouldFallback = /invalid jwt|signature is invalid|not allowed|unauthorized/i.test(upsertError.message || '');
        if (shouldFallback) {
          upsertError = await upsertProfile(supabase, upsertRow);
        }
      }
      if (upsertError) throw upsertError;
      console.log('✅ Fahrer erfolgreich erstellt!');
      setFeedback(t('erstellen.driverCreatedInviteSent'));
      resetForm();
    } catch (error) {
      console.error('❌ Fehler beim Erstellen/Bearbeiten:', error);
      setFeedback(t('erstellen.driverSaveError', { error: error.message }));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Funktion zur Prüfung von doppelten Fahrernummern
  const checkDriverNumber = async (number) => {
    console.log('🔍 Prüfe Fahrernummer:', number);
    if (!number || isEditMode) {
      setDriverNumberWarning('');
      return;
    }

    const parsedNumber = Number(number);
    if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
      setDriverNumberWarning('');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, driver_number')
        .eq('driver_number', parsedNumber)
        .maybeSingle();

      if (error && !/does not exist|relation.*does not exist/i.test(error.message)) {
        // Nur echte Fehler loggen, nicht fehlende Tabelle oder Spalten
        console.warn('Fahrer-Prüfung fehlgeschlagen:', error);
        setDriverNumberWarning('');
        return;
      }

      if (data) {
        const existingName = [data.first_name, data.last_name].filter(Boolean).join(' ').trim();
        console.log('⚠️  Fahrernummer bereits vergeben:', parsedNumber, 'an', existingName);
        setDriverNumberWarning(t('erstellen.driverNumberTaken', { number: parsedNumber, name: existingName }));
      } else {
        console.log('✅ Fahrernummer verfügbar:', parsedNumber);
        setDriverNumberWarning('');
      }
    } catch (error) {
      console.warn('Fahrer-Prüfung fehlgeschlagen:', error);
      setDriverNumberWarning('');
    }
  };

  // Handler für Fahrernummer-Änderung
  const handleDriverNumberChange = (e) => {
    const value = e.target.value.replace(/[^\d]/g, '');
    setDriverNumber(value);
    
    // Debounced Check nach 500ms
    clearTimeout(handleDriverNumberChange.timeout);
    handleDriverNumberChange.timeout = setTimeout(() => {
      checkDriverNumber(value);
    }, 500);
  };

  return (
    <>
    <div
      className="h-dvh w-full bg-black overflow-y-auto overflow-x-hidden flex justify-center overscroll-none"
      style={{ WebkitTextSizeAdjust: 'none', WebkitOverflowScrolling: 'touch', textSizeAdjust: 'none', fontFamily: 'Space Grotesk, sans-serif' }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${BASE_HEIGHT * scale}px` }}>
        <div className="absolute left-0 top-0 w-[402px] origin-top-left" style={{ ...screenBg, transform: `scale(${scale})`, height: `${BASE_HEIGHT}px` }}>
          <BackCircleButton onClick={() => setView('alleFahrer')} className="absolute left-5 top-[60px]" />

          <div className="absolute left-0 top-[20px] w-[402px]">
            <h1 className="absolute left-5 top-[120px] text-[#e2f754] text-[42px] leading-[42px] tracking-[-0.5px] font-bold whitespace-nowrap">
              {isEditMode ? t('erstellen.driverEditTitle') : t('erstellen.driverCreateTitle')}
            </h1>

            <Box x={20} y={186} w={178}>
              <input
                ref={firstNameRef}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder={t('erstellen.firstName')}
                className={inputClass}
              />
              <button type="button" onClick={() => firstNameRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={204} y={186} w={178}>
              <input
                ref={lastNameRef}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder={t('erstellen.lastName')}
                className={inputClass}
              />
              <button type="button" onClick={() => lastNameRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={254} w={362}>
              <input
                ref={emailRef}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('erstellen.email')}
                readOnly={isEditMode}
                className="absolute left-10 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
              />
              <img src="/icon/_Icon_Lime/Mail_Trisar_Icons_01_Lime.svg" alt="" className="absolute left-3 top-1/2 -translate-y-1/2 w-[10px] h-[13px] scale-[1.2]" />
              <button type="button" onClick={() => emailRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={322} w={85}>
              <input
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                placeholder="+49"
                className="absolute left-4 right-2 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
              />
            </Box>

            <Box x={111} y={322} w={271}>
              <input
                ref={phoneRef}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('erstellen.phone')}
                className="absolute left-10 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
              />
              <img src="/icon/_Icon_Schwarz/contact-phone.svg" alt="" className="absolute left-3 top-1/2 -translate-y-1/2 w-[12px] h-[12px] object-contain" />
              <button type="button" onClick={() => phoneRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={390} w={271}>
              <input
                ref={streetRef}
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                placeholder={t('erstellen.street')}
                className="absolute left-4 right-12 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
              />
              <button type="button" onClick={() => streetRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={297} y={390} w={85}>
              <input
                ref={streetNumberRef}
                value={streetNumber}
                onChange={(e) => setStreetNumber(e.target.value)}
                placeholder={t('erstellen.number')}
                className="absolute left-4 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
              />
              <button type="button" onClick={() => streetNumberRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={458} w={362}>
              <input
                ref={cityRef}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={t('erstellen.city')}
                className="absolute left-4 right-12 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
              />
              <button type="button" onClick={() => cityRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={526} w={178}>
              <input
                ref={zipRef}
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder={t('erstellen.zip')}
                className="absolute left-4 right-12 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
              />
              <button type="button" onClick={() => zipRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={204} y={526} w={178} className="z-30">
              <button type="button" onClick={() => setShowLanguageMenu((v) => !v)} className="absolute inset-0 text-left">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium whitespace-nowrap">
                  {language || t('erstellen.language')}
                </span>
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#e3f654] text-[32px] leading-none font-bold">v</span>
              </button>
              {showLanguageMenu && (
                <div className="absolute left-0 right-0 top-[58px] bg-black border-2 border-[#e3f654] z-40 max-h-48 overflow-y-auto">
                  {LANGUAGE_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setLanguage(option);
                        setShowLanguageMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-[#8a9728] text-[16px]"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </Box>

            <Box x={20} y={594} w={271} className="z-20">
              <button type="button" onClick={() => setShowVehicleMenu((v) => !v)} className="absolute inset-0 text-left">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium whitespace-nowrap">
                  {loadingVehicles ? t('erstellen.vehiclesLoading') : selectedVehicleLabel}
                </span>
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#e3f654] text-[32px] leading-none font-bold">v</span>
              </button>
              {showVehicleMenu && (
                <div className="absolute left-0 right-0 top-[58px] bg-black border-2 border-[#e3f654] z-40 max-h-52 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setVehicleId('');
                      setShowVehicleMenu(false);
                    }}
                    className="w-full text-left px-4 py-2 text-[#8a9728] text-[16px]"
                  >
                    {t('erstellen.noVehicle')}
                  </button>
                  {vehicles.map((v) => {
                    const brandModel = String(v.brand_model || '').trim();
                    const plate = String(v.license_plate || '').trim();
                    const label = brandModel && plate ? `${brandModel} (${plate})` : brandModel || plate;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setVehicleId(v.id);
                          setShowVehicleMenu(false);
                        }}
                        className="w-full text-left px-4 py-2 text-[#8a9728] text-[16px]"
                      >
                        {label || t('erstellen.noPlate')}
                      </button>
                    );
                  })}
                </div>
              )}
            </Box>

            <Box x={297} y={594} w={85}>
              <input
                ref={driverNumberRef}
                value={driverNumber}
                onChange={handleDriverNumberChange}
                placeholder={t('erstellen.number')}
                className={`absolute left-4 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90 ${driverNumberWarning ? 'border-red-400' : ''}`}
              />
              <button type="button" onClick={() => driverNumberRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            {driverNumberWarning && (
              <div className="absolute left-5 top-[662px] w-[362px] px-3 py-1 text-[#ff9500] text-[12px] leading-[1.3] bg-[#2d1e00] border border-[#ff9500] rounded">
                {driverNumberWarning}
              </div>
            )}

            <button
              type="button"
              disabled={isSubmitting}
              onClick={createDriver}
              className={`absolute left-5 w-[362px] h-14 bg-[#dbee4a] disabled:opacity-70 ${driverNumberWarning ? 'top-[696px]' : 'top-[674px]'}`}
            >
              <span className="text-[#0e1008] text-[16px] leading-6 tracking-[0.5px] font-medium">
                {isSubmitting ? t('erstellen.saving') : (isEditMode ? t('erstellen.driverSave') : t('erstellen.driverCreateTitle'))}
              </span>
            </button>

            <div className={`absolute left-5 w-[362px] min-h-[56px] px-3 py-2 border border-[#7f8a2b] text-[#c8d85d] text-[12px] leading-[1.3] ${driverNumberWarning ? 'top-[764px]' : 'top-[742px]'}`}>
              {feedback || (isEditMode ? t('erstellen.driverEditHint') : t('erstellen.driverCreateHint'))}
            </div>

          </div>
        </div>
      </div>
    </div>
    {/* Footer fest am unteren Rand — ausserhalb des skalierten Inhalts, weil
        position: fixed sich sonst am transform-Elternteil ausrichten wuerde. */}
    <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-[70]" />
    </>
  );
}

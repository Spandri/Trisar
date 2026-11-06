import { useEffect, useRef, useState } from 'react';
import TrisarFooter from '../ui/TrisarFooter';
import BackCircleButton from '../ui/BackCircleButton';
import { supabase, supabaseAdmin } from '../../services/supabase';
import FahrerStunden from './FahrerStunden';
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

// Wie profiles_username_format in Migration 20261105150000_benutzername.
const isValidUsername = (value = '') => /^[a-z0-9._-]{3,32}$/.test(value);
const cleanUsername = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 32);

// Fehlercodes von dispo-admin in Text der Oberflaeche.
const kontoFehlerText = (code, t) => {
  if (/username_taken/.test(code)) return t('erstellen.errorUsernameTaken');
  if (/username_invalid/.test(code)) return t('erstellen.errorUsernameInvalid');
  if (/email_taken/.test(code)) return t('erstellen.errorEmailTaken');
  if (/email_invalid|invalid format|unable to validate email/i.test(code)) return t('erstellen.errorEmailInvalid');
  if (/password_too_short/.test(code)) return t('erstellen.errorPasswordShort');
  if (/password_missing/.test(code)) return t('erstellen.errorPasswordRequired');
  if (/login_missing/.test(code)) return t('erstellen.errorLoginRequired');
  if (/not_signed_in/.test(code)) return t('erstellen.errorSessionExpired');
  return t('erstellen.errorAccountFailed', { error: code });
};

const kontoAufruf = async (body) => {
  const antwort = await supabase.functions.invoke('dispo-admin', { body });
  if (!antwort.error) return { data: antwort.data, code: '' };
  const inhalt = await antwort.error.context?.json?.().catch(() => null);
  return { data: null, code: String(inhalt?.error || antwort.error.message || 'unknown') };
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
  // Konto: Benutzername + Passwort legt die Disposition selbst an (dispo-admin, konto_anlegen).
  const [username, setUsername] = useState('');
  const [originalUsername, setOriginalUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  // Ortung: 'app' = Handy-Standort aus der Fahrer-App, 'obd' = Tracker (IMEI) im Auto.
  const [trackingMode, setTrackingMode] = useState('app');
  const [trackerImei, setTrackerImei] = useState('');
  const [trackerList, setTrackerList] = useState([]);
  const [showTrackerMenu, setShowTrackerMenu] = useState(false);
  const [stundenOffen, setStundenOffen] = useState(false);
  const isEditMode = Boolean(initialDriver?.id);

  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const emailRef = useRef(null);
  const usernameRef = useRef(null);
  const passwordRef = useRef(null);
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

  // Bekannte Tracker (alle IMEIs, die schon einmal einem Fahrer zugeordnet waren).
  useEffect(() => {
    let mounted = true;
    const loadTrackers = async () => {
      try {
        const { data, error } = await supabase
          .from('imei_driver_map')
          .select('imei, driver_id, is_active, driver:driver_id(first_name, last_name)')
          .order('imei', { ascending: true });
        if (!mounted || error) return;
        setTrackerList(Array.isArray(data) ? data : []);
      } catch {
        // Tabelle fehlt (z.B. Demo): Liste bleibt leer, IMEI kann von Hand eingetragen werden.
      }
    };
    loadTrackers();
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
    setUsername('');
    setOriginalUsername('');
    setPassword('');
    setPasswordVisible(false);
    setTrackingMode('app');
    setTrackerImei('');
    setShowLanguageMenu(false);
    setShowVehicleMenu(false);
    setShowTrackerMenu(false);
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
      setUsername('');
      setOriginalUsername('');
      setPassword('');
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
        setTrackingMode(data.tracking_mode === 'obd' ? 'obd' : 'app');
        setUsername(String(data.username || ''));
        setOriginalUsername(String(data.username || ''));

        const trackerResult = await supabase
          .from('imei_driver_map')
          .select('imei')
          .eq('driver_id', initialDriver.id)
          .eq('is_active', true)
          .maybeSingle();
        if (!mounted) return;
        setTrackerImei(String(trackerResult.data?.imei || '').trim());
      } catch (error) {
        if (!mounted) return;
        setFeedback(t('erstellen.driverLoadError', { error: error.message }));
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
    const normalizedUsername = cleanUsername(username);
    if (!normalizedUsername && !email.trim() && !(isEditMode && originalEmail)) {
      setFeedback(t('erstellen.errorLoginRequired'));
      return;
    }
    if (normalizedUsername && !isValidUsername(normalizedUsername)) {
      setFeedback(t('erstellen.errorUsernameInvalid'));
      return;
    }
    if (!isEditMode && !password) {
      setFeedback(t('erstellen.errorPasswordRequired'));
      return;
    }
    if (password && password.length < 8) {
      setFeedback(t('erstellen.errorPasswordShort'));
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

    const normalizedImei = trackerImei.replace(/\D/g, '');
    if (trackingMode === 'obd' && !/^\d{15}$/.test(normalizedImei)) {
      setFeedback(t('erstellen.errorTrackerImei'));
      return;
    }

    setIsSubmitting(true);
    setFeedback('');

    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail && !isValidEmailFormat(normalizedEmail)) {
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
      ...(isEditMode ? {} : { role: 'fahrer', is_dispo: false }),
      username: normalizedUsername || null,
      vehicle_id: vehicleId || null,
      driver_number: parsedDriverNumber,
      tracking_mode: trackingMode,
    };
    console.log('Profil-Payload:', profilePayload);

    // Tracker-Zuordnung passend zur Ortung schreiben. Bei 'app' wird jeder Tracker des
    // Fahrers abgeschaltet, sonst schreiben Handy und Tracker abwechselnd den Standort.
    // Bei 'obd' bekommt der Fahrer genau diese IMEI. War sie bei jemand anderem, wandert sie mit.
    const saveTracker = async (driverId) => {
      const off = await supabase
        .from('imei_driver_map')
        .update({ is_active: false })
        .eq('driver_id', driverId)
        .neq('imei', trackingMode === 'obd' ? normalizedImei : '');
      if (off.error) throw off.error;
      if (trackingMode !== 'obd') return;
      const on = await supabase
        .from('imei_driver_map')
        .upsert([{ imei: normalizedImei, driver_id: driverId, is_active: true }], { onConflict: 'imei' });
      if (on.error) throw on.error;
    };

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

        // Login-Daten ueber dispo-admin, nur wenn sich etwas daran aendert.
        const kontoGeaendert = password
          || normalizedUsername !== originalUsername
          || (normalizedEmail && normalizedEmail !== originalEmail);
        if (kontoGeaendert) {
          const { code } = await kontoAufruf({
            aktion: 'konto_aendern',
            user_id: targetId,
            benutzername: normalizedUsername,
            email: normalizedEmail,
            ...(password ? { passwort: password } : {}),
          });
          if (code) throw new Error(kontoFehlerText(code, t));
          setOriginalUsername(normalizedUsername);
          setPassword('');
        }

        const adminProfileError = await updateProfile(supabaseAdmin, profilePayload);
        if (adminProfileError) {
          const publicProfileError = await updateProfile(supabase, profilePayload);
          if (publicProfileError) {
            throw new Error(t('erstellen.errorSaveFailedAdminPublic', { admin: adminProfileError.message, public: publicProfileError.message }));
          }
        }

        try {
          await saveTracker(targetId);
        } catch (trackerError) {
          throw new Error(t('erstellen.errorTrackerSave', { error: trackerError.message }));
        }

        console.log('✅ Fahrer erfolgreich aktualisiert!');
        setFeedback(t('erstellen.driverSaved'));
        setOriginalEmail(normalizedEmail || originalEmail);
        return;
      }

      console.log('➕ Erstelle neuen Fahrer...');
      let userId = null;
      let profileClient = supabaseAdmin;

      // Konto mit Passwort direkt anlegen, keine Einladungs-Mail. Admin-Schluessel bleibt auf dem Server.
      const konto = await kontoAufruf({
        aktion: 'konto_anlegen',
        benutzername: normalizedUsername,
        email: normalizedEmail,
        passwort: password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });
      if (konto.code) throw new Error(kontoFehlerText(konto.code, t));
      userId = konto.data?.user_id || null;

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
      try {
        await saveTracker(userId);
      } catch (trackerError) {
        throw new Error(t('erstellen.errorTrackerSave', { error: trackerError.message }));
      }
      console.log('✅ Fahrer erfolgreich erstellt!');
      setFeedback(t('erstellen.driverCreatedAccount'));
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
  // Platz fuer die Ortungs-Zeilen: Auswahl (68) plus bei OBD IMEI-Feld und Hinweiszeile (88).
  // Dazu die Konto-Zeile (Benutzername + Passwort, 68), die alles darunter nach unten schiebt.
  const trackingRowsHeight = (trackingMode === 'obd' ? 156 : 68) + 68;
  const contentHeight = BASE_HEIGHT + trackingRowsHeight;

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
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${contentHeight * scale}px` }}>
        <div className="absolute left-0 top-0 w-[402px] origin-top-left" style={{ ...screenBg, transform: `scale(${scale})`, height: `${contentHeight}px` }}>
          <BackCircleButton onClick={() => setView('alleFahrer')} className="absolute left-5 top-[60px]" />
          {/* Stunden des Fahrers: pruefen, Pausen planen, Excel */}
          {isEditMode ? (
            <button
              type="button"
              onClick={() => setStundenOffen(true)}
              data-tutorial="fahrer-stunden"
              className="absolute right-5 top-[66px] h-[38px] px-4 bg-[#E3F654] text-black text-[15px] font-bold z-10"
            >
              Stunden
            </button>
          ) : null}

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
                placeholder={t('erstellen.emailOptional')}
                type="email"
                autoComplete="off"
                className="absolute left-10 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
              />
              <img src="/icon/_Icon_Lime/Mail_Trisar_Icons_01_Lime.svg" alt="" className="absolute left-3 top-1/2 -translate-y-1/2 w-[10px] h-[13px] scale-[1.2]" />
              <button type="button" onClick={() => emailRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            {/* Konto: Benutzername + Passwort, damit sich der Fahrer nur noch anmelden muss */}
            <Box x={20} y={322} w={178}>
              <input
                ref={usernameRef}
                value={username}
                onChange={(e) => setUsername(cleanUsername(e.target.value))}
                placeholder={t('erstellen.username')}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="absolute left-4 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
              />
              <button type="button" onClick={() => usernameRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={204} y={322} w={178}>
              <input
                ref={passwordRef}
                type={passwordVisible ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEditMode ? t('erstellen.newPassword') : t('erstellen.password')}
                autoComplete="new-password"
                className="absolute left-4 right-10 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
              />
              <button
                type="button"
                onClick={() => setPasswordVisible((v) => !v)}
                aria-label={passwordVisible ? 'Passwort ausblenden' : 'Passwort anzeigen'}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5"
              >
                <img
                  src={passwordVisible ? '/icon/_Icon_Grau/Auge_geschlossen_Trisar_Icons_01_grau.svg' : '/icon/_Icon_Grau/Auge_offen_Trisar_Icons_01_grau.svg'}
                  alt=""
                  className="w-5 h-5 object-contain"
                />
              </button>
            </Box>

            <Box x={20} y={390} w={85}>
              <input
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                placeholder="+49"
                className="absolute left-4 right-2 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90"
              />
            </Box>

            <Box x={111} y={390} w={271}>
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

            <Box x={20} y={458} w={271}>
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

            <Box x={297} y={458} w={85}>
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

            <Box x={20} y={526} w={362}>
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

            <Box x={20} y={594} w={178}>
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

            <Box x={204} y={594} w={178} className="z-30">
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

            <Box x={20} y={662} w={271} className="z-20">
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

            <Box x={297} y={662} w={85}>
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

            {/* Ortung: Handy-App oder OBD-Tracker */}
            {[
              { mode: 'app', x: 20, label: t('erstellen.trackingApp') },
              { mode: 'obd', x: 204, label: t('erstellen.trackingObd') },
            ].map(({ mode, x, label }) => (
              <Box key={mode} x={x} y={730} w={178} className={trackingMode === mode ? 'bg-[#e3f654]' : ''}>
                <button
                  type="button"
                  onClick={() => {
                    setTrackingMode(mode);
                    setShowTrackerMenu(false);
                  }}
                  className="absolute inset-0 text-left"
                >
                  <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-[16px] leading-6 tracking-[0.5px] font-medium whitespace-nowrap ${trackingMode === mode ? 'text-[#0e1008]' : 'text-[#8a9728]'}`}>
                    {label}
                  </span>
                </button>
              </Box>
            ))}

            {trackingMode === 'obd' && (
              <Box x={20} y={798} w={362} className="z-20">
                <input
                  value={trackerImei}
                  onChange={(e) => setTrackerImei(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  onFocus={() => setShowTrackerMenu(false)}
                  inputMode="numeric"
                  placeholder={t('erstellen.trackerImei')}
                  className={inputClass}
                />
                {trackerList.length > 0 && (
                  <button type="button" onClick={() => setShowTrackerMenu((v) => !v)} className="absolute right-0 top-0 bottom-0 w-12">
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#e3f654] text-[32px] leading-none font-bold">v</span>
                  </button>
                )}
                {showTrackerMenu && (
                  <div className="absolute left-0 right-0 top-[58px] bg-black border-2 border-[#e3f654] z-40 max-h-52 overflow-y-auto">
                    {trackerList.map((tracker) => {
                      const owner = [tracker.driver?.first_name, tracker.driver?.last_name].filter(Boolean).join(' ').trim();
                      const isOwn = tracker.driver_id === initialDriver?.id;
                      const note = !tracker.is_active
                        ? t('erstellen.trackerFree')
                        : isOwn
                          ? t('erstellen.trackerThisDriver')
                          : owner;
                      return (
                        <button
                          key={tracker.imei}
                          type="button"
                          onClick={() => {
                            setTrackerImei(tracker.imei);
                            setShowTrackerMenu(false);
                          }}
                          className="w-full text-left px-4 py-2 text-[#8a9728] text-[16px]"
                        >
                          {tracker.imei}
                          {note ? <span className="text-[#c8d85d] text-[12px]"> · {note}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Box>
            )}

            {(() => {
              // Hinweis, wenn der gewaehlte Tracker gerade bei jemand anderem aktiv ist.
              if (trackingMode !== 'obd') return null;
              const taken = trackerList.find((tr) => tr.imei === trackerImei && tr.is_active && tr.driver_id !== initialDriver?.id);
              if (!taken) return null;
              const owner = [taken.driver?.first_name, taken.driver?.last_name].filter(Boolean).join(' ').trim();
              return (
                <div className="absolute left-5 top-[858px] w-[362px] text-[#ff9500] text-[12px] leading-[1.3]">
                  {t('erstellen.trackerMoves', { name: owner || '?' })}
                </div>
              );
            })()}

            {driverNumberWarning && (
              <div className="absolute left-5 w-[362px] px-3 py-1 text-[#ff9500] text-[12px] leading-[1.3] bg-[#2d1e00] border border-[#ff9500] rounded" style={{ top: `${662 + trackingRowsHeight}px` }}>
                {driverNumberWarning}
              </div>
            )}

            <button
              type="button"
              disabled={isSubmitting}
              onClick={createDriver}
              className="absolute left-5 w-[362px] h-14 bg-[#dbee4a] disabled:opacity-70"
              style={{ top: `${(driverNumberWarning ? 696 : 674) + trackingRowsHeight}px` }}
            >
              <span className="text-[#0e1008] text-[16px] leading-6 tracking-[0.5px] font-medium">
                {isSubmitting ? t('erstellen.saving') : (isEditMode ? t('erstellen.driverSave') : t('erstellen.driverCreateTitle'))}
              </span>
            </button>

            <div className="absolute left-5 w-[362px] min-h-[56px] px-3 py-2 border border-[#7f8a2b] text-[#c8d85d] text-[12px] leading-[1.3]" style={{ top: `${(driverNumberWarning ? 764 : 742) + trackingRowsHeight}px` }}>
              {feedback || (isEditMode ? t('erstellen.driverEditHint') : t('erstellen.driverCreateHint'))}
            </div>

          </div>
        </div>
      </div>
    </div>
    {/* Footer fest am unteren Rand — ausserhalb des skalierten Inhalts, weil
        position: fixed sich sonst am transform-Elternteil ausrichten wuerde. */}
    <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-[70]" />
    {stundenOffen ? (
      <FahrerStunden
        fahrer={{ id: initialDriver.id, name: `${firstName} ${lastName}`.trim() || 'Fahrer' }}
        schliessen={() => setStundenOffen(false)}
      />
    ) : null}
    </>
  );
}

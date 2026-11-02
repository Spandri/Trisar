import React, { useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from '../../services/supabase';
import TutorialVorschlagListe from './TutorialVorschlagListe';
import { tutorialLaeuft } from './demoDialoge';

const buildGuestFullName = (guest) =>
  [guest?.first_name, guest?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

const buildGuestSuggestionOptions = (guests = []) => {
  const options = new Set();
  guests.forEach((guest) => {
    const fullName = buildGuestFullName(guest);
    if (fullName) {
      options.add(fullName);
    }
  });
  return Array.from(options);
};

const vergleichbar = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ');

const FahrgastAutocomplete = ({
  value,
  onChange,
  placeholder = 'Fahrgast auswählen',
  className = '',
  style = {},
  disabled = false,
  onGuestSelect = null,
  ...inputProps
}) => {
  const [allGuests, setAllGuests] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  const timeoutRef = useRef(null);
  const inputRef = useRef(null);
  const [listeZu, setListeZu] = useState(false);
  const datalistId = useRef(`fahrgast-datalist-${Math.random().toString(36).slice(2)}`).current;
  const imTutorial = tutorialLaeuft();

  // Tutorial-Vorschlaege mit Gast-ID als Marker (siehe TutorialVorschlagListe).
  const tutorialEintraege = useMemo(() => {
    if (!imTutorial) return [];
    const suche = vergleichbar(value);
    if (!suche) return [];
    const eintraege = [];
    const gesehen = new Set();
    allGuests.forEach((guest) => {
      const label = buildGuestFullName(guest);
      if (!label || !guest?.id || gesehen.has(label)) return;
      if (!vergleichbar(label).includes(suche)) return;
      gesehen.add(label);
      eintraege.push({ key: String(guest.id), label, marker: `vorschlag-gast-${guest.id}`, guest });
    });
    if (eintraege.some((e) => vergleichbar(e.label) === suche)) return [];
    return eintraege.slice(0, 6);
  }, [imTutorial, value, allGuests]);

  useEffect(() => {
    let mounted = true;

    const loadGuests = async () => {
      setLoading(true);
      try {
        const result = await supabase
          .from('guests')
          .select('id, first_name, last_name')
          .order('first_name', { ascending: true })
          .order('last_name', { ascending: true });

        if (!mounted) return;

        if (result.error) {
          console.error('Fehler beim Laden der Fahrgäste:', result.error);
          return;
        }

        const guests = result.data || [];
        setAllGuests(guests);
        setSuggestions(buildGuestSuggestionOptions(guests));
      } catch (error) {
        console.error('Fehler beim Laden der Fahrgäste:', error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadGuests();

    return () => {
      mounted = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleInputChange = (e) => {
    const inputValue = e.target.value;
    setListeZu(false);
    onChange(inputValue);

    if (onGuestSelect && inputValue) {
      const selectedGuest = allGuests.find((guest) => {
        const fullName = buildGuestFullName(guest);
        return inputValue === fullName;
      });
      if (selectedGuest) {
        setTimeout(() => onGuestSelect(selectedGuest), 0);
      }
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        placeholder={loading ? 'Fahrgäste werden geladen...' : placeholder}
        disabled={disabled || loading}
        className={className}
        style={style}
        autoComplete="off"
        list={imTutorial ? undefined : datalistId}
        {...inputProps}
      />

      <TutorialVorschlagListe
        inputRef={inputRef}
        offen={imTutorial && !listeZu && tutorialEintraege.length > 0}
        eintraege={tutorialEintraege}
        onSchliessen={() => setListeZu(true)}
        onWahl={(eintrag) => {
          setListeZu(true);
          onChange(eintrag.label);
          if (onGuestSelect) setTimeout(() => onGuestSelect(eintrag.guest), 0);
        }}
      />

      <datalist id={datalistId}>
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>

      {loading && (
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#8a9728] border-t-transparent"></div>
        </div>
      )}
    </>
  );
};

export default FahrgastAutocomplete;

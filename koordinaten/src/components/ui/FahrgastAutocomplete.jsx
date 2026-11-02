import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../../services/supabase';

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
  const datalistId = useRef(`fahrgast-datalist-${Math.random().toString(36).slice(2)}`).current;

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
        type="text"
        value={value}
        onChange={handleInputChange}
        placeholder={loading ? 'Fahrgäste werden geladen...' : placeholder}
        disabled={disabled || loading}
        className={className}
        style={style}
        autoComplete="off"
        list={datalistId}
        {...inputProps}
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

import React, { useEffect, useState, useRef } from 'react';
import { supabase } from '../../services/supabase';

// Helper functions (aus koordinaten-app-lokal/src/App.jsx übernommen)
const buildDriverFullName = (profile) =>
  [profile?.first_name, profile?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim();

const _extractDriverNumberToken = (value) => {
  const match = String(value || '').match(/\d+/);
  return match ? match[0] : '';
};

const _normalizeLocation = (value) => {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // entfernt diakritische Zeichen
    .replace(/\s+/g, ' ');
};

const buildDriverSuggestionOptions = (profiles = []) => {
  const options = new Set();
  profiles.forEach((profile) => {
    const fullName = buildDriverFullName(profile);
    const driverNumber = profile?.driver_number == null ? '' : String(profile.driver_number).trim();

    if (fullName && driverNumber) {
      options.add(`${fullName} (${driverNumber})`);
      return;
    }
    if (fullName) {
      options.add(fullName);
      return;
    }
    if (driverNumber) {
      options.add(driverNumber);
    }
  });
  return Array.from(options);
};

const FahrerAutocomplete = ({ 
  value, 
  onChange, 
  placeholder = "Fahrer auswählen", 
  className = "",
  style = {},
  disabled = false,
  onDriverSelect = null, // callback mit dem ausgewählten Fahrer-Profile-Objekt
  ...inputProps 
}) => {
  const [allProfiles, setAllProfiles] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  
  const timeoutRef = useRef(null);
  const datalistId = useRef(`fahrer-datalist-${Math.random().toString(36).slice(2)}`).current;

  // Fahrer von der Datenbank laden
  useEffect(() => {
    let mounted = true;
    
    const loadDrivers = async () => {
      setLoading(true);
      try {
        // Versuche verschiedene SELECT-Varianten (für Kompatibilität)
        let result = await supabase
          .from('profiles')
          .select('id, first_name, last_name, driver_number, role, is_dispo')
          .order('driver_number', { ascending: true, nullsFirst: false });
        
        if (result.error && /driver_number/i.test(result.error.message || '')) {
          // Fallback ohne driver_number wenn Spalte nicht existiert
          result = await supabase
            .from('profiles')
            .select('id, first_name, last_name, role, is_dispo')
            .order('first_name', { ascending: true });
        }
        
        if (!mounted) return;
        
        if (result.error) {
          console.error('Fehler beim Laden der Fahrer:', result.error);
          return;
        }
        
        // Nur echte Fahrer, keine Dispatcher
        const drivers = (result.data || []).filter(profile => {
          const role = String(profile.role || '').trim().toLowerCase();
          const isDispoRole = ['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator'].includes(role);
          if (profile.is_dispo === true) return false;
          if (isDispoRole) return false;
          return true;
        });
        
        setAllProfiles(drivers);
        // Erstelle sofort alle Vorschläge für datalist
        const allSuggestions = buildDriverSuggestionOptions(drivers);
        setSuggestions(allSuggestions);
        
      } catch (error) {
        console.error('Fehler beim Laden der Fahrer:', error);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadDrivers();
    
    return () => {
      mounted = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleInputChange = (e) => {
    const inputValue = e.target.value;
    onChange(inputValue);
    
    // Callback für Fahrer-Auswahl
    if (onDriverSelect && inputValue) {
      const selectedProfile = allProfiles.find(profile => {
        const fullName = buildDriverFullName(profile);
        const driverNumber = String(profile?.driver_number || '');
        
        return inputValue.includes(fullName) || 
               inputValue.includes(driverNumber) ||
               inputValue === fullName ||
               inputValue === driverNumber;
      });
      
      if (selectedProfile) {
        // Delay um sicherzustellen dass onChange zuerst ausgeführt wird
        setTimeout(() => onDriverSelect(selectedProfile), 0);
      }
    }
  };

  return (
    <>
      <input
        type="text"
        value={value}
        onChange={handleInputChange}
        placeholder={loading ? "Fahrer werden geladen..." : placeholder}
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

export default FahrerAutocomplete;

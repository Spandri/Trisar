/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null); // 'driver', 'dispatcher', 'coordinator', 'guest'
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    // Check if user is already logged in
    const getSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setSession(session);
          setUser(session.user);
          // Hier später: Rolle aus DB abrufen basierend auf user.id
          setRole('driver'); // Default
        }
      } catch (error) {
        console.error('Session error:', error);
      } finally {
        setAuthLoading(false);
      }
    };

    getSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user || null);
        if (!session) setRole(null);
      }
    );

    return () => subscription?.unsubscribe();
  }, []);

  const login = async (email, password) => {
    setAuthError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setAuthError(error.message);
        return false;
      }
      return true;
    } catch (error) {
      setAuthError(error.message);
      return false;
    }
  };

  const logout = async () => {
    // Nur dieses Geraet abmelden. Standard waere 'global' und wuerde auch die Dispo-Sitzung
    // desselben Kontos auf anderen Geraeten killen (gleicher Account fuer Fahrer-App und Dispo).
await supabase.auth.signOut({ scope: 'local' });
    setRole(null);
  };

  return (
    <AuthContext.Provider value={{
      session,
      user,
      role,
      authLoading,
      authError,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

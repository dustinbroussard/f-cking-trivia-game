import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { onAuthStateChange } from '../services/auth';

export function useAuth() {
  const [user, setUser] = useState<any | null>(null);
  const [hasResolvedInitialAuthState, setHasResolvedInitialAuthState] = useState(false);

  useEffect(() => {
    const isMagicLink = 
      window.location.hash.includes('access_token=') || 
      window.location.hash.includes('type=magiclink') ||
      window.location.hash.includes('type=signup') ||
      window.location.search.includes('code=');
    console.debug('[useAuth] Mount. isMagicLink:', isMagicLink, 'Hash:', window.location.hash.substring(0, 20), 'Search:', window.location.search);

    const fetchSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('[useAuth] getSession error:', error.message);
        }
        
        const currentUser = session?.user ?? null;
        console.debug('[useAuth] getSession:', currentUser ? `Found user ${currentUser.id}` : 'No session');
        
        setUser(currentUser);

        // If it's a magic link, we might want to wait slightly for the onAuthStateChange event
        // which often follows a successful hash parsing.
        if (!currentUser && isMagicLink) {
          console.debug('[useAuth] Magic link detected but session not ready yet. Waiting...');
          // Don't resolve just yet
        } else {
          setHasResolvedInitialAuthState(true);
        }
      } catch (err) {
        console.error('[useAuth] fetchSession unexpected error:', err);
        setHasResolvedInitialAuthState(true);
      }
    };

    fetchSession();

    const subscription = onAuthStateChange((session) => {
      const currentUser = session?.user ?? null;
      console.debug('[useAuth] Auth state change. Event type?', !!session ? 'SIGNED_IN/PROCESSED' : 'SIGNED_OUT');
      setUser(currentUser);
      setHasResolvedInitialAuthState(true);
    });

    // Fallback: If after 5 seconds we still haven't resolved (maybe token was invalid)
    const timer = setTimeout(() => {
      setHasResolvedInitialAuthState((resolved) => {
        if (!resolved) {
          console.warn('[useAuth] Initial auth resolution timed out. Forcing resolution.');
          return true;
        }
        return resolved;
      });
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  return { user, hasResolvedInitialAuthState };
}

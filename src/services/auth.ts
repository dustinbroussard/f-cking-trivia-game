import { supabase } from '../lib/supabase';

function getOAuthRedirectUrl() {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export const signInWithMagicLink = async (email: string) => {
  const isLocal = window.location.hostname === 'localhost';
  const redirectTo = isLocal 
    ? 'http://localhost:3000/' 
    : 'https://a-fucking-trivia-game.vercel.app/';

  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true,
    },
  });
  if (error) throw error;
  return data;
};


export const signOutUser = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

export const onAuthStateChange = (callback: (user: any) => void) => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return subscription;
};

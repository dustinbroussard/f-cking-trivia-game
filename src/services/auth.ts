import { supabase } from '../lib/supabase';

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
  if (error) throw error;
}

export async function signOutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function onAuthStateChange(callback: (user: any) => void) {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return subscription;
}

// NEW: Password migration helper (optional)
export async function migratePassword(email: string, oldPassword: string, newPassword: string) {
  // This would require a custom endpoint or backend function
  // For now, implement forced reset strategy
  console.log('Password migration requires user reset');
}

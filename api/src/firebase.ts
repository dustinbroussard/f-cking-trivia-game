import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  UserCredential,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function getFirestoreErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isFirestoreQuotaExceeded(error: unknown) {
  return /\bquota\b|\bresource-exhausted\b|free daily read units|retry after quota limits are reset/i.test(
    getFirestoreErrorMessage(error)
  );
}

export function getFirestoreDisplayMessage(error: unknown, fallback: string) {
  if (isFirestoreQuotaExceeded(error)) {
    return 'Firestore quota is exhausted for today. Multiplayer, invites, history, and player stats are temporarily unavailable until the quota resets.';
  }

  return fallback;
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: getFirestoreErrorMessage(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

let signingIn = false;

let redirectResultPromise: Promise<UserCredential | null> | null = null;
let persistencePromise: Promise<void> | null = null;
let hasResolvedRedirectResult = false;

const REDIRECT_SIGN_IN_KEY = 'aftg:pending-google-redirect';

function rememberPendingRedirectSignIn() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(REDIRECT_SIGN_IN_KEY, '1');
  window.localStorage.setItem(REDIRECT_SIGN_IN_KEY, '1');
}

function clearPendingRedirectSignIn() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(REDIRECT_SIGN_IN_KEY);
  window.localStorage.removeItem(REDIRECT_SIGN_IN_KEY);
}

function hasPendingRedirectSignIn() {
  if (typeof window === 'undefined') return false;
  return (
    window.sessionStorage.getItem(REDIRECT_SIGN_IN_KEY) === '1' ||
    window.localStorage.getItem(REDIRECT_SIGN_IN_KEY) === '1'
  );
}

function ensureAuthPersistence() {
  if (!persistencePromise) {
    persistencePromise = setPersistence(auth, browserLocalPersistence).catch((error) => {
      persistencePromise = null;
      throw error;
    });
  }
  return persistencePromise;
}

export function finishSignInRedirect() {
  // Only process if there is a pending redirect sign-in
  if (!hasPendingRedirectSignIn()) {
    return Promise.resolve(null);
  }

  // If already processing a redirect result, return that promise
  if (redirectResultPromise) {
    return redirectResultPromise;
  }

  // Process the redirect result
  redirectResultPromise = ensureAuthPersistence()
    .then(() => getRedirectResult(auth))
    .finally(() => {
      clearPendingRedirectSignIn();
      hasResolvedRedirectResult = true;
      redirectResultPromise = null;
    });

  return redirectResultPromise;
}

const POPUP_FALLBACK_ERRORS = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/operation-not-supported-in-this-environment',
]);

export const signIn = async () => {
  if (signingIn) return null;
  signingIn = true;

  try {
    await ensureAuthPersistence();

    try {
      return await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (POPUP_FALLBACK_ERRORS.has(err?.code)) {
        rememberPendingRedirectSignIn();
        await signInWithRedirect(auth, googleProvider);
        return null;
      }
      throw err;
    }
  } catch (err: any) {
    throw err;
  } finally {
    signingIn = false;
  }
};

export const signOut = () => auth.signOut();

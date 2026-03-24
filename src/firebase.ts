import { initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
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

const REDIRECT_PENDING_STORAGE_KEY = 'aftg_auth_redirect_pending';

const canUseSessionStorage = () => typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';

const markRedirectPending = () => {
  if (!canUseSessionStorage()) return;
  window.sessionStorage.setItem(REDIRECT_PENDING_STORAGE_KEY, '1');
};

const clearRedirectPending = () => {
  if (!canUseSessionStorage()) return;
  window.sessionStorage.removeItem(REDIRECT_PENDING_STORAGE_KEY);
};

const hasPendingRedirect = () => {
  if (!canUseSessionStorage()) return false;
  return window.sessionStorage.getItem(REDIRECT_PENDING_STORAGE_KEY) === '1';
};

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

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
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
  throw new Error(JSON.stringify(errInfo));
}

let signingIn = false;

let redirectResultPromise: Promise<UserCredential | null> | null = null;

export function finishSignInRedirect() {
  if (!hasPendingRedirect()) {
    return Promise.resolve(null);
  }

  if (!redirectResultPromise) {
    redirectResultPromise = getRedirectResult(auth)
      .finally(() => {
        clearRedirectPending();
        redirectResultPromise = null;
      });
  }

  return redirectResultPromise;
}

const REDIRECT_FALLBACK_ERRORS = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/operation-not-supported-in-this-environment',
]);

const INTERNAL_ERROR_CODE = 'auth/internal-error';

export const signIn = async () => {
  if (signingIn) return null;
  signingIn = true;

  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err: any) {
    if (REDIRECT_FALLBACK_ERRORS.has(err?.code) || err?.code === INTERNAL_ERROR_CODE) {
      markRedirectPending();
      await signInWithRedirect(auth, googleProvider);
      return null;
    }

    throw err;
  } finally {
    signingIn = false;
  }
};
export const signOut = () => auth.signOut();

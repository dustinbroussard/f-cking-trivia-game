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
  if (!redirectResultPromise) {
    redirectResultPromise = getRedirectResult(auth).finally(() => {
      redirectResultPromise = null;
    });
  }

  return redirectResultPromise;
}

const POPUP_FALLBACK_ERRORS = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/operation-not-supported-in-this-environment',
]);

const REDIRECT_FALLBACK_ERRORS = new Set([
  'auth/internal-error',
]);

const shouldPreferRedirectSignIn = () => {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent || '';
  const isMobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const isSmallTouchScreen = window.matchMedia?.('(max-width: 1024px)').matches && 'ontouchstart' in window;

  return isMobileUserAgent || !!isSmallTouchScreen;
};

const isStandalonePwa = () => {
  if (typeof window === 'undefined') return false;

  const standaloneNavigator = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || standaloneNavigator);
};

export const signIn = async () => {
  if (signingIn) return null;
  signingIn = true;

  try {
    // Prefer popups for standard desktop browsers. Redirect is more reliable on mobile and in constrained browsers.
    const preferRedirect = shouldPreferRedirectSignIn() && !isStandalonePwa();

    if (preferRedirect) {
      try {
        await signInWithRedirect(auth, googleProvider);
        return null;
      } catch (err: any) {
        if (REDIRECT_FALLBACK_ERRORS.has(err?.code)) {
          return await signInWithPopup(auth, googleProvider);
        }
        throw err;
      }
    }

    try {
      return await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (POPUP_FALLBACK_ERRORS.has(err?.code)) {
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

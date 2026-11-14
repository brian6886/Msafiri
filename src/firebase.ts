import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
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
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Firestore connection failed: client appears offline. Check firebase-applet-config.json.');
      return false;
    }
    return true;
  }
}

export async function signInWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signUpWithEmail(
  fullName: string,
  email: string,
  password: string
): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (fullName.trim()) {
    await updateProfile(cred.user, { displayName: fullName.trim() });
  }
  await sendEmailVerification(cred.user).catch(() => {});
  return cred.user;
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export async function resendVerificationEmail(): Promise<void> {
  if (auth.currentUser) {
    await sendEmailVerification(auth.currentUser);
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export function formatFirebaseAuthError(err: unknown): {
  message: string;
  needsEmailProviderEnable: boolean;
} {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  const rawMsg = err instanceof Error ? err.message : String(err);

  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
    return {
      message:
        'Email/Password sign-in is not yet enabled in Firebase Authentication. Enable "Email/Password" in Firebase Console -> Authentication -> Sign-in method, or use Continue with Google.',
      needsEmailProviderEnable: true,
    };
  }
  if (code === 'auth/popup-blocked') {
    return {
      message: 'Browser blocked the Google sign-in popup. Allow popups for this site or sign in with Email/Password.',
      needsEmailProviderEnable: false,
    };
  }
  if (code === 'auth/popup-closed-by-user') {
    return {
      message: 'Google sign-in popup was closed before completing.',
      needsEmailProviderEnable: false,
    };
  }
  if (code === 'auth/email-already-in-use') {
    return {
      message: 'An account with this email already exists. Switch to Sign In.',
      needsEmailProviderEnable: false,
    };
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return {
      message: 'Incorrect email or password.',
      needsEmailProviderEnable: false,
    };
  }
  if (code === 'auth/weak-password') {
    return {
      message: 'Password must be at least 6 characters.',
      needsEmailProviderEnable: false,
    };
  }
  return {
    message: rawMsg || 'Authentication failed. Please try again.',
    needsEmailProviderEnable: false,
  };
}

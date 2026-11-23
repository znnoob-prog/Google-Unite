import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;

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

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/contacts.other.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/directory.readonly',
  'https://www.googleapis.com/auth/user.addresses.read',
  'https://www.googleapis.com/auth/user.birthday.read',
  'https://www.googleapis.com/auth/user.emails.read',
  'https://www.googleapis.com/auth/user.gender.read',
  'https://www.googleapis.com/auth/user.organization.read',
  'https://www.googleapis.com/auth/user.phonenumbers.read',
  'https://www.googleapis.com/auth/classroom.courses',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.announcements',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.rosters',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.topics',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  'https://www.googleapis.com/auth/classroom.profile.photos',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.students.readonly',
  'https://www.googleapis.com/auth/classroom.guardianlinks.me.readonly',
  'https://www.googleapis.com/auth/classroom.guardianlinks.students',
  'https://www.googleapis.com/auth/classroom.guardianlinks.students.readonly',
  'https://www.googleapis.com/auth/classroom.addons.student',
  'https://www.googleapis.com/auth/classroom.addons.teacher',
  'https://www.googleapis.com/auth/classroom.push-notifications',
];

export const ENTERPRISE_CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages',
];

export const ENTERPRISE_KEEP_SCOPES = [
  'https://www.googleapis.com/auth/keep',
  'https://www.googleapis.com/auth/keep.readonly',
];

// In-memory token storage ONLY (never localStorage or sessionStorage)
let cachedAccessToken: string | null = null;
let cachedEnterpriseChatToken: string | null = null;
let cachedEnterpriseKeepToken: string | null = null;

function buildWorkspaceProvider(
  includeEnterpriseChat = false,
  includeEnterpriseKeep = false
): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of WORKSPACE_SCOPES) {
    provider.addScope(scope);
  }
  if (includeEnterpriseChat) {
    for (const scope of ENTERPRISE_CHAT_SCOPES) {
      provider.addScope(scope);
    }
  }
  if (includeEnterpriseKeep) {
    for (const scope of ENTERPRISE_KEEP_SCOPES) {
      provider.addScope(scope);
    }
  }
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

export async function signInWithGoogleWorkspace(
  includeEnterpriseChat = false,
  includeEnterpriseKeep = false
): Promise<{
  user: User;
  accessToken: string | null;
  idToken: string;
}> {
  const provider = buildWorkspaceProvider(includeEnterpriseChat, includeEnterpriseKeep);
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    cachedAccessToken = credential.accessToken;
    if (includeEnterpriseChat) {
      cachedEnterpriseChatToken = credential.accessToken;
    }
    if (includeEnterpriseKeep) {
      cachedEnterpriseKeepToken = credential.accessToken;
    }
  }
  const idToken = await result.user.getIdToken();
  return {
    user: result.user,
    accessToken: cachedAccessToken,
    idToken,
  };
}

export async function signInBasicGoogle(): Promise<{
  user: User;
  idToken: string;
}> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (credential?.accessToken) {
    cachedAccessToken = credential.accessToken;
  }
  const idToken = await result.user.getIdToken();
  return { user: result.user, idToken };
}

export function getCachedAccessToken(): string | null {
  return cachedAccessToken;
}

export function getCachedEnterpriseChatToken(): string | null {
  return cachedEnterpriseChatToken;
}

export function getCachedEnterpriseKeepToken(): string | null {
  return cachedEnterpriseKeepToken;
}

export function clearMemoryTokens() {
  cachedAccessToken = null;
  cachedEnterpriseChatToken = null;
  cachedEnterpriseKeepToken = null;
}

export function subscribeToAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      clearMemoryTokens();
    }
    callback(user);
  });
}

export async function signOutUser() {
  clearMemoryTokens();
  await auth.signOut();
}

// ---- Firestore Real-Time Profile & Picker Bookmark Sync ----
export async function syncFirestoreUserProfile(
  user: User,
  theme: 'light' | 'dark' = 'light'
): Promise<void> {
  if (!user.emailVerified || !user.email) return;
  const path = `userProfiles/${user.uid}`;
  try {
    const ref = doc(db, 'userProfiles', user.uid);
    const snap = await getDocFromServer(ref).catch(() => null);
    if (snap && snap.exists()) {
      await setDoc(
        ref,
        {
          displayName: (user.displayName || '').slice(0, 120),
          theme,
          lastSyncedAt: new Date().toISOString().slice(0, 64),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      await setDoc(ref, {
        uid: user.uid,
        email: user.email.slice(0, 254),
        displayName: (user.displayName || '').slice(0, 120),
        theme,
        lastSyncedAt: new Date().toISOString().slice(0, 64),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export interface FirestorePickerBookmark {
  id: string;
  ownerId: string;
  fileId: string;
  name: string;
  mimeType: string;
  webViewLink: string;
}

export async function listFirestorePickerBookmarks(
  uid: string
): Promise<FirestorePickerBookmark[]> {
  const path = 'pickerBookmarks';
  try {
    const q = query(collection(db, path), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        ownerId: String(data.ownerId || ''),
        fileId: String(data.fileId || ''),
        name: String(data.name || ''),
        mimeType: String(data.mimeType || ''),
        webViewLink: String(data.webViewLink || ''),
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveFirestorePickerBookmark(
  uid: string,
  file: { id: string; name: string; mimeType?: string; url?: string }
): Promise<void> {
  const safeDocId = `${uid}_${file.id}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const path = `pickerBookmarks/${safeDocId}`;
  try {
    const ref = doc(db, 'pickerBookmarks', safeDocId);
    const existingSnap = await getDocFromServer(ref).catch(() => null);
    const safeUrl =
      file.url && file.url.startsWith('https://') ? file.url.slice(0, 1000) : '';
    if (existingSnap && existingSnap.exists()) {
      await setDoc(
        ref,
        {
          name: file.name.slice(0, 300) || 'Drive File',
          mimeType: (file.mimeType || '').slice(0, 160),
          webViewLink: safeUrl,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      await setDoc(ref, {
        ownerId: uid,
        fileId: file.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200),
        name: file.name.slice(0, 300) || 'Drive File',
        mimeType: (file.mimeType || '').slice(0, 160),
        webViewLink: safeUrl,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteFirestorePickerBookmark(bookmarkId: string): Promise<void> {
  const path = `pickerBookmarks/${bookmarkId}`;
  try {
    await deleteDoc(doc(db, 'pickerBookmarks', bookmarkId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

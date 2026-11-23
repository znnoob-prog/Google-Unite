/**
 * Phase 0 Dirty Dozen Security Test Specification for Google Unite Firestore Rules.
 * Verifies all 12 adversarial payloads against the Eight Pillars in firestore.rules.
 */
export interface AdversarialPayloadCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; emailVerified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: AdversarialPayloadCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Read',
    collectionPath: '/userProfiles/userA',
    operation: 'get',
    auth: null,
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Write',
    collectionPath: '/pickerBookmarks/bm1',
    operation: 'create',
    auth: { uid: 'userA', emailVerified: false },
    payload: { ownerId: 'userA', fileId: 'file1', name: 'Doc', mimeType: '', webViewLink: '' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-User Profile Read (PII)',
    collectionPath: '/userProfiles/userB',
    operation: 'get',
    auth: { uid: 'userA', emailVerified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Unscoped Collection List',
    collectionPath: '/pickerBookmarks',
    operation: 'list',
    auth: { uid: 'userA', emailVerified: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Identity Spoofing on Create',
    collectionPath: '/pickerBookmarks/bm2',
    operation: 'create',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userB', fileId: 'file1', name: 'Doc', mimeType: '', webViewLink: '' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Shadow Field Injection',
    collectionPath: '/userProfiles/userA',
    operation: 'create',
    auth: { uid: 'userA', emailVerified: true },
    payload: { uid: 'userA', email: 'a@example.com', displayName: 'A', theme: 'light', isAdmin: true },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Owner Mutation on Update',
    collectionPath: '/pickerBookmarks/bm1',
    operation: 'update',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userB' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'CreatedAt Mutation on Update',
    collectionPath: '/pickerBookmarks/bm1',
    operation: 'update',
    auth: { uid: 'userA', emailVerified: true },
    payload: { createdAt: '2020-01-01T00:00:00Z' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Client-Forged Timestamp on Create',
    collectionPath: '/pickerBookmarks/bm3',
    operation: 'create',
    auth: { uid: 'userA', emailVerified: true },
    payload: {
      ownerId: 'userA',
      fileId: 'file1',
      name: 'Doc',
      mimeType: '',
      webViewLink: '',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'ID Poisoning with Invalid Chars',
    collectionPath: '/pickerBookmarks/bad$id..hack',
    operation: 'create',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userA', fileId: 'file1', name: 'Doc', mimeType: '', webViewLink: '' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Value Poisoning Oversized Name',
    collectionPath: '/pickerBookmarks/bm4',
    operation: 'create',
    auth: { uid: 'userA', emailVerified: true },
    payload: { ownerId: 'userA', fileId: 'file1', name: 'x'.repeat(500), mimeType: '', webViewLink: '' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Admins Privilege Escalation Write',
    collectionPath: '/admins/userA',
    operation: 'create',
    auth: { uid: 'userA', emailVerified: true },
    payload: { role: 'admin' },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];

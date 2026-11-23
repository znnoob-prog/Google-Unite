# Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document in `/userProfiles/{userId}` and `/pickerBookmarks/{bookmarkId}` is strictly owned by a single verified Firebase Auth user (`request.auth.token.email_verified == true`). No blanket `isSignedIn()` reads or lists are permitted.
2. **Identity Integrity**:
   - `/userProfiles/{userId}`: `userId` path variable must equal `request.auth.uid`, and `incoming().uid == request.auth.uid`.
   - `/pickerBookmarks/{bookmarkId}`: `incoming().ownerId == request.auth.uid`, immutable on update.
3. **Immutable Fields**: `uid`, `ownerId`, and `createdAt` must never change after document creation.
4. **Temporal Integrity**: `createdAt` on create and `updatedAt` on create/update must strictly equal `request.time`.
5. **Path & Size Hardening**: All document IDs (`userId`, `bookmarkId`) and external IDs (`fileId`) must match `^[a-zA-Z0-9_\-]+$` with length <= 128 (<= 200 for `fileId`). Every string field has explicit `.size()` bounds.
6. **Zero Shadow Fields**: Create uses `keys().hasAll(...) && keys().hasOnly(...)`; updates use action-specific `affectedKeys().hasOnly(...)` gates.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Be Denied)
1. **Unauthenticated Read/Write**: `request.auth == null` reading `/userProfiles/user123` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: `request.auth.token.email_verified == false` creating `/pickerBookmarks/b1` -> `PERMISSION_DENIED`.
3. **Cross-User Profile Read (PII Leak)**: User A reading `/userProfiles/userB` -> `PERMISSION_DENIED`.
4. **Blanket Collection List**: User A listing `/pickerBookmarks` without `where('ownerId', '==', uid)` -> `PERMISSION_DENIED`.
5. **Identity Spoofing on Create**: User A creating `/pickerBookmarks/b1` with `ownerId: "userB"` -> `PERMISSION_DENIED`.
6. **Shadow Ghost Field Injection**: User A creating `/userProfiles/userA` with extra field `isAdmin: true` -> `PERMISSION_DENIED`.
7. **Owner Mutation on Update**: User A updating `/pickerBookmarks/b1` to change `ownerId` to `"userB"` -> `PERMISSION_DENIED`.
8. **CreatedAt Tampering on Update**: User A updating `/pickerBookmarks/b1` and modifying `createdAt` -> `PERMISSION_DENIED`.
9. **Client-Forged Timestamp**: User A creating `/pickerBookmarks/b1` with a hardcoded past timestamp instead of `request.time` -> `PERMISSION_DENIED`.
10. **ID Poisoning**: Creating `/pickerBookmarks/invalid..slash$id` or >128 char ID -> `PERMISSION_DENIED`.
11. **Value Poisoning (Oversized Name)**: Creating `/pickerBookmarks/b1` with a 5,000-char `name` string (>300 limit) -> `PERMISSION_DENIED`.
12. **Privilege Escalation via Admins Collection**: User A writing `/admins/userA` -> `PERMISSION_DENIED`.

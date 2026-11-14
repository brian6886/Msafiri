# Security Specification — Msafiri Kenyan Matatu Booking System

## 1. Data Invariants
1. **Identity Isolation**: Users can only read/write their own `/users/{userId}` document and cannot self-assign `'admin'` or `'operator'` roles.
2. **Admin Verification**: Admin privileges require either explicit existence in `/admins/{uid}` OR verified email (`email_verified == true`) matching the bootstrapped owner email `khaneribrian@gmail.com`.
3. **Immutable Ownership & Temporal Integrity**: Every `Booking` and `Parcel` binds `passengerUid` / `senderUid` to `request.auth.uid` on creation, forbids changing ownership on update, and enforces `createdAt == request.time` on create and `updatedAt == request.time` on update.
4. **Seat Reservation Monotonicity**: Authenticated verified passengers updating `/trips/{tripId}` to reserve seats may ONLY mutate `['bookedSeats', 'availableSeats', 'updatedAt']`, must preserve all previously booked seats (`incoming().bookedSeats.hasAll(existing().bookedSeats)`), and cannot drive `availableSeats` below `0`.
5. **Terminal State Locking**: Once a `Booking` reaches `'Boarded'` or `'Cancelled'`, or a `Parcel` reaches `'Collected'` or `'Cancelled'`, non-admin clients cannot mutate the record.
6. **No Shadow Fields**: Every collection uses strict `keys().hasAll(...)` and `keys().hasOnly(...)` validation helpers plus `isValidId()` path validation on single-document operations.
7. **Query Enforcement**: `allow list` on `/bookings`, `/parcels`, and `/users` explicitly evaluates `resource.data` against `request.auth.uid` or `isAdmin()`.

## 2. Dirty Dozen Attack Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Booking Create**: `passengerUid: "user1"` with `request.auth == null` -> DENIED.
2. **Identity Spoofing on Booking Create**: `request.auth.uid == "attacker"` creating booking with `passengerUid: "victim"` -> DENIED.
3. **Self-Role Escalation on User Profile**: User creating `/users/{uid}` with `role: "admin"` -> DENIED.
4. **Shadow Field Injection ("Ghost Field")**: Creating `/bookings/{id}` with extra field `isFreeOverride: true` -> DENIED by `hasOnly()`.
5. **Unverified Email Spoof**: Request with `email: "khaneribrian@gmail.com"` and `email_verified: false` attempting admin write -> DENIED.
6. **Cross-User PII Read**: User A requesting `get(/bookings/{userB_bookingId})` or `get(/users/{userB_uid})` -> DENIED.
7. **Blanket List Scraping**: User A querying `/bookings` without `where('passengerUid', '==', userA)` -> DENIED by `allow list` rule check.
8. **Seat Theft / Deletion on Trip**: Passenger updating `/trips/{tripId}` with `bookedSeats` removing an already-booked seat -> DENIED by `hasAll(existing().bookedSeats)`.
9. **Fare Manipulation on Trip Update**: Passenger updating `fareKes: 1` along with `bookedSeats` on `/trips/{tripId}` -> DENIED by `affectedKeys().hasOnly(['bookedSeats', 'availableSeats', 'updatedAt'])`.
10. **Terminal State Bypass**: Passenger modifying a `'Boarded'` booking back to `'Confirmed'` -> DENIED.
11. **ID Poisoning**: Creating `/bookings/` with 500-char ID or invalid characters `../admin` -> DENIED by `isValidId()`.
12. **Client Timestamp Forgery**: Creating booking with backdated `createdAt` instead of server `request.time` -> DENIED.

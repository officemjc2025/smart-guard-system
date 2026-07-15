# Smart Guard Authentication Fix (2026-07-14)

## Changes
- Switched production Google sign-in from popup to redirect to avoid COOP/window.closed popup failures.
- Completes and reports Firebase redirect-result errors during app initialization.
- Looks up active operator profiles by normalized `login_email` instead of assuming `users/{uid}`.
- Supports multiple active operator records sharing one Google login email.
- Keeps bootstrap creation restricted to `VITE_BOOTSTRAP_ADMIN_EMAIL` (and sandbox only in development).

## Required Firebase Console checks
1. Authentication > Sign-in method > Google: Enabled.
2. Authentication > Settings > Authorized domains: add the exact production hostname.
3. Firestore must contain active `users` records with lowercase `login_email` values.
4. Production environment must define `VITE_BOOTSTRAP_ADMIN_EMAIL=office.mjc2025@gmail.com` only if bootstrap is required.

## Verification
- `npm run lint`: passed.
- `npm run build`: passed.

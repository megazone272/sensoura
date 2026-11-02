# Firebase Authentication setup

SENSOURA supports public human sign-in with Email/Password, Google, and GitHub. Email/Password accounts must verify their address through Firebase's email action link before dashboard access. The backend trusts only Firebase Admin-verified ID tokens whose signed `email_verified` claim is true. Google and GitHub also require a provider-verified email. Known disposable-email domains are blocked on the frontend and backend, with an optional backend extension list; this is a best-effort denylist, not a guarantee against every temporary provider. A new account without an administrator-issued `role` custom claim receives `viewer` access, which permits dashboard reads only. Actuator commands and suggestion decisions require an `admin` or `operator` claim assigned through a trusted administrator process. The browser cannot choose or grant roles. Unknown roles and unapproved roleless providers are rejected. The ESP32 does not use Firebase Auth; it uses a separate device bearer credential on the backend HTTPS API.

## Configure Firebase providers and email links

Enable **Authentication → Sign-in method → Email/Password** and **Google** in Firebase Console. For GitHub, create an OAuth App under **GitHub Settings → Developer settings → OAuth Apps**. Set its Authorization callback URL to the exact Firebase OAuth redirect URI displayed in the GitHub provider setup. It normally has the form `https://<project-id>.firebaseapp.com/__/auth/handler`. Enter the GitHub OAuth Client ID and Client Secret in the Firebase GitHub provider settings, then save and enable the provider. Never put the GitHub Client Secret in the browser, source code, or a `VITE_*` variable.

In **Authentication → Templates → Email address verification**, confirm the template is enabled and customize the message if desired. Firebase sends and processes the verification action link; SENSOURA does not use Resend or require a custom sending domain for this flow. The web app calls Firebase Identity Toolkit with its public Web API key, but does not store a session for a password account until the user has clicked the verification link and signs in again.

Add each site hostname to **Firebase Authentication → Settings → Authorized domains**. For local development, add the exact host you use, such as `127.0.0.1` for `http://127.0.0.1:5173` or `localhost` for `http://localhost:5173`; these are distinct hosts. Add the production hostname before deploying. The verification link returns to the app's `/login?emailVerified=1` route after Firebase processes it.

Anyone may register with Email/Password, Google, or GitHub. Email/Password registration sends Firebase's verification link and does not store the Firebase session until the user returns and signs in with a verified ID token. The backend independently verifies Firebase ID tokens and requires the signed `email_verified` claim. New eligible accounts can read dashboard data as a Viewer, so do not enable public providers if the data must be restricted to invited users. Assign `admin` or `operator` only through trusted Firebase Admin code. For example, in a trusted one-off Node.js script:

```ts
import { getAuth } from 'firebase-admin/auth';

const auth = getAuth();
const uid = '<firebase-uid>';
const user = await auth.getUser(uid);
await auth.setCustomUserClaims(uid, { ...user.customClaims, role: 'operator' });
```

The supported human roles are `admin`, `operator`, and `viewer`. A missing role on an Email/Password, Google, or GitHub identity defaults to `viewer`; anonymous identities, roleless unapproved providers, and unknown role values are rejected. Never let the browser set custom claims. After changing a claim, sign out and sign in again so Firebase issues a token containing the new claim.

## Email verification and temporary-domain blocklist

Email/Password sign-up first creates the Firebase Auth account and then asks Firebase Identity Toolkit to send a `VERIFY_EMAIL` action link. If sending fails, the account may already exist but remains unverified and cannot access protected dashboard APIs. The sign-in screen can resend the Firebase link after authenticating the account; after clicking the link, return to the app and sign in to receive a fresh ID token with `email_verified: true`. Firebase's signed claim is verified server-side by Firebase Admin. No custom OTP claim is issued, and there is no Resend API key or sender configuration in this workflow.

The application contains a small built-in list of commonly used disposable-email domains. The frontend applies it before sign-up for immediate feedback; the backend applies it to every human ID token and is the security boundary. Extend the backend list with comma-separated `DISPOSABLE_EMAIL_DOMAINS` entries in `backend/.env` when needed. Keep any frontend additions in sync. Domain lists are inherently incomplete and change over time. A direct call to Firebase can still create an unverified Auth record; this policy prevents that account from accessing the SENSOURA backend, but does not promise to prevent every Firebase account record from being created. If preventing account creation itself becomes a requirement, add a server-side Firebase Auth blocking function or another server-controlled registration workflow.

## Configure frontend and backend

The frontend needs the public Firebase Web app values `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, and `VITE_FIREBASE_PROJECT_ID`. Put them in the ignored `frontend/.env.local` for local development. They are public browser configuration, not service-account credentials. Compose production builds also need those values available as build-time variables. The Firebase GitHub Client Secret stays only in Firebase Console.

Configure the backend with `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_URL`, and either a service-account JSON path (`FIREBASE_SERVICE_ACCOUNT_PATH`) or the service-account email/private key (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`). Application Default Credentials are also supported when project ID and database URL are set. Optionally add regional disposable providers to `DISPOSABLE_EMAIL_DOMAINS`, separated by commas. Keep service-account credentials in ignored `backend/.env`, a path outside the repository, or a managed secret store; never commit them or expose them to the frontend.

Set `FRONTEND_URL` to the comma-separated browser origins that will host the site, for example `https://dashboard.example.com,http://127.0.0.1:5173`. Provision the device separately: set a unique random `DEVICE_AUTH_TOKEN` of at least 32 characters and matching `DEVICE_ID` in `backend/.env`, then provision the same values in the ignored firmware `secrets.h`. See [container security deployment](../docker/SECURITY.md).

Production startup intentionally fails if Firebase Admin credentials, project ID, database URL, or the device token are missing or unusable. Keep Firebase Realtime Database rules deny-by-default for direct clients: the Admin SDK bypasses those rules, so the backend enforces authorization itself.

## Authorization boundary

The backend independently verifies Firebase ID tokens on protected REST requests and dashboard Socket.IO handshakes. Every supported identity must have a verified email, and Email/Password users become eligible only after following Firebase's verification link. Dashboard read endpoints permit recognized human roles, including the default Viewer role for approved public providers. Actuator commands and suggestion decisions require `admin` or `operator`. Device identities cannot read the dashboard API and are rejected from Socket.IO. The ESP32 can call only the separate token-protected device REST endpoints, which validate its identity, restrict telemetry fields and timestamps, scope commands to its device ID, and accept command results only for matching queued commands.

The access ID token is stored in browser local storage and the refresh token in session storage after a verified sign-in. A browser session ends when its session storage is cleared; the user must sign in again.

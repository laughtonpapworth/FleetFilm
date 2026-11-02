# Fleet Film – PWA (Firebase Auth + Firestore)

Installable website for the Fleet Film committee: collect films, vote, move them through the pipeline
and build the next programme. Designed for older users – large text, high contrast, big buttons.

## Releasing an update (important)
1. Change the files as needed.
2. **Bump the number in `version.json`** (e.g. `2026-11-02.1` → `2026-11-15.1`).
3. Deploy.

Anyone with the app open sees a **"A new version of Fleet Film is ready – Update now"** banner
(checked when the app is reopened and every 30 minutes). Everyone also has a manual
**⟳ Refresh app / Get latest version** button (top bar, phone "More" menu, Display settings, and the
sign-in screen), which clears the app's cache and reloads. No one needs to clear browser data.

The service worker (`sw.js`) is network-first: when online, pages always come from the server; the
cache is only used offline. The first time this version is deployed it also clears the old
`fleetfilm-v1` cache and reloads any page that the old worker had stuck on stale files.

## Pipeline statuses
`pending` → `in_progress` → `greenlist` → `next_programme` → `archived`, or `discarded` (with reason).

Each has its own page; the Film List shows all "active" films (everything except Discarded/Archived).

## Roles & permissions (`users/{uid}` in Firestore)
| Field | Effect |
|---|---|
| `role: "admin"` | Addresses page, Bulk TMDB re-fetch, Permanent Delete |
| `canDelete: true` | Permanent Delete button only (without full admin) |

To remove a user: delete their `users/{uid}` doc **and** delete/disable their account in
Firebase Console → Authentication, otherwise signing in again recreates the profile.

## Display settings (per device)
"Aa Display" (top bar, or phone More menu): text size Standard / Large / Extra large, and Dark / Light colours.
Stored in the browser, so each person sets it once on their own phone/tablet.

## Firebase setup
1. Firebase project with Authentication (Google + Email/Password) and Firestore.
2. Web app config in `js/firebase-config.js`.
3. Publish `firestore.rules`.
4. Add the hosting domain under Authentication → Authorized domains.

## Local test
Serve over `http://localhost` (e.g. `python -m http.server`), open `http://localhost:8000`.

## Data model
- `users/{uid}`: { displayName, email, role, canDelete?, lastLoginAt }
- `films/{id}`: { title, originalTitle, year, synopsis, runtimeMinutes, language, country, genre, director,
  ukAgeRating, distributor, whereToSee, notes, posterUrl, tmdbId, imdbID, status, discardedReason,
  greenAt, screenings[], programmeId, programmeDate, createdBy, createdAt }
- `films/{id}/votes/{uid}`: { value: 1 | 0 | -1, comment, voterName, updatedAt }
- `films/{id}/audit/{id}`: append-only history
- `programmes/{id}`, `locations/{id}`

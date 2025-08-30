# Fleet Film – PWA (Firebase Auth + Firestore)

Installable website for older users with big buttons and simple flows.
Features: Login, submit films, committee review, viewing + voting, final program. Works on phones and desktops.


## 1) Firebase setup
1. Create a Firebase project (https://console.firebase.google.com).
2. Enable **Authentication** → Sign-in methods:
   - Google (enabled)
   - Email/Password (enabled)
3. Enable **Firestore** (native mode).
4. Create a web app and copy the config into `js/firebase-config.js`.
5. Deploy Firestore rules: copy `firestore.rules` into the Rules tab and publish.

Optional: In Firestore → `users/{uid}`, set `role` to `committee` or `admin` for committee members.

## 2) Local test
You need to serve over **http://localhost** for service workers to work.
- Use any static server (e.g., VSCode Live Server, `python -m http.server`).
- Open `http://localhost:8000` (or whichever port).

## 3) GitHub Pages / static hosting
- Upload the folder to GitHub (or Netlify, Vercel).
- Update Firebase Auth → Authorized domains: add your GitHub Pages domain (e.g., `yourname.github.io`).

## 4) Using the app
- Sign in.
- **Submit**: add a film (title, optional year/distributor/link/synopsis, basic criteria checkbox).
- **Review** (committee/admin): mark basic criteria, screen/program, move to Voting or Archive.
- **Voting**: members vote (👎 / 👍 / ⭐). One vote per member per film.
- **Program**: committee/admin can mark films as **Selected** for the program.

## 5) Accessibility
- Large text, high-contrast, big buttons, keyboard focus outlines.
- Minimal screens, plain language.

## 6) Data model
- `users/{uid}`: { displayName, email, role }
- `films/{id}`: {
    title, year, distributor, link, synopsis,
    status: 'submitted' | 'reviewing' | 'voting' | 'selected' | 'archived',
    criteria: { basic_pass, screen_program_pass },
    createdBy, createdAt
  }
- `films/{id}/votes/{uid}`: { value: -1|1|2, createdAt }

## 7) Notes
- This is an MVP. We can add: vote tallies, CSV export, screening dates/venues, email invites, file uploads (posters), audit logs, etc.
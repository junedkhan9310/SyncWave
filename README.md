# SyncWave

Listen to music together, perfectly in sync. Create a room, share the 6-character
code, and everyone hears the same song at the same position — no accounts, no
installs, no backend server.

Pure HTML/CSS/vanilla JS. Realtime sync via **Firebase Realtime Database**.
File hosting via **Cloudinary** (unsigned uploads). Deploys as a static site
to **GitHub Pages**.

## How it works

- One person **creates a room** and becomes the **host**.
- Everyone else **joins** with the 6-character code.
- The host uploads MP3s, builds the playlist, and controls play/pause/seek/
  next/previous. Those actions write to Firebase.
- Every uploaded song is stored **once** in a global song library. Any room's
  host can reuse any previously-uploaded song without uploading it again —
  new rooms get instant access to everything that's ever been uploaded.
- Every other member listens to that same room and mirrors the host's state
  in their own `<audio>` element — including people who join mid-song, who
  sync to the current track and position automatically.
- Volume is local only; it's never written to Firebase.

## 1. Set up Firebase

1. Go to the [Firebase console](https://console.firebase.google.com/) and
   create a new project (Google Analytics is optional, skip it).
2. In the project, click **Build → Realtime Database → Create Database**.
   Start in **locked mode** — you'll paste in real rules next.
3. Open the **Rules** tab of the Realtime Database and paste the contents of
   [`database.rules.json`](./database.rules.json) from this repo, then
   **Publish**. This restricts playback control, uploads, and deletes to
   whoever is currently marked as the room's host.
4. Click **Build → Authentication → Get started**. Enable the
   **Anonymous** sign-in provider. (SyncWave uses anonymous auth purely to
   give each visitor a stable ID for the security rules above — no email or
   password is ever asked for.)
5. Go to **Project settings → General → Your apps**, click the web icon
   (`</>`) to register a web app, and copy the `firebaseConfig` object it
   gives you.
6. Paste those values into `firebase-config.js` in this repo (the
   `firebaseConfig` object).

## 2. Set up Cloudinary

1. Create a free account at [cloudinary.com](https://cloudinary.com/).
2. On your dashboard, copy your **Cloud name**.
3. Go to **Settings → Upload → Upload presets → Add upload preset**.
4. Set **Signing Mode** to **Unsigned**. This is what lets the browser
   upload files directly without ever touching your API Secret. Save the
   preset and copy its name.
5. Paste your cloud name and preset name into `firebase-config.js` in this
   repo (the `CLOUDINARY_CONFIG` object).

> **Never** put your Cloudinary API Secret anywhere in this project. The
> unsigned preset is the only credential the browser needs, and it can only
> create uploads — it can't read, delete, or manage your account.

## 3. Run it locally

Because the app uses `fetch`/modules-adjacent browser APIs, serve it over
HTTP rather than opening `index.html` directly as a `file://` URL:

```bash
# any static file server works, e.g.:
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed local URL in two browser windows to test sync.

## 4. Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a
   branch**, choose your default branch and the `/ (root)` folder, then
   save.
4. GitHub will publish the site at
   `https://<your-username>.github.io/<repo-name>/`. It can take a minute
   to go live after the first deploy.

That's it — no server, no build step.

## File overview

| File | Purpose |
|---|---|
| `index.html` | Markup for the landing view and the room view (single-page app, toggled via JS) |
| `style.css` | Dark, tuner-inspired theme; fully responsive |
| `firebase-config.js` | Where you paste your own Firebase + Cloudinary public config |
| `app.js` | All app logic: auth, room creation/joining, realtime sync engine, Cloudinary upload, playback controls |
| `database.rules.json` | Firebase Realtime Database security rules (host-only writes) |

## Data model

Songs are uploaded to Cloudinary **once** and stored **once** in a top-level
`songs` collection. Rooms never store song files or metadata directly — they
just hold a lightweight reference (`playlist/<songId>`) into that shared
collection. That means:

- Uploading the same MP3 again is never required — any host, in any room,
  can add any previously-uploaded song from the **Library** panel.
- A brand-new room starts with an empty *playlist*, but the full song
  *library* is available to add from immediately, with zero re-uploads.
- Deleting a song from a room's playlist just removes that room's
  reference — the song stays in the library for other rooms. Permanently
  deleting a song from the library (only available to whoever uploaded it)
  removes it everywhere.

```
songs/
  -Nabc123:
    name: "Song title"
    url: "https://res.cloudinary.com/..."
    duration: 214
    addedAt: <server timestamp>
    addedBy: "<uid of uploader>"

rooms/
  ROOM123/
    host: "<uid>"
    currentSongId: "-Nabc123" | null   # references songs/<id>
    baseTime: 0                        # seconds — playback position at updatedAt
    isPlaying: false
    updatedAt: <server timestamp>
    playlist:
      -Nabc123:
        addedAt: <server timestamp>    # when this room added the song, for ordering
    members:
      <uid>:
        name: "Nova"
        joinedAt: <server timestamp>
```

### Why `baseTime` + `updatedAt` instead of writing position every second?

Every client computes the "live" playback position as:

```
position = baseTime + (serverNow - updatedAt) / 1000   // while playing
position = baseTime                                     // while paused
```

This means the host only needs to write to Firebase on an actual action
(play, pause, seek, next, previous) rather than every second — and any
client, including one that joins mid-song, can compute exactly where
playback should be from a single read. Clients also self-correct for small
network jitter by comparing their local `<audio>` position to the computed
target every ~1.5s.

## Permissions

Only the host can: upload songs, add/remove songs from the room's playlist,
change the current song, play/pause, and seek. Deleting a song from the
*global library* permanently is restricted to whoever originally uploaded
it, since other rooms may still be using it. Everyone can: see the room, see
the playlist, and adjust their own local volume. If the host closes their
tab, the earliest-joined remaining member automatically becomes the new host
so the room doesn't get stuck.
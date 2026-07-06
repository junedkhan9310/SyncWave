/* =========================================================
   SyncWave — app.js
   Vanilla JS. No frameworks, no build step.
   ========================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------------
     Firebase init
  --------------------------------------------------------- */
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.database();

  let uid = null;
  let myName = "";
  let serverOffset = 0; // ms to add to Date.now() to approximate server time

  db.ref(".info/serverTimeOffset").on("value", (snap) => {
    serverOffset = snap.val() || 0;
  });

  function serverNow() {
    return Date.now() + serverOffset;
  }

  /* ---------------------------------------------------------
     DOM refs
  --------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);

  const viewLanding = $("view-landing");
  const viewRoom = $("view-room");

  const btnShowCreate = $("btn-show-create");
  const btnShowJoin = $("btn-show-join");
  const panelCreate = $("panel-create");
  const panelJoin = $("panel-join");
  const inputNameCreate = $("input-name-create");
  const inputNameJoin = $("input-name-join");
  const inputCodeJoin = $("input-code-join");
  const btnCreateConfirm = $("btn-create-confirm");
  const btnJoinConfirm = $("btn-join-confirm");
  const landingActions = document.querySelector(".landing-actions");

  const roomCodeDisplay = $("room-code-display");
  const roomCodeText = $("room-code-text");
  const livePill = $("live-pill");
  const btnLeave = $("btn-leave");

  const membersList = $("members-list");

  const discEl = $("disc");
  const dialProgress = $("dial-progress");
  const trackTitle = $("track-title");
  const trackSub = $("track-sub");
  const timeCurrent = $("time-current");
  const timeTotal = $("time-total");
  const seekBar = $("seek-bar");
  const btnPrev = $("btn-prev");
  const btnPlayPause = $("btn-playpause");
  const btnNext = $("btn-next");
  const iconPlay = $("icon-play");
  const iconPause = $("icon-pause");
  const volumeBar = $("volume-bar");
  const hostOnlyNote = $("host-only-note");

  const uploadWrap = $("upload-wrap");
  const fileUpload = $("file-upload");
  const uploadProgressWrap = $("upload-progress-wrap");
  const uploadProgressBar = $("upload-progress-bar");
  const uploadProgressLabel = $("upload-progress-label");
  const playlistList = $("playlist-list");
  const playlistEmpty = $("playlist-empty");

  const btnToggleLibrary = $("btn-toggle-library");
  const btnCloseLibrary = $("btn-close-library");
  const libraryPanel = $("library-panel");
  const libraryList = $("library-list");
  const libraryEmpty = $("library-empty");

  const audio = $("player");
  const toast = $("toast");

  const DIAL_CIRCUMFERENCE = 2 * Math.PI * 98; // matches r=98 in svg

  /* ---------------------------------------------------------
     Toast helper
  --------------------------------------------------------- */
  let toastTimer = null;
  function showToast(msg, type) {
    toast.textContent = msg;
    toast.className = "toast show" + (type ? " " + type : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.className = "toast";
    }, 3200);
  }

  /* ---------------------------------------------------------
     Local identity
  --------------------------------------------------------- */
  function loadSavedName() {
    return localStorage.getItem("syncwave_name") || "";
  }
  function saveName(name) {
    localStorage.setItem("syncwave_name", name);
  }

  const savedName = loadSavedName();
  if (savedName) {
    inputNameCreate.value = savedName;
    inputNameJoin.value = savedName;
  }

  /* ---------------------------------------------------------
     Landing view interactions
  --------------------------------------------------------- */
  btnShowCreate.addEventListener("click", () => {
    landingActions.classList.add("hidden");
    panelCreate.classList.remove("hidden");
    panelJoin.classList.add("hidden");
    inputNameCreate.focus();
  });

  btnShowJoin.addEventListener("click", () => {
    landingActions.classList.add("hidden");
    panelJoin.classList.remove("hidden");
    panelCreate.classList.add("hidden");
    inputNameJoin.focus();
  });

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      panelCreate.classList.add("hidden");
      panelJoin.classList.add("hidden");
      landingActions.classList.remove("hidden");
    });
  });

  inputCodeJoin.addEventListener("input", () => {
    inputCodeJoin.value = inputCodeJoin.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  btnCreateConfirm.addEventListener("click", () => {
    const name = inputNameCreate.value.trim() || "Host";
    saveName(name);
    myName = name;
    createRoom();
  });

  btnJoinConfirm.addEventListener("click", () => {
    const name = inputNameJoin.value.trim() || "Listener";
    const code = inputCodeJoin.value.trim().toUpperCase();
    if (code.length !== 6) {
      showToast("Enter the 6-character room code", "error");
      return;
    }
    saveName(name);
    myName = name;
    joinRoom(code);
  });

  [inputNameCreate].forEach((el) =>
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") btnCreateConfirm.click(); })
  );
  [inputCodeJoin, inputNameJoin].forEach((el) =>
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") btnJoinConfirm.click(); })
  );

  /* ---------------------------------------------------------
     Global song library
     Songs live at the top level (songs/<id>) so they're uploaded to
     Cloudinary exactly once and can be reused by any room without
     re-uploading. Rooms only store lightweight references to song ids.
  --------------------------------------------------------- */
  let latestSongsData = null;

  db.ref("songs").on("value", (snap) => {
    latestSongsData = snap.val() || {};
    // Re-render whatever's currently on screen — the library and any
    // room playlist both depend on this data.
    if (currentRoomCode && latestRoomData) {
      renderPlaylistAndTrack(latestRoomData, latestSongsData);
      renderLibrary();
    }
  });

  btnToggleLibrary.addEventListener("click", () => {
    libraryPanel.classList.toggle("hidden");
    if (!libraryPanel.classList.contains("hidden")) renderLibrary();
  });
  btnCloseLibrary.addEventListener("click", () => {
    libraryPanel.classList.add("hidden");
  });

  /* ---------------------------------------------------------
     Room code generation
  --------------------------------------------------------- */
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1 ambiguity
  function generateRoomCode() {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return code;
  }

  /* ---------------------------------------------------------
     Room state
  --------------------------------------------------------- */
  let currentRoomCode = null;
  let roomRef = null;
  let isHost = false;
  let latestRoomData = null;
  let seekBarIsDragging = false;
  let correctionInterval = null;
  let loadedSongId = null; // song id currently loaded into <audio>

  async function ensureAuth() {
    if (uid) return uid;
    return new Promise((resolve, reject) => {
      auth.onAuthStateChanged((user) => {
        if (user) {
          uid = user.uid;
          resolve(uid);
        }
      });
      auth.signInAnonymously().catch((err) => {
        console.error(err);
        showToast("Could not connect. Check your Firebase config.", "error");
        reject(err);
      });
    });
  }

  async function createRoom() {
    try {
      await ensureAuth();
      let code = generateRoomCode();
      // Extremely unlikely collision, but check anyway.
      for (let attempts = 0; attempts < 5; attempts++) {
        const snap = await db.ref("rooms/" + code).get();
        if (!snap.exists()) break;
        code = generateRoomCode();
      }

      await db.ref("rooms/" + code).set({
        host: uid,
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        currentSongId: null,
        baseTime: 0,
        isPlaying: false,
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
        playlist: {},
        members: {
          [uid]: {
            name: myName,
            joinedAt: firebase.database.ServerValue.TIMESTAMP
          }
        }
      });

      enterRoom(code);
    } catch (err) {
      console.error(err);
      showToast("Couldn't create room. Check console / Firebase config.", "error");
    }
  }

  async function joinRoom(code) {
    try {
      await ensureAuth();
      const snap = await db.ref("rooms/" + code).get();
      if (!snap.exists()) {
        showToast("Room not found. Check the code.", "error");
        return;
      }
      await db.ref(`rooms/${code}/members/${uid}`).set({
        name: myName,
        joinedAt: firebase.database.ServerValue.TIMESTAMP
      });
      enterRoom(code);
    } catch (err) {
      console.error(err);
      showToast("Couldn't join room. Check console / Firebase config.", "error");
    }
  }

  function enterRoom(code) {
    currentRoomCode = code;
    roomRef = db.ref("rooms/" + code);
    window.location.hash = "#/room/" + code;

    // Presence: remove self on disconnect.
    const memberRef = db.ref(`rooms/${code}/members/${uid}`);
    memberRef.onDisconnect().remove();

    viewLanding.classList.add("hidden");
    viewRoom.classList.remove("hidden");
    roomCodeText.textContent = code;

    roomRef.on("value", onRoomUpdate, (err) => {
      console.error(err);
      showToast("Lost connection to room.", "error");
    });

    if (!correctionInterval) {
      correctionInterval = setInterval(applyDriftCorrection, 1500);
    }
  }

  function leaveRoom() {
    if (roomRef && uid) {
      db.ref(`rooms/${currentRoomCode}/members/${uid}`).remove();
      roomRef.off("value", onRoomUpdate);
    }
    if (correctionInterval) {
      clearInterval(correctionInterval);
      correctionInterval = null;
    }
    audio.pause();
    audio.removeAttribute("src");
    loadedSongId = null;
    currentRoomCode = null;
    roomRef = null;
    latestRoomData = null;
    isHost = false;
    libraryPanel.classList.add("hidden");
    btnToggleLibrary.classList.add("hidden");
    window.location.hash = "";
    viewRoom.classList.add("hidden");
    viewLanding.classList.remove("hidden");
    panelCreate.classList.add("hidden");
    panelJoin.classList.add("hidden");
    landingActions.classList.remove("hidden");
  }

  btnLeave.addEventListener("click", leaveRoom);

  roomCodeDisplay.addEventListener("click", () => {
    if (!currentRoomCode) return;
    const url = window.location.origin + window.location.pathname + "#/room/" + currentRoomCode;
    navigator.clipboard?.writeText(url).then(
      () => showToast("Room link copied to clipboard", "success"),
      () => showToast("Room code: " + currentRoomCode)
    );
  });

  window.addEventListener("beforeunload", () => {
    if (roomRef && uid) db.ref(`rooms/${currentRoomCode}/members/${uid}`).remove();
  });

  /* ---------------------------------------------------------
     Deep link: #/room/CODE on load
  --------------------------------------------------------- */
  function handleInitialHash() {
    const match = window.location.hash.match(/^#\/room\/([A-Z0-9]{6})$/i);
    if (match) {
      const code = match[1].toUpperCase();
      const name = loadSavedName();
      inputCodeJoin.value = code;
      if (name) {
        myName = name;
        joinRoom(code);
      } else {
        landingActions.classList.add("hidden");
        panelJoin.classList.remove("hidden");
        inputNameJoin.focus();
      }
    }
  }

  /* ---------------------------------------------------------
     Room state → UI rendering
  --------------------------------------------------------- */
  function onRoomUpdate(snap) {
    const data = snap.val();
    if (!data) {
      showToast("This room no longer exists.", "error");
      leaveRoom();
      return;
    }
    latestRoomData = data;
    isHost = data.host === uid;

    maybeClaimHost(data);
    renderHostUI();
    renderMembers(data.members || {});
    renderPlaylistAndTrack(data, latestSongsData);
    renderLibrary();
    syncPlayback(data, latestSongsData);
  }

  // If the recorded host is no longer present in the room, the earliest-joined
  // remaining member promotes themself. Keeps rooms usable if a host drops.
  function maybeClaimHost(data) {
    const members = data.members || {};
    if (data.host && members[data.host]) return; // host still present
    const entries = Object.entries(members);
    if (entries.length === 0) return;
    entries.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
    const [earliestUid] = entries[0];
    if (earliestUid === uid) {
      db.ref(`rooms/${currentRoomCode}/host`).set(uid);
    }
  }

  function renderHostUI() {
    uploadWrap.classList.toggle("hidden", !isHost);
    btnToggleLibrary.classList.toggle("hidden", !isHost);
    if (!isHost) libraryPanel.classList.add("hidden");
    hostOnlyNote.classList.toggle("hidden", isHost);
    const hasPlaylist = latestRoomData && latestRoomData.playlist &&
      Object.keys(latestRoomData.playlist).length > 0;
    [btnPrev, btnPlayPause, btnNext].forEach((b) => {
      b.disabled = !isHost || !hasPlaylist;
    });
    seekBar.disabled = !isHost || !hasPlaylist;
  }

  function renderMembers(members) {
    membersList.innerHTML = "";
    const entries = Object.entries(members).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
    if (entries.length === 0) {
      membersList.innerHTML = '<li class="playlist-empty">No one here yet.</li>';
      return;
    }
    entries.forEach(([memberUid, m]) => {
      const li = document.createElement("li");
      li.className = "member-row" + (memberUid === uid ? " is-me" : "");
      const initial = (m.name || "?").trim().charAt(0).toUpperCase() || "?";
      li.innerHTML = `
        <span class="member-avatar">${escapeHtml(initial)}</span>
        <span class="member-name">${escapeHtml(m.name || "Listener")}${memberUid === uid ? " (you)" : ""}</span>
        ${memberUid === latestRoomData.host ? '<span class="host-badge">HOST</span>' : ""}
      `;
      membersList.appendChild(li);
    });
  }

  // Rooms only store references (playlist/<songId>: { addedAt }); the actual
  // song metadata (name/url/duration) lives once in the global `songs` node.
  function getOrderedPlaylist(roomData, songsData) {
    const refs = (roomData && roomData.playlist) || {};
    const songs = songsData || {};
    return Object.entries(refs)
      .map(([id, ref]) => {
        const song = songs[id];
        if (!song) return null; // song was deleted from the global library
        return { id, ...song, addedToRoomAt: ref && ref.addedAt };
      })
      .filter(Boolean)
      .sort((a, b) => (a.addedToRoomAt || 0) - (b.addedToRoomAt || 0));
  }

  function renderPlaylistAndTrack(data, songsData) {
    const songs = getOrderedPlaylist(data, songsData);
    playlistList.innerHTML = "";
    playlistEmpty.classList.toggle("hidden", songs.length > 0);

    songs.forEach((song, idx) => {
      const li = document.createElement("li");
      li.className = "track-row" + (song.id === data.currentSongId ? " is-current" : "");
      const durationLabel = song.duration ? formatTime(song.duration) : "--:--";

      const mainBtn = document.createElement("button");
      mainBtn.className = "track-row-main" + (isHost ? " clickable" : "");
      mainBtn.innerHTML = `
        <span class="track-row-title">${escapeHtml(song.name || "Untitled")}</span>
        <span class="track-row-sub">${durationLabel}</span>
      `;
      if (isHost) {
        mainBtn.addEventListener("click", () => selectSong(song.id));
      } else {
        mainBtn.disabled = true;
      }

      li.innerHTML = `<span class="track-row-index">${idx + 1}</span>`;
      li.appendChild(mainBtn);

      if (isHost) {
        const delBtn = document.createElement("button");
        delBtn.className = "track-row-delete";
        delBtn.setAttribute("aria-label", "Remove from this room's playlist");
        delBtn.title = "Remove from this room's playlist";
        delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7zm3-3h6l1 2H8l1-2z"/></svg>';
        delBtn.addEventListener("click", () => deleteSong(song.id));
        li.appendChild(delBtn);
      }

      playlistList.appendChild(li);
    });

    // Now-playing meta
    const current = songs.find((s) => s.id === data.currentSongId);
    if (current) {
      trackTitle.textContent = current.name || "Untitled";
      trackSub.textContent = isHost ? "You're hosting" : "Synced with host";
      timeTotal.textContent = current.duration ? formatTime(current.duration) : "--:--";
      seekBar.max = current.duration || 100;
    } else {
      trackTitle.textContent = "No track queued";
      trackSub.textContent = isHost ? "Upload a song or add one from the library" : "Waiting for the host to queue a song";
      timeTotal.textContent = "0:00";
      seekBar.value = 0;
    }
  }

  // The library panel lists every song ever uploaded (globally), regardless
  // of which room uploaded it, so hosts can build a playlist without
  // re-uploading anything.
  function renderLibrary() {
    if (!isHost) return;
    const songs = latestSongsData || {};
    const entries = Object.entries(songs).sort((a, b) => (b[1].addedAt || 0) - (a[1].addedAt || 0));
    const currentRefs = (latestRoomData && latestRoomData.playlist) || {};

    libraryList.innerHTML = "";
    libraryEmpty.classList.toggle("hidden", entries.length > 0);

    entries.forEach(([songId, song]) => {
      const li = document.createElement("li");
      li.className = "library-row";
      const durationLabel = song.duration ? formatTime(song.duration) : "--:--";

      const main = document.createElement("div");
      main.className = "library-row-main";
      main.innerHTML = `
        <span class="library-row-title">${escapeHtml(song.name || "Untitled")}</span>
        <span class="library-row-sub">${durationLabel}</span>
      `;
      li.appendChild(main);

      if (currentRefs[songId]) {
        const added = document.createElement("span");
        added.className = "library-row-added";
        added.textContent = "In playlist";
        li.appendChild(added);
      } else {
        const addBtn = document.createElement("button");
        addBtn.className = "library-row-add";
        addBtn.textContent = "+ Add";
        addBtn.addEventListener("click", () => addExistingSongToRoom(songId));
        li.appendChild(addBtn);
      }

      if (song.addedBy === uid) {
        const delBtn = document.createElement("button");
        delBtn.className = "library-row-delete";
        delBtn.setAttribute("aria-label", "Delete from library permanently");
        delBtn.title = "Delete from library permanently";
        delBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13H7L6 7zm3-3h6l1 2H8l1-2z"/></svg>';
        delBtn.addEventListener("click", () => removeSongFromLibrary(songId, song.name));
        li.appendChild(delBtn);
      }

      libraryList.appendChild(li);
    });
  }

  /* ---------------------------------------------------------
     Playback sync engine
  --------------------------------------------------------- */
  function computePosition(data) {
    if (!data.currentSongId) return 0;
    const base = data.baseTime || 0;
    if (data.isPlaying) {
      const elapsed = (serverNow() - (data.updatedAt || serverNow())) / 1000;
      return Math.max(0, base + elapsed);
    }
    return base;
  }

  function syncPlayback(data, songsData) {
    const songs = getOrderedPlaylist(data, songsData);
    const current = songs.find((s) => s.id === data.currentSongId);

    livePill.classList.toggle("paused", !data.isPlaying);
    $("live-pill-text").textContent = data.isPlaying ? "LIVE" : "PAUSED";

    if (!current) {
      audio.pause();
      audio.removeAttribute("src");
      loadedSongId = null;
      discEl.classList.remove("spinning");
      setDialProgress(0);
      updateTransportIcon(false);
      return;
    }

    const targetPos = computePosition(data);

    if (loadedSongId !== current.id) {
      loadedSongId = current.id;
      audio.src = current.url;
      const onReady = () => {
        audio.currentTime = targetPos;
        if (data.isPlaying) tryPlay();
        audio.removeEventListener("loadedmetadata", onReady);
      };
      audio.addEventListener("loadedmetadata", onReady);
      audio.load();
    } else {
      const drift = Math.abs(audio.currentTime - targetPos);
      if (drift > 0.75) audio.currentTime = targetPos;
      if (data.isPlaying && audio.paused) tryPlay();
      if (!data.isPlaying && !audio.paused) audio.pause();
    }

    discEl.classList.toggle("spinning", !!data.isPlaying);
    updateTransportIcon(!!data.isPlaying);
  }

  function applyDriftCorrection() {
    if (!latestRoomData || !latestRoomData.isPlaying || !loadedSongId) return;
    const targetPos = computePosition(latestRoomData);
    const drift = Math.abs(audio.currentTime - targetPos);
    if (drift > 0.75) audio.currentTime = targetPos;
  }

  let audioUnlockPromptShown = false;
  function tryPlay() {
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        if (!audioUnlockPromptShown) {
          audioUnlockPromptShown = true;
          showToast("Tap anywhere to enable audio playback");
          const unlock = () => {
            audio.play().catch(() => {});
            document.removeEventListener("click", unlock);
          };
          document.addEventListener("click", unlock, { once: true });
        }
      });
    }
  }

  function updateTransportIcon(playing) {
    iconPlay.classList.toggle("hidden", playing);
    iconPause.classList.toggle("hidden", !playing);
    btnPlayPause.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  function setDialProgress(ratio) {
    const offset = DIAL_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, ratio)));
    dialProgress.style.strokeDashoffset = offset;
  }

  // Drive the visible progress bar + dial off the local <audio> element,
  // since every client is actually playing the audio locally once synced.
  audio.addEventListener("timeupdate", () => {
    if (!seekBarIsDragging) {
      seekBar.value = audio.currentTime;
    }
    timeCurrent.textContent = formatTime(audio.currentTime);
    const dur = audio.duration || (seekBar.max ? Number(seekBar.max) : 0);
    setDialProgress(dur ? audio.currentTime / dur : 0);
  });

  audio.addEventListener("loadedmetadata", () => {
    if (audio.duration && isFinite(audio.duration)) {
      seekBar.max = audio.duration;
      timeTotal.textContent = formatTime(audio.duration);
    }
  });

  audio.addEventListener("ended", () => {
    if (isHost) goToRelativeSong(1, true);
  });

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ---------------------------------------------------------
     Host controls
  --------------------------------------------------------- */
  function requireHost() {
    if (!isHost) {
      showToast("Only the host can control playback", "error");
      return false;
    }
    return true;
  }

  btnPlayPause.addEventListener("click", () => {
    if (!requireHost() || !latestRoomData) return;
    const nowPlaying = !latestRoomData.isPlaying;
    roomRef.update({
      isPlaying: nowPlaying,
      baseTime: audio.currentTime || 0,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
  });

  btnNext.addEventListener("click", () => {
    if (!requireHost()) return;
    goToRelativeSong(1, true);
  });

  btnPrev.addEventListener("click", () => {
    if (!requireHost()) return;
    // If we're more than 3s into the track, "previous" restarts it (common UX);
    // otherwise it goes to the actual previous track.
    if (audio.currentTime > 3) {
      roomRef.update({
        baseTime: 0,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      });
    } else {
      goToRelativeSong(-1, true);
    }
  });

  function goToRelativeSong(direction, autoplay) {
    if (!latestRoomData) return;
    const songs = getOrderedPlaylist(latestRoomData, latestSongsData);
    if (songs.length === 0) return;
    const idx = songs.findIndex((s) => s.id === latestRoomData.currentSongId);
    let nextIdx;
    if (idx === -1) {
      nextIdx = 0;
    } else {
      nextIdx = (idx + direction + songs.length) % songs.length;
    }
    roomRef.update({
      currentSongId: songs[nextIdx].id,
      baseTime: 0,
      isPlaying: autoplay,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  function selectSong(songId) {
    if (!requireHost()) return;
    roomRef.update({
      currentSongId: songId,
      baseTime: 0,
      isPlaying: true,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  function deleteSong(songId) {
    if (!requireHost() || !latestRoomData) return;
    const updates = {};
    updates[`playlist/${songId}`] = null;
    if (latestRoomData.currentSongId === songId) {
      const songs = getOrderedPlaylist(latestRoomData, latestSongsData).filter((s) => s.id !== songId);
      updates.currentSongId = songs.length ? songs[0].id : null;
      updates.baseTime = 0;
      updates.isPlaying = false;
      updates.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    }
    roomRef.update(updates);
  }

  // Seek bar: only host can drag it.
  seekBar.addEventListener("pointerdown", () => { seekBarIsDragging = true; });
  seekBar.addEventListener("input", () => {
    if (!isHost) return;
    timeCurrent.textContent = formatTime(seekBar.value);
    const dur = Number(seekBar.max) || 1;
    setDialProgress(seekBar.value / dur);
  });
  seekBar.addEventListener("change", () => {
    seekBarIsDragging = false;
    if (!requireHost()) return;
    const target = Number(seekBar.value);
    audio.currentTime = target;
    roomRef.update({
      baseTime: target,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
  });

  // Volume is local-only — never written to Firebase.
  const savedVolume = localStorage.getItem("syncwave_volume");
  if (savedVolume !== null) {
    volumeBar.value = savedVolume;
    audio.volume = Number(savedVolume) / 100;
  } else {
    audio.volume = 0.8;
  }
  volumeBar.addEventListener("input", () => {
    audio.volume = Number(volumeBar.value) / 100;
    localStorage.setItem("syncwave_volume", volumeBar.value);
  });

  /* ---------------------------------------------------------
     Upload (host only) → Cloudinary → Firebase
  --------------------------------------------------------- */
  fileUpload.addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!isHost) {
      showToast("Only the host can upload songs", "error");
      return;
    }
    uploadToCloudinary(file);
  });

  function uploadToCloudinary(file) {
    if (!CLOUDINARY_CONFIG.cloudName || CLOUDINARY_CONFIG.cloudName.startsWith("YOUR_")) {
      showToast("Add your Cloudinary settings in firebase-config.js", "error");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", CLOUDINARY_CONFIG.uploadPreset);
    formData.append("resource_type", "video"); // Cloudinary routes audio through the video pipeline

    const xhr = new XMLHttpRequest();
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/video/upload`;

    uploadProgressWrap.classList.remove("hidden");
    uploadProgressBar.style.width = "0%";
    uploadProgressLabel.textContent = "Uploading… 0%";

    xhr.open("POST", url, true);

    xhr.upload.addEventListener("progress", (evt) => {
      if (evt.lengthComputable) {
        const pct = Math.round((evt.loaded / evt.total) * 100);
        uploadProgressBar.style.width = pct + "%";
        uploadProgressLabel.textContent = `Uploading… ${pct}%`;
      }
    });

    xhr.onload = () => {
      uploadProgressWrap.classList.add("hidden");
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          addUploadedSongToLibraryAndRoom({
            name: file.name.replace(/\.mp3$/i, ""),
            url: res.secure_url,
            duration: res.duration || null
          });
          showToast("Song added to library and playlist", "success");
        } catch (err) {
          console.error(err);
          showToast("Upload succeeded but response was invalid", "error");
        }
      } else {
        console.error(xhr.responseText);
        showToast("Upload failed. Check your Cloudinary preset.", "error");
      }
    };

    xhr.onerror = () => {
      uploadProgressWrap.classList.add("hidden");
      showToast("Upload failed. Check your connection.", "error");
    };

    xhr.send(formData);
  }

  // Uploading always creates a brand-new entry in the global `songs`
  // collection (uploaded to Cloudinary exactly once), then adds a
  // lightweight reference to it in the current room's playlist.
  function addUploadedSongToLibraryAndRoom(song) {
    const songRef = db.ref("songs").push();
    const payload = {
      name: song.name,
      url: song.url,
      duration: song.duration,
      addedAt: firebase.database.ServerValue.TIMESTAMP,
      addedBy: uid
    };
    songRef.set(payload).then(() => {
      addExistingSongToRoom(songRef.key);
    });
  }

  // Adds a reference to an already-uploaded (global) song into the current
  // room's playlist — no re-upload required. This is how new rooms, or any
  // room, get access to the shared song library.
  function addExistingSongToRoom(songId) {
    if (!requireHost() || !roomRef) return;
    db.ref(`rooms/${currentRoomCode}/playlist/${songId}`).set({
      addedAt: firebase.database.ServerValue.TIMESTAMP
    }).then(() => {
      // If nothing is queued yet, queue this song automatically.
      if (latestRoomData && !latestRoomData.currentSongId) {
        roomRef.update({
          currentSongId: songId,
          baseTime: 0,
          isPlaying: false,
          updatedAt: firebase.database.ServerValue.TIMESTAMP
        });
      }
    });
  }

  // Permanently deletes a song from the global library. Only the person who
  // uploaded it can do this (enforced both here and in the security rules),
  // since other rooms may still be referencing it.
  function removeSongFromLibrary(songId, name) {
    if (!latestSongsData || !latestSongsData[songId]) return;
    if (latestSongsData[songId].addedBy !== uid) {
      showToast("Only the uploader can delete this from the library", "error");
      return;
    }
    const ok = window.confirm(`Delete "${name || "this song"}" from the library permanently? It will disappear from every room using it.`);
    if (!ok) return;
    db.ref(`songs/${songId}`).remove();
  }

  /* ---------------------------------------------------------
     Boot
  --------------------------------------------------------- */
  ensureAuth().then(handleInitialHash).catch(() => {});
})();
/* ============================================================
   FÚTBOL SALA STATS - Los Yébenes FS
   ============================================================ */

// ─── Default roster ───
const DEFAULT_PLAYERS = [
    { name: 'Gonzalo', number: 23, isGoalkeeper: true },
    { name: 'Pablo', number: 13, isGoalkeeper: true },
    { name: 'Diego Jiménez', number: 16, isGoalkeeper: false },
    { name: 'Yordi', number: 10, isGoalkeeper: false },
    { name: 'Gabri', number: 21, isGoalkeeper: false },
    { name: 'Miguel', number: 6, isGoalkeeper: false },
    { name: 'Rayito', number: 7, isGoalkeeper: false },
    { name: 'Fran', number: 8, isGoalkeeper: false },
    { name: 'Mario', number: 9, isGoalkeeper: false },
    { name: 'Antonio', number: 12, isGoalkeeper: false },
    { name: 'Marcos', number: 14, isGoalkeeper: false },
    { name: 'Isi', number: 80, isGoalkeeper: false },
    { name: 'Raúl', number: 3, isGoalkeeper: false },
    { name: 'Alonso Rojo', number: 19, isGoalkeeper: false },
    { name: 'Juan', number: 11, isGoalkeeper: false },
    { name: 'Houssam', number: 20, isGoalkeeper: false },
    { name: 'Chicharro', number: 18, isGoalkeeper: false },
];

const PERIOD_SECONDS = 20 * 60; // 20 min per period
const PENALTY_SECONDS = 2 * 60; // 2 min sanción por expulsión
const PHOTO_SIZE = 120; // thumbnail px
const PHOTO_STORAGE_KEY = 'matchpulse_photos';
const MATCH_STORAGE_KEY = 'matchpulse_match';
const HISTORY_STORAGE_KEY = 'matchpulse_history';
const REPORTS_STORAGE_KEY = 'matchpulse_reports';

// ─── Photo storage (persists across sessions) ───
let playerPhotos = {}; // { "name-number": "data:image/jpeg;base64,..." }

function loadPhotos() {
    try {
        const stored = localStorage.getItem(PHOTO_STORAGE_KEY);
        if (stored) playerPhotos = JSON.parse(stored);
    } catch (e) { /* ignore */ }
}

function savePhotos() {
    try {
        localStorage.setItem(PHOTO_STORAGE_KEY, JSON.stringify(playerPhotos));
    } catch (e) { /* ignore */ }
}

function getPhotoKey(name, number) {
    return `${name}-${number}`;
}

function getPlayerPhoto(p) {
    return playerPhotos[getPhotoKey(p.name, p.number)] || null;
}

function handlePhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    resizeImage(file, PHOTO_SIZE, (dataUrl) => {
        // Show preview in modal
        const preview = document.getElementById('photo-preview');
        preview.innerHTML = `<img src="${dataUrl}" class="photo-img">`;
        preview.dataset.photoData = dataUrl;
    });
}

function resizeImage(file, maxSize, callback) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            // Crop to square from center
            const size = Math.min(img.width, img.height);
            const sx = (img.width - size) / 2;
            const sy = (img.height - size) / 2;
            canvas.width = maxSize;
            canvas.height = maxSize;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, sx, sy, size, size, 0, 0, maxSize, maxSize);
            callback(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function renderPhotoOrDorsal(p, cssClass) {
    const photo = getPlayerPhoto(p);
    if (photo) {
        return `<img src="${photo}" class="${cssClass}" alt="${p.name}">`;
    }
    return '';
}

// ─── Auto-save match state ───
function saveMatch() {
    if (!match) return;
    try {
        // Pause clock state for saving (we'll resume on load)
        const data = JSON.parse(JSON.stringify(match));
        data._savedAt = Date.now();
        data._clockWasRunning = match.clockRunning;
        localStorage.setItem(MATCH_STORAGE_KEY, JSON.stringify(data));
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(actionHistory));
    } catch (e) { /* ignore */ }
}

function loadMatch() {
    try {
        const stored = localStorage.getItem(MATCH_STORAGE_KEY);
        if (!stored) return null;
        const data = JSON.parse(stored);
        if (!data || !data.players) return null;
        return data;
    } catch (e) { return null; }
}

function clearSavedMatch() {
    try {
        localStorage.removeItem(MATCH_STORAGE_KEY);
        localStorage.removeItem(HISTORY_STORAGE_KEY);
    } catch (e) { /* ignore */ }
}

// ─── Reports history (finished matches) ───
function saveReport(matchData) {
    try {
        const reports = loadReports();
        const report = {
            id: Date.now(),
            date: new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }),
            myTeam: matchData.myTeam,
            rival: matchData.rival,
            myGoals: matchData.myGoals,
            rivalGoals: matchData.rivalGoals,
            rivalShotsOnTarget: matchData.rivalShotsOnTarget,
            rivalShotsOff: matchData.rivalShotsOff,
            players: matchData.players.map(p => ({
                name: p.name, number: p.number, isGoalkeeper: p.isGoalkeeper,
                stats: { ...p.stats }, courtTimeSeconds: p.courtTimeSeconds,
            })),
            goalLog: matchData.goalLog,
        };
        reports.unshift(report); // newest first
        // Keep max 50 reports
        if (reports.length > 50) reports.length = 50;
        localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports));
    } catch (e) { /* ignore quota errors */ }
}

function loadReports() {
    try {
        const stored = localStorage.getItem(REPORTS_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) { return []; }
}

function deleteReport(id) {
    try {
        const reports = loadReports().filter(r => r.id !== id);
        localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reports));
    } catch (e) { /* ignore */ }
}

// ─── State ───
let match = null;
let clockInterval = null;
let courtTimeInterval = null;
let selectedPlayerId = null;
let actionHistory = []; // for undo
let editingPlayerId = null;
let isHome = true; // true = local, false = visitante
let rivalCrestData = null; // data URL for rival crest image

// ─── DOM refs ───
const $ = id => document.getElementById(id);

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
    loadPhotos();
    bindSetupEvents();
    bindMatchEvents();
    bindSummaryEvents();

    // Check for saved match
    const saved = loadMatch();
    if (saved && saved.players && saved.players.length > 0) {
        // Determine which screen to restore
        const hasStarted = saved.players.some(p => p.onCourt);
        if (hasStarted) {
            match = saved;
            // Retrocompatibilidad con partidos guardados sin sanciones
            if (!Array.isArray(match.penalties)) match.penalties = [];
            if (typeof match.pendingReentries !== 'number') match.pendingReentries = 0;
            match.players.forEach(p => { if (typeof p.isExpelled !== 'boolean') p.isExpelled = false; });
            try {
                const hist = localStorage.getItem(HISTORY_STORAGE_KEY);
                if (hist) actionHistory = JSON.parse(hist);
            } catch (e) { /* ignore */ }

            // Show match screen
            $('setup-screen').classList.add('hidden');
            $('match-screen').classList.remove('hidden');
            document.querySelector('.scoreboard').classList.toggle('away-mode', !match.isHome);
            $('my-team-label').textContent = abbreviate(match.myTeam);
            $('rival-team-label').textContent = abbreviate(match.rival);
            $('rival-actions-label').textContent = match.rival;
            if (match.period >= 2) $('btn-period').textContent = '2T';
            match.clockRunning = false; // Always resume paused
            renderCourt();
            renderBench();
            renderActionHistory();
            updateScoreboard();
            updateClock();
            if (match.pendingReentries > 0) openReentryModal();
            return;
        }
    }

    initSetup();
});

// ============================================================
// SETUP SCREEN
// ============================================================

function initSetup() {
    match = createEmptyMatch();
    DEFAULT_PLAYERS.forEach(p => addPlayerToMatch(p.name, p.number, p.isGoalkeeper));
    renderPlayerList();
    renderSquadSelection();
    renderStarterSelection();
    renderReportsHistory();
}

function createEmptyMatch() {
    return {
        myTeam: 'Los Yébenes FS',
        rival: '',
        period: 1,
        clockRunning: false,
        remainingSeconds: PERIOD_SECONDS,
        myGoals: 0,
        rivalGoals: 0,
        rivalShotsOnTarget: 0,
        rivalShotsOff: 0,
        players: [],
        goalLog: [],
        nextPlayerId: 1,
        penalties: [],          // [{ id, remainingSeconds }] sanciones activas
        pendingReentries: 0,    // nº de huecos pendientes de rellenar tras cumplir sanción
    };
}

function makeEmptyStats() {
    return {
        goals: 0, assists: 0,
        shotsOnTarget: 0, shotsOff: 0,
        passes: 0, keyPasses: 0,
        foulsCommitted: 0, foulsReceived: 0,
        yellowCards: 0, redCards: 0,
        saves: 0,
    };
}

function addPlayerToMatch(name, number, isGoalkeeper) {
    match.players.push({
        id: match.nextPlayerId++,
        name, number, isGoalkeeper,
        onCourt: false,
        isStarter: false,
        isCalledUp: false,
        isExpelled: false,
        stats: makeEmptyStats(),
        courtTimeSeconds: 0,
        enteredAt: null,
    });
}

function renderPlayerList() {
    const container = $('player-list');
    container.innerHTML = match.players.map(p => {
        const photo = getPlayerPhoto(p);
        return `
        <div class="player-item" data-id="${p.id}">
            <div class="player-info">
                ${photo
                    ? `<div class="player-avatar-wrap">
                        <img src="${photo}" class="player-avatar">
                        <span class="dorsal-badge-sm">${p.number}</span>
                       </div>`
                    : `<span class="dorsal">${p.number}</span>`
                }
                <span class="player-name">${p.name}</span>
                ${p.isGoalkeeper ? '<span class="gk-badge">POR</span>' : ''}
            </div>
            <div class="player-item-actions">
                <button class="btn-edit" onclick="openEditPlayer(${p.id})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn-delete" onclick="removePlayer(${p.id})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>`;
    }).join('');
}

function renderSquadSelection() {
    const container = $('squad-selection');
    container.innerHTML = match.players.map(p => {
        const photo = getPlayerPhoto(p);
        return `
        <div class="starter-chip ${p.isCalledUp ? 'selected' : ''}" onclick="toggleCalledUp(${p.id})">
            ${photo
                ? `<div class="starter-avatar-wrap">
                    <img src="${photo}" class="starter-avatar">
                    <span class="dorsal-badge-xs">${p.number}</span>
                   </div>`
                : `<span class="dorsal-sm">${p.number}</span>`
            }
            <span>${p.name}</span>
            ${p.isGoalkeeper ? '<span class="gk-tag">POR</span>' : ''}
        </div>`;
    }).join('');
    updateSquadCount();
}

function toggleCalledUp(id) {
    const player = match.players.find(p => p.id === id);
    if (!player) return;
    if (player.isCalledUp) {
        player.isCalledUp = false;
        // Also remove from starters if was starter
        if (player.isStarter) {
            player.isStarter = false;
        }
    } else {
        player.isCalledUp = true;
    }
    renderSquadSelection();
    renderStarterSelection();
}

function updateSquadCount() {
    const count = match.players.filter(p => p.isCalledUp).length;
    $('squad-count').textContent = count;
}

function renderStarterSelection() {
    const container = $('starter-selection');
    const calledUp = match.players.filter(p => p.isCalledUp);

    if (calledUp.length === 0) {
        container.innerHTML = '<p class="reports-empty">Selecciona primero los convocados</p>';
        updateStarterCount();
        return;
    }

    container.innerHTML = calledUp.map(p => {
        const photo = getPlayerPhoto(p);
        return `
        <div class="starter-chip ${p.isStarter ? 'selected' : ''}" onclick="toggleStarter(${p.id})">
            ${photo
                ? `<div class="starter-avatar-wrap">
                    <img src="${photo}" class="starter-avatar">
                    <span class="dorsal-badge-xs">${p.number}</span>
                   </div>`
                : `<span class="dorsal-sm">${p.number}</span>`
            }
            <span>${p.name}</span>
            ${p.isGoalkeeper ? '<span class="gk-tag">POR</span>' : ''}
        </div>`;
    }).join('');
    updateStarterCount();
}

function toggleStarter(id) {
    const player = match.players.find(p => p.id === id);
    if (!player || !player.isCalledUp) return;
    const starterCount = match.players.filter(p => p.isStarter).length;
    if (player.isStarter) {
        player.isStarter = false;
    } else if (starterCount < 5) {
        player.isStarter = true;
    }
    renderStarterSelection();
}

function updateStarterCount() {
    const count = match.players.filter(p => p.isStarter).length;
    $('starter-count').textContent = `${count}/5`;
    $('btn-start-match').disabled = count !== 5;
}

function removePlayer(id) {
    match.players = match.players.filter(p => p.id !== id);
    renderPlayerList();
    renderSquadSelection();
    renderStarterSelection();
}

function resetPhotoPreview(photo) {
    const preview = $('photo-preview');
    delete preview.dataset.photoData;
    if (photo) {
        preview.innerHTML = `<img src="${photo}" class="photo-img">`;
    } else {
        preview.innerHTML = `
            <svg class="photo-placeholder-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            <span class="photo-hint">Foto</span>`;
    }
    $('photo-file-input').value = '';
}

function openEditPlayer(id) {
    const p = match.players.find(pl => pl.id === id);
    if (!p) return;
    editingPlayerId = id;
    $('modal-title').textContent = 'Editar jugador';
    $('player-name-input').value = p.name;
    $('player-number-input').value = p.number;
    $('player-gk-input').checked = p.isGoalkeeper;
    resetPhotoPreview(getPlayerPhoto(p));
    $('player-modal').classList.remove('hidden');
}

function openAddPlayer() {
    editingPlayerId = null;
    $('modal-title').textContent = 'Añadir jugador';
    $('player-name-input').value = '';
    $('player-number-input').value = '';
    $('player-gk-input').checked = false;
    resetPhotoPreview(null);
    $('player-modal').classList.remove('hidden');
}

function savePlayerModal() {
    const name = $('player-name-input').value.trim();
    const number = parseInt($('player-number-input').value, 10);
    const isGk = $('player-gk-input').checked;
    if (!name || isNaN(number)) return;

    // Save photo if one was selected
    const preview = $('photo-preview');
    if (preview.dataset.photoData) {
        playerPhotos[getPhotoKey(name, number)] = preview.dataset.photoData;
        savePhotos();
    }

    if (editingPlayerId) {
        const p = match.players.find(pl => pl.id === editingPlayerId);
        if (p) {
            p.name = name;
            p.number = number;
            p.isGoalkeeper = isGk;
        }
    } else {
        addPlayerToMatch(name, number, isGk);
    }

    $('player-modal').classList.add('hidden');
    renderPlayerList();
    renderSquadSelection();
    renderStarterSelection();
}

function bindSetupEvents() {
    $('btn-add-player').addEventListener('click', openAddPlayer);
    $('btn-modal-cancel').addEventListener('click', () => $('player-modal').classList.add('hidden'));
    $('btn-modal-save').addEventListener('click', savePlayerModal);
    $('btn-start-match').addEventListener('click', startMatch);

    $('btn-home-away').addEventListener('click', () => {
        isHome = !isHome;
        $('btn-home-away').querySelector('.ha-label').textContent = isHome ? 'LOCAL' : 'VISIT';
        $('btn-home-away').classList.toggle('away', !isHome);
    });

    // Rival crest upload
    $('rival-crest-btn').addEventListener('click', () => $('rival-crest-input').click());
    $('rival-crest-input').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        resizeImage(file, 120, (dataUrl) => {
            rivalCrestData = dataUrl;
            $('rival-crest-img').src = dataUrl;
            $('rival-crest-img').classList.remove('hidden');
            $('rival-crest-placeholder').classList.add('hidden');
        });
    });
}

// ============================================================
// MATCH SCREEN
// ============================================================

function startMatch() {
    match.myTeam = $('my-team-name').value.trim() || 'Mi equipo';
    match.rival = $('rival-name').value.trim() || 'Rival';

    // Remove non-called-up players from match
    match.players = match.players.filter(p => p.isCalledUp);

    // Set starters on court
    match.players.forEach(p => {
        if (p.isStarter) {
            p.onCourt = true;
            p.enteredAt = 0; // elapsed = 0 at start
        }
    });

    match.isHome = isHome;

    $('setup-screen').classList.add('hidden');
    $('match-screen').classList.remove('hidden');

    // Apply home/away order to scoreboard
    document.querySelector('.scoreboard').classList.toggle('away-mode', !match.isHome);

    // Labels
    $('my-team-label').textContent = abbreviate(match.myTeam);
    $('rival-team-label').textContent = abbreviate(match.rival);

    // Update rival actions label
    $('rival-actions-label').textContent = match.rival;

    // Update rival crest in scoreboard
    if (rivalCrestData) {
        const rivalCrestEl = document.querySelector('.sb-crest-rival');
        rivalCrestEl.innerHTML = `<img src="${rivalCrestData}" style="width:100%;height:100%;object-fit:contain;border-radius:50%;">`;
    }

    renderCourt();
    renderBench();
    renderActionHistory();
    updateScoreboard();
    updateClock();
    saveMatch();
}

function abbreviate(name) {
    if (name.length <= 4) return name.toUpperCase();
    // Use initials of each word (e.g. "Los Yébenes FS" → "LYF")
    const words = name.trim().split(/\s+/);
    if (words.length >= 2) {
        return words.map(w => w[0]).join('').toUpperCase();
    }
    return name.substring(0, 3).toUpperCase();
}

function getElapsed() {
    return PERIOD_SECONDS - match.remainingSeconds;
}

function getMinuteStr(elapsed) {
    const periodOffset = (match.period - 1) * 20;
    const totalMin = periodOffset + Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    return `${totalMin}:${String(sec).padStart(2, '0')}`;
}

// ─── Clock ───

function toggleClock() {
    if (match.clockRunning) {
        stopClock();
    } else {
        startClock();
    }
}

function startClock() {
    if (match.remainingSeconds <= 0) return;
    match.clockRunning = true;
    const playIcon = $('btn-clock-toggle').querySelector('.icon-play');
    const pauseIcon = $('btn-clock-toggle').querySelector('.icon-pause');
    if (playIcon) playIcon.classList.add('hidden');
    if (pauseIcon) pauseIcon.classList.remove('hidden');
    $('btn-clock-toggle').classList.add('active');
    $('clock-display').classList.add('running');

    clockInterval = setInterval(() => {
        match.remainingSeconds--;
        updateClock();

        // Update court time for players on court
        match.players.forEach(p => {
            if (p.onCourt) p.courtTimeSeconds++;
        });
        updateCourtTimes();

        // Decrementar sanciones activas
        if (match.penalties.length > 0) {
            match.penalties.forEach(pen => pen.remainingSeconds--);
            const expired = match.penalties.filter(p => p.remainingSeconds <= 0);
            if (expired.length > 0) {
                match.penalties = match.penalties.filter(p => p.remainingSeconds > 0);
                match.pendingReentries += expired.length;
                stopClock();
                renderCourt();
                renderBench();
                openReentryModal();
            } else {
                updatePenaltyCountdowns();
            }
        }

        // Auto-save every 10 seconds
        if (match.remainingSeconds % 10 === 0) saveMatch();

        if (match.remainingSeconds <= 0) {
            stopClock();
        }
    }, 1000);
}

function stopClock() {
    match.clockRunning = false;
    clearInterval(clockInterval);
    const playIcon = $('btn-clock-toggle').querySelector('.icon-play');
    const pauseIcon = $('btn-clock-toggle').querySelector('.icon-pause');
    if (playIcon) playIcon.classList.remove('hidden');
    if (pauseIcon) pauseIcon.classList.add('hidden');
    $('btn-clock-toggle').classList.remove('active');
    $('clock-display').classList.remove('running');
}

function updateClock() {
    const min = Math.floor(match.remainingSeconds / 60);
    const sec = match.remainingSeconds % 60;
    $('clock-display').textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

async function changePeriod() {
    if (match.period >= 2) return;
    const ok = await showConfirm('Cambio de periodo', '¿Pasar al 2º tiempo?');
    if (!ok) return;
    stopClock();
    match.period = 2;
    match.remainingSeconds = PERIOD_SECONDS;
    $('btn-period').textContent = '2T';
    updateClock();
    saveMatch();
}

function updateCourtTimes() {
    match.players.filter(p => p.onCourt).forEach(p => {
        const el = document.querySelector(`.court-card[data-id="${p.id}"] .card-time`);
        if (el) el.textContent = formatTime(p.courtTimeSeconds);
    });
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Court rendering ───

function renderCourt() {
    const container = $('court-players');
    const onCourt = match.players.filter(p => p.onCourt);
    const playerHtml = onCourt.map(p => {
        const photo = getPlayerPhoto(p);
        let avatarHtml;
        if (photo) {
            // Show photo as circular avatar + dorsal as badge overlay
            avatarHtml = `
                <div class="court-avatar-wrap">
                    <img src="${photo}" class="court-avatar">
                    <span class="court-dorsal-badge">${p.number}</span>
                </div>`;
        } else {
            // No photo: show dorsal large
            avatarHtml = `<span class="card-dorsal">${p.number}</span>`;
        }
        return `
        <div class="court-card ${selectedPlayerId === p.id ? 'selected' : ''}" data-id="${p.id}" onclick="selectPlayer(${p.id})">
            ${p.isGoalkeeper ? '<span class="card-gk">POR</span>' : ''}
            <button class="btn-sub" onclick="event.stopPropagation(); openSub(${p.id})" title="Sustituir">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            </button>
            ${avatarHtml}
            <span class="card-name">${p.name}</span>
            <span class="card-time">${formatTime(p.courtTimeSeconds)}</span>
            ${renderMiniStats(p)}
        </div>`;
    }).join('');

    // Huecos vacíos: sanciones activas (bloqueadas) + pendientes de reentrada
    let emptyHtml = '';
    match.penalties.forEach(pen => {
        const m = Math.floor(pen.remainingSeconds / 60);
        const s = pen.remainingSeconds % 60;
        emptyHtml += `
        <div class="court-card court-empty court-empty-locked">
            <svg class="empty-lock-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span class="empty-countdown">${m}:${String(s).padStart(2, '0')}</span>
            <span class="empty-label">Sanción</span>
        </div>`;
    });
    for (let i = 0; i < (match.pendingReentries || 0); i++) {
        emptyHtml += `
        <div class="court-card court-empty court-empty-ready" onclick="openReentryModal()">
            <span class="empty-plus">+</span>
            <span class="empty-label">Añadir jugador</span>
        </div>`;
    }

    container.innerHTML = playerHtml + emptyHtml;
}

function renderMiniStats(p) {
    const s = p.stats;
    let badges = '';
    if (s.goals) badges += `<span class="mini-stat goals">G${s.goals}</span>`;
    if (s.assists) badges += `<span class="mini-stat assists">A${s.assists}</span>`;
    if (s.saves) badges += `<span class="mini-stat saves">P${s.saves}</span>`;
    if (s.yellowCards) badges += `<span class="mini-stat yellows">&#128998;${s.yellowCards}</span>`;
    if (s.redCards) badges += `<span class="mini-stat reds">&#128997;${s.redCards}</span>`;
    return badges ? `<div class="card-stats">${badges}</div>` : '';
}

function renderBench() {
    const container = $('bench-players');
    const renderChip = (p, expelled) => {
        const photo = getPlayerPhoto(p);
        let avatarHtml;
        if (photo) {
            avatarHtml = `
                <div class="bench-avatar-wrap">
                    <img src="${photo}" class="bench-avatar">
                    <span class="dorsal-badge-xs">${p.number}</span>
                </div>`;
        } else {
            avatarHtml = `<span class="dorsal-sm">${p.number}</span>`;
        }
        if (expelled) {
            return `
            <div class="bench-chip bench-chip-expelled" title="Expulsado · no puede volver al partido">
                ${avatarHtml}
                <span>${p.name}</span>
                <span class="expelled-tag">EXP</span>
            </div>`;
        }
        return `
        <div class="bench-chip" onclick="quickSubIn(${p.id})">
            ${avatarHtml}
            <span>${p.name}</span>
            ${p.isGoalkeeper ? '<span class="gk-tag">POR</span>' : ''}
        </div>`;
    };
    const available = match.players.filter(p => !p.onCourt && !p.isExpelled).sort((a, b) => a.number - b.number);
    const expelled = match.players.filter(p => p.isExpelled).sort((a, b) => a.number - b.number);
    container.innerHTML = available.map(p => renderChip(p, false)).join('') +
                          expelled.map(p => renderChip(p, true)).join('');
}

// ─── Player selection ───

function selectPlayer(id) {
    if (selectedPlayerId === id) {
        selectedPlayerId = null;
        $('action-bar').classList.add('hidden');
    } else {
        selectedPlayerId = id;
        const p = match.players.find(pl => pl.id === id);
        $('selected-player-label').textContent = `#${p.number} ${p.name}`;
        $('action-bar').classList.remove('hidden');

        // Enable/disable save button based on goalkeeper
        const saveBtn = document.querySelector('.btn-save');
        saveBtn.disabled = !p.isGoalkeeper;
    }
    renderCourt();
}

// ─── Actions ───

function registerAction(action) {
    if (!selectedPlayerId) return;
    const player = match.players.find(p => p.id === selectedPlayerId);
    if (!player) return;

    const elapsed = getElapsed();
    const minuteStr = getMinuteStr(elapsed);
    const undoEntry = { playerId: player.id, action, minuteStr };

    switch (action) {
        case 'goal':
            player.stats.goals++;
            player.stats.shotsOnTarget++; // auto
            match.myGoals++;
            match.goalLog.push({
                minute: minuteStr,
                period: match.period,
                team: 'my',
                scorerName: `#${player.number} ${player.name}`,
                assistName: null,
                playersOnCourt: getPlayersOnCourtNames(),
            });
            flashCard(player.id, 'flash');
            break;

        case 'assist':
            player.stats.assists++;
            player.stats.passes++; // auto
            player.stats.keyPasses++; // auto
            flashCard(player.id, 'flash');
            break;

        case 'shotOn':
            player.stats.shotsOnTarget++;
            break;

        case 'shotOff':
            player.stats.shotsOff++;
            break;

        case 'keyPass':
            player.stats.keyPasses++;
            player.stats.passes++; // key pass is also a pass
            break;

        case 'foulCommitted':
            player.stats.foulsCommitted++;
            break;

        case 'foulReceived':
            player.stats.foulsReceived++;
            break;

        case 'yellowCard':
            player.stats.yellowCards++;
            flashCard(player.id, 'flash-red');
            // 2ª amarilla → expulsión automática
            if (player.stats.yellowCards >= 2 && !player.isExpelled) {
                expelPlayer(player, undoEntry);
            }
            break;

        case 'redCard':
            player.stats.redCards++;
            flashCard(player.id, 'flash-red');
            if (!player.isExpelled) {
                expelPlayer(player, undoEntry);
            }
            break;

        case 'save':
            if (player.isGoalkeeper) {
                player.stats.saves++;
            }
            break;
    }

    actionHistory.push(undoEntry);
    selectedPlayerId = null;
    $('action-bar').classList.add('hidden');
    renderCourt();
    renderBench();
    updateScoreboard();
    renderActionHistory();
    saveMatch();
}

// ─── Expulsiones y sanciones ───

function expelPlayer(player, undoEntry) {
    player.isExpelled = true;
    player.onCourt = false;
    player.enteredAt = null;
    match.penalties.push({
        id: Date.now() + Math.random(),
        remainingSeconds: PENALTY_SECONDS,
    });
    undoEntry.causedExpulsion = true;
    if (selectedPlayerId === player.id) {
        selectedPlayerId = null;
        $('action-bar').classList.add('hidden');
    }
}

function unexpelPlayer(player) {
    player.isExpelled = false;
    // Quitar la sanción más reciente o un pending reentry
    if (match.penalties.length > 0) {
        match.penalties.pop();
    } else if (match.pendingReentries > 0) {
        match.pendingReentries--;
    }
    // Si queda hueco en pista, devolverle a pista
    const onCourtCount = match.players.filter(p => p.onCourt).length;
    if (onCourtCount < 5) {
        player.onCourt = true;
        player.enteredAt = getElapsed();
    }
    // Cerrar modal si ya no hay pendientes
    if (match.pendingReentries === 0) {
        $('reentry-modal').classList.add('hidden');
    }
}

function openReentryModal() {
    if (!match || match.pendingReentries <= 0) return;
    const modal = $('reentry-modal');
    const list = $('reentry-list');
    const available = match.players
        .filter(p => !p.onCourt && !p.isExpelled)
        .sort((a, b) => a.number - b.number);

    if (available.length === 0) {
        list.innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:16px">Sin jugadores disponibles en el banquillo</p>';
    } else {
        list.innerHTML = available.map(p => `
            <button onclick="selectReentry(${p.id})">
                #${p.number} ${p.name} ${p.isGoalkeeper ? '(POR)' : ''}
            </button>
        `).join('');
    }

    const countEl = $('reentry-count');
    if (countEl) {
        countEl.textContent = match.pendingReentries > 1
            ? `Quedan ${match.pendingReentries} por entrar`
            : '';
    }
    modal.classList.remove('hidden');
}

function selectReentry(playerId) {
    const player = match.players.find(p => p.id === playerId);
    if (!player) return;
    player.onCourt = true;
    player.enteredAt = getElapsed();
    match.pendingReentries--;
    if (match.pendingReentries > 0) {
        openReentryModal(); // siguiente
    } else {
        $('reentry-modal').classList.add('hidden');
    }
    renderCourt();
    renderBench();
    saveMatch();
}

function updatePenaltyCountdowns() {
    document.querySelectorAll('.court-empty-locked').forEach((el, i) => {
        const pen = match.penalties[i];
        if (!pen) return;
        const m = Math.floor(pen.remainingSeconds / 60);
        const s = pen.remainingSeconds % 60;
        const cd = el.querySelector('.empty-countdown');
        if (cd) cd.textContent = `${m}:${String(s).padStart(2, '0')}`;
    });
}

function registerRivalAction(action) {
    const elapsed = getElapsed();
    const minuteStr = getMinuteStr(elapsed);

    switch (action) {
        case 'rival-goal':
            match.rivalGoals++;
            match.rivalShotsOnTarget++; // goal = shot on target
            match.goalLog.push({
                minute: minuteStr,
                period: match.period,
                team: 'rival',
                scorerName: null,
                assistName: null,
                playersOnCourt: getPlayersOnCourtNames(),
            });
            // Regla FIFA: gol del rival cancela la sanción más antigua
            if (match.penalties.length > 0) {
                match.penalties.shift();
                match.pendingReentries++;
                stopClock();
                renderCourt();
                renderBench();
                openReentryModal();
            }
            break;
        case 'rival-shot-on':
            match.rivalShotsOnTarget++;
            break;
        case 'rival-shot-off':
            match.rivalShotsOff++;
            break;
    }

    actionHistory.push({ playerId: null, action, minuteStr });
    updateScoreboard();
    renderActionHistory();
    saveMatch();
}

function getPlayersOnCourtNames() {
    return match.players.filter(p => p.onCourt).map(p => `#${p.number} ${p.name}`);
}

function flashCard(playerId, cls) {
    const card = document.querySelector(`.court-card[data-id="${playerId}"]`);
    if (!card) return;
    card.classList.remove('flash', 'flash-red');
    void card.offsetWidth; // force reflow
    card.classList.add(cls);
}

function updateScoreboard() {
    $('my-score').textContent = match.myGoals;
    $('rival-score').textContent = match.rivalGoals;
}

// ─── Undo ───

function undoLastAction() {
    if (actionHistory.length === 0) return;
    const last = actionHistory.pop();

    if (last.playerId) {
        const player = match.players.find(p => p.id === last.playerId);
        if (!player) return;

        switch (last.action) {
            case 'goal':
                player.stats.goals--;
                player.stats.shotsOnTarget--;
                match.myGoals--;
                // Remove last goal log entry for my team
                for (let i = match.goalLog.length - 1; i >= 0; i--) {
                    if (match.goalLog[i].team === 'my') {
                        match.goalLog.splice(i, 1);
                        break;
                    }
                }
                break;
            case 'assist':
                player.stats.assists--;
                player.stats.passes--;
                player.stats.keyPasses--;
                break;
            case 'shotOn':
                player.stats.shotsOnTarget--;
                break;
            case 'shotOff':
                player.stats.shotsOff--;
                break;
            case 'keyPass':
                player.stats.keyPasses--;
                player.stats.passes--;
                break;
            case 'foulCommitted':
                player.stats.foulsCommitted--;
                break;
            case 'foulReceived':
                player.stats.foulsReceived--;
                break;
            case 'yellowCard':
                player.stats.yellowCards--;
                if (last.causedExpulsion) unexpelPlayer(player);
                break;
            case 'redCard':
                player.stats.redCards--;
                if (last.causedExpulsion) unexpelPlayer(player);
                break;
            case 'save':
                player.stats.saves--;
                break;
        }
    } else {
        switch (last.action) {
            case 'rival-goal':
                match.rivalGoals--;
                match.rivalShotsOnTarget--;
                for (let i = match.goalLog.length - 1; i >= 0; i--) {
                    if (match.goalLog[i].team === 'rival') {
                        match.goalLog.splice(i, 1);
                        break;
                    }
                }
                break;
            case 'rival-shot-on':
                match.rivalShotsOnTarget--;
                break;
            case 'rival-shot-off':
                match.rivalShotsOff--;
                break;
        }
    }

    renderCourt();
    renderBench();
    updateScoreboard();
    renderActionHistory();
    saveMatch();
}

// ─── Action History Log ───

function getActionLabel(action) {
    const labels = {
        goal: 'Gol', assist: 'Asistencia', shotOn: 'Tiro a puerta', shotOff: 'Tiro fuera',
        keyPass: 'Pase clave', foulCommitted: 'Falta cometida', foulReceived: 'Falta recibida',
        yellowCard: 'Tarjeta amarilla', redCard: 'Tarjeta roja', save: 'Parada',
        'rival-goal': 'Gol rival', 'rival-shot-on': 'Tiro rival a puerta', 'rival-shot-off': 'Tiro rival fuera'
    };
    return labels[action] || action;
}

function renderActionHistory() {
    const container = $('history-list');
    const badge = $('history-count');
    if (!container || !badge) return;

    badge.textContent = actionHistory.length;

    if (actionHistory.length === 0) {
        container.innerHTML = '<div class="history-empty">Sin acciones registradas</div>';
        return;
    }

    // Show most recent first
    let html = '';
    for (let i = actionHistory.length - 1; i >= 0; i--) {
        const entry = actionHistory[i];
        let playerLabel = 'Rival';
        if (entry.playerId) {
            const p = match.players.find(pl => pl.id === entry.playerId);
            if (p) playerLabel = `#${p.number} ${p.name}`;
        }
        const isRival = !entry.playerId;
        html += `<div class="history-entry${isRival ? ' history-rival' : ''}">
            <span class="history-minute">${entry.minuteStr}</span>
            <span class="history-player">${playerLabel}</span>
            <span class="history-action">${getActionLabel(entry.action)}</span>
        </div>`;
    }
    container.innerHTML = html;
}

// ─── Substitutions ───

let subOutId = null;

function openSub(playerId) {
    subOutId = playerId;
    const player = match.players.find(p => p.id === playerId);
    $('sub-out-label').textContent = `Sale: #${player.number} ${player.name}`;

    const bench = match.players.filter(p => !p.onCourt).sort((a, b) => a.number - b.number);
    $('sub-bench-list').innerHTML = bench.map(p => `
        <button onclick="executeSub(${p.id})">
            #${p.number} ${p.name} ${p.isGoalkeeper ? '(POR)' : ''}
        </button>
    `).join('');

    $('sub-modal').classList.remove('hidden');
}

function quickSubIn(benchPlayerId) {
    // If a player on court was selected for sub, do the swap
    // Otherwise open selection of who to sub out
    const onCourt = match.players.filter(p => p.onCourt);
    if (onCourt.length < 5) {
        // Just put them in (shouldn't normally happen in futsal)
        const benchP = match.players.find(p => p.id === benchPlayerId);
        benchP.onCourt = true;
        benchP.enteredAt = getElapsed();
        renderCourt();
        renderBench();
        return;
    }

    // Show sub modal to pick who goes out
    subOutId = null;
    $('sub-out-label').textContent = `Entra: #${match.players.find(p => p.id === benchPlayerId).number} ${match.players.find(p => p.id === benchPlayerId).name}`;

    $('sub-bench-list').innerHTML = onCourt.map(p => `
        <button onclick="executeSub2(${benchPlayerId}, ${p.id})">
            Sale #${p.number} ${p.name}
        </button>
    `).join('');

    $('sub-modal').classList.remove('hidden');
}

function executeSub(benchPlayerId) {
    if (!subOutId) return;
    doSubstitution(subOutId, benchPlayerId);
    $('sub-modal').classList.add('hidden');
}

function executeSub2(inId, outId) {
    doSubstitution(outId, inId);
    $('sub-modal').classList.add('hidden');
}

function doSubstitution(outId, inId) {
    const outPlayer = match.players.find(p => p.id === outId);
    const inPlayer = match.players.find(p => p.id === inId);

    // Record court time for outgoing player is already accumulated via interval
    outPlayer.onCourt = false;
    outPlayer.enteredAt = null;

    inPlayer.onCourt = true;
    inPlayer.enteredAt = getElapsed();

    selectedPlayerId = null;
    $('action-bar').classList.add('hidden');
    renderCourt();
    renderBench();
    saveMatch();
}

// ─── End match ───

async function endMatch() {
    const ok = await showConfirm('Finalizar partido', '¿Finalizar el partido?');
    if (!ok) return;
    stopClock();
    saveReport(match);
    clearSavedMatch();
    $('match-screen').classList.add('hidden');
    $('summary-screen').classList.remove('hidden');
    renderSummary();
}

// ─── Bind match events ───

function bindMatchEvents() {
    $('btn-clock-toggle').addEventListener('click', toggleClock);
    $('btn-period').addEventListener('click', changePeriod);
    $('btn-undo').addEventListener('click', undoLastAction);
    $('btn-end-match').addEventListener('click', endMatch);
    $('btn-sub-cancel').addEventListener('click', () => {
        $('sub-modal').classList.add('hidden');
    });

    // Rival actions
    document.querySelectorAll('.btn-rival').forEach(btn => {
        btn.addEventListener('click', () => registerRivalAction(btn.dataset.action));
    });

    // Player actions
    document.querySelector('.action-grid').addEventListener('click', e => {
        const btn = e.target.closest('.btn-action');
        if (!btn || btn.disabled) return;
        registerAction(btn.dataset.action);
    });

    // Bench toggle
    $('btn-toggle-bench').addEventListener('click', () => {
        const bench = $('bench-players');
        bench.classList.toggle('hidden');
        $('btn-toggle-bench').classList.toggle('open', !bench.classList.contains('hidden'));
    });

    // History toggle
    $('btn-toggle-history').addEventListener('click', () => {
        const list = $('history-list');
        list.classList.toggle('hidden');
        $('btn-toggle-history').classList.toggle('open', !list.classList.contains('hidden'));
    });
}

// ============================================================
// REPORTS HISTORY
// ============================================================

function renderReportsHistory() {
    const container = $('reports-list');
    if (!container) return;
    const reports = loadReports();

    if (reports.length === 0) {
        container.innerHTML = '<p class="reports-empty">No hay informes guardados</p>';
        return;
    }

    container.innerHTML = reports.map(r => {
        const result = r.myGoals > r.rivalGoals ? 'V' : r.myGoals < r.rivalGoals ? 'D' : 'E';
        const resultClass = r.myGoals > r.rivalGoals ? 'result-win' : r.myGoals < r.rivalGoals ? 'result-loss' : 'result-draw';
        return `
        <div class="report-item" data-id="${r.id}">
            <div class="report-main" onclick="viewReport(${r.id})">
                <span class="report-result ${resultClass}">${result}</span>
                <div class="report-info">
                    <span class="report-score">${r.myTeam} <strong>${r.myGoals} - ${r.rivalGoals}</strong> ${r.rival}</span>
                    <span class="report-date">${r.date}</span>
                </div>
            </div>
            <button class="btn-delete-report" onclick="event.stopPropagation(); confirmDeleteReport(${r.id})" title="Eliminar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </div>`;
    }).join('');
}

let viewingReport = null;

function viewReport(id) {
    const reports = loadReports();
    const report = reports.find(r => r.id === id);
    if (!report) return;

    // Build a temporary match-like object for the summary renderer
    viewingReport = {
        myTeam: report.myTeam,
        rival: report.rival,
        myGoals: report.myGoals,
        rivalGoals: report.rivalGoals,
        rivalShotsOnTarget: report.rivalShotsOnTarget,
        rivalShotsOff: report.rivalShotsOff,
        players: report.players,
        goalLog: report.goalLog,
    };

    $('setup-screen').classList.add('hidden');
    $('summary-screen').classList.remove('hidden');
    $('btn-new-match').textContent = '';
    $('btn-new-match').innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
        Volver`;
    renderSummary(viewingReport);
}

async function confirmDeleteReport(id) {
    const ok = await showConfirm('Eliminar informe', '¿Eliminar este informe?');
    if (!ok) return;
    deleteReport(id);
    renderReportsHistory();
}

// ============================================================
// SUMMARY SCREEN
// ============================================================

function renderSummary(data) {
    const m = data || match;

    // Scoreboard
    $('summary-scoreboard').innerHTML = `
        ${m.myTeam} <strong>${m.myGoals}</strong> - <strong>${m.rivalGoals}</strong> ${m.rival}
    `;

    // Rival stats
    $('summary-rival-stats').innerHTML = `
        Rival — Tiros a puerta: ${m.rivalShotsOnTarget} | Tiros fuera: ${m.rivalShotsOff}
    `;

    // Stats table
    const headers = ['Jugador', 'Dor', 'Min', 'Gol', 'Asi', 'TP', 'TF', 'Pas', 'PC', 'FC', 'FR', 'TA', 'TR', 'Par'];
    const rows = m.players.map(p => {
        const s = p.stats;
        const mins = formatTime(p.courtTimeSeconds);
        return `<tr>
            <td>${p.name}${p.isGoalkeeper ? ' (POR)' : ''}</td>
            <td>${p.number}</td>
            <td>${mins}</td>
            <td class="${s.goals ? 'highlight' : ''}">${s.goals}</td>
            <td class="${s.assists ? 'highlight' : ''}">${s.assists}</td>
            <td>${s.shotsOnTarget}</td>
            <td>${s.shotsOff}</td>
            <td>${s.passes}</td>
            <td>${s.keyPasses}</td>
            <td>${s.foulsCommitted}</td>
            <td>${s.foulsReceived}</td>
            <td>${s.yellowCards}</td>
            <td>${s.redCards}</td>
            <td>${p.isGoalkeeper ? s.saves : '-'}</td>
        </tr>`;
    });

    $('summary-table-container').innerHTML = `
        <table class="stats-table">
            <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
            <tbody>${rows.join('')}</tbody>
        </table>
    `;

    // Goal log
    $('goal-log-container').innerHTML = m.goalLog.length === 0
        ? '<p style="color:var(--text-dim)">No se registraron goles</p>'
        : m.goalLog.map(g => `
            <div class="goal-entry">
                <span class="goal-minute">${g.period}T ${g.minute}'</span>
                <span class="${g.team === 'my' ? 'goal-team-my' : 'goal-team-rival'}">
                    ${g.team === 'my' ? m.myTeam : m.rival}
                </span>
                ${g.scorerName ? `— ${g.scorerName}` : ''}
                ${g.assistName ? `(asist. ${g.assistName})` : ''}
                <div class="goal-players">En pista: ${g.playersOnCourt.join(', ')}</div>
            </div>
        `).join('');
}

// ─── Export CSV ───

function getActiveMatchData() {
    return viewingReport || match;
}

function exportCSV() {
    const m = getActiveMatchData();
    const sep = ';';
    let csv = '';

    csv += `Partido${sep}${m.myTeam} ${m.myGoals} - ${m.rivalGoals} ${m.rival}\n`;
    csv += `Rival tiros a puerta${sep}${m.rivalShotsOnTarget}\n`;
    csv += `Rival tiros fuera${sep}${m.rivalShotsOff}\n\n`;

    csv += ['Jugador', 'Dorsal', 'Portero', 'Minutos', 'Goles', 'Asistencias', 'Tiros puerta', 'Tiros fuera', 'Pases', 'Pases clave', 'Faltas com.', 'Faltas rec.', 'T.Amarillas', 'T.Rojas', 'Paradas'].join(sep) + '\n';

    m.players.forEach(p => {
        const s = p.stats;
        csv += [
            p.name, p.number, p.isGoalkeeper ? 'Sí' : 'No',
            formatTime(p.courtTimeSeconds),
            s.goals, s.assists, s.shotsOnTarget, s.shotsOff,
            s.passes, s.keyPasses, s.foulsCommitted, s.foulsReceived,
            s.yellowCards, s.redCards, p.isGoalkeeper ? s.saves : ''
        ].join(sep) + '\n';
    });

    csv += '\nRegistro de goles\n';
    csv += ['Periodo', 'Minuto', 'Equipo', 'Goleador', 'Asistente', 'Jugadores en pista'].join(sep) + '\n';
    m.goalLog.forEach(g => {
        csv += [
            `${g.period}T`, g.minute,
            g.team === 'my' ? m.myTeam : m.rival,
            g.scorerName || '', g.assistName || '',
            g.playersOnCourt.join(', ')
        ].join(sep) + '\n';
    });

    downloadFile(`${m.myTeam}_vs_${m.rival}.csv`, csv, 'text/csv;charset=utf-8;');
}

function downloadFile(filename, content, type) {
    const blob = new Blob(['\uFEFF' + content], { type }); // BOM for Excel
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ._-]/g, '_');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── Export Print ───

function exportPrint() {
    const m = getActiveMatchData();

    const headers = ['Jugador', 'Dor', 'Min', 'Gol', 'Asi', 'TP', 'TF', 'Pas', 'PC', 'FC', 'FR', 'TA', 'TR', 'Par'];

    // Split players into rows of 8 for page-friendly chunks
    const allRows = m.players.map(p => {
        const s = p.stats;
        return `<tr>
            <td style="text-align:left;font-weight:600;white-space:nowrap">${p.name}${p.isGoalkeeper ? ' <span style="color:#0ea5e9;font-size:9px">(POR)</span>' : ''}</td>
            <td>${p.number}</td>
            <td>${formatTime(p.courtTimeSeconds)}</td>
            <td style="${s.goals ? 'color:#16a34a;font-weight:700' : ''}">${s.goals}</td>
            <td style="${s.assists ? 'color:#16a34a;font-weight:700' : ''}">${s.assists}</td>
            <td>${s.shotsOnTarget}</td><td>${s.shotsOff}</td>
            <td>${s.passes}</td><td>${s.keyPasses}</td>
            <td>${s.foulsCommitted}</td><td>${s.foulsReceived}</td>
            <td>${s.yellowCards}</td><td>${s.redCards}</td>
            <td>${p.isGoalkeeper ? s.saves : '-'}</td>
        </tr>`;
    }).join('');

    const goalRows = m.goalLog.map(g => `
        <div style="padding:8px 10px;margin:4px 0;background:#f8f8f8;border-radius:6px;font-size:12px;page-break-inside:avoid">
            <strong>${g.period}T ${g.minute}'</strong> —
            <span style="color:${g.team === 'my' ? '#16a34a' : '#dc2626'};font-weight:600">${g.team === 'my' ? m.myTeam : m.rival}</span>
            ${g.scorerName ? ' — ' + g.scorerName : ''}
            ${g.assistName ? ' (asist. ' + g.assistName + ')' : ''}
            <div style="color:#888;font-size:11px;margin-top:2px">En pista: ${g.playersOnCourt.join(', ')}</div>
        </div>
    `).join('');

    const theadHtml = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${m.myTeam} vs ${m.rival} — MatchPulse</title>
<style>
    @page {
        size: A4 landscape;
        margin: 12mm 10mm;
    }
    * { box-sizing: border-box; }
    body {
        font-family: 'Segoe UI', Arial, sans-serif;
        padding: 0;
        margin: 0;
        color: #1a1a1a;
        font-size: 13px;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .header {
        text-align: center;
        padding-bottom: 12px;
        border-bottom: 2px solid #16a34a;
        margin-bottom: 16px;
    }
    .header h1 {
        font-size: 14px;
        color: #666;
        margin: 0 0 4px;
        font-weight: 400;
    }
    .header h2 {
        font-size: 26px;
        margin: 0 0 6px;
        letter-spacing: -0.5px;
    }
    .header h2 strong {
        color: #16a34a;
        font-size: 30px;
    }
    .sub {
        color: #666;
        font-size: 12px;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
    }
    thead { display: table-header-group; }
    thead tr {
        background: #16a34a;
        color: #fff;
    }
    th {
        padding: 7px 5px;
        text-align: center;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        border: none;
    }
    th:first-child { text-align: left; padding-left: 10px; }
    td {
        padding: 6px 5px;
        text-align: center;
        border-bottom: 1px solid #e5e5e5;
    }
    td:first-child { text-align: left; padding-left: 10px; }
    tr:nth-child(even) td { background: #f8faf8; }
    tbody tr {
        page-break-inside: avoid;
    }
    h3 {
        font-size: 14px;
        margin: 20px 0 10px;
        padding-bottom: 4px;
        border-bottom: 1px solid #ddd;
        color: #333;
        page-break-after: avoid;
    }
    .section {
        page-break-inside: auto;
    }
    .footer {
        text-align: center;
        color: #bbb;
        font-size: 9px;
        margin-top: 24px;
        padding-top: 8px;
        border-top: 1px solid #eee;
    }
    @media print {
        body { padding: 0; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
        table { page-break-inside: auto; }
        tr { page-break-inside: avoid; }
        h3 { page-break-after: avoid; }
    }
</style></head><body>
    <div class="header">
        <h1>MatchPulse — Informe de partido</h1>
        <h2>${m.myTeam} <strong>${m.myGoals}</strong> - <strong>${m.rivalGoals}</strong> ${m.rival}</h2>
        <div class="sub">Rival — Tiros a puerta: ${m.rivalShotsOnTarget} &nbsp;|&nbsp; Tiros fuera: ${m.rivalShotsOff}</div>
    </div>

    <div class="section">
        <h3>Estadísticas individuales</h3>
        <table>
            <thead>${theadHtml}</thead>
            <tbody>${allRows}</tbody>
        </table>
    </div>

    <div class="section">
        <h3>Registro de goles</h3>
        ${m.goalLog.length === 0 ? '<p style="color:#999">No se registraron goles</p>' : goalRows}
    </div>

    <div class="footer">Generado con MatchPulse — Futsal Analytics</div>
</body></html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 500);
    } else {
        downloadFile(`${m.myTeam}_vs_${m.rival}.html`, html, 'text/html;charset=utf-8');
    }
}

// ─── New match ───

async function newMatch() {
    // If viewing a saved report, just go back without confirmation
    if (viewingReport) {
        viewingReport = null;
        $('summary-screen').classList.add('hidden');
        $('setup-screen').classList.remove('hidden');
        // Restore the button text
        $('btn-new-match').innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            Nuevo partido`;
        renderReportsHistory();
        return;
    }
    const ok = await showConfirm('Nuevo partido', '¿Empezar un nuevo partido? Se perderán los datos actuales.');
    if (!ok) return;
    clearSavedMatch();
    $('summary-screen').classList.add('hidden');
    $('setup-screen').classList.remove('hidden');
    actionHistory = [];
    selectedPlayerId = null;
    initSetup();
}

// ─── Bind summary events ───

function bindSummaryEvents() {
    $('btn-export-csv').addEventListener('click', exportCSV);
    $('btn-export-print').addEventListener('click', exportPrint);
    $('btn-new-match').addEventListener('click', newMatch);
}

// ============================================================
// CONFIRM MODAL (replaces native confirm())
// ============================================================

function showConfirm(title, message) {
    return new Promise(resolve => {
        $('confirm-title').textContent = title;
        $('confirm-message').textContent = message;
        $('confirm-modal').classList.remove('hidden');

        function cleanup() {
            $('confirm-modal').classList.add('hidden');
            $('btn-confirm-yes').removeEventListener('click', onYes);
            $('btn-confirm-no').removeEventListener('click', onNo);
        }

        function onYes() { cleanup(); resolve(true); }
        function onNo() { cleanup(); resolve(false); }

        $('btn-confirm-yes').addEventListener('click', onYes);
        $('btn-confirm-no').addEventListener('click', onNo);
    });
}

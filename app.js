/* ============================================
   ResistBand Pro — App Logic
   ============================================ */

// ---- Configuration & Supabase Init ----
const supabaseUrl = 'https://lnptfqkxcznzjjwmrlwl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxucHRmcWt4Y3puempqd21ybHdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzODU4NjUsImV4cCI6MjA4Nzk2MTg2NX0.bLZ69PDIoQccfhZFf2lSgwlZGDVKHgdh86d-J4SgKIE';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// ---- State ----
let currentUserEmail = '';
let currentPin = '';
const CORRECT_PIN = '1111';
let currentExercise = '';
let currentSet = 1;
const TOTAL_SETS = 3;
const TOTAL_REPS = 15;
let currentRep = 0;
let workoutStats = { fast: 0, perfect: 0, slow: 0 };
let setStats = [];
let restTimer = null;
let restSeconds = 60;
let countdownTimer = null;
let failureTimer = null;
let failureCountdown = 12;
let failureTickTimer = null;
const FAILURE_TOTAL = 12;
const FAILURE_SHOW_AT = 3;
let workoutActive = false;
let activeTickAudio = null;

// ---- Vercel Server Config ----
const VERCEL_URL = 'https://resistband-pro.vercel.app'; // no trailing slash
let repPollInterval = null;
let lastRepPollTime = 0;

// Safe URL builder — same logic as apiUrl() in the .ino
function vercelApi(path) {
  const base = VERCEL_URL.replace(/\/$/, ''); // strip any accidental trailing slash
  return base + path; // path must start with /
}

// ---- Difficulty → Band Length (cm) ----
const DIFFICULTY_CM = { light: 12, medium: 8, heavy: 4 };

// ---- Live Workout DB State ----
let activeDbSessionId = null;
let activeUserId = null;
let liveRepCache = [];
let workoutStartTime = null;

// ---- Exercise Data ----
const exercises = {
  'bicep-curl': {
    name: 'Bicep Curl',
    muscles: ['Biceps', 'Brachialis', 'Forearms'],
    description: 'The bicep curl targets the upper arm muscles, primarily the biceps brachii. Using the resistance band with load cell motor provides consistent tension throughout the full range of motion, maximizing muscle engagement and promoting hypertrophy.'
  },
  'squat': {
    name: 'Squat',
    muscles: ['Quadriceps', 'Glutes', 'Hamstrings', 'Core'],
    description: 'The squat is a compound exercise targeting the entire lower body. The smart resistance band system provides adaptive resistance, ensuring proper form and progressive overload through load cell feedback.'
  },
  'chest-press': {
    name: 'Chest Press',
    muscles: ['Pectorals', 'Triceps', 'Anterior Deltoids'],
    description: 'The chest press primarily targets the pectoral muscles while also engaging the triceps and front deltoids. The motorized resistance adapts in real-time to your strength curve for optimal chest development.'
  }
};


// ---- Sound Effects ----
/* ============================================
   Audio Manager
   ============================================ */
class AudioManager {
  constructor() {
    this.sounds = {};
    this.isMuted = false;
  }

  register(name, src, defaultVolume = 1.0) {
    const audio = new Audio(src);
    audio.preload = 'auto'; // Force browser to download it in the background
    audio.volume = defaultVolume;
    this.sounds[name] = audio;
  }

  // Plays a sound. Clones the node to allow overlapping playback
  play(name) {
    if (this.isMuted || !this.sounds[name]) return null;
    const soundClone = this.sounds[name].cloneNode();
    soundClone.volume = this.sounds[name].volume;
    soundClone.play().catch(err => console.warn(`Audio blocked for ${name}:`, err));
    return soundClone;
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }
}


const sfx = new AudioManager();

sfx.register('pin_entry', 'audio/pin-entry.mp3', 1);
sfx.register('nav_click', 'audio/nav-click2.mp3', 1);
sfx.register('countdown', 'audio/countdown.mp3', 0.7);
sfx.register('timer_tick', 'audio/timer-tick.mp3', 0.4);
sfx.register('rep_perfect', 'audio/rep-perfect.mp3', 0.12);
sfx.register('rep_slow', 'audio/rep-slow.mp3', 0.12);
sfx.register('rep_fast', 'audio/rep-fast.mp3', 0.12);
sfx.register('complete_set', 'audio/complete-set.mp3', 0.3);
sfx.register('complete_workout', 'audio/complete-workout.mp3', 0.3);


// ---- Page Navigation ----
function showPage(pageId, direction = 'forward') {
  const pages = document.querySelectorAll('.page');
  pages.forEach(p => {
    if (p.classList.contains('active')) {
      p.classList.remove('active');
      if (direction === 'forward') {
        p.classList.add('exit-left');
      }
      setTimeout(() => p.classList.remove('exit-left'), 400);
    }
  });

  setTimeout(() => {
    const target = document.getElementById(pageId);
    if (target) {
      target.classList.add('active');
    }
  }, 50);
}

// ---- Authentication Logic ----
const emailInput = document.getElementById('email-input');
const btnNextPin = document.getElementById('btn-next-pin');
const emailSection = document.getElementById('email-section');
const pinSection = document.getElementById('pin-section');
const loginHeader = document.getElementById('login-header');
const displayEmail = document.getElementById('display-email');
const emailError = document.getElementById('email-error');
const pinError = document.getElementById('pin-error');

// Enable/Disable email next button
function checkEmailValid() {
  const emailVal = emailInput.value.trim();
  const isValid = emailVal.includes('@') && emailVal.includes('.');
  btnNextPin.disabled = !isValid;
  emailError.textContent = '';
}

emailInput.addEventListener('input', checkEmailValid);
emailInput.addEventListener('change', checkEmailValid);

emailInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !btnNextPin.disabled) {
    btnNextPin.click();
  }
});

// Proceed to PIN
btnNextPin.addEventListener('click', () => {
  currentUserEmail = emailInput.value.trim();
  displayEmail.textContent = currentUserEmail;

  // Transition UI
  emailSection.classList.remove('active-auth-section');
  emailSection.classList.add('hidden-auth-section');

  loginHeader.classList.add('shrunk');

  setTimeout(() => {
    emailSection.style.display = 'none';
    pinSection.style.display = 'flex';
    pinSection.classList.remove('hidden-auth-section');
    pinSection.classList.add('active-auth-section');
  }, 300);
});

// Go back to Email
document.getElementById('btn-change-user').addEventListener('click', () => {
  currentPin = '';
  updatePinDots();
  pinError.textContent = '';

  pinSection.classList.remove('active-auth-section');
  pinSection.classList.add('hidden-auth-section');

  loginHeader.classList.remove('shrunk');

  setTimeout(() => {
    pinSection.style.display = 'none';
    emailSection.style.display = 'flex';
    emailSection.classList.remove('hidden-auth-section');
    emailSection.classList.add('active-auth-section');
  }, 300);
});

async function handleLoginAttempt() {
  const paddedPin = currentPin + '0000'; // Pad to 8 chars to meet Supabase min password length
  document.querySelectorAll('.pin-dot').forEach(d => d.style.opacity = '0.5'); // Loading state
  pinError.textContent = '';

  let { data, error } = await supabaseClient.auth.signInWithPassword({
    email: currentUserEmail,
    password: paddedPin,
  });

  // Auto-signup if the user doesn't exist (Invalid login credentials usually means wrong password or no user)
  if (error && error.message.includes('Invalid login credentials')) {
    // Try signing up instead
    const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({
      email: currentUserEmail,
      password: paddedPin,
    });

    if (!signUpError && signUpData.user) {
      // Signup successful
      data = signUpData;
      error = null;
    } else if (signUpError && signUpError.message.includes('User already registered')) {
      // User exists but gave wrong PIN
      error = new Error("Incorrect PIN. Please try again.");
    } else {
      error = signUpError || new Error("Failed to create account.");
    }
  }

  document.querySelectorAll('.pin-dot').forEach(d => d.style.opacity = '1'); // Remove loading state

  if (error) {
    pinError.textContent = error.message || 'Incorrect PIN. Please try again.';
    document.querySelectorAll('.pin-dot').forEach(d => d.classList.add('error'));

    setTimeout(() => {
      currentPin = '';
      updatePinDots();
      document.querySelectorAll('.pin-dot').forEach(d => d.classList.remove('error'));
    }, 600);
  } else {
    // Check if session exists (success)
    if (data.session) {
      showPage('page-devices');
    }
  }
}

// Handle Logout
document.getElementById('btn-logout').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  // Reset state
  currentPin = '';
  currentUserEmail = '';
  emailInput.value = '';
  btnNextPin.disabled = true;
  updatePinDots();

  // Reset UI to start
  pinSection.style.display = 'none';
  pinSection.classList.remove('active-auth-section');
  emailSection.style.display = 'flex';
  emailSection.classList.add('active-auth-section');
  loginHeader.classList.remove('shrunk');

  showPage('page-login', 'back');
});

// Check active session on load
async function checkActiveSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    showPage('page-devices');
  }
}
checkActiveSession();

// ---- PIN Pad ----
document.querySelectorAll('.pin-key[data-key]').forEach(key => {
  key.addEventListener('click', () => {
    handlePinInput(key.dataset.key);
    sfx.play('pin_entry');
  });
});

function handlePinInput(val) {
  if (val === 'delete') {
    if (currentPin.length > 0) {
      currentPin = currentPin.slice(0, -1);
      updatePinDots();
    }
    return;
  }

  if (currentPin.length >= 4) return;

  currentPin += val;
  updatePinDots();

  if (currentPin.length === 4) {
    handleLoginAttempt();
  }
}

// ---- Keyboard Support ----
document.addEventListener('keydown', (e) => {
  // Only process if we are on the login page AND viewing the PIN section
  const loginPage = document.getElementById('page-login');
  const pinSec = document.getElementById('pin-section');

  if (loginPage.classList.contains('active') && pinSec.style.display === 'flex') {
    if (e.key >= '0' && e.key <= '9') {
      handlePinInput(e.key);
    } else if (e.key === 'Backspace') {
      handlePinInput('delete');
    }
  }
});

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (i < currentPin.length) {
      dot.classList.add('filled');
    } else {
      dot.classList.remove('filled');
    }
  }
}

document.addEventListener('click', (e) => {
  // If the clicked element is a button or is inside a button
  const isButton = e.target.closest('button') || e.target.closest('.app-btn');
  const isPinKey = e.target.closest('.pin-key'); // Skip pin keys since they have their own sound

  if (isButton && !isPinKey) {
    sfx.play('nav_click');
  }
});

// ---- Device Selection ----
function selectDevice(el) {
  if (el.classList.contains('connected')) {
    showPage('page-exercises');
  }
}

document.getElementById('devices-back').addEventListener('click', async () => {
  // If we go back from devices, we should log the user out since they are exiting the app shell
  await supabaseClient.auth.signOut();
  currentPin = '';
  currentUserEmail = '';
  emailInput.value = '';
  btnNextPin.disabled = true;
  updatePinDots();

  pinSection.style.display = 'none';
  pinSection.classList.remove('active-auth-section');
  emailSection.style.display = 'flex';
  emailSection.classList.add('active-auth-section');
  loginHeader.classList.remove('shrunk');

  showPage('page-login', 'back');
});

document.getElementById('exercises-back').addEventListener('click', () => {
  showPage('page-devices', 'back');
});

// ---- Exercise Detail Modal ----
function showExerciseDetail(exerciseId) {
  currentExercise = exerciseId;
  const ex = exercises[exerciseId];

  document.getElementById('modal-exercise-name').textContent = ex.name;
  document.getElementById('modal-description').textContent = ex.description;

  const muscleContainer = document.getElementById('modal-muscles');
  muscleContainer.innerHTML = ex.muscles.map(m =>
    `<span class="muscle-tag">${m}</span>`
  ).join('');

  // Reset difficulty UI
  document.querySelectorAll('input[name="difficulty"]').forEach(rad => {
    if (rad.value === 'medium') rad.checked = true;
    updateDifficultyUI(rad);
  });

  // Reset button state
  document.getElementById('btn-start-text').style.display = 'flex';
  document.getElementById('btn-start-loading').style.display = 'none';
  document.getElementById('btn-start-ex').disabled = false;

  document.getElementById('exercise-modal').classList.add('active');
}

function updateDifficultyUI(selectedRadio) {
  sfx.play('nav_click');
  document.querySelectorAll('.diff-box').forEach(box => {
    box.style.border = '1px solid var(--border-color)';
    box.style.background = 'var(--bg-primary)';
    box.style.color = 'var(--text-primary)';
    box.style.fontWeight = 'normal';
  });

  if (selectedRadio.checked) {
    const box = selectedRadio.nextElementSibling;
    box.style.border = '2px solid var(--accent-primary)';
    box.style.background = 'var(--accent-light)';
    box.style.color = 'var(--accent-secondary)';
    box.style.fontWeight = 'bold';
  }
}

function closeExerciseModal() {
  document.getElementById('exercise-modal').classList.remove('active');
}

function closeModal(event) {
  if (event.target === event.currentTarget) {
    closeExerciseModal();
  }
}

// ---- Start Exercise / Workout ----
async function startExercise() {
  const diffRadio = document.querySelector('input[name="difficulty"]:checked');
  const selectedDifficulty = diffRadio ? diffRadio.value : 'medium';
  const bandCm = DIFFICULTY_CM[selectedDifficulty] ?? 8;

  // Show loading spinner while we command the device
  document.getElementById('btn-start-text').style.display = 'none';
  document.getElementById('btn-start-loading').style.display = 'flex';
  document.getElementById('btn-start-ex').disabled = true;

  // ── 1. Send set_length command to ESP32 via Vercel ──────────────────────
  const commandSentAt = Date.now(); // used below to reject stale 'ready' timestamps
  let deviceAvailable = false;
  try {
    const cmdRes = await fetch(vercelApi('/api/command'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'set_length', cm: bandCm })
    });
    deviceAvailable = cmdRes.ok;
    console.log('[APP] set_length command sent, cm=', bandCm, 'ok=', deviceAvailable);
  } catch (err) {
    console.warn('Could not reach Vercel — proceeding without hardware:', err);
  }

  // ── 2. Poll /api/status until device reports a FRESH "ready" ─────────────
  //    Wait 1.5 s first so the ESP32 finishes its current 1-second poll cycle
  //    and changes status to "moving", then only accept "ready" with a
  //    last_seen_at timestamp newer than when we sent the command.
  if (deviceAvailable) {
    await new Promise(r => setTimeout(r, 3000)); // give ESP32 time to read command
    let ready = false;
    for (let i = 0; i < 60; i++) {  // max 30 s
      await new Promise(r => setTimeout(r, 500));
      try {
        const st = await fetch(vercelApi('/api/status'));
        const json = await st.json();
        const lastSeenMs = new Date(json.last_seen_at).getTime();
        console.log('[APP] status=', json.status, 'lastSeen=', json.last_seen_at);
        if (json.status === 'ready' && lastSeenMs > commandSentAt) {
          ready = true;
          break;
        }
      } catch (_) { /* ignore transient network errors */ }
    }
    if (!ready) console.warn('Device did not report ready in time — proceeding anyway');
  }

  // ── 3. Transition UI → workout ──────────────────────────────────────────
  closeExerciseModal();
  currentSet = 1;
  currentRep = 0;
  workoutStats = { fast: 0, perfect: 0, slow: 0 };
  setStats = [];
  liveRepCache = [];
  workoutStartTime = new Date();

  const ex = exercises[currentExercise];
  document.getElementById('workout-exercise-name').textContent =
    ex.name + ` (${selectedDifficulty.charAt(0).toUpperCase() + selectedDifficulty.slice(1)})`;
  document.getElementById('workout-set').textContent = `${currentSet}/${TOTAL_SETS}`;
  document.getElementById('rep-count').textContent = '0';
  updateRepRing(0);
  hideFeedback();
  showPage('page-workout');

  // ── 4. Create Supabase session record ───────────────────────────────────
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (user) {
      activeUserId = user.id;
      const { data: sData } = await supabaseClient
        .from('workout_sessions')
        .insert({
          user_id: user.id,
          created_at: workoutStartTime.toISOString(),
          exercise_type: currentExercise,
          difficulty: selectedDifficulty,
          total_reps: 0
        })
        .select()
        .single();
      if (sData) activeDbSessionId = sData.id;
    }
  } catch (err) {
    console.warn('DB session create failed (offline?), continuing workout:', err);
  }

  // ── 5. Begin countdown ───────────────────────────────────────────────────
  startCountdown();
}

function startCountdown() {
  const overlay = document.getElementById('countdown-overlay');
  const numberEl = document.getElementById('countdown-number');
  overlay.classList.add('active');

  let count = 3;
  numberEl.textContent = count;

  sfx.play('countdown');

  countdownTimer = setInterval(() => {
    count--;
    if (count > 0) {
      numberEl.textContent = count;
    } else if (count === 0) {
      numberEl.textContent = 'GO!';
      numberEl.style.fontSize = '72px';
    } else {
      clearInterval(countdownTimer);
      overlay.classList.remove('active');
      numberEl.style.fontSize = '';
      workoutActive = true;
      startFailureTimer();
      startRepPolling(); // ← tell ESP32 to begin rep detection & start polling
    }
  }, 1000);
}

// ---- Failure Timer (5s inactivity = set done) ----
function startFailureTimer() {
  clearFailureTimer();
  failureCountdown = FAILURE_TOTAL;
  const timerText = document.getElementById('failure-timer-text');
  const progressBar = document.getElementById('failure-progress');
  const bar = document.getElementById('failure-timer-bar');

  // Reset bar to full instantly
  progressBar.style.transition = 'none';
  progressBar.style.width = '100%';
  progressBar.style.background = 'var(--accent-gradient)';
  bar.classList.remove('visible');
  timerText.textContent = `${FAILURE_SHOW_AT}s`;



  failureTickTimer = setInterval(() => {
    failureCountdown--;

    if (failureCountdown <= FAILURE_SHOW_AT) {
      // On first reveal, show bar and kick off smooth CSS transition
      if (failureCountdown === FAILURE_SHOW_AT) {
        if (activeTickAudio) {
          activeTickAudio.pause();
          activeTickAudio.currentTime = 0;
        }
        activeTickAudio = sfx.play('timer_tick');
        bar.classList.add('visible');
        // Force reflow so 100% width is painted before animating to 0
        void progressBar.offsetWidth;
        progressBar.style.transition = `width ${FAILURE_SHOW_AT}s linear, background 0.3s`;
        progressBar.style.width = '0%';
      }

      timerText.textContent = `${failureCountdown}s`;

      // Color shifts
      if (failureCountdown <= 1) {
        progressBar.style.background = 'var(--danger)';
      } else if (failureCountdown <= 2) {
        progressBar.style.background = 'var(--warning)';
      }
    }

    if (failureCountdown <= 0) {
      clearFailureTimer();
      triggerFailure();
    }
  }, 1000);
}

function resetFailureTimer() {
  if (workoutActive) {
    startFailureTimer();
  }
}

function clearFailureTimer() {
  clearInterval(failureTickTimer);
  failureTickTimer = null;
  document.getElementById('failure-timer-bar').classList.remove('visible');

  if (activeTickAudio) {
    activeTickAudio.pause();
    activeTickAudio.currentTime = 0;
    activeTickAudio = null;
  }
}

// updateFailureDisplay logic is now inside startFailureTimer

function triggerFailure() {
  workoutActive = false;
  stopRepPolling();

  // Save the set stats locally for UI Summary
  setStats.push({
    set: currentSet,
    fast: workoutStats.fast - setStats.reduce((a, s) => a + s.fast, 0),
    perfect: workoutStats.perfect - setStats.reduce((a, s) => a + s.perfect, 0),
    slow: workoutStats.slow - setStats.reduce((a, s) => a + s.slow, 0),
    failure: true,
    reps: currentRep
  });

  // Smoothly transition to rest or summary after a brief pause
  setTimeout(() => {
    flushRepsToDatabase();

    if (currentSet < TOTAL_SETS) {
      startRest();
    } else {
      showSummary();
    }
  }, 600);
}

// ---- Database Flush Helper ----
async function flushRepsToDatabase() {
  if (!activeDbSessionId || liveRepCache.length === 0) return;

  // Copy and clear cache immediately so frontend isn't blocked by network
  const repsToInsert = [...liveRepCache];
  liveRepCache = [];

  const { error: repInsertError } = await supabaseClient.from('workout_reps').insert(repsToInsert);
  if (repInsertError) {
    console.error('Failed to insert reps:', repInsertError);
  }
}

// ---- Rep Polling (from Vercel / ESP32) ----
async function startRepPolling() {
  lastRepPollTime = Date.now();

  // Tell ESP32 to enter rep-detection mode
  try {
    await fetch(vercelApi('/api/command'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'start_workout' })
    });
  } catch (e) { console.warn('start_workout command failed:', e); }

  repPollInterval = setInterval(async () => {
    if (!workoutActive) return;
    try {
      const res = await fetch(vercelApi(`/api/rep?since=${lastRepPollTime}`));
      const data = await res.json();
      if (data.reps && data.reps.length > 0) {
        lastRepPollTime = Date.now();
        console.log('[APP] Received reps:', data.reps.length, data.reps.map(r => r.quality));
        data.reps.forEach(rep => addRep(rep.quality, rep.duration_ms, rep.force_data));
      }
    } catch (e) { /* ignore transient errors */ }
  }, 600);
}

async function stopRepPolling() {
  clearInterval(repPollInterval);
  repPollInterval = null;
  try {
    await fetch(vercelApi('/api/command'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'end_workout' })
    });
  } catch (e) { /* ignore */ }
}

// ---- Rep Tracking ----
function addRep(speed, realDuration = null, realForceData = null) {
  if (!workoutActive || currentRep >= TOTAL_REPS) return;

  currentRep++;
  workoutStats[speed]++;

  document.getElementById('rep-count').textContent = currentRep;
  updateRepRing(currentRep / TOTAL_REPS);
  showFeedback(speed);

  if (speed === 'perfect') {
    sfx.play('rep_perfect');
  }
  else if (speed === 'fast') {
    sfx.play('rep_fast');
  }
  else if (speed === 'slow') {
    sfx.play('rep_slow');
  }

  // Use real duration if provided, otherwise mock fallback
  const duration = realDuration ? parseFloat((realDuration / 1000).toFixed(2)) : (speed === 'fast' ? 1.84 : (speed === 'slow' ? 1.9 : 1.86));

  let forceData = realForceData;
  if (!forceData || forceData.length === 0) {
    // Mock fallback for testing without hardware
    forceData = [];
    for (let ms = 0; ms < (duration * 1000); ms += 50) {
      const progress = ms / (duration * 1000);
      forceData.push(parseFloat((Math.sin(progress * Math.PI) * 15).toFixed(2)));
    }
  }

  if (activeDbSessionId) {
    liveRepCache.push({
      session_id: activeDbSessionId,
      user_id: activeUserId,
      set_number: currentSet,
      rep_number: currentRep,
      quality: speed,
      duration: duration,
      force_data: forceData
    });
  }

  // Reset the failure timer on every rep
  resetFailureTimer();

  if (currentRep >= TOTAL_REPS) {
    // Set complete
    sfx.play('complete_set');
    workoutActive = false;
    clearFailureTimer();
    setStats.push({
      set: currentSet,
      fast: workoutStats.fast - setStats.reduce((a, s) => a + s.fast, 0),
      perfect: workoutStats.perfect - setStats.reduce((a, s) => a + s.perfect, 0),
      slow: workoutStats.slow - setStats.reduce((a, s) => a + s.slow, 0),
      failure: false,
      reps: currentRep
    });

    setTimeout(() => {
      // Flush rep cache to DB
      flushRepsToDatabase();

      if (currentSet < TOTAL_SETS) {
        startRest();
      } else {
        sfx.play('complete_workout');
        showSummary();
      }
    }, 800);
  }
}

function updateRepRing(progress) {
  const ring = document.getElementById('rep-progress-ring');
  const circumference = 2 * Math.PI * 88; // r=88
  const offset = circumference - (progress * circumference);
  ring.style.strokeDashoffset = offset;
  ring.style.transition = 'stroke-dashoffset 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
}

function showFeedback(speed) {
  const fb = document.getElementById('speed-feedback');
  const icon = document.getElementById('feedback-icon');
  const text = document.getElementById('feedback-text');

  fb.className = 'speed-feedback visible';

  if (speed === 'fast') {
    fb.classList.add('fast');
    icon.textContent = '🐇';
    text.textContent = 'Too fast!';
  } else if (speed === 'slow') {
    fb.classList.add('slow');
    icon.textContent = '🐢';
    text.textContent = 'Too slow!';
  } else {
    fb.classList.add('perfect');
    icon.textContent = '⭐';
    text.textContent = 'Perfect pace!';
  }

  clearTimeout(fb._hideTimer);
  fb._hideTimer = setTimeout(hideFeedback, 1500);
}

function hideFeedback() {
  const fb = document.getElementById('speed-feedback');
  fb.classList.remove('visible');
}

// ---- Rest Between Sets ----
function startRest() {
  restSeconds = 60;
  document.getElementById('rest-time').textContent = '1:00';
  const nextSet = currentSet + 1;
  document.getElementById('rest-next-set').textContent = `Set ${nextSet}/${TOTAL_SETS}`;

  showPage('page-rest');

  const ring = document.getElementById('rest-progress-ring');
  const circumference = 2 * Math.PI * 105; // r=105

  restTimer = setInterval(() => {
    restSeconds--;
    const mins = Math.floor(restSeconds / 60);
    const secs = restSeconds % 60;
    document.getElementById('rest-time').textContent =
      `${mins}:${secs.toString().padStart(2, '0')}`;

    // Update ring
    const progress = restSeconds / 60;
    const offset = circumference - (progress * circumference);
    ring.style.strokeDashoffset = offset;
    ring.style.transition = 'stroke-dashoffset 1s linear';

    if (restSeconds <= 0) {
      clearInterval(restTimer);
      nextSet_go();
    }
  }, 1000);
}

function skipRest() {
  clearInterval(restTimer);
  nextSet_go();
}

function nextSet_go() {
  currentSet++;
  currentRep = 0;

  document.getElementById('workout-set').textContent = `${currentSet}/${TOTAL_SETS}`;
  document.getElementById('rep-count').textContent = '0';
  updateRepRing(0);
  hideFeedback();

  showPage('page-workout');
  startCountdown();
}

// ---- Summary ----
async function showSummary() {
  const ex = exercises[currentExercise];
  document.getElementById('summary-exercise-name').textContent = ex.name;

  const totalReps = workoutStats.fast + workoutStats.perfect + workoutStats.slow;
  document.getElementById('summary-total-reps').textContent = totalReps;
  document.getElementById('summary-perfect').innerHTML =
    `<span class="mini-icon">⭐</span> ${workoutStats.perfect}`;
  document.getElementById('summary-fast').innerHTML =
    `<span class="mini-icon">🐇</span> ${workoutStats.fast}`;
  document.getElementById('summary-slow').innerHTML =
    `<span class="mini-icon">🐢</span> ${workoutStats.slow}`;

  // Score
  const accuracy = totalReps > 0 ? Math.round((workoutStats.perfect / totalReps) * 100) : 0;
  document.getElementById('score-value').textContent = `${accuracy}%`;

  // Update DB session record with final totals
  if (activeDbSessionId) {
    await supabaseClient.from('workout_sessions').update({ total_reps: totalReps }).eq('id', activeDbSessionId);
    activeDbSessionId = null; // Clear so it doesn't leak into next workout accidentally
  }

  // Score ring
  const scoreRing = document.getElementById('score-ring');
  const circumference = 2 * Math.PI * 70;
  const offset = circumference - ((accuracy / 100) * circumference);
  scoreRing.style.strokeDashoffset = offset;
  scoreRing.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)';

  // Set breakdown
  const breakdownList = document.getElementById('set-breakdown-list');
  breakdownList.innerHTML = setStats.map(s =>
    `<div class="set-row ${s.failure ? 'set-row-failure' : ''}">
      <span class="set-row-label">Set ${s.set} ${s.failure ? '<span class="failure-badge">FAILURE</span>' : ''}</span>
      <div class="set-row-stats">
        <span class="rep-stat">${s.reps}/15 reps</span>
        <span>⭐ ${s.perfect}</span>
        <span>🐇 ${s.fast}</span>
        <span>🐢 ${s.slow}</span>
      </div>
    </div>`
  ).join('');

  showPage('page-summary');
}

// ---- Quit / Done ----
async function quitWorkout() {
  workoutActive = false;
  stopRepPolling();
  clearInterval(countdownTimer);
  clearFailureTimer();
  flushRepsToDatabase();

  if (activeDbSessionId) {
    const totalReps = workoutStats.fast + workoutStats.perfect + workoutStats.slow;
    await supabaseClient.from('workout_sessions').update({ total_reps: totalReps }).eq('id', activeDbSessionId);
    activeDbSessionId = null;
  }

  const overlay = document.getElementById('countdown-overlay');
  overlay.classList.remove('active');
  showPage('page-exercises', 'back');
}

function goHome() {
  showPage('page-exercises', 'back');
}

/* ============================================
   WORKOUT HISTORY — Supabase Fetching
   ============================================ */

let HISTORY_SESSIONS = [];

async function generateTestData() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return alert("Must be logged in to generate data.");

  const btn = document.getElementById('btn-gen-data');
  if (btn) btn.disabled = true;

  try {
    // Generate 3 random past sessions
    for (let i = 0; i < 3; i++) {
      const sessionDate = new Date();
      sessionDate.setDate(sessionDate.getDate() - (i + 1)); // 1, 2, 3 days ago

      const totalReps = 45; // 3 sets of 15

      // Insert Session
      const { data: sessionData, error: sessionError } = await supabaseClient
        .from('workout_sessions')
        .insert({
          user_id: user.id,
          created_at: sessionDate.toISOString(),
          exercise_type: 'bicep-curl',
          difficulty: 'medium',
          total_reps: totalReps
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      const sessionId = sessionData.id;

      // Generate Reps for 3 sets
      const repsToInsert = [];
      for (let setNum = 1; setNum <= 3; setNum++) {
        for (let repNum = 1; repNum <= 15; repNum++) {

          // Add some randomness to pace
          const rand = Math.random();
          let quality = 'perfect';
          let duration = 1.86; // perfect base

          if (rand < 0.2) { quality = 'fast'; duration = 1.84; }
          else if (rand > 0.8) { quality = 'slow'; duration = 1.90; }

          // Mock force data array
          const forceData = [];
          for (let ms = 0; ms < (duration * 1000); ms += 50) {
            // Simple bell curve logic
            const progress = ms / (duration * 1000);
            const force = Math.sin(progress * Math.PI) * 15; // Peak force ~15lbs
            forceData.push(parseFloat(force.toFixed(2)));
          }

          repsToInsert.push({
            session_id: sessionId,
            user_id: user.id,
            set_number: setNum,
            rep_number: repNum,
            quality: quality,
            duration: duration,
            force_data: forceData
          });
        }
      }

      // Insert Reps in batch
      const { error: repsError } = await supabaseClient
        .from('workout_reps')
        .insert(repsToInsert);

      if (repsError) throw repsError;
    }

    alert("Test data generated successfully!");
    renderHistoryPage(); // Refresh view
  } catch (err) {
    console.error(err);
    alert("Error generating data");
  } finally {
    if (btn) btn.disabled = false;
  }
}



// ---- Pace Classification ----
// Thresholds calibrated to actual data range (1.81–1.92s per rep):
//   Fast  = below 33rd percentile (~1.855s) → rep executed quickly
//   Slow  = above 67th percentile (~1.875s) → rep executed slowly
//   Perfect = in between
const PACE_FAST_MAX = 1.855;
const PACE_SLOW_MIN = 1.875;


function classifyPace(duration) {
  if (duration < PACE_FAST_MAX) return 'fast';
  if (duration > PACE_SLOW_MIN) return 'slow';
  return 'perfect';
}

function paceEmoji(pace) {
  if (pace === 'fast') return '🐇';
  if (pace === 'slow') return '🐢';
  return '⭐';
}

function paceLabel(pace) {
  if (pace === 'fast') return 'Too Fast';
  if (pace === 'slow') return 'Too Slow';
  return 'Perfect';
}

// ---- Format session timestamp ----
function formatSessionId(createdAt) {
  const d = new Date(createdAt);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// ---- Render History Page ----
async function renderHistoryPage() {
  const list = document.getElementById('history-sessions-list');
  list.innerHTML = '<p class="history-empty">Loading history...</p>';

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    list.innerHTML = '<p class="history-empty">Must be logged in.</p>';
    return;
  }

  // Fetch sessions
  const { data: sessions, error } = await supabaseClient
    .from('workout_sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error || !sessions || sessions.length === 0) {
    list.innerHTML = `
        <div class="history-empty">
            <p>No workout history found.</p>
            <button class="btn-primary" id="btn-gen-data" onclick="generateTestData()" style="margin-top: 20px;">Generate Test Data</button>
        </div>
    `;
    return;
  }

  // Store globally for detail view
  HISTORY_SESSIONS = sessions;

  let htmlStr = '';

  for (let idx = 0; idx < sessions.length; idx++) {
    const session = sessions[idx];

    // Fetch aggregated rep stats for this session
    const { data: statsData, error: statsError } = await supabaseClient
      .rpc('get_session_stats', { session_id_param: session.id }); // Note: We will do client side aggregation to avoid RPC setup for now

    // Fallback: Client side aggregation
    const { data: reps } = await supabaseClient
      .from('workout_reps')
      .select('quality, duration')
      .eq('session_id', session.id);

    session.reps = reps || [];

    const totalReps = session.reps.length;
    const paces = session.reps.map(r => r.quality);
    const perfect = paces.filter(p => p === 'perfect').length;
    const fast = paces.filter(p => p === 'fast').length;
    const slow = paces.filter(p => p === 'slow').length;
    const accuracy = totalReps > 0 ? Math.round((perfect / totalReps) * 100) : 0;
    const avgDur = totalReps > 0
      ? (session.reps.reduce((a, r) => a + r.duration, 0) / totalReps).toFixed(2)
      : '—';

    htmlStr += `
      <div class="history-session-card" onclick="openSessionDetail('${session.id}')">
        <div class="session-card-header">
          <div class="session-card-meta">
            <span class="session-num">${session.exercise_type.replace('-', ' ')}</span>
            <span class="session-date">${formatSessionId(session.created_at)}</span>
          </div>
          <div class="session-accuracy-badge ${accuracy >= 70 ? 'badge-good' : accuracy >= 40 ? 'badge-mid' : 'badge-low'}">
            ${accuracy}%
          </div>
        </div>
        <div class="session-card-stats">
          <div class="sc-stat">
            <span class="sc-stat-val">${totalReps}</span>
            <span class="sc-stat-lbl">Reps</span>
          </div>
          <div class="sc-stat">
            <span class="sc-stat-val">⭐ ${perfect}</span>
            <span class="sc-stat-lbl">Perfect</span>
          </div>
          <div class="sc-stat">
            <span class="sc-stat-val">🐇 ${fast}</span>
            <span class="sc-stat-lbl">Too Fast</span>
          </div>
          <div class="sc-stat">
            <span class="sc-stat-val">🐢 ${slow}</span>
            <span class="sc-stat-lbl">Too Slow</span>
          </div>
        </div>
        <div class="session-card-bar-row">
          <div class="session-mini-bar">
            <div class="smb-perfect" style="width:${(perfect / totalReps) * 100}%"></div>
            <div class="smb-fast" style="width:${(fast / totalReps) * 100}%"></div>
            <div class="smb-slow" style="width:${(slow / totalReps) * 100}%"></div>
          </div>
          <span class="session-avg-dur">avg ${avgDur}s / rep</span>
        </div>
        <div class="session-card-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </div>
      </div>
    `;
  }
  list.innerHTML = htmlStr;
}

// ---- Open Session Detail ----
async function openSessionDetail(sessionId) {
  const session = HISTORY_SESSIONS.find(s => s.id === sessionId);
  if (!session) return;

  // We need to fetch the full rep details, including force_data because the initial list fetch excluded it to save bandwidth
  const { data: fullReps } = await supabaseClient
    .from('workout_reps')
    .select('*')
    .eq('session_id', session.id)
    .order('set_number', { ascending: true })
    .order('rep_number', { ascending: true });

  session.reps = fullReps || [];

  document.getElementById('session-detail-title').textContent = session.exercise_type.replace('-', ' ');

  const totalReps = session.reps.length;
  const paces = session.reps.map(r => r.quality);
  const perfect = paces.filter(p => p === 'perfect').length;
  const fast = paces.filter(p => p === 'fast').length;
  const slow = paces.filter(p => p === 'slow').length;
  const accuracy = totalReps > 0 ? Math.round((perfect / totalReps) * 100) : 0;

  // Summary bar
  const summaryEl = document.getElementById('session-summary-bar');
  summaryEl.innerHTML = `
    <div class="sdb-date">${formatSessionId(session.created_at)}</div>
    <div class="sdb-stats">
      <div class="sdb-stat highlight">
        <span class="sdb-val">${totalReps}</span>
        <span class="sdb-lbl">Total Reps</span>
      </div>
      <div class="sdb-stat">
        <span class="sdb-val">${accuracy}%</span>
        <span class="sdb-lbl">Accuracy</span>
      </div>
      <div class="sdb-stat">
        <span class="sdb-val">⭐ ${perfect}</span>
        <span class="sdb-lbl">Perfect</span>
      </div>
      <div class="sdb-stat">
        <span class="sdb-val">🐇 ${fast}</span>
        <span class="sdb-lbl">Fast</span>
      </div>
      <div class="sdb-stat">
        <span class="sdb-val">🐢 ${slow}</span>
        <span class="sdb-lbl">Slow</span>
      </div>
    </div>
  `;

  // Draw Initial Graph (Set 1)
  const availableSets = [...new Set(session.reps.map(r => r.set_number))];

  if (availableSets.length > 0) {
    drawSessionChart(session.reps, availableSets[0]);

    const toggleContainer = document.getElementById('chart-set-toggles');
    toggleContainer.innerHTML = availableSets.map(setNum => `
          <button class="btn-text-small" style="padding: 4px 12px; border-radius: 12px; background: var(--bg-elevated); color: var(--text-primary); text-decoration: none;" onclick="drawSessionChart(HISTORY_SESSIONS.find(s => s.id === '${sessionId}').reps, ${setNum}, this)">Set ${setNum}</button>
      `).join('');

    // Highlight first button
    setTimeout(() => {
      if (toggleContainer.children[0]) {
        toggleContainer.children[0].style.background = 'var(--accent-primary)';
        toggleContainer.children[0].style.color = 'white';
      }
    }, 50);

    // Add Swipe Support
    const chartContainer = document.querySelector('.session-chart-container');
    let touchStartX = 0;
    let touchEndX = 0;

    chartContainer.ontouchstart = e => {
      touchStartX = e.changedTouches[0].screenX;
    };

    chartContainer.ontouchend = e => {
      touchEndX = e.changedTouches[0].screenX;
      handleSwipe();
    };

    function handleSwipe() {
      const swipedLeft = touchEndX < (touchStartX - 50);
      const swipedRight = touchEndX > (touchStartX + 50);

      const currentLabel = parseInt(document.getElementById('chart-set-label').textContent, 10);
      const currentIndex = availableSets.indexOf(currentLabel);

      if (swipedLeft && currentIndex < availableSets.length - 1) {
        // Next Set
        const nextSet = availableSets[currentIndex + 1];
        const nextBtn = toggleContainer.children[currentIndex + 1];
        drawSessionChart(session.reps, nextSet, nextBtn);
      } else if (swipedRight && currentIndex > 0) {
        // Prev Set
        const prevSet = availableSets[currentIndex - 1];
        const prevBtn = toggleContainer.children[currentIndex - 1];
        drawSessionChart(session.reps, prevSet, prevBtn);
      }
    }
  }

  // Rep list
  const maxDur = Math.max(...session.reps.map(r => r.duration), PACE_SLOW_MIN + 0.5);
  const repsEl = document.getElementById('session-reps-list');
  repsEl.innerHTML = `
    <h3 class="reps-list-title">Rep Breakdown</h3>
    ${session.reps.map((rep, i) => {
    const pace = rep.quality;
    const barPct = Math.min((rep.duration / maxDur) * 100, 100);
    return `
        <div class="rep-row rep-row-${pace}">
          <div class="rep-row-left">
            <span class="rep-row-num">Set ${rep.set_number} - Rep ${rep.rep_number}</span>
            <span class="rep-row-pace">${paceEmoji(pace)} ${paceLabel(pace)}</span>
          </div>
          <div class="rep-row-right">
            <div class="rep-duration-bar-wrap">
              <div class="rep-duration-bar rep-bar-${pace}" style="width:${barPct}%"></div>
            </div>
            <span class="rep-duration-val">${rep.duration.toFixed(2)}s</span>
          </div>
        </div>
      `;
  }).join('')}
  `;

  showPage('page-session-detail');
}

// ---- Chart Instance Globals ----
let sessionChartInstance = null;

function drawSessionChart(allReps, setNumber, btnElement = null) {
  const labelSpan = document.getElementById('chart-set-label');
  if (labelSpan) labelSpan.textContent = setNumber;

  // Update button styling if clicked
  if (btnElement) {
    const container = document.getElementById('chart-set-toggles');
    Array.from(container.children).forEach(btn => {
      btn.style.background = 'var(--bg-elevated)';
      btn.style.color = 'var(--text-primary)';
    });
    btnElement.style.background = 'var(--accent-primary)';
    btnElement.style.color = 'white';
  }

  const setReps = allReps.filter(r => r.set_number === setNumber).sort((a, b) => a.rep_number - b.rep_number);

  // Compile single continuous array of force data for the set
  const compiledData = [];
  const labels = [];
  let cumulativeTimeMs = 0;

  setReps.forEach(rep => {
    if (rep.force_data) {
      // For each rep, the duration is divided across the number of force samples
      const durationMsTotal = (rep.duration || 1.85) * 1000;
      const msPerSample = durationMsTotal / rep.force_data.length;

      rep.force_data.forEach((forceVal) => {
        compiledData.push(forceVal);
        labels.push((cumulativeTimeMs / 1000).toFixed(1) + 's');
        cumulativeTimeMs += msPerSample;
      });
      // Add a visual gap between reps
      compiledData.push(null);
      labels.push('');
      cumulativeTimeMs += 500; // half second gap on the graph
    }
  });

  // Destroy old chart instance
  if (sessionChartInstance) {
    sessionChartInstance.destroy();
    sessionChartInstance = null;
  }

  // Replace the canvas entirely so Chart.js starts with a clean DOM element
  // (prevents accumulated inline height from previous renders)
  const oldCanvas = document.getElementById('session-force-chart');
  const newCanvas = document.createElement('canvas');
  newCanvas.id = 'session-force-chart';
  newCanvas.width = 400;
  newCanvas.height = 400;
  oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);

  const ctx = newCanvas.getContext('2d');

  sessionChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Force Applied (lbs)',
        data: compiledData,
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 2,
        pointRadius: 0,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 8,
            maxRotation: 0
          },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          suggestedMax: 3000
        }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}

// ---- History Navigation ----
document.getElementById('exercises-history-btn').addEventListener('click', () => {
  renderHistoryPage();
  showPage('page-history');
});

document.getElementById('history-back').addEventListener('click', () => {
  showPage('page-exercises', 'back');
});

document.getElementById('session-detail-back').addEventListener('click', () => {
  showPage('page-history', 'back');
});

// ---- Load history data on startup ----
// We no longer load it on startup, only when navigating to page explicitly via renderHistoryPage();


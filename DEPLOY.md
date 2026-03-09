# ResistBand Pro — Deployment Guide

A step-by-step guide to get the full system (Phone App ↔ Vercel Server ↔ ESP32) running.

---

## Step 1 — Supabase: Create New Tables

1. Go to [supabase.com](https://supabase.com) → your project → **SQL Editor**
2. Click **New query**, paste the contents of `supabase_setup.sql`, and click **Run**
3. You should see three new tables: `device_commands`, `device_status`, `device_rep_queue`

---

## Step 2 — GitHub: Push Your Project Files

**Yes — it's exactly as simple as you thought!**

1. Go to [github.com](https://github.com) and sign in (or create a free account)
2. Click the **+** button → **New repository**
3. Name it (e.g. `resistband-pro`), set it to **Public**, click **Create repository**
4. On the next page, click **uploading an existing file**
5. Drag-and-drop the entire contents of your `AppFinal` folder, including:
   - `index.html`, `styles.css`, `app.js`
   - `vercel.json`, `package.json`
   - The entire `api/` folder (with `command.js`, `rep.js`, `status.js`)
   - The `audio/` folder
6. Click **Commit changes**

> **Note:** Do NOT upload `AppFinal.ino` to GitHub if you're concerned about WiFi credentials.  
> The `.ino` file only lives on your computer and gets flashed directly to the ESP32.

---

## Step 3 — Vercel: Deploy the App

1. Go to [vercel.com](https://vercel.com) → sign in with your **GitHub account**
2. Click **Add New → Project**
3. Find your `resistband-pro` repo and click **Import**
4. In **Environment Variables**, add these two (click **Add**):

   | Name | Value |
   |------|-------|
   | `SUPABASE_URL` | `https://lnptfqkxcznzjjwmrlwl.supabase.co` |
   | `SUPABASE_ANON_KEY` | *(your anon key from app.js line 7)* |

5. Click **Deploy** — Vercel will build and give you a URL like `https://resistband-pro.vercel.app`

---

## Step 4 — Update Your Code with the Real Vercel URL

You need to replace `YOUR-PROJECT` in two files with your actual Vercel URL:

### `app.js` (line ~38)
```js
const VERCEL_URL = 'https://resistband-pro.vercel.app'; // ← your real URL
```

### `AppFinal.ino` (line ~50)
```cpp
const char* SERVER = "https://resistband-pro.vercel.app"; // ← your real URL
```

After updating `app.js`, go back to GitHub, edit the file there (click the pencil icon), paste the new URL, and commit. Vercel will auto-redeploy in ~30 seconds.

---

## Step 5 — Arduino: Install Required Libraries

In Arduino IDE → **Sketch → Include Library → Manage Libraries**, install:

| Library | Minimum Version |
|---------|----------------|
| `ArduinoJson` by Benoit Blanchon | 6.x |
| `ESP32Servo` | any |
| `HX711 Arduino Library` by Bogdan Necula | any |
| `Adafruit SSD1306` | any |
| `Adafruit GFX` | any |
| `Adafruit AS5600` | any |

---

## Step 6 — Flash the ESP32

1. Open `AppFinal.ino` in Arduino IDE
2. Confirm the Vercel URL is updated (Step 4)
3. Select your board: **Tools → Board → ESP32 Dev Module**
4. Select the correct COM port
5. Click **Upload**
6. Open **Serial Monitor** (115200 baud) and watch for:
   - `WiFi connected: 192.168.x.x`
   - `Status posted: ready`

---

## Step 7 — Verify End-to-End

1. **OLED** shows "Ready" after boot
2. Open the web app (your Vercel URL) on your phone
3. Log in → navigate to Devices page
4. The device card should show a **green dot** (online)
5. Select exercise → pick difficulty → press **Start**
6. Watch the motor adjust the band length
7. When OLED shows "Ready", the app countdown starts
8. Do actual reps — app shows Perfect / Too Fast / Too Slow in real-time

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Device shows offline on app | Check ESP32 serial monitor — WiFi connected? Vercel URL correct? |
| App hangs waiting for "ready" | ESP32 may be still moving — wait 30s, or check Serial Monitor |
| Rep counter doesn't increment | Check Serial Monitor for "Rep complete" messages. Adjust `FORCE_PULL_THRESHOLD` in `.ino` |
| 500 error from Vercel API | Check Vercel dashboard → Functions tab for error logs. Usually a missing env var |
| ArduinoJson compile error | Ensure version 6.x (not v7) of ArduinoJson is installed |

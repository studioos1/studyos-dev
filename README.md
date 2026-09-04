# StudyOS — Personal Study Assistant

A personal AI-powered study planner. Daily briefing, weekly schedule, assignments, exams, and progress tracking — all in one place.

---

## What you need

- A Mac (macOS 11 or later)
- An Anthropic API key → get one free at **console.anthropic.com**

---

## Installation (one time, ~5 minutes)

### Step 1 — Install Node.js

Open **Terminal** (press `Cmd+Space`, type "Terminal", press Enter) and run:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

When that finishes:

```
brew install node
```

Verify it worked:

```
node --version
```

You should see something like `v20.x.x`. If you do, Node is installed.

---

### Step 2 — Set up StudyOS

Move the `studyos` folder anywhere you like (Desktop is fine). Then in Terminal:

```
cd ~/Desktop/studyos
npm install
```

This downloads the dependencies. Takes about 30 seconds.

---

### Step 3 — Add your API key

1. Go to **console.anthropic.com** → sign up free → API Keys → Create Key
2. Copy the key (starts with `sk-ant-...`)
3. In the `studyos` folder, duplicate `.env.template` and rename it to `.env`
4. Open `.env` in any text editor and replace `your-api-key-here` with your key:

```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxx
```

Save the file.

---

## Starting the app

Every time you want to use StudyOS, open Terminal and run:

```
cd ~/Desktop/studyos
npm start
```

Then open your browser and go to:

```
http://localhost:3000
```

To stop the app: press `Ctrl+C` in Terminal.

---

## First time setup (in the browser)

1. The app will walk you through a 7-step setup (~3 minutes)
2. Upload your **class schedule PDF** (from MyPortal → Enrollment → Class Schedule → Save as PDF)
3. Upload your **syllabus PDFs** — AI extracts all deadlines automatically
4. Set your gym days, meal times, sleep schedule
5. Hit **Launch StudyOS**

Your data saves in the browser automatically. It's private — nothing is sent to any server except the AI prompts.

---

## Daily use

- Open Terminal → `cd ~/Desktop/studyos` → `npm start`
- Go to `http://localhost:3000`
- The **Daily Briefing** generates automatically each morning
- Check **Assignments** and **Exams** to manage deadlines
- Use **My Week** to see your full weekly schedule
- **Settings** to update anything

---

## Updating when you transfer to UCSD

In **Settings → School Info**:
- Change school name to "UC San Diego"
- Change address to UCSD campus address
- Uncheck "Use De Anza calendar"
- Click **Re-run setup** to upload your new UCSD schedule PDF

---

## Troubleshooting

**"npm: command not found"** → Node wasn't installed correctly. Repeat Step 1.

**"Cannot connect" or blank page** → Make sure you ran `npm start` and go to `http://localhost:3000` (not https).

**"No API key" error** → Check your `.env` file has the correct key with no extra spaces.

**App feels slow / AI not responding** → Check your internet connection. The AI calls go to Anthropic's servers.

**Lost all my data** → Data is stored in your browser's localStorage. Don't clear browser data for localhost.

---

## API cost

Very low. Each daily briefing costs roughly $0.01–0.02. A full month of daily use is under $1.

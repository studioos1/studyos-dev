# StudyOS — Personal Study Assistant

A personal AI-powered study planner. Daily briefing, weekly schedule, assignments, exams, and progress tracking — all in one place.

---

# Part 1 — For students (using the app)

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

You should see something like `v20.x.x` or later. If you do, Node is installed.

### Step 2 — Get StudyOS

Download or clone this repository, then in Terminal:

```
cd studyos-dev
npm install
```

This downloads the dependencies. Takes about 30 seconds.

### Step 3 — Add your API key

1. Go to **console.anthropic.com** → sign up free → API Keys → Create Key
2. Copy the key (starts with `sk-ant-...`)
3. In the `studyos-dev` folder, duplicate `.env.template` and rename it to `.env`
4. Open `.env` in any text editor and replace `your-api-key-here` with your key:

```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxx
```

Save the file.

---

## Starting the app

Every time you want to use StudyOS, open Terminal and run:

```
cd studyos-dev
npm run dev
```

Then open your browser and go to:

```
http://localhost:3000
```

To stop the app: press `Ctrl+C` in Terminal.

---

## First time setup (in the browser)

1. The app will walk you through a 7-step setup (~3 minutes)
2. Upload your **class schedule PDF** (from your school portal's enrollment/schedule page → Save as PDF)
3. Upload your **syllabus PDFs** — AI extracts all deadlines automatically
4. Set your gym days, meal times, sleep schedule
5. Hit **Launch StudyOS**

Your data saves in the browser automatically. It's private — nothing is sent to any server except the AI prompts.

---

## Daily use

- Open Terminal → `cd studyos-dev` → `npm run dev`
- Go to `http://localhost:3000`
- The **Today** tab generates your daily briefing automatically
- Check **Academics** to manage assignments, exams, and grades
- Use **Weekly** to see your full week's schedule
- **Preferences** and **School Info** to update anything

---

## Transferring schools

StudyOS supports multiple schools and terms — your history is kept, nothing is overwritten.

In **School Info**:
1. Click **Add term**
2. Type your new school's name (auto-fills address, quarter/semester, and current term dates when it can find them — otherwise fill in manually)
3. Save

The app automatically switches the active term to whichever one is current based on real dates — your old school's courses and grades stay archived, viewable any time from the School Info tab.

---

## Troubleshooting

**"npm: command not found"** → Node wasn't installed correctly. Repeat Step 1.

**"Cannot connect" or blank page** → Make sure you ran `npm run dev` and go to `http://localhost:3000` (not https).

**"No API key" error** → Check your `.env` file has the correct key with no extra spaces.

**App feels slow / AI not responding** → Check your internet connection. The AI calls go to Anthropic's servers.

**Lost all my data** → Data is stored in your browser's localStorage. Don't clear browser data for localhost.

---

## API cost

Very low. Each daily briefing costs roughly $0.01–0.02. A full month of daily use is under $1.

---

# Part 2 — For developers (contributing)

## Architecture

- **Next.js (App Router, JavaScript)** — `app/` holds the routes: `app/page.jsx` mounts the app client-side, `app/layout.jsx` carries fonts/pdf.js, `app/api/*/route.js` are the four server-side endpoints (`ai`, `course-info`, `college-calendar`, `health`) that proxy the Anthropic API so the key never reaches the browser.
- **`components/App.jsx`** — the main React component. Currently one large client component covering all seven tabs (Today, Weekly, Academics, Progress, History, School Info, Preferences) — being incrementally broken into modules; see the roadmap for the plan.
- **`lib/`** — extracted, independently-tested modules:
  - `lib/time.js`, `lib/courses.js` — small shared pure helpers
  - `lib/planner/` — the scheduling engine (`buildItemDemand`, `planDayV2`, `placeCourseBlocks`, `preflightRiskCheck`, `planHorizon`) and the difficulty/hours/priority estimator. Fully unit-tested (see `npm test` below) and has zero dependency on React or the browser — pure functions in, plain data out.
- **`server.js`** — the original Express server this app started as. Kept for reference (`npm run legacy-server`), not used by `npm run dev`/`npm start`.
- **Data model** — everything (profile, courses, assignments, exams, the generated study plan, logs) lives in one JSON blob in the browser's `localStorage`. There is no backend database yet — that's a planned later phase (multi-user accounts + a real datastore), not built.

## Dev setup

```
git clone https://github.com/studioos1/studyos-dev.git
cd studyos-dev
npm install
cp .env.template .env      # then add your ANTHROPIC_API_KEY
npm run dev                # http://localhost:3000
```

Other commands:

```
npm test                   # planner test suite (Vitest) — should stay green
npm run test:watch         # same, in watch mode
npm run build               # production build — this is what CI runs
```

## Contributing

`main` is protected — no direct pushes, every change goes through a pull request.

```
git checkout -b your-branch-name
# make your change
git add -A && git commit -m "what you changed and why"
git push -u origin your-branch-name
```

Then open a PR on GitHub. **CI runs automatically** (`npm test` + `npm run build`) and must pass before the merge button unlocks. Once green, merge from the GitHub UI.

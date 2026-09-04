require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── AI Proxy ──────────────────────────────────────────────────────────────────
app.post('/api/ai', async (req, res) => {
  try {
    const { system, prompt, maxTokens = 1500, temperature, model } = req.body;
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('your-api-key-here')) {
      return res.status(500).json({ error: 'Add your API key to the .env file' });
    }
    const messages = system
      ? [{ role: 'user', content: `[INSTRUCTIONS]\n${system}\n\n[REQUEST]\n${prompt}` }]
      : [{ role: 'user', content: prompt }];
    const body = { model: model || 'claude-sonnet-4-5', max_tokens: maxTokens, messages };
    // temperature is opt-in per call — most calls (briefs, motivational text) benefit from the
    // model's default variety; extraction/classification calls pass temperature:0 explicitly to
    // minimize (not eliminate — Anthropic's own docs note even temp:0 isn't fully deterministic)
    // run-to-run drift on judgment calls like "is this a quiz or an exam".
    if (temperature !== undefined) body.temperature = temperature;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'API error' });
    const text = data.content?.map(b => b.text || '').join('') || '';
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Course difficulty lookup ───────────────────────────────────────────────────
app.post('/api/course-info', async (req, res) => {
  try {
    const { courseName, courseCode } = req.body;
    const query = `${courseCode || ''} ${courseName} De Anza College difficulty rating`;
    const searchRes = await fetch(`https://api.anthropic.com/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You are a college academic advisor. Rate this De Anza College course for difficulty and study time needed.

Course: ${courseName} ${courseCode ? `(${courseCode})` : ''}

Return ONLY valid JSON:
{
  "difficultyScore": 7,
  "difficultyLabel": "Heavy",
  "weeklyStudyHours": 8,
  "startExamPrepDays": 7,
  "description": "one sentence about what makes this course challenging or manageable",
  "tips": ["one specific study tip for this subject"]
}

difficultyScore 1-10: 1-3=Light, 4-6=Medium, 7-8=Heavy, 9-10=Intense
weeklyStudyHours: realistic hours needed outside class
startExamPrepDays: how many days before exam to start studying`
        }]
      })
    });
    const data = await searchRes.json();
    const text = data.content?.map(b => b.text || '').join('') || '{}';
    const info = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.json(info);
  } catch (err) {
    res.status(500).json({ difficultyScore: 5, difficultyLabel: 'Medium', weeklyStudyHours: 6, startExamPrepDays: 5 });
  }
});

// ── College calendar lookup ─────────────────────────────────────────────────
// Uses Claude's web_search tool (the plain /api/ai proxy above has no tool access) to find a
// specific college's real address, schedule type, and current/upcoming term dates + holidays —
// none of which a model's training data alone can reliably know, since term dates change every
// year. Prefers official .edu sources; the student always sees and can edit whatever comes back.
app.post('/api/college-calendar', async (req, res) => {
  try {
    const { schoolName } = req.body;
    if (!schoolName) return res.status(400).json({ error: 'schoolName is required' });
    if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('your-api-key-here')) {
      return res.status(500).json({ error: 'Add your API key to the .env file' });
    }
    const today = new Date().toISOString().split('T')[0];
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{
          role: 'user',
          content: `Today's date is ${today}. Search for "${schoolName}"'s official academic calendar. Prefer the school's own .edu domain over aggregator sites. Find:
1. The school's main campus mailing address.
2. Whether it runs on a semester or quarter academic system.
3. The CURRENT term if one is in progress today, otherwise the NEXT upcoming term — its name, start date, and end date (the end date must be the LAST DAY OF FINALS, not the last day of regular classes).
4. Every official holiday or break that falls within that term window (federal holidays the school observes, plus any school-specific breaks like Thanksgiving break, spring recess, etc).

After searching, respond with ONLY a single JSON object in exactly this shape, no other text before or after it:
{
  "address": "street address, city, state zip",
  "scheduleType": "semester" or "quarter",
  "termName": "e.g. Fall 2026",
  "termStart": "YYYY-MM-DD",
  "termEnd": "YYYY-MM-DD",
  "holidays": [
    {"name": "...", "date": "YYYY-MM-DD"},
    {"name": "...", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}
  ],
  "sourceUrl": "the official page you found this on"
}
If you genuinely cannot find reliable current information for a field, use null for that field rather than guessing.`
        }]
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message || 'API error' });
    // BUG FIX: joining every text block together is wrong — when web search is used, Claude
    // typically emits a SEPARATE narration text block before the search ("I'll search for...")
    // and the actual final answer in a LATER text block after results come back. Concatenating
    // them produced things like "I'll search for X...{ actual JSON }", which JSON.parse rejects
    // every time. Only the LAST text block is the real final answer.
    const textBlocks = data.content?.filter(b => b.type === 'text').map(b => b.text || '') || [];
    const lastText = textBlocks[textBlocks.length - 1] || '{}';
    // Extra safety net: even with explicit "respond with ONLY JSON" instructions, pull out just
    // the {...} substring rather than assuming the whole block is clean JSON — handles stray
    // leading/trailing prose or code-fence formatting the model might still add.
    const jsonMatch = lastText.match(/\{[\s\S]*\}/);
    const cleaned = jsonMatch ? jsonMatch[0] : lastText.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('StudyOS: college-calendar JSON parse failed. Raw model output:', lastText);
      throw parseErr;
    }
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasApiKey: !!(process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('your-api-key-here')),
    time: new Date().toISOString()
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅ StudyOS running at http://localhost:${PORT}`);
  console.log(`   API key: ${process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.includes('your-api-key-here') ? '✓ found' : '✗ MISSING'}\n`);
});

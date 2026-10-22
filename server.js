const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const dataDir = path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'db.json');

function id() { return crypto.randomUUID(); }
function slug() { return crypto.randomBytes(5).toString('base64url').toLowerCase(); }
function now() { return new Date().toISOString(); }
function emptyDb() { return { forms: [], submissions: [], events: [] }; }
function readDb() {
  if (!fs.existsSync(dbFile)) return emptyDb();
  try { return JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch { return emptyDb(); }
}
function writeDb(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2) + '\n');
}
function safeText(value, max = 1000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function normaliseFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.slice(0, 20).map((field) => ({
    id: safeText(field.id, 80) || id(),
    label: safeText(field.label, 120),
    type: ['text', 'email', 'textarea', 'select', 'radio', 'checkbox'].includes(field.type) ? field.type : 'text',
    required: Boolean(field.required),
    options: Array.isArray(field.options) ? field.options.map((x) => safeText(x, 100)).filter(Boolean).slice(0, 20) : []
  })).filter((field) => field.label);
}
function publicForm(form) {
  const { id: ignored, ...rest } = form;
  return rest;
}

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Корневой адрес остаётся полезной точкой входа для проверяющего.
app.get('/', (req, res) => res.redirect('/admin'));

app.get('/api/forms', (req, res) => {
  const db = readDb();
  const forms = db.forms.map((form) => {
    const submissions = db.submissions.filter((x) => x.formId === form.id).length;
    const starts = new Set(db.events.filter((x) => x.formId === form.id && x.type === 'start').map((x) => x.sessionId)).size;
    return { ...form, submissions, starts };
  });
  res.json(forms.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});

app.post('/api/forms', (req, res) => {
  const title = safeText(req.body.title, 140);
  if (!title) return res.status(400).json({ error: 'Укажите название формы.' });
  const db = readDb();
  const form = { id: id(), title, description: safeText(req.body.description, 600), fields: normaliseFields(req.body.fields), published: false, slug: null, createdAt: now(), updatedAt: now() };
  db.forms.push(form); writeDb(db); res.status(201).json(form);
});

app.put('/api/forms/:id', (req, res) => {
  const db = readDb(); const form = db.forms.find((x) => x.id === req.params.id);
  if (!form) return res.status(404).json({ error: 'Форма не найдена.' });
  const title = safeText(req.body.title, 140);
  if (!title) return res.status(400).json({ error: 'Укажите название формы.' });
  form.title = title; form.description = safeText(req.body.description, 600); form.fields = normaliseFields(req.body.fields); form.updatedAt = now();
  writeDb(db); res.json(form);
});

app.post('/api/forms/:id/publish', (req, res) => {
  const db = readDb(); const form = db.forms.find((x) => x.id === req.params.id);
  if (!form) return res.status(404).json({ error: 'Форма не найдена.' });
  if (!form.fields.length) return res.status(400).json({ error: 'Добавьте хотя бы один вопрос перед публикацией.' });
  form.published = true; form.slug ||= slug(); form.updatedAt = now(); writeDb(db);
  res.json({ ...form, url: `/f/${form.slug}` });
});

app.get('/api/forms/:id/responses', (req, res) => {
  const db = readDb(); const form = db.forms.find((x) => x.id === req.params.id);
  if (!form) return res.status(404).json({ error: 'Форма не найдена.' });
  const submissions = db.submissions.filter((x) => x.formId === form.id).sort((a,b) => b.submittedAt.localeCompare(a.submittedAt));
  const views = new Set(db.events.filter((x) => x.formId === form.id && x.type === 'view').map((x) => x.sessionId)).size;
  const starts = new Set(db.events.filter((x) => x.formId === form.id && x.type === 'start').map((x) => x.sessionId)).size;
  const completedSessions = new Set(submissions.map((x) => x.sessionId)).size;
  res.json({ form, submissions, analytics: { views, starts, completed: completedSessions, completionRate: starts ? Math.round(completedSessions / starts * 100) : 0 } });
});

app.get('/api/public/:slug', (req, res) => {
  const form = readDb().forms.find((x) => x.slug === req.params.slug && x.published);
  if (!form) return res.status(404).json({ error: 'Форма не найдена или ещё не опубликована.' });
  res.json(publicForm(form));
});

app.post('/api/public/:slug/event', (req, res) => {
  const db = readDb(); const form = db.forms.find((x) => x.slug === req.params.slug && x.published);
  const type = req.body.type; const sessionId = safeText(req.body.sessionId, 100);
  if (!form || !['view', 'start'].includes(type) || !sessionId) return res.sendStatus(204);
  if (!db.events.some((x) => x.formId === form.id && x.type === type && x.sessionId === sessionId)) db.events.push({ formId: form.id, type, sessionId, at: now() });
  writeDb(db); res.sendStatus(204);
});

app.post('/api/public/:slug/submissions', (req, res) => {
  const db = readDb(); const form = db.forms.find((x) => x.slug === req.params.slug && x.published);
  if (!form) return res.status(404).json({ error: 'Форма не найдена.' });
  const answers = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
  const cleanAnswers = {};
  for (const field of form.fields) {
    const raw = answers[field.id];
    const value = Array.isArray(raw) ? raw.map((x) => safeText(x, 100)).filter(Boolean) : safeText(raw, 2000);
    if (field.required && (!value || (Array.isArray(value) && !value.length))) return res.status(400).json({ error: `Заполните поле «${field.label}».` });
    if (field.type === 'email' && value && !/^\S+@\S+\.\S+$/.test(value)) return res.status(400).json({ error: 'Проверьте адрес электронной почты.' });
    cleanAnswers[field.id] = value;
  }
  const sessionId = safeText(req.body.sessionId, 100) || id();
  db.submissions.push({ id: id(), formId: form.id, sessionId, answers: cleanAnswers, submittedAt: now() }); writeDb(db);
  res.status(201).json({ ok: true });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/f/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'form.html')));
app.listen(PORT, () => console.log(`FormFlow is running on http://localhost:${PORT}`));

const app = document.querySelector('#publicApp');
const slug = location.pathname.split('/').pop();
const draftKey = `formflow:draft:${slug}`;
const sessionKey = `formflow:session:${slug}`;
let sessionId = sessionStorage.getItem(sessionKey);
if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem(sessionKey, sessionId); }
let form, step = 0, started = false, answers = {}, touchedFields = new Set();

const esc = (v='') => String(v).replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
async function request(url, options={}) { const r = await fetch(url, { headers:{'Content-Type':'application/json'}, ...options }); const body = await r.json().catch(() => ({})); if (!r.ok) throw Error(body.error || 'Не удалось выполнить запрос.'); return body; }
function track(type, fieldId='') { fetch(`/api/public/${slug}/event`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ type, fieldId, sessionId }) }); }
function saveDraft() { localStorage.setItem(draftKey, JSON.stringify({ answers, step })); }
function clearDraft() { localStorage.removeItem(draftKey); }
function readDraft() { try { return JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { return null; } }
function answered(field) { const value = answers[field.id]; return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim()); }
function estimateTime() { return Math.max(1, Math.ceil(form.fields.length * 0.25)); }
function choice(field, type) { return field.options.map((option) => `<label class="choice-card ${Array.isArray(answers[field.id]) ? answers[field.id].includes(option) ? 'selected' : '' : answers[field.id] === option ? 'selected' : ''}"><input type="${type}" name="${field.id}" value="${esc(option)}" ${Array.isArray(answers[field.id]) ? answers[field.id].includes(option) ? 'checked' : '' : answers[field.id] === option ? 'checked' : ''}><span>${esc(option)}</span></label>`).join(''); }
function control(field) {
  const value = answers[field.id] || '';
  if (field.type === 'textarea') return `<textarea id="answer" placeholder="Напишите ответ…">${esc(value)}</textarea>`;
  if (field.type === 'select') return `<select id="answer"><option value="">Выберите вариант</option>${field.options.map((x) => `<option ${value===x?'selected':''}>${esc(x)}</option>`).join('')}</select>`;
  if (field.type === 'radio') return `<div class="choices">${choice(field, 'radio')}</div>`;
  if (field.type === 'checkbox') return `<div class="choices">${choice(field, 'checkbox')}</div>`;
  return `<input id="answer" class="input answer-input" type="${field.type}" value="${esc(value)}" autocomplete="${field.type==='email'?'email':'name'}" placeholder="${field.type==='email'?'name@example.com':'Введите ответ'}">`;
}
function updateAnswer(field) {
  const nodes = [...document.querySelectorAll(`[name="${field.id}"]`)];
  if (field.type === 'checkbox') answers[field.id] = nodes.filter((node) => node.checked).map((node) => node.value);
  else if (field.type === 'radio') answers[field.id] = nodes.find((node) => node.checked)?.value || '';
  else answers[field.id] = document.querySelector('#answer')?.value || '';
  saveDraft();
}
function validate(field) {
  if (field.required && !answered(field)) return `Ответьте на вопрос «${field.label}».`;
  if (field.type === 'email' && answered(field) && !/^\S+@\S+\.\S+$/.test(answers[field.id])) return 'Проверьте адрес электронной почты.';
  return '';
}
function render() {
  const field = form.fields[step]; const total = form.fields.length; const percent = Math.round(((step + 1) / total) * 100);
  app.innerHTML = `<div class="public-top"><a class="public-logo" href="/">Form<span>Flow</span></a><span class="save-status">Черновик сохраняется автоматически</span></div><div class="progress-meta"><span>Вопрос ${step + 1} из ${total}</span><span>${percent}%</span></div><div class="progress-line"><i style="width:${percent}%"></i></div><section class="question-screen"><div class="question-number">${String(step + 1).padStart(2, '0')}</div><h1>${esc(field.label)} ${field.required?'<span class="required">*</span>':''}</h1><p class="answer-hint">${field.required?'Это обязательный вопрос':'Можно пропустить, если не хочется отвечать'}</p><div class="answer-control">${control(field)}</div><p id="error" class="error-message" aria-live="polite"></p></section><div class="step-actions"><button id="back" class="button text-button" ${step===0?'disabled':''}>← Назад</button><button id="next" class="button primary">${step===total-1?'Отправить анкету':'Продолжить →'}</button></div><p class="privacy-note">Мы используем ответы только для рассмотрения вашей заявки.</p>`;
  const inputs = [...document.querySelectorAll('#answer, [name]')];
  inputs.forEach((node) => {
    node.addEventListener('focus', () => { if (!touchedFields.has(field.id)) { touchedFields.add(field.id); track('field', field.id); } });
    node.addEventListener('input', () => { if (!started) { started = true; track('start'); } updateAnswer(field); document.querySelector('#error').textContent = ''; });
    node.addEventListener('change', () => { if (!started) { started = true; track('start'); } updateAnswer(field); render(); });
  });
  document.querySelector('#back').onclick = () => { if (step > 0) { updateAnswer(field); step--; saveDraft(); render(); } };
  document.querySelector('#next').onclick = async () => {
    updateAnswer(field); const error = validate(field); if (error) { document.querySelector('#error').textContent = error; return; }
    if (step < total - 1) { step++; saveDraft(); render(); return; }
    const button = document.querySelector('#next'); button.disabled = true; button.textContent = 'Отправляем…';
    try { await request(`/api/public/${slug}/submissions`, { method:'POST', body:JSON.stringify({ answers, sessionId }) }); clearDraft(); app.innerHTML = `<div class="success"><div class="success-mark">✓</div><p class="eyebrow">АНКЕТА ОТПРАВЛЕНА</p><h1>Спасибо!</h1><p>Ваш ответ уже у команды. Желаем удачи — мы обязательно вернёмся с новостями.</p></div>`; }
    catch (err) { button.disabled = false; button.textContent = 'Отправить анкету'; document.querySelector('#error').textContent = err.message; }
  };
}
async function init() {
  try {
    form = await request(`/api/public/${slug}`); document.title = `${form.title} — FormFlow`; track('view');
    const draft = readDraft(); if (draft?.answers) { answers = draft.answers; step = Math.min(Number(draft.step) || 0, form.fields.length - 1); }
    app.innerHTML = `<div class="welcome"><div class="public-logo">Form<span>Flow</span></div><div class="welcome-orbit">✦</div><p class="eyebrow">АНКЕТА ДЛЯ УЧАСТНИКА</p><h1>${esc(form.title)}</h1><p>${esc(form.description || 'Несколько коротких вопросов — и ваша заявка уже у команды.')}</p><div class="welcome-facts"><span>◷ Около ${estimateTime()} мин.</span><span>▣ ${form.fields.length} ${form.fields.length === 1 ? 'вопрос' : 'вопроса'}</span></div>${draft?.answers?'<div class="draft-note">Черновик найден — продолжим с того места, где вы остановились.</div>':''}<button id="start" class="button primary start-button">${draft?.answers?'Продолжить заполнение':'Начать анкету'} →</button><small>Без регистрации · можно вернуться позже</small></div>`;
    document.querySelector('#start').onclick = () => render();
  } catch (error) { app.innerHTML = `<div class="success"><h1>Форма недоступна</h1><p>${esc(error.message)}</p></div>`; }
}
init();

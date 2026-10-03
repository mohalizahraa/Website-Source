const STATUS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  review: 'Review',
  completed: 'Completed',
  published: 'Published',
};
const STATUS_ORDER = Object.keys(STATUS);
const ASSIGNEES = ['Zahraa','Mohammed','Both','Unassigned'];
const savedActor = localStorage.getItem('haydariActor');
const state = { projects: [], activity: [], pdfAudit: null, coverMap: {}, coverObjectUrls: new Map(), coverLoads: new Map(), view: 'dashboard', key: '', actor: ['Zahraa', 'Mohammed'].includes(savedActor) ? savedActor : 'Zahraa' };

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'), gate: $('access-gate'), title: $('view-title'), search: $('search'), actor: $('actor'), dialog: $('project-dialog'),
  form: $('project-form'), toast: $('toast'),
};

function readKey() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const incoming = params.get('key');
  if (incoming) {
    localStorage.setItem('haydariWorkbenchKey', incoming);
    history.replaceState(null, '', location.pathname + location.search);
    return incoming;
  }
  return localStorage.getItem('haydariWorkbenchKey') || '';
}

async function authenticatedFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('x-workbench-key', state.key);
  headers.set('x-workbench-actor', state.actor);
  return fetch(path, { ...options, headers });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-workbench-key': state.key,
      'x-workbench-actor': state.actor,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function toast(message) {
  els.toast.textContent = message; els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 1800);
}

function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
function dateText(value) { return value ? new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}) : 'No deadline'; }
function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function parseDateTime(value) {
  if (!value) return null;
  const raw=String(value);
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:/.test(raw) ? raw.replace(' ','T')+'Z' : raw;
  const date=new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
function isDone(p) { return ['completed','published'].includes(p.status); }
function coverFor(p) { const imported=state.coverMap[p?.catalog_id]; return p?.cover_url || imported?.path || imported?.source_url || ''; }
function assigneeOptions(current) { return ASSIGNEES.map(name => `<option value="${name}" ${current===name?'selected':''}>${name}</option>`).join(''); }
function coverMarkup(p, compact=false) {
  const cached = state.coverObjectUrls.get(p.id) || '';
  const fallback = coverFor(p);
  const src = cached || fallback;
  const privateAttr = p.has_uploaded_cover ? ` data-uploaded-cover="${p.id}"` : '';
  if (src) return `<img class="book-cover ${compact ? 'compact-cover' : ''}"${privateAttr} src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><svg class="rosette cover-fallback" hidden aria-hidden="true"><use href="#rosette"></use></svg>`;
  if (p.has_uploaded_cover) return `<img class="book-cover ${compact ? 'compact-cover' : ''}" data-uploaded-cover="${p.id}" hidden alt=""><svg class="rosette cover-fallback" aria-hidden="true"><use href="#rosette"></use></svg>`;
  return `<svg class="rosette cover-fallback" aria-hidden="true"><use href="#rosette"></use></svg>`;
}
function googleDocLinkMarkup(p) {
  return p.google_doc_url
    ? `<a class="mini-link secondary-link english-book-link" href="${escapeHtml(p.google_doc_url)}" target="_blank" rel="noopener">English Book</a>`
    : `<button class="mini-link secondary-link english-book-button" type="button" data-link-english="${p.id}">English Book · link</button>`;
}
function quickControlsMarkup(p, compact=false) {
  return `<div class="quick-controls ${compact ? 'compact-quick-controls' : ''}">
    <label class="quick-field"><span>Assigned</span><select class="quick-assignee" data-project-id="${p.id}" draggable="false" aria-label="Assign ${escapeHtml(p.title_ar)}">${assigneeOptions(p.assignee)}</select></label>
    <label class="quick-field"><span>Deadline</span><input class="quick-deadline" data-project-id="${p.id}" draggable="false" type="date" value="${escapeHtml(p.due_date || '')}" aria-label="Deadline for ${escapeHtml(p.title_ar)}"></label>
  </div>`;
}

function setCoverObjectUrl(id, blob) {
  const old = state.coverObjectUrls.get(id);
  if (old) URL.revokeObjectURL(old);
  const url = URL.createObjectURL(blob);
  state.coverObjectUrls.set(id, url);
  document.querySelectorAll(`[data-uploaded-cover="${id}"]`).forEach(img => {
    img.src = url;
    img.hidden = false;
    if (img.nextElementSibling?.classList.contains('cover-fallback')) img.nextElementSibling.hidden = true;
  });
  return url;
}

async function ensureUploadedCover(id) {
  if (state.coverObjectUrls.has(id)) return state.coverObjectUrls.get(id);
  if (state.coverLoads.has(id)) return state.coverLoads.get(id);
  const load = (async () => {
    try {
      const response = await authenticatedFetch(`/api/cover/${id}`, { headers: { accept: 'image/*' } });
      if (!response.ok) return null;
      const blob = await response.blob();
      return setCoverObjectUrl(id, blob);
    } catch {
      return null;
    } finally {
      state.coverLoads.delete(id);
    }
  })();
  state.coverLoads.set(id, load);
  return load;
}

function hydrateUploadedCovers(root=document) {
  const ids = [...new Set([...root.querySelectorAll('[data-uploaded-cover]')].map(img => Number(img.dataset.uploadedCover)).filter(Boolean))];
  ids.forEach(id => ensureUploadedCover(id));
}

function filteredProjects() {
  const q = els.search.value.trim().toLowerCase();
  const assignee = $('filter-assignee')?.value || '';
  const status = $('filter-status')?.value || '';
  const blocked = $('filter-blocked')?.checked || false;
  const missingPdf = $('filter-missing-pdf')?.checked || false;
  return state.projects.filter(p => {
    const text = `${p.title_ar} ${p.title_en || ''} ${p.translit || ''} ${p.author || ''} ${p.author_ar || ''} ${p.category || ''}`.toLowerCase();
    return (!q || text.includes(q))
      && (!assignee || p.assignee === assignee)
      && (!status || p.status === status)
      && (!blocked || p.blocked)
      && (!missingPdf || p.pdf_missing);
  });
}

function projectMarkup(p, compact=false) {
  if (compact) {
    return `<article class="project-card" data-project-id="${p.id}" draggable="true">
      <div class="compact-card-head"><div class="compact-cover-slot">${coverMarkup(p,true)}</div><div class="compact-card-titles">
        <div class="title-ar">${escapeHtml(p.title_ar)}</div>
        ${p.title_en ? `<div class="title-en">${escapeHtml(p.title_en)}</div>` : ''}
      </div></div>
      <div class="meta">
        <span class="pill status-${p.status}">${STATUS[p.status]}</span>
        ${p.pdf_missing ? '<span class="pill pdf-missing">PDF missing</span>' : (p.pdf_unchecked ? '<span class="pill">PDF checking…</span>' : '')}
        ${p.blocked ? '<span class="pill blocked">Blocked</span>' : ''}
      </div>
      <div class="entry-actions compact-actions">
        ${p.pdf_available ? `<a class="mini-link pdf" href="/api/pdf/${p.id}" target="_blank" rel="noopener">Arabic PDF</a>` : ''}
        ${googleDocLinkMarkup(p)}
      </div>
      ${quickControlsMarkup(p,true)}
    </article>`;
  }

  const facts = [p.pages ? `${p.pages} pages` : '', p.volumes && p.volumes > 1 ? `${p.volumes} volumes` : ''].filter(Boolean).join(' · ');
  return `<article class="project-row" data-project-id="${p.id}">
    <div class="cover-cell">${coverMarkup(p)}</div>
    <div class="project-main">
      <div class="meta-row">
        <div><span class="rubric">${escapeHtml(p.topic_en || p.category || 'Book')}</span>${p.topic_ar ? `<span class="rubric-ar">${escapeHtml(p.topic_ar)}</span>` : ''}</div>
        <span class="facts">${escapeHtml(facts)}</span>
      </div>
      <div class="title-ar">${escapeHtml(p.title_ar)}</div>
      ${p.title_en ? `<div class="title-en">${escapeHtml(p.title_en)}</div>` : ''}
      ${p.translit ? `<div class="title-translit">${escapeHtml(p.translit)}</div>` : ''}
      ${p.author || p.author_ar ? `<div class="author-row">${p.author ? `<span>${escapeHtml(p.author)}</span>` : ''}${p.author_ar ? `<span class="author-ar">${escapeHtml(p.author_ar)}</span>` : ''}</div>` : ''}
      <div class="entry-actions">
        ${p.pdf_available ? `<a class="mini-link pdf" href="/api/pdf/${p.id}" target="_blank" rel="noopener">Arabic PDF</a>` : (p.pdf_missing ? '<span class="pill pdf-missing">PDF missing</span>' : '<span class="pill">PDF checking…</span>')}
        ${googleDocLinkMarkup(p)}
      </div>
    </div>
    <div class="project-side">
      <span class="pill status-${p.status}">${STATUS[p.status]}</span>
      ${p.blocked ? '<span class="pill blocked">Blocked</span>' : ''}
      ${quickControlsMarkup(p)}
    </div>
  </article>`;
}

function bindProjectClicks(root=document) {
  root.querySelectorAll('[data-project-id]').forEach(el => el.addEventListener('click', event => {
    if (event.target.closest('a,button,input,select,label')) return;
    openProject(Number(el.dataset.projectId));
  }));
  bindQuickActions(root);
}

function bindQuickActions(root=document) {
  root.querySelectorAll('.quick-assignee').forEach(select => select.addEventListener('change', async event => {
    event.stopPropagation();
    const id = Number(select.dataset.projectId);
    try {
      await api(`/api/projects/${id}`, {method:'PATCH', body:JSON.stringify({assignee:select.value})});
      await loadData();
      toast(select.value === 'Unassigned' ? 'Book unassigned' : `Assigned to ${select.value}`);
    } catch (error) { toast(error.message); }
  }));
  root.querySelectorAll('.quick-deadline').forEach(input => input.addEventListener('change', async event => {
    event.stopPropagation();
    const id = Number(input.dataset.projectId);
    try {
      await api(`/api/projects/${id}`, {method:'PATCH', body:JSON.stringify({due_date:input.value})});
      await loadData();
      toast(input.value ? `Deadline set: ${dateText(input.value)}` : 'Deadline removed');
    } catch (error) { toast(error.message); }
  }));
  root.querySelectorAll('[data-link-english]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openEnglishBookDialog(Number(button.dataset.linkEnglish));
  }));
}

function paceModel() {
  const total = state.projects.length;
  const translated = state.projects.filter(isDone).length;
  const published = state.projects.filter(p => p.status === 'published').length;
  const events = state.projects
    .filter(p => p.completed_at)
    .map(p => parseDateTime(p.completed_at))
    .filter(Boolean)
    .sort((a,b)=>a-b);
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30*86400000);
  const recent = events.filter(d => d >= cutoff);
  let pace30 = recent.length;
  let basis = 'last 30 days';
  if (pace30 < 2 && events.length >= 2) {
    const spanDays = Math.max(7, (now - events[0]) / 86400000);
    pace30 = events.length / spanDays * 30;
    basis = 'all completion history';
  }
  const remaining = Math.max(0,total-translated);
  let forecastDate = null;
  if (remaining === 0) forecastDate = now;
  else if (pace30 > 0.05) forecastDate = new Date(now.getTime() + (remaining / (pace30/30))*86400000);
  return {total,translated,published,events,pace30,basis,remaining,forecastDate};
}

function renderDashboard() {
  const model = paceModel();
  const {total,translated,published} = model;
  $('translation-ratio').textContent = `${translated} / ${total}`;
  $('publication-ratio').textContent = `${published} / ${total}`;
  $('translation-percent').textContent = `${pct(translated,total)}%`;
  $('publication-percent').textContent = `${pct(published,total)}%`;
  $('translation-bar').style.width = `${pct(translated,total)}%`;
  $('publication-bar').style.width = `${pct(published,total)}%`;

  const active = state.projects.filter(p => ['in_progress','review'].includes(p.status));
  const blocked = state.projects.filter(p => p.blocked);
  const due = state.projects.filter(p => p.due_date && !isDone(p));
  const missingPdf = state.projects.filter(p => p.pdf_missing).length;
  const uncheckedPdf = state.projects.filter(p => p.pdf_unchecked).length;
  $('now-list').innerHTML = [
    ['Active', active.length], ['In review', state.projects.filter(p=>p.status==='review').length], ['Blocked', blocked.length],
    ['With deadlines', due.length], ['Missing PDF', missingPdf], ['PDFs still checking', uncheckedPdf]
  ].map(([label,n])=>`<div class="summary-row"><span>${label}</span><strong>${n}</strong></div>`).join('');

  const people = ['Zahraa','Mohammed','Both','Unassigned'];
  $('people-summary').innerHTML = people.map(person => {
    const list = state.projects.filter(p=>p.assignee===person);
    const done = list.filter(isDone).length;
    return `<div class="summary-row"><span>${person}</span><strong>${done}/${list.length} complete</strong></div>`;
  }).join('');

  const forecast = model.forecastDate
    ? (model.remaining === 0 ? 'Translation corpus complete' : `At this rate: ${model.forecastDate.toLocaleDateString(undefined,{month:'long',year:'numeric'})}`)
    : 'Complete two books to unlock a useful finish forecast';
  $('pace-summary').innerHTML = `
    <div class="pace-number"><strong>${model.pace30 >= 2 ? model.pace30.toFixed(model.pace30>=10?0:1) : '—'}</strong><span>books / 30 days</span></div>
    <div class="pace-copy"><strong>${escapeHtml(forecast)}</strong><span>${model.pace30 >= 2 ? `Based on ${model.basis}; ${model.remaining} books remain.` : `${model.remaining} books remain.`}</span></div>`;

  const recent = [...state.projects].sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))).slice(0,6);
  $('recent-projects').innerHTML = recent.map(p=>projectMarkup(p)).join('') || '<p class="muted">No projects yet.</p>';
  bindProjectClicks($('recent-projects'));
}

function renderProjects() {
  const list = filteredProjects();
  const audit = state.pdfAudit;
  const pdfText = audit ? ` · PDFs: ${audit.available} verified · ${audit.missing} missing · ${audit.unchecked} checking` : '';
  $('project-count').textContent = `${list.length} of ${state.projects.length} books${pdfText}`;
  $('projects-list').innerHTML = list.map(p=>projectMarkup(p)).join('') || '<p class="muted">No projects match these filters.</p>';
  bindProjectClicks($('projects-list'));
}

function renderBoard() {
  const q = els.search.value.trim().toLowerCase();
  const base = state.projects.filter(p=>!q || `${p.title_ar} ${p.title_en||''} ${p.translit||''} ${p.author||''} ${p.category||''}`.toLowerCase().includes(q));
  $('board').innerHTML = STATUS_ORDER.map(status => {
    const list = base.filter(p=>p.status===status);
    return `<section class="board-col" data-status="${status}"><div class="board-head"><strong>${STATUS[status]}</strong><span class="pill">${list.length}</span></div><div class="board-list" data-status="${status}">${list.map(p=>projectMarkup(p,true)).join('') || '<p class="muted">Empty</p>'}</div></section>`;
  }).join('');
  bindProjectClicks($('board'));
  bindBoardDrag();
}

function bindBoardDrag() {
  const board = $('board');
  board.querySelectorAll('.project-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', event => {
      if (event.target.closest('a,button,input,select,label,.quick-controls')) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.projectId);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      board.querySelectorAll('.board-list').forEach(list => list.classList.remove('drag-over'));
    });
  });
  board.querySelectorAll('.board-list').forEach(list => {
    list.addEventListener('dragover', event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      list.classList.add('drag-over');
    });
    list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
    list.addEventListener('drop', async event => {
      event.preventDefault();
      list.classList.remove('drag-over');
      const id = Number(event.dataTransfer.getData('text/plain'));
      const project = state.projects.find(item => item.id === id);
      const status = list.dataset.status;
      if (!project || !STATUS[status] || project.status === status) return;
      try {
        await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
        await loadData();
        toast(`Moved to ${STATUS[status]}`);
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

function renderTimeline() {
  const scheduled = state.projects.filter(p => p.due_date).sort((a,b) => a.due_date.localeCompare(b.due_date));
  const unscheduled = state.projects.filter(p => !p.due_date && !['completed','published'].includes(p.status));
  const today = new Date().toISOString().slice(0,10);
  const row = p => {
    const overdue = p.due_date && p.due_date < today && !['completed','published'].includes(p.status);
    return `<article class="timeline-row" data-project-id="${p.id}"><div class="timeline-date ${overdue ? 'overdue' : ''}">${p.due_date ? dateText(p.due_date) : 'No deadline'}</div><div><div class="title-ar">${escapeHtml(p.title_ar)}</div><div class="timeline-meta"><span class="pill status-${p.status}">${STATUS[p.status]}</span>${overdue ? '<span class="pill blocked">Overdue</span>' : ''}</div><div class="entry-actions timeline-actions">${googleDocLinkMarkup(p)}${p.pdf_available ? `<a class="mini-link pdf" href="/api/pdf/${p.id}" target="_blank" rel="noopener">Arabic PDF</a>` : ''}</div>${quickControlsMarkup(p,true)}</div></article>`;
  };
  $('timeline-list').innerHTML = scheduled.map(row).join('') + (unscheduled.length ? `<div class="timeline-divider">Unscheduled</div>${unscheduled.map(row).join('')}` : '') || '<p class="muted">No projects yet.</p>';
  bindProjectClicks($('timeline-list'));
}

function renderStats() {
  const model = paceModel();
  const today = new Date().toISOString().slice(0,10);
  const active = state.projects.filter(p=>!isDone(p));
  const overdue = active.filter(p=>p.due_date && p.due_date < today).length;
  const next30 = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  const dueSoon = active.filter(p=>p.due_date && p.due_date >= today && p.due_date <= next30).length;
  const unscheduled = active.filter(p=>!p.due_date).length;

  $('stat-translated').textContent = model.translated;
  $('stat-translated-sub').textContent = `of ${model.total} books · ${pct(model.translated,model.total)}%`;
  $('stat-published').textContent = model.published;
  $('stat-published-sub').textContent = `of ${model.total} books · ${pct(model.published,model.total)}%`;
  $('stat-pace').textContent = model.pace30 >= 2 ? model.pace30.toFixed(model.pace30>=10?0:1) : '—';
  $('stat-forecast').textContent = model.forecastDate
    ? (model.remaining === 0 ? 'Done' : model.forecastDate.toLocaleDateString(undefined,{month:'short',year:'numeric'}))
    : '—';
  $('stat-forecast-sub').textContent = model.forecastDate
    ? (model.remaining === 0 ? 'Translation complete' : `${model.remaining} remaining · ${model.basis}`)
    : 'Need at least two completions for a stable pace';

  $('stats-by-person').innerHTML = ASSIGNEES.map(person => {
    const list=state.projects.filter(p=>p.assignee===person);
    const done=list.filter(isDone).length;
    return `<div class="summary-row"><span>${person}</span><strong>${done}/${list.length} · ${pct(done,list.length)}%</strong></div>`;
  }).join('');
  $('stats-deadlines').innerHTML = [
    ['Overdue',overdue],['Due in next 30 days',dueSoon],['Active without deadline',unscheduled],['Blocked',active.filter(p=>p.blocked).length]
  ].map(([label,n])=>`<div class="summary-row"><span>${label}</span><strong>${n}</strong></div>`).join('');

  $('progress-chart').innerHTML = progressChartMarkup(model);
}

function progressChartMarkup(model) {
  if (!model.events.length) return '<div class="chart-empty">Completion history will appear here after the first translated book is marked Completed.</div>';
  const width=760, height=280, left=46, right=18, top=18, bottom=42;
  const start = new Date(model.events[0]); start.setHours(0,0,0,0);
  const end = new Date(); end.setHours(23,59,59,999);
  const span = Math.max(86400000,end-start);
  const dayCounts = new Map();
  for (const d of model.events) {
    const key=d.toISOString().slice(0,10);
    dayCounts.set(key,(dayCounts.get(key)||0)+1);
  }
  let running=0;
  const points=[{date:start,count:0}];
  for (const [key,n] of [...dayCounts.entries()].sort(([a],[b])=>a.localeCompare(b))) {
    running += n;
    points.push({date:new Date(`${key}T12:00:00Z`),count:running});
  }
  points.push({date:end,count:running});
  const x=d=>left+((d-start)/span)*(width-left-right);
  const y=n=>top+(1-(n/Math.max(1,model.total)))*(height-top-bottom);
  const path=points.map((p,i)=>`${i?'L':'M'} ${x(p.date).toFixed(1)} ${y(p.count).toFixed(1)}`).join(' ');
  const pctNow=pct(model.translated,model.total);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative translation progress">
    <line class="chart-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height-bottom}"></line>
    <line class="chart-axis" x1="${left}" y1="${height-bottom}" x2="${width-right}" y2="${height-bottom}"></line>
    <line class="chart-grid" x1="${left}" y1="${y(model.total/2)}" x2="${width-right}" y2="${y(model.total/2)}"></line>
    <text class="chart-label" x="${left-8}" y="${top+4}" text-anchor="end">100%</text>
    <text class="chart-label" x="${left-8}" y="${y(model.total/2)+4}" text-anchor="end">50%</text>
    <text class="chart-label" x="${left-8}" y="${height-bottom+4}" text-anchor="end">0%</text>
    <path class="chart-line" d="${path}"></path>
    <circle class="chart-point" cx="${x(end)}" cy="${y(model.translated)}" r="4"></circle>
    <text class="chart-value" x="${Math.max(left+30,x(end)-6)}" y="${Math.max(top+14,y(model.translated)-10)}" text-anchor="end">${pctNow}%</text>
    <text class="chart-label" x="${left}" y="${height-12}">${start.toLocaleDateString(undefined,{month:'short',year:'2-digit'})}</text>
    <text class="chart-label" x="${width-right}" y="${height-12}" text-anchor="end">Today</text>
  </svg>`;
}

function renderActivity() {
  $('activity-list').innerHTML = state.activity.map(a => `<div class="activity-item"><time>${new Date(a.created_at.replace(' ','T')+'Z').toLocaleDateString()}</time><div><strong>${escapeHtml(a.actor)}</strong> ${escapeHtml(a.action)}${a.title_ar ? ` — <span dir="rtl">${escapeHtml(a.title_ar)}</span>` : ''}</div><small>${new Date(a.created_at.replace(' ','T')+'Z').toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</small></div>`).join('') || '<p class="muted">No activity yet.</p>';
}

function render() { renderDashboard(); renderProjects(); renderBoard(); renderTimeline(); renderStats(); renderActivity(); hydrateUploadedCovers(document); }

function setView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active-view'));
  $(`${view}-view`).classList.add('active-view');
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active', x.dataset.view===view));
  els.title.textContent = ({dashboard:'Dashboard',projects:'Projects',board:'Board',timeline:'Timeline',stats:'Stats',activity:'Activity'})[view];
}

function openProject(id) {
  const p = state.projects.find(x=>x.id===id);
  $('project-id').value = p?.id || '';
  $('dialog-title').textContent = p ? 'Edit project' : 'New project';
  $('title-ar').value = p?.title_ar || '';
  $('title-en').value = p?.title_en || '';
  $('assignee').value = p?.assignee || 'Unassigned';
  $('status').value = p?.status || 'not_started';
  $('priority').value = p?.priority || 'normal';
  $('start-date').value = p?.start_date || '';
  $('due-date').value = p?.due_date || '';
  $('google-doc-url').value = p?.google_doc_url || '';
  $('cover-url').value = p?.cover_url || '';
  $('cover-file').value = '';
  $('upload-cover').disabled = !p?.id;
  $('remove-uploaded-cover').disabled = !p?.has_uploaded_cover;
  $('cover-upload-note').textContent = p?.id ? '' : 'Save this project before importing a photo.';
  renderCoverPreview(p);
  if (p?.has_uploaded_cover) ensureUploadedCover(p.id).then(() => { if (Number($('project-id').value) === p.id) renderCoverPreview(p); });
  $('source-pdf-url').value = p?.source_pdf_url || '';
  $('pdf-state').innerHTML = p ? (
    p.pdf_available
      ? `<span>Verified direct PDF available</span>`
      : p.pdf_missing
        ? `<span class="missing">PDF missing or unusable${p.package_url ? ' — archive only provides a ZIP/RAR package' : ''}${p.pdf_check_note ? ` · ${escapeHtml(p.pdf_check_note)}` : ''}</span>`
        : `<span>PDF awaiting verification${p.pdf_check_note ? ` · ${escapeHtml(p.pdf_check_note)}` : ''}</span>`
  ) : '';
  $('blocked').checked = Boolean(p?.blocked);
  $('blocker-reason').value = p?.blocker_reason || '';
  $('notes').value = p?.notes || '';
  const meta = [];
  if (p?.completed_at) meta.push(`Completed ${new Date(p.completed_at).toLocaleDateString()}${p.completed_by ? ` by ${escapeHtml(p.completed_by)}` : ''}`);
  if (p?.published_at) meta.push(`Published ${new Date(p.published_at).toLocaleDateString()}${p.published_by ? ` by ${escapeHtml(p.published_by)}` : ''}`);
  $('completion-meta').innerHTML = meta.map(x => `<span>${x}</span>`).join('');
  els.dialog.showModal();
}

async function saveProject(event) {
  event.preventDefault();
  const id = Number($('project-id').value) || null;
  const payload = {
    title_ar: $('title-ar').value.trim(), title_en: $('title-en').value.trim(), assignee: $('assignee').value,
    status: $('status').value, priority: $('priority').value, start_date: $('start-date').value, due_date: $('due-date').value,
    google_doc_url: $('google-doc-url').value.trim(), cover_url: $('cover-url').value.trim(), source_pdf_url: $('source-pdf-url').value.trim(),
    blocked: $('blocked').checked, blocker_reason: $('blocker-reason').value.trim(), notes: $('notes').value.trim(),
  };
  try {
    if (id) await api(`/api/projects/${id}`, {method:'PATCH', body:JSON.stringify(payload)});
    else await api('/api/projects', {method:'POST', body:JSON.stringify(payload)});
    els.dialog.close(); await loadData(); toast(id ? 'Project updated' : 'Project created');
  } catch (e) { toast(e.message); }
}

function renderCoverPreview(project=null) {
  const uploaded = project?.id ? state.coverObjectUrls.get(project.id) : '';
  const manual = $('cover-url')?.value.trim();
  const imported=state.coverMap[project?.catalog_id];
  const fallback = manual || imported?.path || imported?.source_url || '';
  const src = uploaded || fallback;
  const label = uploaded
    ? 'Uploaded cover photo'
    : project?.has_uploaded_cover
      ? 'Uploaded cover photo loading…'
      : manual
        ? 'Manual cover override'
        : fallback
          ? 'Imported official cover'
          : 'No cover yet';
  $('cover-preview').innerHTML = src
    ? `<img src="${escapeHtml(src)}" alt="Book cover preview"><span class="muted">${label}</span>`
    : `<span class="muted">${label}. Import a photo, paste an image URL, or use the automatic archive importer.</span>`;
  if ($('remove-uploaded-cover')) $('remove-uploaded-cover').disabled = !project?.has_uploaded_cover;
}

function loadImageElement(file) {
  return new Promise((resolve,reject) => {
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src=url;
  });
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve,reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('Could not compress the cover image.')),
    'image/jpeg',
    quality
  ));
}

async function optimizeCoverFile(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  const img=await loadImageElement(file);
  const attempts=[
    {w:900,h:1400,q:.84},
    {w:760,h:1180,q:.76},
    {w:640,h:1000,q:.68},
  ];
  for (const attempt of attempts) {
    const scale=Math.min(1,attempt.w/img.naturalWidth,attempt.h/img.naturalHeight);
    const width=Math.max(1,Math.round(img.naturalWidth*scale));
    const height=Math.max(1,Math.round(img.naturalHeight*scale));
    const canvas=document.createElement('canvas');
    canvas.width=width; canvas.height=height;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#FFF8EA';
    ctx.fillRect(0,0,width,height);
    ctx.drawImage(img,0,0,width,height);
    const blob=await canvasBlob(canvas,attempt.q);
    if (blob.size <= 1_350_000) return blob;
  }
  throw new Error('That image is still too large after compression. Try a smaller photo.');
}

async function uploadCoverPhoto() {
  const id=Number($('project-id').value);
  const file=$('cover-file').files?.[0];
  if (!id) return toast('Save the project before importing a cover.');
  if (!file) return toast('Choose a cover photo first.');
  const button=$('upload-cover');
  button.disabled=true;
  $('cover-upload-note').textContent='Optimizing cover…';
  try {
    const blob=await optimizeCoverFile(file);
    $('cover-upload-note').textContent='Uploading cover…';
    const response=await authenticatedFetch(`/api/cover/${id}`, {
      method:'PUT',
      headers:{'content-type':blob.type},
      body:blob,
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error || `Upload failed (${response.status})`);
    setCoverObjectUrl(id,blob);
    $('cover-file').value='';
    await loadData();
    const project=state.projects.find(p=>p.id===id);
    renderCoverPreview(project);
    $('cover-upload-note').textContent=`Imported · ${Math.round(blob.size/1024)} KB`;
    toast('Cover photo imported');
  } catch(error) {
    $('cover-upload-note').textContent=error.message;
    toast(error.message);
  } finally {
    button.disabled=false;
  }
}

async function removeUploadedCover() {
  const id=Number($('project-id').value);
  if(!id) return;
  const button=$('remove-uploaded-cover');
  button.disabled=true;
  try {
    const response=await authenticatedFetch(`/api/cover/${id}`, {method:'DELETE'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error || `Remove failed (${response.status})`);
    const old=state.coverObjectUrls.get(id);
    if(old) URL.revokeObjectURL(old);
    state.coverObjectUrls.delete(id);
    await loadData();
    const project=state.projects.find(p=>p.id===id);
    renderCoverPreview(project);
    $('cover-upload-note').textContent='Uploaded photo removed; fallback cover restored.';
    toast('Uploaded cover removed');
  } catch(error) {
    toast(error.message);
  } finally {
    button.disabled=false;
  }
}

async function loadCoverMap() {
  try {
    const response = await fetch('/cover-map.json', {cache:'no-store'});
    const data = response.ok ? await response.json() : {};
    state.coverMap = data.covers || {};
  } catch { state.coverMap = {}; }
}

function openEnglishBookDialog(id) {
  const project = state.projects.find(p=>p.id===id);
  $('english-project-id').value = id || '';
  $('english-book-url').value = project?.google_doc_url || '';
  $('english-book-dialog').showModal();
  setTimeout(()=>$('english-book-url').focus(),0);
}

async function saveEnglishBook(event) {
  event.preventDefault();
  const id=Number($('english-project-id').value);
  const url=$('english-book-url').value.trim();
  if(!id || !url) return;
  try {
    await api(`/api/projects/${id}`, {method:'PATCH',body:JSON.stringify({google_doc_url:url})});
    $('english-book-dialog').close();
    await loadData();
    toast('English Book linked');
  } catch(error) { toast(error.message); }
}

async function loadData() {
  const [projects, activity] = await Promise.all([api('/api/projects'), api('/api/activity')]);
  state.projects = projects.projects || [];
  state.activity = activity.activity || [];
  render();
}

async function refreshProjects() {
  const projects = await api('/api/projects');
  state.projects = projects.projects || [];
  render();
}

async function auditPdfs() {
  let rounds = 0;
  while (rounds < 20) {
    const result = await api('/api/pdf-audit', {
      method: 'POST',
      body: JSON.stringify({ limit: 12 }),
    });
    state.pdfAudit = result.counts || state.pdfAudit;
    await refreshProjects();
    rounds += 1;
    if (!result.processed || !result.counts?.unchecked) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function init() {
  state.key = readKey(); els.actor.value = state.actor;
  if (!state.key) { els.gate.classList.remove('hidden'); return; }
  try {
    const health = await api('/api/health');
    state.pdfAudit = health.pdfs || null;
    els.app.classList.remove('hidden');
    await loadCoverMap();
    await loadData();
    if (state.pdfAudit?.unchecked) auditPdfs().catch(error => toast(`PDF verification paused: ${error.message}`));
  } catch (e) {
    els.gate.classList.remove('hidden');
    els.gate.querySelector('p').textContent = e.message;
  }
}

document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));
document.querySelectorAll('[data-jump-view]').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.jumpView)));
els.search.addEventListener('input',()=>{renderProjects();renderBoard();});
els.actor.addEventListener('change',()=>{state.actor=els.actor.value;localStorage.setItem('haydariActor',state.actor);});
['filter-assignee','filter-status','filter-blocked','filter-missing-pdf'].forEach(id=>$(id)?.addEventListener('change',renderProjects));
$('new-project').addEventListener('click',()=>openProject(null));
$('cover-url').addEventListener('input',()=>renderCoverPreview(state.projects.find(p=>p.id===Number($('project-id').value))));
$('upload-cover').addEventListener('click',uploadCoverPhoto);
$('remove-uploaded-cover').addEventListener('click',removeUploadedCover);
$('close-english-dialog').addEventListener('click',()=>$('english-book-dialog').close());
$('cancel-english-dialog').addEventListener('click',()=>$('english-book-dialog').close());
$('english-book-form').addEventListener('submit',saveEnglishBook);
$('close-dialog').addEventListener('click',()=>els.dialog.close());
$('cancel-dialog').addEventListener('click',()=>els.dialog.close());
els.form.addEventListener('submit',saveProject);
init();

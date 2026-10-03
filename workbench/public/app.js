const STATUS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  review: 'Review',
  completed: 'Completed',
  published: 'Published',
};
const STATUS_ORDER = Object.keys(STATUS);
const savedActor = localStorage.getItem('haydariActor');
const state = { projects: [], activity: [], view: 'dashboard', key: '', actor: ['Zahraa', 'Mohammed'].includes(savedActor) ? savedActor : 'Zahraa' };

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
      <div class="title-ar">${escapeHtml(p.title_ar)}</div>
      ${p.title_en ? `<div class="title-en">${escapeHtml(p.title_en)}</div>` : ''}
      <div class="meta">
        <span class="pill">${escapeHtml(p.assignee)}</span>
        ${p.pdf_missing ? '<span class="pill pdf-missing">PDF missing</span>' : ''}
        ${p.blocked ? '<span class="pill blocked">Blocked</span>' : ''}
      </div>
    </article>`;
  }

  const facts = [p.pages ? `${p.pages} pages` : '', p.volumes && p.volumes > 1 ? `${p.volumes} volumes` : ''].filter(Boolean).join(' · ');
  return `<article class="project-row" data-project-id="${p.id}">
    <svg class="rosette" aria-hidden="true"><use href="#rosette"></use></svg>
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
        ${p.source_pdf_url ? `<a class="mini-link pdf" href="${escapeHtml(p.source_pdf_url)}" target="_blank" rel="noopener">Arabic PDF</a>` : '<span class="pill pdf-missing">PDF missing</span>'}
        ${p.google_doc_url ? `<a class="mini-link secondary-link" href="${escapeHtml(p.google_doc_url)}" target="_blank" rel="noopener">Google Doc</a>` : ''}
        ${p.source_url ? `<a class="mini-link secondary-link" href="${escapeHtml(p.source_url)}" target="_blank" rel="noopener">Catalog page</a>` : ''}
      </div>
    </div>
    <div class="project-side">
      <span class="pill">${escapeHtml(p.assignee)}</span>
      <span class="pill status-${p.status}">${STATUS[p.status]}</span>
      ${p.blocked ? '<span class="pill blocked">Blocked</span>' : ''}
      <span class="due">${dateText(p.due_date)}</span>
    </div>
  </article>`;
}

function bindProjectClicks(root=document) {
  root.querySelectorAll('[data-project-id]').forEach(el => el.addEventListener('click', event => {
    if (event.target.closest('a')) return;
    openProject(Number(el.dataset.projectId));
  }));
}

function renderDashboard() {
  const total = state.projects.length;
  const translated = state.projects.filter(p => ['completed','published'].includes(p.status)).length;
  const published = state.projects.filter(p => p.status === 'published').length;
  $('translation-ratio').textContent = `${translated} / ${total}`;
  $('publication-ratio').textContent = `${published} / ${total}`;
  $('translation-percent').textContent = `${pct(translated,total)}%`;
  $('publication-percent').textContent = `${pct(published,total)}%`;
  $('translation-bar').style.width = `${pct(translated,total)}%`;
  $('publication-bar').style.width = `${pct(published,total)}%`;

  const active = state.projects.filter(p => ['in_progress','review'].includes(p.status));
  const blocked = state.projects.filter(p => p.blocked);
  const due = state.projects.filter(p => p.due_date && !['completed','published'].includes(p.status));
  const missingPdf = state.projects.filter(p => p.pdf_missing).length;
  $('now-list').innerHTML = [
    ['Active', active.length], ['In review', state.projects.filter(p=>p.status==='review').length], ['Blocked', blocked.length],
    ['With deadlines', due.length], ['Missing PDF', missingPdf]
  ].map(([label,n])=>`<div class="summary-row"><span>${label}</span><strong>${n}</strong></div>`).join('');

  const people = ['Zahraa','Mohammed','Both','Unassigned'];
  $('people-summary').innerHTML = people.map(person => {
    const list = state.projects.filter(p=>p.assignee===person);
    const done = list.filter(p=>['completed','published'].includes(p.status)).length;
    return `<div class="summary-row"><span>${person}</span><strong>${done}/${list.length} complete</strong></div>`;
  }).join('');

  const recent = [...state.projects].sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at))).slice(0,6);
  $('recent-projects').innerHTML = recent.map(p=>projectMarkup(p)).join('') || '<p class="muted">No projects yet.</p>';
  bindProjectClicks($('recent-projects'));
}

function renderProjects() {
  const list = filteredProjects();
  $('project-count').textContent = `${list.length} of ${state.projects.length} books`;
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
    return `<article class="timeline-row" data-project-id="${p.id}"><div class="timeline-date ${overdue ? 'overdue' : ''}">${p.due_date ? dateText(p.due_date) : 'No deadline'}</div><div><div class="title-ar">${escapeHtml(p.title_ar)}</div><div class="timeline-meta"><span class="pill">${escapeHtml(p.assignee)}</span><span class="pill status-${p.status}">${STATUS[p.status]}</span>${overdue ? '<span class="pill blocked">Overdue</span>' : ''}</div></div></article>`;
  };
  $('timeline-list').innerHTML = scheduled.map(row).join('') + (unscheduled.length ? `<div class="timeline-divider">Unscheduled</div>${unscheduled.map(row).join('')}` : '') || '<p class="muted">No projects yet.</p>';
  bindProjectClicks($('timeline-list'));
}

function renderActivity() {
  $('activity-list').innerHTML = state.activity.map(a => `<div class="activity-item"><time>${new Date(a.created_at.replace(' ','T')+'Z').toLocaleDateString()}</time><div><strong>${escapeHtml(a.actor)}</strong> ${escapeHtml(a.action)}${a.title_ar ? ` — <span dir="rtl">${escapeHtml(a.title_ar)}</span>` : ''}</div><small>${new Date(a.created_at.replace(' ','T')+'Z').toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</small></div>`).join('') || '<p class="muted">No activity yet.</p>';
}

function render() { renderDashboard(); renderProjects(); renderBoard(); renderTimeline(); renderActivity(); }

function setView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active-view'));
  $(`${view}-view`).classList.add('active-view');
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active', x.dataset.view===view));
  els.title.textContent = ({dashboard:'Dashboard',projects:'Projects',board:'Board',timeline:'Timeline',activity:'Activity'})[view];
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
  $('source-url').value = p?.source_url || '';
  $('source-pdf-url').value = p?.source_pdf_url || '';
  $('pdf-state').innerHTML = p ? (p.source_pdf_url
    ? `<span>Direct PDF available</span>`
    : `<span class="missing">PDF missing from archive${p.package_url ? ' — archive only provides a ZIP/RAR package' : ''}</span>`) : '';
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
    google_doc_url: $('google-doc-url').value.trim(), source_url: $('source-url').value.trim(), source_pdf_url: $('source-pdf-url').value.trim(),
    blocked: $('blocked').checked, blocker_reason: $('blocker-reason').value.trim(), notes: $('notes').value.trim(),
  };
  try {
    if (id) await api(`/api/projects/${id}`, {method:'PATCH', body:JSON.stringify(payload)});
    else await api('/api/projects', {method:'POST', body:JSON.stringify(payload)});
    els.dialog.close(); await loadData(); toast(id ? 'Project updated' : 'Project created');
  } catch (e) { toast(e.message); }
}

async function loadData() {
  const [projects, activity] = await Promise.all([api('/api/projects'), api('/api/activity')]);
  state.projects = projects.projects || []; state.activity = activity.activity || []; render();
}

async function init() {
  state.key = readKey(); els.actor.value = state.actor;
  if (!state.key) { els.gate.classList.remove('hidden'); return; }
  try {
    await api('/api/health');
    els.app.classList.remove('hidden');
    await loadData();
  } catch (e) {
    els.gate.classList.remove('hidden');
    els.gate.querySelector('p').textContent = e.message;
  }
}

document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));
els.search.addEventListener('input',()=>{renderProjects();renderBoard();});
els.actor.addEventListener('change',()=>{state.actor=els.actor.value;localStorage.setItem('haydariActor',state.actor);});
['filter-assignee','filter-status','filter-blocked','filter-missing-pdf'].forEach(id=>$(id)?.addEventListener('change',renderProjects));
$('new-project').addEventListener('click',()=>openProject(null));
$('close-dialog').addEventListener('click',()=>els.dialog.close());
$('cancel-dialog').addEventListener('click',()=>els.dialog.close());
els.form.addEventListener('submit',saveProject);
init();

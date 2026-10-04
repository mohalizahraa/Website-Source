const STATUS = {
  not_started: 'Not Started',
  in_progress: 'Translating',
  review: 'Needs Formatting',
  completed: 'Needs Review',
  published: 'Publish Ready',
};
const STATUS_ORDER = Object.keys(STATUS);
const ASSIGNEES = ['Zahraa','Mohammed','Both','Unassigned'];
const VIEW_SCOPES = ['Zahraa','Mohammed','Shared'];
const ACTIVITY_ACTORS = ['all','Zahraa','Mohammed','System'];
const ACTIVITY_TYPES = ['all','translation','project'];
const SORT_VALUES = ['updated','deadline','title','status','assignee','topic'];
const TITLE_COLLATOR = new Intl.Collator(['ar','en'], { sensitivity:'base', numeric:true });
const savedActor = localStorage.getItem('haydariActor');
const savedProjectSort = localStorage.getItem('haydariProjectSort');
const savedProjectGrouping = localStorage.getItem('haydariProjectGrouping');
const savedViewScope = localStorage.getItem('haydariViewScope') || localStorage.getItem('haydariBoardScope');
const savedMobileBoardStatus = localStorage.getItem('haydariBoardStatus');
const savedActivityActor = localStorage.getItem('haydariActivityActor');
const savedActivityType = localStorage.getItem('haydariActivityType');
const state = { projects: [], activity: [], paceEvents: [], liveSignature: '', pdfAudit: null, coverMap: {}, seriesMap: {groups:{},books:{}}, coverObjectUrls: new Map(), coverLoads: new Map(), selectedIds: new Set(), view: 'dashboard', actor: ['Zahraa', 'Mohammed'].includes(savedActor) ? savedActor : 'Zahraa', projectSort: SORT_VALUES.includes(savedProjectSort) ? savedProjectSort : 'updated', projectGrouping: savedProjectGrouping === 'series' ? 'series' : 'none', viewScope: VIEW_SCOPES.includes(savedViewScope) ? savedViewScope : 'Shared', mobileBoardStatus: STATUS_ORDER.includes(savedMobileBoardStatus) ? savedMobileBoardStatus : 'in_progress', activityActorFilter: ACTIVITY_ACTORS.includes(savedActivityActor) ? savedActivityActor : 'all', activityTypeFilter: ACTIVITY_TYPES.includes(savedActivityType) ? savedActivityType : 'all', pendingWorkOnLink: null };
const LIVE_SYNC_MS = 15000;
let liveSyncTimer = null;
let liveSyncInFlight = false;

const $ = (id) => document.getElementById(id);
const els = {
  app: $('app'), title: $('view-title'), search: $('search'), actor: $('actor'), dialog: $('project-dialog'),
  form: $('project-form'), toast: $('toast'),
};

function clearLegacyAccessKey() {
  localStorage.removeItem('haydariWorkbenchKey');
  if (location.hash.startsWith('#key=')) history.replaceState(null, '', location.pathname + location.search);
}

async function authenticatedFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('x-workbench-actor', state.actor);
  return fetch(path, { ...options, headers });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-workbench-actor': state.actor,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function syncActorSwitch() {
  document.querySelectorAll('[data-actor-choice]').forEach(button=>{
    const active=button.dataset.actorChoice===state.actor;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',active?'true':'false');
  });
}

function syncViewScopeSwitch() {
  document.querySelectorAll('[data-view-scope]').forEach(button=>{
    const active=button.dataset.viewScope===state.viewScope;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',active?'true':'false');
  });
}

function viewScopeMatches(project) {
  if (state.viewScope === 'Zahraa') return project.assignee === 'Zahraa' || project.assignee === 'Both';
  if (state.viewScope === 'Mohammed') return project.assignee === 'Mohammed' || project.assignee === 'Both';
  return project.assignee === 'Zahraa' || project.assignee === 'Mohammed' || project.assignee === 'Both';
}

function setViewScope(scope) {
  if (!VIEW_SCOPES.includes(scope)) return;
  state.viewScope=scope;
  localStorage.setItem('haydariViewScope',scope);
  localStorage.removeItem('haydariBoardScope');
  syncViewScopeSwitch();
}

function toast(message) {
  els.toast.textContent = message; els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 1800);
}

function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
function dateText(value) { return value ? new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}) : 'No deadline'; }
function deadlineDaysAgo(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return 0;
  const [year,month,day]=String(value).split('-').map(Number);
  const now=new Date();
  const today=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  const deadline=Date.UTC(year,month-1,day);
  return Math.floor((today-deadline)/86400000);
}
function isSuspiciousPastDeadline(value) { return deadlineDaysAgo(value) > 90; }
function confirmSuspiciousDeadline(value,currentValue='') {
  if (!value || value === currentValue || !isSuspiciousPastDeadline(value)) return true;
  const days=deadlineDaysAgo(value);
  return window.confirm(`This deadline is ${days.toLocaleString()} days in the past — keep it?`);
}
function updateDeadlineWarning(value,currentValue='') {
  const warning=$('due-date-warning');
  if (!warning) return;
  const show=Boolean(value && value !== currentValue && isSuspiciousPastDeadline(value));
  warning.hidden=!show;
  warning.textContent=show ? 'This deadline is unusually far in the past. Saving it will ask for confirmation.' : '';
}
function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function parseDateTime(value) {
  if (!value) return null;
  const raw=String(value);
  const normalized=/^\d{4}-\d{2}-\d{2} \d{2}:/.test(raw) ? raw.replace(' ','T')+'Z' : raw;
  const date=new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}
function isTranslated(p) { return ['review','completed','published'].includes(p.status); }
function isPublishReady(p) { return p.status === 'published'; }
function coverFor(p) { const imported=state.coverMap[p?.catalog_id]; return p?.cover_url || imported?.path || (imported?.source_url ? `/api/official-cover/${encodeURIComponent(p.catalog_id)}` : ''); }
function hasCover(p) { return Boolean(p?.has_uploaded_cover || coverFor(p)); }
function monthKey(value) { return String(value || '').slice(0,7); }
function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function localDateKeyAfterDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}
function median(values) {
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!sorted.length) return 400;
  const mid=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
}
function looksLikeIndexedVolume(p) {
  return /(?:^|[\s,(])(?:ج|جزء|vol(?:ume)?\.?|part)\s*\(?\d+/iu.test(`${p?.title_ar || ''} ${p?.title_en || ''}`);
}
function estimatedPages(p, fallbackPages) {
  const pages=Number(p?.pages);
  if (Number.isFinite(pages) && pages > 0) return pages;
  const volumes=Number(p?.volumes);
  if (Number.isFinite(volumes) && volumes > 1 && !looksLikeIndexedVolume(p)) return fallbackPages * volumes;
  return fallbackPages;
}
function assigneeOptions(current) { return ASSIGNEES.map(name => `<option value="${name}" ${current===name?'selected':''}>${name}</option>`).join(''); }
function statusOptions(current) { return STATUS_ORDER.map(status => `<option value="${status}" ${current===status?'selected':''}>${STATUS[status]}</option>`).join(''); }
function assigneeLabel(value) { return value === 'Both' ? 'Shared' : value; }
function assigneeBadgeMarkup(p) { return `<span class="pill assignee-pill assignee-${String(p.assignee || 'Unassigned').toLowerCase()}">${escapeHtml(assigneeLabel(p.assignee || 'Unassigned'))}</span>`; }
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
    ? `<button class="mini-link secondary-link english-book-link" type="button" data-open-english="${p.id}">English Book</button>`
    : `<button class="mini-link secondary-link english-book-button" type="button" data-link-english="${p.id}">English Book · link</button>`;
}
async function setProjectDeadline(id, value) {
  const project=state.projects.find(p=>p.id===id);
  const current=project?.due_date || '';
  if (value && !confirmSuspiciousDeadline(value,current)) return false;
  await api(`/api/projects/${id}`, {method:'PATCH', body:JSON.stringify({due_date:value || null})});
  await loadData();
  toast(value ? `Deadline set: ${dateText(value)}` : 'Deadline removed');
  return true;
}

function workOnBookMarkup(p) {
  return `<button class="mini-link work-on-book" type="button" data-work-on-book="${p.id}">Work on Book</button>`;
}
function quickControlsMarkup(p, compact=false) {
  return `<div class="quick-controls ${compact ? 'compact-quick-controls' : ''}">
    <label class="quick-field"><span>Assigned</span><select class="quick-assignee" data-project-id="${p.id}" draggable="false" aria-label="Assign ${escapeHtml(p.title_ar)}">${assigneeOptions(p.assignee)}</select></label>
    ${compact ? `<label class="quick-field quick-status-field"><span>Status</span><select class="quick-status" data-project-id="${p.id}" draggable="false" aria-label="Status for ${escapeHtml(p.title_ar)}">${statusOptions(p.status)}</select></label>` : ''}
    <div class="quick-field quick-deadline-field"><span>Deadline</span><div class="quick-date-row"><input class="quick-deadline" data-project-id="${p.id}" draggable="false" type="date" value="${escapeHtml(p.due_date || '')}" aria-label="Deadline for ${escapeHtml(p.title_ar)}">${p.due_date ? `<button class="quick-clear-date" type="button" data-clear-deadline="${p.id}" aria-label="Remove deadline for ${escapeHtml(p.title_ar)}">Remove</button>` : ''}</div></div>
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

function syncTopicFilter() {
  const select=$('filter-topic');
  if (!select) return;
  const previous=select.value;
  const topics=[...new Map(state.projects
    .filter(p=>p.topic_en)
    .map(p=>[p.topic_en,{en:p.topic_en,ar:p.topic_ar || ''}])).values()]
    .sort((a,b)=>a.en.localeCompare(b.en));
  select.innerHTML='<option value="">All topics</option>'+topics.map(t =>
    `<option value="${escapeHtml(t.en)}">${escapeHtml(t.en)}${t.ar ? ` — ${escapeHtml(t.ar)}` : ''}</option>`
  ).join('');
  if ([...select.options].some(o=>o.value===previous)) select.value=previous;
}

function sortProjects(projects, sort='updated') {
  const list=[...projects];
  const titleCompare=(a,b)=>TITLE_COLLATOR.compare(a.title_ar || a.title_en || '', b.title_ar || b.title_en || '') || Number(a.id)-Number(b.id);
  const updatedTime=p=>parseDateTime(p.updated_at)?.getTime() || 0;
  const assigneeRank=p=>Math.max(0,ASSIGNEES.indexOf(p.assignee));
  const statusRank=p=>Math.max(0,STATUS_ORDER.indexOf(p.status));
  list.sort((a,b)=>{
    if (sort === 'deadline') {
      const aDue=a.due_date || '9999-12-31';
      const bDue=b.due_date || '9999-12-31';
      return aDue.localeCompare(bDue) || titleCompare(a,b);
    }
    if (sort === 'title') return titleCompare(a,b);
    if (sort === 'status') return statusRank(a)-statusRank(b) || titleCompare(a,b);
    if (sort === 'assignee') return assigneeRank(a)-assigneeRank(b) || titleCompare(a,b);
    if (sort === 'topic') return String(a.topic_en || '').localeCompare(String(b.topic_en || '')) || titleCompare(a,b);
    return updatedTime(b)-updatedTime(a) || titleCompare(a,b);
  });
  return list;
}

function filteredProjects() {
  const q = els.search.value.trim().toLowerCase();
  const topic = $('filter-topic')?.value || '';
  const assignee = $('filter-assignee')?.value || '';
  const assigneeMatch = p => !assignee || (assignee === '__mine__' ? (p.assignee === state.actor || p.assignee === 'Both') : p.assignee === assignee);
  const status = $('filter-status')?.value || '';
  const schedule = $('filter-schedule')?.value || '';
  const sort = $('sort-projects')?.value || state.projectSort || 'updated';
  const missingPdf = $('filter-missing-pdf')?.checked || false;
  const checkingPdf = $('filter-checking-pdf')?.checked || false;
  const missingCover = $('filter-missing-cover')?.checked || false;
  const noEnglish = $('filter-no-english')?.checked || false;
  const today = localDateKey();
  const thisMonth = today.slice(0,7);
  const filtered = state.projects.filter(p => {
    const text = `${p.title_ar} ${p.title_en || ''} ${p.translit || ''} ${p.author || ''} ${p.author_ar || ''} ${p.category || ''} ${p.topic_en || ''} ${p.topic_ar || ''}`.toLowerCase();
    const scheduleMatch = !schedule
      || (schedule === 'overdue' && p.due_date && p.due_date < today && !isPublishReady(p))
      || (schedule === 'due_month' && p.due_date && monthKey(p.due_date) === thisMonth && !isPublishReady(p))
      || (schedule === 'with_deadline' && p.due_date && !isPublishReady(p))
      || (schedule === 'no_deadline' && !p.due_date && !isPublishReady(p));
    const statusMatch = !status
      || (status === '__active__' ? ['in_progress','review','completed'].includes(p.status) : p.status === status);
    return (!q || text.includes(q))
      && (!topic || p.topic_en === topic)
      && assigneeMatch(p)
      && statusMatch
      && scheduleMatch
      && (!missingPdf || p.pdf_missing)
      && (!checkingPdf || p.pdf_unchecked)
      && (!missingCover || !hasCover(p))
      && (!noEnglish || !p.google_doc_url);
  });
  return sortProjects(filtered, sort);
}

function seriesInfo(p) {
  const item=state.seriesMap?.books?.[p?.catalog_id];
  if (!item) return null;
  const group=state.seriesMap?.groups?.[item.group];
  return group ? {item,group,key:item.group} : null;
}
function seriesPartText(info) {
  if (!info) return '';
  if (info.item.role === 'umbrella') return info.group.total ? `Complete set · ${info.group.total} parts` : 'Complete collection';
  if (info.item.position) return `Part ${info.item.position}${info.group.total ? ` of ${info.group.total}` : ''}`;
  return 'Series member';
}
function seriesTypeLabel(group) {
  if (group.type === 'collection') return 'Collection';
  if (group.type === 'multi_volume') return 'Multi-volume work';
  return 'Series';
}

function projectMarkup(p, compact=false, selectable=false) {
  if (compact) {
    return `<article class="project-card" data-project-id="${p.id}" draggable="true">
      <div class="compact-card-head"><div class="compact-cover-slot">${coverMarkup(p,true)}</div><div class="compact-card-titles">
        <div class="title-ar">${escapeHtml(p.title_ar)}</div>
        ${p.title_en ? `<div class="title-en">${escapeHtml(p.title_en)}</div>` : ''}
      </div></div>
      <div class="meta">
        <span class="pill status-${p.status}">${STATUS[p.status]}</span>
        ${assigneeBadgeMarkup(p)}\n        ${p.published ? '<span class="pill">Published</span>' : ''}
        ${p.pdf_missing ? '<span class="pill pdf-missing">PDF missing</span>' : (p.pdf_unchecked ? '<span class="pill">PDF checking…</span>' : '')}
      </div>
      ${translationProgressMarkup(p,true)}
      <div class="entry-actions compact-actions">
        ${workOnBookMarkup(p)}
        ${p.pdf_available ? `<a class="mini-link pdf" href="/api/pdf/${p.id}" target="_blank" rel="noopener">Arabic PDF</a>` : ''}
        ${googleDocLinkMarkup(p)}
      </div>
      ${quickControlsMarkup(p,true)}
    </article>`;
  }

  const info=seriesInfo(p);
  const seriesFact=seriesPartText(info);
  const facts = [seriesFact, p.pages ? `${p.pages} pages` : '', !info && p.volumes && p.volumes > 1 ? `${p.volumes} volumes` : ''].filter(Boolean).join(' · ');
  return `<article class="project-row ${selectable && state.selectedIds.has(p.id) ? 'selected' : ''}" data-project-id="${p.id}">
    <div class="cover-cell">${selectable ? `<label class="select-book" title="Select book"><input class="select-book-input" type="checkbox" data-select-project="${p.id}" ${state.selectedIds.has(p.id)?'checked':''} aria-label="Select ${escapeHtml(p.title_ar)}"><span aria-hidden="true"></span></label>` : ''}${coverMarkup(p)}</div>
    <div class="project-main">
      <div class="meta-row">
        <div><span class="rubric">${escapeHtml(p.topic_en || p.category || 'Book')}</span>${p.topic_ar ? `<span class="rubric-ar">${escapeHtml(p.topic_ar)}</span>` : ''}</div>
        <span class="facts">${escapeHtml(facts)}</span>
      </div>
      <div class="title-ar">${escapeHtml(p.title_ar)}</div>
      ${p.title_en ? `<div class="title-en">${escapeHtml(p.title_en)}</div>` : ''}
      ${p.translit ? `<div class="title-translit">${escapeHtml(p.translit)}</div>` : ''}
      ${p.author || p.author_ar ? `<div class="author-row">${p.author ? `<span>${escapeHtml(p.author)}</span>` : ''}${p.author_ar ? `<span class="author-ar">${escapeHtml(p.author_ar)}</span>` : ''}</div>` : ''}
      ${translationProgressMarkup(p)}
      <div class="entry-actions">
        ${workOnBookMarkup(p)}
        ${p.pdf_available ? `<a class="mini-link pdf" href="/api/pdf/${p.id}" target="_blank" rel="noopener">Arabic PDF</a>` : (p.pdf_missing ? '<span class="pill pdf-missing">PDF missing</span>' : '<span class="pill">PDF checking…</span>')}
        ${googleDocLinkMarkup(p)}
      </div>
    </div>
    <div class="project-side">
      <span class="pill status-${p.status}">${STATUS[p.status]}</span>
      ${p.published ? '<span class="pill">Published</span>' : ''}
      ${quickControlsMarkup(p)}
    </div>
  </article>`;
}

function bindProjectClicks(root=document) {
  root.querySelectorAll('[data-project-id]').forEach(el => el.addEventListener('click', event => {
    if (event.target.closest('a,button,input,select,label')) return;
    openProject(Number(el.dataset.projectId));
  }));
  root.querySelectorAll('[data-select-project]').forEach(input => input.addEventListener('change', event => {
    event.stopPropagation();
    const id=Number(input.dataset.selectProject);
    if (input.checked) state.selectedIds.add(id); else state.selectedIds.delete(id);
    input.closest('.project-row')?.classList.toggle('selected',input.checked);
    renderBatchToolbar();
  }));
  bindQuickActions(root);
}

async function resolveEnglishBookUrl(id) {
  const result = await api(`/api/english-book/${id}`);
  if (!result?.url) throw new Error('English Book could not be resolved.');
  return result.url;
}

async function openEnglishBook(id) {
  const reservedWindow=window.open('about:blank','_blank');
  if (reservedWindow) reservedWindow.opener=null;
  try {
    const url=await resolveEnglishBookUrl(id);
    if (reservedWindow) reservedWindow.location.replace(url);
    else window.location.assign(url);
  } catch (error) {
    if (reservedWindow) reservedWindow.close();
    toast(error.message);
  }
}

async function startWorkOnBook(id) {
  const project=state.projects.find(p=>p.id===id);
  if (!project) return;
  if (!project.google_doc_url) {
    openEnglishBookDialog(id,true);
    toast('Link the English Book first');
    return;
  }
  const reservedPdfWindow = project.pdf_available ? window.open('about:blank','_blank') : null;
  if (reservedPdfWindow) reservedPdfWindow.opener=null;
  try {
    const url=await resolveEnglishBookUrl(id);
    if (reservedPdfWindow) reservedPdfWindow.location.replace(`/api/pdf/${project.id}`);
    window.location.assign(url);
  } catch (error) {
    if (reservedPdfWindow) reservedPdfWindow.close();
    toast(error.message);
  }
}

function bindQuickActions(root=document) {
  root.querySelectorAll('[data-work-on-book]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    startWorkOnBook(Number(button.dataset.workOnBook));
  }));
  root.querySelectorAll('.quick-assignee').forEach(select => select.addEventListener('change', async event => {
    event.stopPropagation();
    const id = Number(select.dataset.projectId);
    try {
      await api(`/api/projects/${id}`, {method:'PATCH', body:JSON.stringify({assignee:select.value})});
      await loadData();
      toast(select.value === 'Unassigned' ? 'Book unassigned' : `Assigned to ${assigneeLabel(select.value)}`);
    } catch (error) { toast(error.message); }
  }));
  root.querySelectorAll('.quick-status').forEach(select => select.addEventListener('change', async event => {
    event.stopPropagation();
    const id=Number(select.dataset.projectId);
    try {
      await api(`/api/projects/${id}`, {method:'PATCH',body:JSON.stringify({status:select.value})});
      await loadData();
      toast(`Moved to ${STATUS[select.value]}`);
    } catch (error) { toast(error.message); }
  }));
  root.querySelectorAll('.quick-deadline').forEach(input => input.addEventListener('change', async event => {
    event.stopPropagation();
    const id = Number(input.dataset.projectId);
    const current=state.projects.find(p=>p.id===id)?.due_date || '';
    try {
      const changed=await setProjectDeadline(id,input.value);
      if (changed === false) input.value=current;
    } catch (error) { input.value=current; toast(error.message); }
  }));
  root.querySelectorAll('[data-clear-deadline]').forEach(button => button.addEventListener('click', async event => {
    event.stopPropagation();
    try { await setProjectDeadline(Number(button.dataset.clearDeadline),null); }
    catch (error) { toast(error.message); }
  }));
  root.querySelectorAll('[data-open-english]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openEnglishBook(Number(button.dataset.openEnglish));
  }));
  root.querySelectorAll('[data-link-english]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    openEnglishBookDialog(Number(button.dataset.linkEnglish));
  }));
}

function resetProjectFilters() {
  els.search.value='';
  ['filter-topic','filter-assignee','filter-status','filter-schedule'].forEach(id=>{ if ($(id)) $(id).value=''; });
  ['filter-missing-pdf','filter-checking-pdf','filter-missing-cover','filter-no-english'].forEach(id=>{ if ($(id)) $(id).checked=false; });
}

function clearProjectFilters() {
  resetProjectFilters();
  renderProjects();
  renderBoard();
  toast('Filters cleared');
}

function openProjectsPreset(preset) {
  resetProjectFilters();
  if (preset === 'active') $('filter-status').value='__active__';
  if (preset === 'needs_review') $('filter-status').value='completed';
  if (preset === 'deadlines') $('filter-schedule').value='with_deadline';
  if (preset === 'missing_pdf') $('filter-missing-pdf').checked=true;
  if (preset === 'checking_pdf') $('filter-checking-pdf').checked=true;
  setView('projects');
  renderProjects();
}

function openPersonWork(person) {
  if (person === 'Zahraa' || person === 'Mohammed') {
    els.search.value='';
    setViewScope(person);
    setView('board');
    renderBoard();
    renderTimeline();
    return;
  }
  resetProjectFilters();
  $('filter-assignee').value=person;
  setView('projects');
  renderProjects();
}

function paceModel() {
  const total = state.projects.length;
  const translated = state.projects.filter(isTranslated).length;
  const published = state.projects.filter(p => p.published).length;
  const completedProjects = state.projects
    .map(p=>({project:p,date:parseDateTime(p.completed_at)}))
    .filter(x=>x.date)
    .sort((a,b)=>a.date-b.date);
  const events=completedProjects.map(x=>x.date);

  const knownPages=state.projects.map(p=>Number(p.pages)).filter(n=>Number.isFinite(n)&&n>0);
  const fallbackPages=Math.round(median(knownPages));
  const workloadOf=p=>estimatedPages(p,fallbackPages);

  const representedSeries=new Set();
  for (const p of state.projects) {
    const info=seriesInfo(p);
    if (info && info.item.role !== 'umbrella') representedSeries.add(info.key);
  }
  const workloadProjects=state.projects.filter(p=>{
    const info=seriesInfo(p);
    return !(info?.item?.role === 'umbrella' && representedSeries.has(info.key));
  });

  const totalWork=workloadProjects.reduce((sum,p)=>sum+workloadOf(p),0);
  const completedWork=workloadProjects.reduce((sum,p)=>{
    const work=workloadOf(p);
    if (isTranslated(p)) return sum+work;
    const logged=Math.max(0,Number(p.translated_pages || 0));
    return sum+Math.min(work,logged);
  },0);
  const remainingWork=Math.max(0,totalWork-completedWork);

  const pageEvents=(state.paceEvents?.length ? state.paceEvents : state.activity.filter(a=>a.action==='translation progress'));
  const dailyPages=new Map();
  for (const event of pageEvents) {
    const before=parseActivityJson(event.before_json) || {};
    const after=parseActivityJson(event.after_json) || {};
    const delta=Number(after.translated_pages || 0)-Number(before.translated_pages || 0);
    const when=parseDateTime(event.created_at);
    if (!(delta > 0) || !when) continue;
    const key=localDateKey(when);
    dailyPages.set(key,(dailyPages.get(key)||0)+delta);
  }

  let pagesPerDay=0;
  let observedDays=0;
  let progressDays=0;
  let loggedPages=0;
  const now=new Date();
  const today=new Date(now); today.setHours(12,0,0,0);
  const positiveKeys=[...dailyPages.keys()].sort();
  if (positiveKeys.length) {
    const firstParts=positiveKeys[0].split('-').map(Number);
    const first=new Date(firstParts[0],firstParts[1]-1,firstParts[2],12,0,0,0);
    const cap=new Date(today); cap.setDate(cap.getDate()-89);
    const windowStart=first>cap ? first : cap;
    const weightedHalfLifeDays=14;
    let weightedPages=0;
    let weightTotal=0;
    for (let cursor=new Date(windowStart); cursor<=today; cursor.setDate(cursor.getDate()+1)) {
      const key=localDateKey(cursor);
      const pages=dailyPages.get(key)||0;
      const ageDays=Math.max(0,Math.round((today-cursor)/86400000));
      const weight=Math.pow(0.5,ageDays/weightedHalfLifeDays);
      weightedPages+=pages*weight;
      weightTotal+=weight;
      observedDays+=1;
      if (pages>0) {
        progressDays+=1;
        loggedPages+=pages;
      }
    }
    pagesPerDay=weightTotal ? weightedPages/weightTotal : 0;
  }

  const paceReady=remainingWork===0 || (observedDays>=7 && progressDays>=3 && pagesPerDay>0.05);
  const forecastDate=remainingWork===0
    ? now
    : (paceReady ? new Date(now.getTime()+(remainingWork/pagesPerDay)*86400000) : null);
  const workloadPercent=totalWork ? Math.round((completedWork/totalWork)*100) : 0;

  return {
    total,translated,published,events,completedProjects,
    fallbackPages,totalWork,completedWork,remainingWork,workloadPercent,
    pagesPerDay,pagesPer30:pagesPerDay*30,observedDays,progressDays,loggedPages,
    paceReady,forecastDate,paceHalfLifeDays:14,paceWindowDays:90
  };
}
function translationProgressMarkup(p, compact=false, showZero=false) {
  const done=Math.max(0,Number(p.translated_pages || 0));
  const total=Math.max(0,Number(p.pages || 0));
  if (!total || (!showZero && !done)) return '';
  const percent=Math.min(100,Math.round((done/total)*100));
  return `<div class="book-translation-progress ${compact?'compact':''} ${done===0?'zero':''}" aria-label="${done} of ${total} source pages translated">
    <div class="book-progress-copy"><span>${done}/${total} pages translated</span><strong>${percent}%</strong></div>
    <div class="book-progress-track"><span style="width:${percent}%"></span></div>
  </div>`;
}
function assignedProjectMarkup(p) {
  const due = p.due_date ? dateText(p.due_date) : 'No deadline';
  return `<article class="assigned-card" data-project-id="${p.id}">
    <div class="assigned-cover">${coverMarkup(p,true)}</div>
    <div class="assigned-body">
      <div class="assigned-topline">
        <span class="pill status-${p.status}">${STATUS[p.status]}</span>
        ${p.published ? '<span class="pill">Published</span>' : ''}
      </div>
      <div class="title-ar">${escapeHtml(p.title_ar)}</div>
      ${p.title_en ? `<div class="title-en">${escapeHtml(p.title_en)}</div>` : ''}
      <div class="assigned-meta">${escapeHtml(due)}${p.assignee === 'Both' ? ' · Shared' : ''}</div>
      ${translationProgressMarkup(p,true,true)}
      <div class="entry-actions assigned-actions">
        ${workOnBookMarkup(p)}
        ${googleDocLinkMarkup(p)}
        ${p.pdf_available ? `<a class="mini-link pdf" href="/api/pdf/${p.id}" target="_blank" rel="noopener">Arabic PDF</a>` : ''}
      </div>
    </div>
  </article>`;
}

function parseActivityJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function renderTranslationLive() {
  const assigned=state.projects
    .filter(p=>p.assignee===state.actor || p.assignee==='Both')
    .sort((a,b)=>{
      const ap=Number(a.translated_pages || 0), bp=Number(b.translated_pages || 0);
      if (Boolean(bp) !== Boolean(ap)) return Number(Boolean(bp))-Number(Boolean(ap));
      const recent=String(b.translation_progress_at || '').localeCompare(String(a.translation_progress_at || ''));
      if (recent) return recent;
      return TITLE_COLLATOR.compare(a.title_ar || '',b.title_ar || '');
    });
  const assignedIds=new Set(assigned.map(p=>Number(p.id)));
  const latest=state.activity.filter(a=>a.action==='translation progress' && assignedIds.has(Number(a.project_id))).slice(0,5);
  $('live-progress-summary').textContent=`${assigned.length} assigned · updates live`;
  const assignedMarkup=assigned.length ? assigned.map(p=>{
    const done=Number(p.translated_pages || 0), total=Number(p.pages || 0);
    const percent=total ? Math.min(100,Math.round(done/total*100)) : 0;
    return `<button type="button" class="live-translation-row ${done===0?'zero':''}" data-live-project="${p.id}">
      <div class="live-translation-copy"><span dir="rtl">${escapeHtml(p.title_ar)}</span><strong>${done}/${total} pages</strong></div>
      <div class="live-translation-track"><span style="width:${percent}%"></span></div>
    </button>`;
  }).join('') : '<div class="live-empty">No books are assigned here yet.</div>';
  const feedMarkup=latest.length ? latest.map(a=>{
    const after=parseActivityJson(a.after_json) || {};
    const done=Number(after.translated_pages || 0), total=Number(after.pages || 0);
    const when=new Date(a.created_at.replace(' ','T')+'Z');
    return `<div class="translation-feed-item"><span class="translation-feed-dot"></span><div><strong>${done}/${total} pages</strong><span dir="rtl">${escapeHtml(a.title_ar || '')}</span></div><time>${when.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</time></div>`;
  }).join('') : '<div class="live-empty subtle">Page updates will appear here as translation advances.</div>';
  $('live-translation-active').innerHTML=assignedMarkup;
  $('live-translation-feed').innerHTML=feedMarkup;
  $('live-translation-active').querySelectorAll('[data-live-project]').forEach(button=>button.addEventListener('click',()=>openProject(Number(button.dataset.liveProject))));
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

  const active = state.projects.filter(p => ['in_progress','review','completed'].includes(p.status));
  const due = state.projects.filter(p => p.due_date && !isPublishReady(p));
  const missingPdf = state.projects.filter(p => p.pdf_missing).length;
  const uncheckedPdf = state.projects.filter(p => p.pdf_unchecked).length;
  $('now-list').innerHTML = [
    ['active','Active', active.length], ['needs_review','Needs review', state.projects.filter(p=>p.status==='completed').length],
    ['deadlines','With deadlines', due.length], ['missing_pdf','Missing PDF', missingPdf], ['checking_pdf','PDFs still checking', uncheckedPdf]
  ].map(([preset,label,n])=>`<button type="button" class="summary-row summary-link" data-dashboard-preset="${preset}"><span>${label}</span><strong>${n}</strong></button>`).join('');

  const people = ['Zahraa','Mohammed','Both','Unassigned'];
  $('people-summary').innerHTML = people.map(person => {
    const list = state.projects.filter(p=>p.assignee===person);
    const done = list.filter(isTranslated).length;
    return `<button type="button" class="summary-row summary-link" data-dashboard-person="${person}"><span>${escapeHtml(assigneeLabel(person))}</span><strong>${done}/${list.length} translated</strong></button>`;
  }).join('');
  $('now-list').querySelectorAll('[data-dashboard-preset]').forEach(button=>button.addEventListener('click',()=>openProjectsPreset(button.dataset.dashboardPreset)));
  $('people-summary').querySelectorAll('[data-dashboard-person]').forEach(button=>button.addEventListener('click',()=>openPersonWork(button.dataset.dashboardPerson)));

  const paceValue=model.pagesPerDay>0 ? (model.pagesPerDay>=10 ? model.pagesPerDay.toFixed(0) : model.pagesPerDay.toFixed(1)) : '—';
  const forecast = model.remainingWork===0
    ? 'Translation workload complete'
    : (model.forecastDate
      ? `Projected finish: ${model.forecastDate.toLocaleDateString(undefined,{month:'long',year:'numeric'})}`
      : (model.loggedPages ? 'Learning your translation pace' : 'No page-pace history yet'));
  const paceDetail = model.remainingWork===0
    ? 'No source-page workload remains.'
    : (model.paceReady
      ? `${Math.round(model.remainingWork).toLocaleString()} page-equivalents remain · recent work is weighted more heavily.`
      : (model.loggedPages
        ? `${model.loggedPages.toLocaleString()} pages logged across ${model.progressDays} progress day${model.progressDays===1?'':'s'}; a finish date starts after 7 observed days and 3 progress days.`
        : 'Update translated-page counters to start the forecast.'));
  $('pace-summary').innerHTML = `
    <div class="pace-number"><strong>${paceValue}</strong><span>source pages / day</span></div>
    <div class="pace-copy"><strong>${escapeHtml(forecast)}</strong><span>${escapeHtml(paceDetail)}</span></div>`;

  const assigned = sortProjects(
    state.projects.filter(p => p.assignee === state.actor || p.assignee === 'Both'),
    'title'
  );
  $('my-projects-title').textContent = `${state.actor}'s assigned projects`;
  $('my-projects-count').textContent = `${assigned.length} book${assigned.length===1?'':'s'}`;
  $('my-projects').innerHTML = assigned.map(assignedProjectMarkup).join('') || `<div class="assigned-empty">No books are assigned to ${escapeHtml(state.actor)} yet.</div>`;
  bindProjectClicks($('my-projects'));
  renderTranslationLive();
}

function renderBatchToolbar() {
  const toolbar=$('batch-toolbar');
  if (!toolbar) return;
  const selected=state.selectedIds.size;
  toolbar.classList.toggle('hidden', selected === 0);
  $('batch-count').textContent=`${selected} selected`;
  const visible=filteredProjects();
  const allVisible=visible.length>0 && visible.every(p=>state.selectedIds.has(p.id));
  $('select-visible').checked=allVisible;
  $('select-visible').indeterminate=!allVisible && visible.some(p=>state.selectedIds.has(p.id));
}

function seriesGroupedMarkup(list) {
  const grouped=new Map();
  const standalone=[];
  for (const project of list) {
    const info=seriesInfo(project);
    if (!info) { standalone.push(project); continue; }
    if (!grouped.has(info.key)) grouped.set(info.key,[]);
    grouped.get(info.key).push(project);
  }
  const groupEntries=[...grouped.entries()].sort(([a],[b]) => {
    const ga=state.seriesMap.groups[a], gb=state.seriesMap.groups[b];
    return TITLE_COLLATOR.compare(ga?.name_en || ga?.name_ar || a, gb?.name_en || gb?.name_ar || b);
  });
  const seriesBlocks=groupEntries.map(([key,projects]) => {
    const group=state.seriesMap.groups[key];
    projects.sort((a,b)=>{
      const ia=seriesInfo(a)?.item || {}, ib=seriesInfo(b)?.item || {};
      if (ia.role === 'umbrella' && ib.role !== 'umbrella') return -1;
      if (ib.role === 'umbrella' && ia.role !== 'umbrella') return 1;
      return (ia.position ?? 999)-(ib.position ?? 999) || TITLE_COLLATOR.compare(a.title_ar||'',b.title_ar||'');
    });
    const memberCount=projects.filter(p=>seriesInfo(p)?.item?.role!=='umbrella').length;
    const totalText=group.total ? `${group.total} part${group.total===1?'':'s'}` : 'Official series';
    const visibleText=memberCount && group.total && memberCount !== group.total ? `${memberCount} visible · ${totalText}` : totalText;
    return `<section class="series-cluster">
      <header class="series-cluster-head">
        <svg class="series-rosette" aria-hidden="true"><use href="#rosette"></use></svg>
        <div class="series-heading">
          <div class="series-kicker">${seriesTypeLabel(group)} · ${escapeHtml(visibleText)}</div>
          <h3 class="series-title-ar" dir="rtl">${escapeHtml(group.name_ar)}</h3>
          <div class="series-title-en">${escapeHtml(group.name_en)}</div>
        </div>
      </header>
      <div class="series-cluster-body">${projects.map(p=>projectMarkup(p,false,true)).join('')}</div>
    </section>`;
  }).join('');
  const standaloneBlock=standalone.length ? `<section class="series-cluster standalone-cluster">
    <header class="series-cluster-head">
      <svg class="series-rosette" aria-hidden="true"><use href="#rosette"></use></svg>
      <div class="series-heading">
        <div class="series-kicker">Standalone · ${standalone.length} book${standalone.length===1?'':'s'}</div>
        <h3 class="series-title-ar" dir="rtl">كتب مستقلة</h3>
        <div class="series-title-en">Standalone Books</div>
      </div>
    </header>
    <div class="series-cluster-body">${standalone.map(p=>projectMarkup(p,false,true)).join('')}</div>
  </section>` : '';
  return `<div class="series-groups">${seriesBlocks}${standaloneBlock}</div>`;
}

function renderProjects() {
  syncTopicFilter();
  const list = filteredProjects();
  const audit = state.pdfAudit;
  const pdfText = audit ? ` · PDFs: ${audit.available} verified · ${audit.missing} missing · ${audit.unchecked} checking` : '';
  const coverCount=state.projects.filter(hasCover).length;
  $('project-count').textContent = `${list.length} of ${state.projects.length} books · Covers: ${coverCount}/${state.projects.length}${pdfText}`;
  $('projects-list').innerHTML = (state.projectGrouping === 'series' ? seriesGroupedMarkup(list) : list.map(p=>projectMarkup(p,false,true)).join('')) || '<p class="muted">No projects match these filters.</p>';
  bindProjectClicks($('projects-list'));
  hydrateUploadedCovers($('projects-list'));
  renderBatchToolbar();
}

async function runWithConcurrency(items, limit, worker) {
  let cursor=0;
  const runners=Array.from({length:Math.min(limit,items.length)}, async()=>{
    while(cursor<items.length){
      const item=items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function clearBatchDeadlines() {
  const ids=[...state.selectedIds];
  if (!ids.length) { toast('Select books first'); return; }
  $('clear-batch-deadlines').disabled=true;
  let failures=0;
  try {
    await runWithConcurrency(ids,5,async id=>{
      try { await api(`/api/projects/${id}`,{method:'PATCH',body:JSON.stringify({due_date:null})}); }
      catch { failures+=1; }
    });
    await loadData();
    toast(failures ? `Removed ${ids.length-failures} deadlines; ${failures} failed` : `Removed deadlines from ${ids.length} books`);
  } finally {
    $('clear-batch-deadlines').disabled=false;
  }
}

async function applyBatch() {
  const ids=[...state.selectedIds];
  if (!ids.length) return;
  const patch={};
  if ($('batch-assignee').value) patch.assignee=$('batch-assignee').value;
  if ($('batch-status').value) patch.status=$('batch-status').value;
  if ($('batch-deadline').value) patch.due_date=$('batch-deadline').value;
  if (!Object.keys(patch).length) { toast('Choose a batch change first'); return; }
  if (patch.due_date && !confirmSuspiciousDeadline(patch.due_date,'')) return;
  $('apply-batch').disabled=true;
  let failures=0;
  try {
    await runWithConcurrency(ids,5,async id=>{
      try { await api(`/api/projects/${id}`,{method:'PATCH',body:JSON.stringify(patch)}); }
      catch { failures+=1; }
    });
    state.selectedIds.clear();
    $('batch-assignee').value='';
    $('batch-status').value='';
    $('batch-deadline').value='';
    await loadData();
    toast(failures ? `Updated ${ids.length-failures}; ${failures} failed` : `Updated ${ids.length} books`);
  } finally {
    $('apply-batch').disabled=false;
  }
}

function renderBoard() {
  const q = els.search.value.trim().toLowerCase();
  const matching = state.projects.filter(p=>!q || `${p.title_ar} ${p.title_en||''} ${p.translit||''} ${p.author||''} ${p.category||''}`.toLowerCase().includes(q));
  const base = matching.filter(viewScopeMatches);
  const unassigned = state.viewScope === 'Shared' ? matching.filter(p=>p.assignee === 'Unassigned') : [];
  syncViewScopeSwitch();
  if ($('board-scope-summary')) {
    $('board-scope-summary').textContent = state.viewScope === 'Shared'
      ? `${base.length} team books · ${unassigned.length} unassigned`
      : `${base.length} books · Shared assignments included`;
  }
  const statusTabs=$('board-status-tabs');
  if (statusTabs) {
    statusTabs.innerHTML=STATUS_ORDER.map(status=>{
      const count=base.filter(p=>p.status===status).length;
      const active=state.mobileBoardStatus===status;
      return `<button type="button" data-board-status="${status}" class="${active?'active':''}" aria-pressed="${active?'true':'false'}"><span>${STATUS[status]}</span><strong>${count}</strong></button>`;
    }).join('');
    statusTabs.querySelectorAll('[data-board-status]').forEach(button=>button.addEventListener('click',()=>{
      state.mobileBoardStatus=button.dataset.boardStatus;
      localStorage.setItem('haydariBoardStatus',state.mobileBoardStatus);
      renderBoard();
    }));
  }
  if ($('board-unassigned')) {
    $('board-unassigned').hidden = state.viewScope !== 'Shared' || !unassigned.length;
    $('board-unassigned').innerHTML = unassigned.length
      ? `<section class="board-unassigned-panel"><div class="board-unassigned-head"><div><span class="panel-eyebrow">Team inbox</span><strong>Unassigned</strong></div><span class="pill">${unassigned.length}</span></div><div class="board-unassigned-grid">${unassigned.map(p=>projectMarkup(p,true)).join('')}</div></section>`
      : '';
    if (!$('board-unassigned').hidden) bindProjectClicks($('board-unassigned'));
  }
  $('board').innerHTML = STATUS_ORDER.map(status => {
    const list = base.filter(p=>p.status===status);
    const mobileActive=state.mobileBoardStatus===status ? ' mobile-active' : '';
    return `<section class="board-col${mobileActive}" data-status="${status}"><div class="board-head"><strong>${STATUS[status]}</strong><span class="pill">${list.length}</span></div><div class="board-list" data-status="${status}">${list.map(p=>projectMarkup(p,true)).join('') || '<p class="muted">Empty</p>'}</div></section>`;
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

function timelineDay(value) {
  if (!value) return null;
  const parts=String(value).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return Math.floor(Date.UTC(parts[0],parts[1]-1,parts[2])/86400000);
}
function timelineDate(day) { return new Date(day*86400000); }
function timelineMonths(minDay,maxDay) {
  const segments=[];
  let cursor=new Date(timelineDate(minDay));
  cursor.setUTCDate(1);
  while (Math.floor(cursor.getTime()/86400000) <= maxDay) {
    const start=Math.max(minDay,Math.floor(cursor.getTime()/86400000));
    const next=new Date(cursor); next.setUTCMonth(next.getUTCMonth()+1);
    const end=Math.min(maxDay+1,Math.floor(next.getTime()/86400000));
    if (end>start) segments.push({label:cursor.toLocaleDateString(undefined,{month:'short',year:'numeric',timeZone:'UTC'}),start,end});
    cursor=next;
  }
  return segments;
}
function renderTimeline() {
  const scoped=state.projects.filter(viewScopeMatches);
  const dated=scoped.filter(p=>p.start_date || p.due_date);
  const unscheduled=scoped.filter(p=>!p.start_date && !p.due_date && !isPublishReady(p));
  const unassigned=state.viewScope === 'Shared'
    ? state.projects.filter(p=>p.assignee === 'Unassigned' && (p.start_date || p.due_date || !isPublishReady(p)))
    : [];
  syncViewScopeSwitch();
  if ($('timeline-scope-summary')) {
    $('timeline-scope-summary').textContent=state.viewScope === 'Shared'
      ? `${scoped.length} team books · ${unassigned.length} unassigned`
      : `${scoped.length} books · Shared assignments included`;
  }
  const todayKey=localDateKey();
  const today=timelineDay(todayKey);
  if (!dated.length) {
    $('timeline-visual').innerHTML='<div class="timeline-empty">Add a start date or deadline to place a book on the timeline.</div>';
  } else {
    const points=[today];
    dated.forEach(p=>{
      const s=timelineDay(p.start_date), d=timelineDay(p.due_date);
      if (s!==null) points.push(s);
      if (d!==null) points.push(d);
    });
    const minDay=Math.min(...points)-7;
    const maxDay=Math.max(...points)+14;
    const span=Math.max(1,maxDay-minDay);
    const trackWidth=Math.max(900,Math.min(2800,span*9));
    const px=day=>((day-minDay)/span)*trackWidth;
    const monthMarkup=timelineMonths(minDay,maxDay).map(m=>{
      const left=px(m.start), width=Math.max(1,px(m.end)-left);
      return `<div class="timeline-month" style="left:${left}px;width:${width}px">${escapeHtml(m.label)}</div>`;
    }).join('');
    const todayLeft=px(today);
    const sorted=[...dated].sort((a,b)=>(a.due_date||a.start_date||'9999').localeCompare(b.due_date||b.start_date||'9999'));
    const rows=sorted.map(p=>{
      const start=timelineDay(p.start_date || p.due_date);
      const end=timelineDay(p.due_date || p.start_date);
      const left=px(start);
      const width=Math.max(12,px(Math.max(start+1,end+1))-left);
      const milestone=!p.start_date || !p.due_date || start===end;
      const overdue=Boolean(p.due_date && p.due_date < todayKey && !isPublishReady(p));
      const barTitle=p.start_date && p.due_date && p.start_date!==p.due_date
        ? `${dateText(p.start_date)} → ${dateText(p.due_date)}`
        : (p.due_date ? `Due ${dateText(p.due_date)}` : `Starts ${dateText(p.start_date)}`);
      return `<div class="timeline-lane" data-project-id="${p.id}">
        <div class="timeline-label">
          <div class="timeline-label-title" dir="rtl">${escapeHtml(p.title_ar)}</div>
          <div class="timeline-label-meta"><span class="pill status-${p.status}">${STATUS[p.status]}</span><span>${escapeHtml(barTitle)}</span></div>
        </div>
        <div class="timeline-track" style="width:${trackWidth}px">
          <div class="timeline-today" style="left:${todayLeft}px"></div>
          <button class="timeline-bar status-${p.status} ${milestone?'milestone':''} ${overdue?'overdue':''}" type="button" data-project-id="${p.id}" style="left:${left}px;width:${width}px" title="${escapeHtml(barTitle)}"><span>${escapeHtml(p.title_en || p.title_ar)}</span>${!milestone && p.due_date ? '<i class="timeline-due-marker" aria-hidden="true"></i>' : ''}</button>
        </div>
      </div>`;
    }).join('');
    $('timeline-visual').innerHTML=`<div class="timeline-scroll" data-today-left="${todayLeft}"><div class="timeline-canvas" style="--timeline-track-width:${trackWidth}px">
      <div class="timeline-axis"><div class="timeline-axis-label">Projects</div><div class="timeline-months" style="width:${trackWidth}px">${monthMarkup}<div class="timeline-today axis" style="left:${todayLeft}px"><span>Today</span></div></div></div>
      ${rows}
    </div></div>`;
  }
  $('timeline-unscheduled').innerHTML=unscheduled.length
    ? `<div class="timeline-unscheduled-head"><span>Without dates</span><strong>${unscheduled.length}</strong></div><div class="timeline-unscheduled-grid">${unscheduled.map(assignedProjectMarkup).join('')}</div>`
    : '';
  if ($('timeline-unassigned')) {
    $('timeline-unassigned').hidden=state.viewScope !== 'Shared' || !unassigned.length;
    $('timeline-unassigned').innerHTML=unassigned.length
      ? `<div class="timeline-unscheduled-head"><span>Unassigned schedule</span><strong>${unassigned.length}</strong></div><div class="timeline-unassigned-grid">${unassigned.map(p=>{
          const schedule=p.start_date && p.due_date ? `${dateText(p.start_date)} → ${dateText(p.due_date)}` : (p.due_date ? `Due ${dateText(p.due_date)}` : (p.start_date ? `Starts ${dateText(p.start_date)}` : 'Without dates'));
          return `<article class="timeline-unassigned-card" data-project-id="${p.id}"><div class="title-ar" dir="rtl">${escapeHtml(p.title_ar)}</div><div class="timeline-unassigned-meta"><span class="pill status-${p.status}">${STATUS[p.status]}</span><span>${escapeHtml(schedule)}</span></div></article>`;
        }).join('')}</div>`
      : '';
  }
  bindProjectClicks($('timeline-visual'));
  $('timeline-visual').querySelectorAll('.timeline-bar').forEach(button=>button.addEventListener('click',event=>{
    event.stopPropagation();
    openProject(Number(button.dataset.projectId));
  }));
  bindProjectClicks($('timeline-unscheduled'));
  if ($('timeline-unassigned') && !$('timeline-unassigned').hidden) bindProjectClicks($('timeline-unassigned'));
}

function renderStats() {
  const model = paceModel();
  const today = localDateKey();
  const active = state.projects.filter(p=>!isPublishReady(p));
  const overdue = active.filter(p=>p.due_date && p.due_date < today).length;
  const next30 = localDateKeyAfterDays(30);
  const dueSoon = active.filter(p=>p.due_date && p.due_date >= today && p.due_date <= next30).length;
  const unscheduled = active.filter(p=>!p.due_date).length;

  $('stat-translated').textContent = model.translated;
  $('stat-translated-sub').textContent = `of ${model.total} books · ${pct(model.translated,model.total)}%`;
  $('stat-published').textContent = model.published;
  $('stat-published-sub').textContent = `of ${model.total} books · ${pct(model.published,model.total)}%`;
  const paceText=model.pagesPerDay>0 ? (model.pagesPerDay>=10 ? model.pagesPerDay.toFixed(0) : model.pagesPerDay.toFixed(1)) : '—';
  $('stat-pace').textContent = paceText;
  const paceSub=$('stat-pace-sub');
  if (paceSub) {
    paceSub.textContent = model.loggedPages
      ? `source pages/day · ${model.paceHalfLifeDays}-day half-life · ${model.observedDays} observed day${model.observedDays===1?'':'s'}`
      : 'source pages/day · waiting for page progress';
  }
  $('stat-forecast').textContent = model.remainingWork===0
    ? 'Done'
    : (model.forecastDate ? model.forecastDate.toLocaleDateString(undefined,{month:'short',year:'numeric'}) : 'Learning');
  $('stat-forecast-sub').textContent = model.remainingWork===0
    ? 'Translation workload complete'
    : (model.forecastDate
      ? `${Math.round(model.remainingWork).toLocaleString()} page-equivalents remain · 90-day maximum history`
      : (model.loggedPages
        ? `Forecast unlocks after 7 observed days + 3 progress days; currently ${model.observedDays} + ${model.progressDays}.`
        : 'Log source-page progress to start forecasting'));

  $('stat-workload-pace').textContent = `${model.workloadPercent}%`;
  const workloadPaceSub=$('stat-workload-pace-sub');
  if (workloadPaceSub) workloadPaceSub.textContent = `${Math.round(model.completedWork).toLocaleString()} of ${Math.round(model.totalWork).toLocaleString()} page-equivalents`;
  $('stat-workload-forecast').textContent = Math.round(model.remainingWork).toLocaleString();
  $('stat-workload-forecast-sub').textContent = model.remainingWork===0
    ? 'No translation workload remains'
    : `page-equivalents remain · unknown counts use ~${model.fallbackPages} pages; duplicate series umbrellas excluded`;

  $('stats-by-person').innerHTML = ASSIGNEES.map(person => {
    const list=state.projects.filter(p=>p.assignee===person);
    const done=list.filter(isTranslated).length;
    const recentByPerson=model.completedProjects.filter(x=>x.date>=new Date(Date.now()-30*86400000) && x.project.completed_by===person).length;
    return `<div class="summary-row"><span>${person}</span><strong>${done}/${list.length} · ${pct(done,list.length)}%${['Zahraa','Mohammed'].includes(person) ? ` · ${recentByPerson}/30d` : ''}</strong></div>`;
  }).join('');
  $('stats-deadlines').innerHTML = [
    ['Overdue',overdue],['Due in next 30 days',dueSoon],['Active without deadline',unscheduled]
  ].map(([label,n])=>`<div class="summary-row"><span>${label}</span><strong>${n}</strong></div>`).join('');

  $('progress-chart').innerHTML = progressChartMarkup(model);
}

function progressChartMarkup(model) {
  if (!model.events.length) return '<div class="chart-empty">Translation history will appear here after the first book reaches Needs Formatting or later.</div>';
  const width=760, height=280, left=46, right=18, top=18, bottom=42;
  const start = new Date(model.events[0]); start.setHours(0,0,0,0);
  const now = new Date(); now.setHours(23,59,59,999);
  const projectedEnd=model.forecastDate && model.forecastDate>now ? model.forecastDate : now;
  const span = Math.max(86400000,projectedEnd-start);
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
  points.push({date:now,count:running});
  const x=d=>left+((d-start)/span)*(width-left-right);
  const y=n=>top+(1-(n/Math.max(1,model.total)))*(height-top-bottom);
  const path=points.map((p,i)=>`${i?'L':'M'} ${x(p.date).toFixed(1)} ${y(p.count).toFixed(1)}`).join(' ');
  const pctNow=pct(model.translated,model.total);
  const projection=model.forecastDate && model.forecastDate>now
    ? `<line class="chart-projection" x1="${x(now)}" y1="${y(model.translated)}" x2="${x(model.forecastDate)}" y2="${y(model.total)}"></line>
       <text class="chart-label" x="${width-right}" y="${top+12}" text-anchor="end">Projected finish</text>`
    : '';
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative translation progress">
    <line class="chart-axis" x1="${left}" y1="${top}" x2="${left}" y2="${height-bottom}"></line>
    <line class="chart-axis" x1="${left}" y1="${height-bottom}" x2="${width-right}" y2="${height-bottom}"></line>
    <line class="chart-grid" x1="${left}" y1="${y(model.total/2)}" x2="${width-right}" y2="${y(model.total/2)}"></line>
    <text class="chart-label" x="${left-8}" y="${top+4}" text-anchor="end">100%</text>
    <text class="chart-label" x="${left-8}" y="${y(model.total/2)+4}" text-anchor="end">50%</text>
    <text class="chart-label" x="${left-8}" y="${height-bottom+4}" text-anchor="end">0%</text>
    <path class="chart-line" d="${path}"></path>
    ${projection}
    <circle class="chart-point" cx="${x(now)}" cy="${y(model.translated)}" r="4"></circle>
    <text class="chart-value" x="${Math.max(left+30,x(now)-6)}" y="${Math.max(top+14,y(model.translated)-10)}" text-anchor="end">${pctNow}%</text>
    <text class="chart-label" x="${left}" y="${height-12}">${start.toLocaleDateString(undefined,{month:'short',year:'2-digit'})}</text>
    <text class="chart-label" x="${width-right}" y="${height-12}" text-anchor="end">${projectedEnd===now ? 'Today' : model.forecastDate.toLocaleDateString(undefined,{month:'short',year:'2-digit'})}</text>
  </svg>`;
}

function activityActorGroup(activity) {
  if (activity.actor === 'Zahraa') return 'Zahraa';
  if (activity.actor === 'Mohammed' || activity.actor === 'Brother') return 'Mohammed';
  return 'System';
}

function syncActivityFilters() {
  document.querySelectorAll('[data-activity-actor]').forEach(button=>{
    const active=button.dataset.activityActor===state.activityActorFilter;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',active?'true':'false');
  });
  if ($('activity-type')) $('activity-type').value=state.activityTypeFilter;
}

function renderActivity() {
  syncActivityFilters();
  const filtered=state.activity.filter(a=>{
    const actorMatch=state.activityActorFilter === 'all' || activityActorGroup(a) === state.activityActorFilter;
    const type= a.action === 'translation progress' ? 'translation' : 'project';
    const typeMatch=state.activityTypeFilter === 'all' || type === state.activityTypeFilter;
    return actorMatch && typeMatch;
  });
  if ($('activity-filter-summary')) $('activity-filter-summary').textContent=`${filtered.length} of ${state.activity.length} events`;
  $('activity-list').innerHTML = filtered.map(a => {
    const when=new Date(a.created_at.replace(' ','T')+'Z');
    if (a.action === 'translation progress') {
      const after=parseActivityJson(a.after_json) || {};
      return `<div class="activity-item activity-translation"><time>${when.toLocaleDateString()}</time><div><strong>${Number(after.translated_pages || 0)}/${Number(after.pages || 0)} pages translated</strong>${a.title_ar ? ` — <span dir="rtl">${escapeHtml(a.title_ar)}</span>` : ''}</div><small>${when.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</small></div>`;
    }
    return `<div class="activity-item"><time>${when.toLocaleDateString()}</time><div><strong>${escapeHtml(a.actor)}</strong> ${escapeHtml(a.action)}${a.title_ar ? ` — <span dir="rtl">${escapeHtml(a.title_ar)}</span>` : ''}</div><small>${when.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</small></div>`;
  }).join('') || '<p class="muted">No activity matches these filters.</p>';
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
  $('start-date').value = p?.start_date || '';
  $('due-date').value = p?.due_date || '';
  updateDeadlineWarning($('due-date').value,p?.due_date || '');
  $('translated-pages').value = p?.translated_pages || 0;
  $('translated-pages').max = p?.pages || ''; 
  $('translated-pages-total').textContent = p?.pages ? `/ ${p.pages} source pages` : 'source pages';
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
  $('published').checked = Boolean(p?.published);
  $('notes').value = p?.notes || '';
  const meta = [];
  if (p?.completed_at) meta.push(`Translation finished ${new Date(p.completed_at).toLocaleDateString()}${p.completed_by ? ` by ${escapeHtml(p.completed_by)}` : ''}`);
  if (p?.published_at) meta.push(`Published ${new Date(p.published_at).toLocaleDateString()}${p.published_by ? ` by ${escapeHtml(p.published_by)}` : ''}`);
  $('completion-meta').innerHTML = meta.map(x => `<span>${x}</span>`).join('');
  els.dialog.showModal();
}

async function saveProject(event) {
  event.preventDefault();
  const id = Number($('project-id').value) || null;
  const payload = {
    title_ar: $('title-ar').value.trim(), title_en: $('title-en').value.trim(), assignee: $('assignee').value,
    status: $('status').value, start_date: $('start-date').value, due_date: $('due-date').value,
    google_doc_url: $('google-doc-url').value.trim(), cover_url: $('cover-url').value.trim(), source_pdf_url: $('source-pdf-url').value.trim(),
    published: $('published').checked, notes: $('notes').value.trim(),
  };
  const currentProject=id ? state.projects.find(p=>p.id===id) : null;
  if (payload.due_date && !confirmSuspiciousDeadline(payload.due_date,currentProject?.due_date || '')) return;
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
  const fallback = manual || imported?.path || (imported?.source_url && project?.catalog_id ? `/api/official-cover/${encodeURIComponent(project.catalog_id)}` : '');
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

async function loadSeriesMap() {
  try {
    const response=await fetch('/series-map.json',{cache:'no-store'});
    const data=response.ok ? await response.json() : {};
    state.seriesMap={groups:data.groups || {},books:data.books || {}};
  } catch { state.seriesMap={groups:{},books:{}}; }
}

async function loadCoverMap() {
  try {
    const response = await fetch('/cover-map.json', {cache:'no-store'});
    const data = response.ok ? await response.json() : {};
    state.coverMap = data.covers || {};
  } catch { state.coverMap = {}; }
}

function openEnglishBookDialog(id, continueWork=false) {
  const project = state.projects.find(p=>p.id===id);
  state.pendingWorkOnLink = continueWork ? id : null;
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
  const continueWork = state.pendingWorkOnLink === id;
  const project = state.projects.find(p=>p.id===id);
  const reservedPdfWindow = continueWork && project?.pdf_available ? window.open('about:blank','_blank') : null;
  if (reservedPdfWindow) reservedPdfWindow.opener=null;
  try {
    await api(`/api/projects/${id}`, {method:'PATCH',body:JSON.stringify({google_doc_url:url})});
    const verifiedUrl = continueWork ? await resolveEnglishBookUrl(id) : null;
    $('english-book-dialog').close();
    state.pendingWorkOnLink=null;
    await loadData();
    if (continueWork) {
      if (reservedPdfWindow) reservedPdfWindow.location.replace(`/api/pdf/${id}`);
      window.location.assign(verifiedUrl);
      return;
    }
    if (reservedPdfWindow) reservedPdfWindow.close();
    toast('English Book linked');
  } catch(error) {
    if (reservedPdfWindow) reservedPdfWindow.close();
    toast(error.message);
  }
}

function sharedDataSignature(projects, activity, paceEvents) {
  const projectState=projects.map(p=>[
    p.id,p.updated_at,p.status,p.assignee,p.translated_pages,p.translation_progress_at,
    p.start_date,p.due_date,p.google_doc_url,p.cover_url,p.has_uploaded_cover,
    p.published_at,p.pdf_status
  ]);
  return JSON.stringify([
    projectState,
    activity.map(a=>a.id),
    paceEvents.map(a=>a.id)
  ]);
}

async function fetchSharedData() {
  const [projects, activity] = await Promise.all([api('/api/projects'), api('/api/activity')]);
  const nextProjects=projects.projects || [];
  const nextActivity=activity.activity || [];
  const nextPaceEvents=activity.pace_events || nextActivity.filter(a=>a.action==='translation progress');
  return {projects:nextProjects,activity:nextActivity,paceEvents:nextPaceEvents};
}

function applySharedData(next,{force=false}={}) {
  const signature=sharedDataSignature(next.projects,next.activity,next.paceEvents);
  const changed=force || signature!==state.liveSignature;
  state.projects=next.projects;
  state.activity=next.activity;
  state.paceEvents=next.paceEvents;
  state.liveSignature=signature;
  if (changed) render();
  return changed;
}

async function loadData() {
  const next=await fetchSharedData();
  applySharedData(next,{force:true});
}

async function syncSharedData() {
  if (document.hidden || liveSyncInFlight) return;
  liveSyncInFlight=true;
  try {
    const next=await fetchSharedData();
    applySharedData(next);
  } catch {
    // Background sync is best-effort; a transient network miss should not
    // interrupt the person currently working in the open workspace.
  } finally {
    liveSyncInFlight=false;
  }
}

function startLiveSync() {
  if (liveSyncTimer) clearInterval(liveSyncTimer);
  liveSyncTimer=setInterval(syncSharedData,LIVE_SYNC_MS);
  window.addEventListener('focus',syncSharedData);
  document.addEventListener('visibilitychange',()=>{
    if (!document.hidden) syncSharedData();
  });
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
  clearLegacyAccessKey();
  els.actor.value = state.actor;
  syncActorSwitch();
  syncViewScopeSwitch();
  syncActivityFilters();
  if ($('sort-projects')) $('sort-projects').value = state.projectSort;
  if ($('group-projects')) $('group-projects').value = state.projectGrouping;
  try {
    const health = await api('/api/health');
    state.pdfAudit = health.pdfs || null;
    await Promise.all([loadCoverMap(),loadSeriesMap()]);
    await loadData();
    startLiveSync();
    if (state.pdfAudit?.unchecked) auditPdfs().catch(error => toast(`PDF verification paused: ${error.message}`));
  } catch (e) {
    toast(`Could not load workspace: ${e.message}`);
  }
}

document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));
document.querySelectorAll('[data-actor-choice]').forEach(button=>button.addEventListener('click',()=>{
  if (button.dataset.actorChoice===state.actor) return;
  els.actor.value=button.dataset.actorChoice;
  els.actor.dispatchEvent(new Event('change',{bubbles:true}));
}));
document.querySelectorAll('[data-view-scope]').forEach(button=>button.addEventListener('click',()=>{
  const scope=button.dataset.viewScope;
  if (!VIEW_SCOPES.includes(scope) || scope===state.viewScope) return;
  setViewScope(scope);
  renderBoard();
  renderTimeline();
}));
document.querySelectorAll('[data-activity-actor]').forEach(button=>button.addEventListener('click',()=>{
  const actor=button.dataset.activityActor;
  if (!ACTIVITY_ACTORS.includes(actor)) return;
  state.activityActorFilter=actor;
  localStorage.setItem('haydariActivityActor',actor);
  renderActivity();
}));
$('activity-type')?.addEventListener('change',()=>{
  state.activityTypeFilter=$('activity-type').value;
  localStorage.setItem('haydariActivityType',state.activityTypeFilter);
  renderActivity();
});
document.querySelectorAll('[data-jump-view]').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.jumpView)));
$('view-my-projects')?.addEventListener('click',()=>{
  $('filter-assignee').value='__mine__';
  setView('projects');
  renderProjects();
});
els.search.addEventListener('input',()=>{renderProjects();renderBoard();});
els.actor.addEventListener('change',()=>{
  state.actor=els.actor.value;
  localStorage.setItem('haydariActor',state.actor);
  syncActorSwitch();
  renderDashboard();
  if ($('filter-assignee')?.value === '__mine__') renderProjects();
});
['filter-topic','filter-assignee','filter-status','filter-schedule','filter-missing-pdf','filter-checking-pdf','filter-missing-cover','filter-no-english'].forEach(id=>$(id)?.addEventListener('change',renderProjects));
$('sort-projects')?.addEventListener('change',()=>{state.projectSort=$('sort-projects').value;localStorage.setItem('haydariProjectSort',state.projectSort);renderProjects();});
$('group-projects')?.addEventListener('change',()=>{state.projectGrouping=$('group-projects').value;localStorage.setItem('haydariProjectGrouping',state.projectGrouping);renderProjects();});
$('new-project').addEventListener('click',()=>openProject(null));
$('due-date')?.addEventListener('input',()=>{
  const id=Number($('project-id').value) || null;
  const current=id ? state.projects.find(p=>p.id===id)?.due_date || '' : '';
  updateDeadlineWarning($('due-date').value,current);
});
$('clear-due-date')?.addEventListener('click',async ()=>{
  const id=Number($('project-id').value) || null;
  if (!id) { $('due-date').value=''; return; }
  try {
    await setProjectDeadline(id,null);
    $('due-date').value='';
    updateDeadlineWarning('','');
  } catch (error) { toast(error.message); }
});
$('published').addEventListener('change',()=>{ if ($('published').checked) $('status').value='published'; });
$('status').addEventListener('change',()=>{ if ($('status').value!=='published') $('published').checked=false; });
$('clear-project-filters')?.addEventListener('click',clearProjectFilters);
$('timeline-jump-today')?.addEventListener('click',()=>{
  const scroll=$('timeline-visual')?.querySelector('.timeline-scroll');
  if (!scroll) return;
  const todayLeft=Number(scroll.dataset.todayLeft || 0);
  scroll.scrollTo({left:Math.max(0,todayLeft-scroll.clientWidth/2+230),behavior:'smooth'});
});
$('filter-toggle')?.addEventListener('click',()=>{
  const content=$('filter-content');
  const open=!content.classList.toggle('collapsed');
  $('filter-toggle').setAttribute('aria-expanded',open?'true':'false');
  $('filter-toggle-label').textContent=open?'Hide filters':'Filter & organize';
});
$('select-visible').addEventListener('change',()=>{
  const visible=filteredProjects();
  if ($('select-visible').checked) visible.forEach(p=>state.selectedIds.add(p.id));
  else visible.forEach(p=>state.selectedIds.delete(p.id));
  renderProjects();
});
$('clear-batch').addEventListener('click',()=>{state.selectedIds.clear();renderProjects();});
$('clear-batch-deadlines')?.addEventListener('click',clearBatchDeadlines);
$('apply-batch').addEventListener('click',applyBatch);
$('cover-url').addEventListener('input',()=>renderCoverPreview(state.projects.find(p=>p.id===Number($('project-id').value))));
$('upload-cover').addEventListener('click',uploadCoverPhoto);
$('remove-uploaded-cover').addEventListener('click',removeUploadedCover);
$('close-english-dialog').addEventListener('click',()=>{state.pendingWorkOnLink=null;$('english-book-dialog').close();});
$('cancel-english-dialog').addEventListener('click',()=>{state.pendingWorkOnLink=null;$('english-book-dialog').close();});
$('english-book-form').addEventListener('submit',saveEnglishBook);
$('close-dialog').addEventListener('click',()=>els.dialog.close());
$('cancel-dialog').addEventListener('click',()=>els.dialog.close());
els.form.addEventListener('submit',saveProject);
init();

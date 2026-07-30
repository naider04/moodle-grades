// ─── State ───
const state = {
    mode: null,          // 'aulagradoa' | 'aulagradob'
    baseUrl: null,
    token: null,
    userId: null,
    fullname: null,
    careerName: null,
    courses: [],
    gradeCache: {},
};

const MOODLE_URLS = {
    aulagradoa: 'https://aulagradoa.unemi.edu.ec',
    aulagradob: 'https://aulagradob.unemi.edu.ec',
};

const MODE_LABELS = {
    aulagradoa: 'Estudiante presencial',
    aulagradob: 'Estudiante en l\u00ednea',
};

// ─── DOM refs ───
const $ = id => document.getElementById(id);

const screenMode = $('screen-mode');
const screenLogin = $('screen-login');
const screenDash = $('screen-dashboard');
const loginModeLabel = $('login-mode-label');
const loginForm = $('login-form');
const loginBtn = $('login-btn');
const loginError = $('login-error');
const loginBackBtn = $('login-back-btn');
const usernameInput = $('username');
const passwordInput = $('password');
const headerUser = $('header-user');
const headerCareer = $('header-career');
const logoutBtn = $('logout-btn');
const courseList = $('course-list');
const loadingOverlay = $('loading-overlay');

// ─── Screen helpers ───
function showScreen(screen) {
    [screenMode, screenLogin, screenDash].forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
}

function showLoading(show) {
    loadingOverlay.classList.toggle('hidden', !show);
}

function showError(el, msg) {
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = msg;
    el.classList.remove('hidden');
}

// ─── API call ───
async function api(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
}

// ─── Mode selection ───
document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        state.mode = btn.dataset.mode;
        const label = MODE_LABELS[state.mode] || state.mode;
        loginModeLabel.textContent = label;
        showScreen(screenLogin);
        usernameInput.focus();
    });
});

loginBackBtn.addEventListener('click', () => {
    showScreen(screenMode);
});

// ─── Login ───
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError(loginError);
    loginBtn.disabled = true;
    loginBtn.textContent = 'Ingresando\u2026';

    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const moodleUrl = MOODLE_URLS[state.mode];

    if (!moodleUrl) {
        showError(loginError, 'Modalidad no v\u00e1lida.');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Ingresar';
        return;
    }

    try {
        const data = await api('/api/login', { moodleUrl, username, password });
        state.baseUrl = data.baseUrl;
        state.token = data.token;
        state.userId = data.userId;
        state.fullname = data.fullname;

        headerUser.textContent = data.fullname;

        showScreen(screenDash);
        await loadCourses();
    } catch (err) {
        showError(loginError, err.message);
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Ingresar';
    }
});

// ─── Logout ───
logoutBtn.addEventListener('click', () => {
    state.mode = null;
    state.baseUrl = null;
    state.token = null;
    state.userId = null;
    state.fullname = null;
    state.careerName = null;
    state.courses = [];
    state.gradeCache = {};
    courseList.innerHTML = '';
    showScreen(screenMode);
    usernameInput.value = '';
    passwordInput.value = '';
});

// ─── Load courses ───
async function loadCourses() {
    showLoading(true);
    courseList.innerHTML = '';
    try {
        const data = await api('/api/courses', {
            baseUrl: state.baseUrl,
            token: state.token,
            userId: state.userId,
        });

        state.courses = data.courses || [];

        // Set career name from server (extracted from categories)
        state.careerName = data.careerName || MODE_LABELS[state.mode] || '';
        headerCareer.textContent = state.careerName;

        renderCourseList();
    } catch (err) {
        courseList.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
    } finally {
        showLoading(false);
    }
}

// ─── Render course list ───
function renderCourseList() {
    courseList.innerHTML = '';
    if (state.courses.length === 0) {
        courseList.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center;">No se encontraron cursos.</p>';
        return;
    }

    for (const c of state.courses) {
        const card = document.createElement('div');
        card.className = 'course-card';
        card.dataset.courseId = c.id;

        const shortName = (c.fullname || c.shortname || '').split(' - ')[0].trim();

        card.innerHTML =
            '<div class="course-card-header" tabindex="0" role="button" aria-expanded="false">' +
                '<span class="course-name">' + escapeHtml(shortName) + '</span>' +
                '<span class="course-total" id="total-' + c.id + '">' +
                    '<span class="loading-placeholder">&mdash;</span>' +
                '</span>' +
                '<span class="course-expand-icon">&#9660;</span>' +
            '</div>' +
            '<div class="course-detail" id="detail-' + c.id + '">' +
                '<div class="grade-table-wrap">' +
                    '<div class="loading-placeholder" style="text-align:center;padding:1rem;color:var(--text-muted);">Cargando detalle&hellip;</div>' +
                '</div>' +
            '</div>';

        const header = card.querySelector('.course-card-header');
        header.addEventListener('click', () => toggleCourse(card, c.id));
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCourse(card, c.id); }
        });

        courseList.appendChild(card);

        fetchGradeDetail(c.id);
    }
}

// ─── Toggle course expand ───
function toggleCourse(card, courseId) {
    const expanded = card.classList.toggle('expanded');
    card.querySelector('.course-card-header').setAttribute('aria-expanded', expanded);
}

// ─── Fetch grade detail ───
async function fetchGradeDetail(courseId) {
    try {
        const data = await api('/api/grade-detail', {
            baseUrl: state.baseUrl,
            token: state.token,
            userId: state.userId,
            courseId,
        });
        state.gradeCache[courseId] = data;

        const totalEl = document.getElementById('total-' + courseId);
        if (totalEl) {
            const total = data.courseTotal;
            if (total.raw !== null && total.raw !== undefined) {
                totalEl.innerHTML = formatNum(total.raw) + ' <span class="max">/ ' + total.max + '</span>';
            } else {
                totalEl.innerHTML = '<span class="max" style="color:var(--text-muted)">Sin nota</span>';
            }
        }

        const detailEl = document.getElementById('detail-' + courseId);
        if (detailEl) {
            detailEl.querySelector('.grade-table-wrap').innerHTML = buildGradeTableHTML(data);
        }
    } catch (err) {
        console.error('Grade detail error:', courseId, err.message);
        const detailEl = document.getElementById('detail-' + courseId);
        if (detailEl) {
            detailEl.querySelector('.grade-table-wrap').innerHTML =
                '<p style="color:var(--text-muted);text-align:center;padding:1rem;font-size:0.85rem;">' + escapeHtml(err.message) + '</p>';
        }
    }
}

// ─── Build grade table HTML ───
function buildGradeTableHTML(data) {
    if (!data.categories || data.categories.length === 0) {
        return '<p style="color:var(--text-muted);text-align:center;padding:1rem;font-size:0.85rem;">Sin calificaciones disponibles.</p>';
    }

    var html = '<table class="grade-table">';
    html += '<thead><tr>';
    html += '<th class="col-name">Actividad</th>';
    html += '<th class="col-score">Nota</th>';
    html += '<th class="col-max">M&aacute;x</th>';
    html += '<th class="col-pct">Rendimiento</th>';
    html += '<th class="col-contrib">Aporte a nota final</th>';
    html += '</tr></thead><tbody>';

    for (var ci = 0; ci < data.categories.length; ci++) {
        var cat = data.categories[ci];
        var catPct = (cat.raw !== null && cat.max) ? Math.round(cat.raw / cat.max * 1000) / 10 : null;

        html += '<tr class="cat-header">' +
            '<td><span class="cat-label">' + escapeHtml(cat.name) + '</span> <span class="cat-max">(m&aacute;x ' + formatNum(cat.max) + ')</span></td>' +
            '<td class="col-score cat-total">' + cat.score + '</td>' +
            '<td class="col-max">' + formatNum(cat.max) + '</td>' +
            '<td class="col-pct">' + (catPct !== null ? catPct + '%' : '&mdash;') + '</td>' +
            '<td class="col-contrib cat-total">' + cat.score + ' / ' + formatNum(cat.max) + '</td>' +
        '</tr>';

        for (var ii = 0; ii < cat.items.length; ii++) {
            var item = cat.items[ii];
            var badgeClass = item.module === 'quiz' ? 'quiz' : 'assign';
            var badgeLabel = item.module === 'quiz' ? 'Quiz' : 'Tarea';
            var pctDisplay = item.percentage !== null ? item.percentage + '%' : '&mdash;';

            var contribStr = '&mdash;';
            if (item.pointsToFinal !== null) {
                contribStr = formatNum(item.pointsToFinal) + ' / ' + formatNum(item.maxPointsToFinal);
            }

            var pctVal = item.percentage !== null ? Math.min(item.percentage, 100) : 0;

            html += '<tr class="activity-row">' +
                '<td class="col-name">' +
                    '<span class="mod-badge ' + badgeClass + '">' + badgeLabel + '</span> ' +
                    escapeHtml(item.name) +
                '</td>' +
                '<td class="col-score">' + item.score + '</td>' +
                '<td class="col-max">' + (item.max !== null ? item.max : '&mdash;') + '</td>' +
                '<td class="col-pct">' +
                    '<span class="pct-bar">' +
                        '<span class="pct-bar-fill"><span class="fill" style="width:' + pctVal + '%"></span></span>' +
                        '<span class="pct-text">' + pctDisplay + '</span>' +
                    '</span>' +
                '</td>' +
                '<td class="col-contrib">' + contribStr + '</td>' +
            '</tr>';
        }
    }

    // Course total row
    var total = data.courseTotal;
    var totalPct = (total.raw !== null && total.max) ? Math.round(total.raw / total.max * 1000) / 10 : null;

    html += '<tr class="total-row">' +
        '<td class="total-label">Total del curso</td>' +
        '<td class="col-score">' + total.formatted + '</td>' +
        '<td class="col-max">' + formatNum(total.max) + '</td>' +
        '<td class="col-pct">' + (totalPct !== null ? totalPct + '%' : '&mdash;') + '</td>' +
        '<td class="col-contrib">' + total.formatted + ' / ' + formatNum(total.max) + '</td>' +
    '</tr>';

    html += '</tbody></table>';
    return html;
}

// ─── Utilities ───
function escapeHtml(str) {
    if (typeof str !== 'string') return String(str || '');
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatNum(n) {
    if (n === null || n === undefined) return '&mdash;';
    if (typeof n === 'number') {
        return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
    }
    return String(n).replace('.', ',');
}

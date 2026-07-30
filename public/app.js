// ─── State ───
const state = {
    mode: null,          // 'presencial' | 'enlinea' | 'otra'
    sgaToken: null,
    fullname: null,
    careerName: null,
    courses: [],
    moodle: null,        // { token, baseUrl, userId } for UNEMI modes
};

const MODE_LABELS = {
    presencial: 'Estudiante presencial',
    enlinea: 'Estudiante en l\u00ednea',
    otra: 'Otra instituci\u00f3n',
};

const MOODLE_BASE_URLS = {
    presencial: 'https://aulagradoa.unemi.edu.ec',
    enlinea: 'https://aulagradob.unemi.edu.ec',
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
const moodleUrlField = $('field-moodle-url');
const moodleUrlInput = $('moodle-url-input');
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
        moodleUrlField.classList.toggle('hidden', state.mode !== 'otra');
        if (state.mode === 'otra') {
            moodleUrlInput.required = true;
        } else {
            moodleUrlInput.required = false;
            moodleUrlInput.value = '';
        }
        showScreen(screenLogin);
        if (state.mode === 'otra') {
            moodleUrlInput.focus();
        } else {
            usernameInput.focus();
        }
    });
});

loginBackBtn.addEventListener('click', () => {
    moodleUrlField.classList.add('hidden');
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

    if (!username || !password) {
        showError(loginError, 'Ingrese usuario y contrase\u00f1a.');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Ingresar';
        return;
    }

    try {
        if (state.mode === 'otra') {
            // Pure Moodle login
            const moodleUrl = moodleUrlInput.value.trim().replace(/\/+$/, '');
            if (!moodleUrl) {
                showError(loginError, 'Ingrese la URL de Moodle.');
                loginBtn.disabled = false;
                loginBtn.textContent = 'Ingresar';
                return;
            }
            const data = await api('/api/login', { moodleUrl, username, password });
            state.sgaToken = null;
            state.moodle = { token: data.token, baseUrl: data.baseUrl, userId: data.userId };
            state.fullname = data.fullname;
            state.careerName = '';
            headerUser.textContent = data.fullname;
            headerCareer.textContent = MODE_LABELS[state.mode];
            showScreen(screenDash);
            await loadMoodleCourses(data.baseUrl, data.token, data.userId);
        } else {
            // Combined SGA + Moodle login
            const data = await api('/api/login-full', { username, password, mode: state.mode });
            state.sgaToken = data.sgaToken;
            state.moodle = data.moodle || null;
            state.fullname = data.fullname;
            state.careerName = data.careerName || MODE_LABELS[state.mode];
            headerUser.textContent = data.fullname;
            headerCareer.textContent = state.careerName;
            showScreen(screenDash);
            await loadSgaCourses(data.sgaToken);
        }
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
    state.sgaToken = null;
    state.moodle = null;
    state.fullname = null;
    state.careerName = null;
    state.courses = [];
    courseList.innerHTML = '';
    showScreen(screenMode);
    usernameInput.value = '';
    passwordInput.value = '';
    moodleUrlInput.value = '';
    moodleUrlField.classList.add('hidden');
});

// ─── Load SGA Courses (with Moodle matching) ───
async function loadSgaCourses(token) {
    showLoading(true);
    courseList.innerHTML = '';
    try {
        const body = { token };
        if (state.moodle) {
            body.moodleToken = state.moodle.token;
            body.moodleUrl = state.moodle.baseUrl;
            body.moodleUserId = state.moodle.userId;
        }
        const data = await api('/api/sga-courses', body);
        state.courses = data.courses || [];
        renderCourseList();
    } catch (err) {
        courseList.innerHTML = `<div class="error-msg">${escapeHtml(err.message)}</div>`;
    } finally {
        showLoading(false);
    }
}

// ─── Load Moodle Courses (for "otra" mode) ───
async function loadMoodleCourses(baseUrl, token, userId) {
    showLoading(true);
    courseList.innerHTML = '';
    try {
        const data = await api('/api/moodle-courses', { baseUrl, token, userId });
        state.courses = data.courses.map(c => ({
            id: c.id,
            fullname: c.fullname || c.shortname || '',
            shortname: c.shortname || '',
            professor: '',
            finalGrade: null,
            attendance: null,
            status: '',
            dateRange: '',
            grades: [],
            _moodleId: c.id,
            _moodleUserId: userId,
            _moodleToken: token,
            _moodleBaseUrl: baseUrl,
        }));
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

        const displayName = c.fullname.split(' - ')[0].trim();
        const teacherName = c.professor || '';

        let gradeClass = 'grade-ok';
        if (c.status === 'REPROBADO') gradeClass = 'grade-fail';
        else if (c.status === 'EN CURSO' || !c.status) gradeClass = 'grade-none';

        let finalDisplay;
        if (c.finalGrade !== null && c.finalGrade !== undefined && c.finalGrade > 0) {
            finalDisplay = `<span class="grade-badge ${gradeClass}">${formatNum(c.finalGrade)} <span class="max">/ 100</span></span>`;
        } else if (c.status === 'EN CURSO') {
            finalDisplay = '<span class="grade-badge grade-none"><span class="max" style="color:var(--text-muted)">En curso</span></span>';
        } else {
            finalDisplay = '<span class="grade-badge grade-none"><span class="max" style="color:var(--text-muted)">Sin nota</span></span>';
        }

        card.innerHTML =
            '<div class="course-card-header" tabindex="0" role="button" aria-expanded="false">' +
                '<div class="course-main-info">' +
                    '<span class="course-name">' +
                        escapeHtml(displayName) +
                        (teacherName ? ' <span class="course-teacher">' + escapeHtml(teacherName) + '</span>' : '') +
                    '</span>' +
                    '<div class="course-meta">' +
                        (c.dateRange ? '<span class="course-dates">' + escapeHtml(c.dateRange) + '</span>' : '') +
                        (c.status ? '<span class="course-status status-' + c.statusId + '">' + escapeHtml(c.status) + '</span>' : '') +
                        (c.attendance && c.attendance.percentage !== null && c.attendance.percentage !== undefined
                            ? '<span class="course-attendance">Asist: ' + c.attendance.percentage + '%</span>'
                            : '') +
                    '</div>' +
                '</div>' +
                finalDisplay +
                '<span class="course-expand-icon">&#9660;</span>' +
            '</div>' +
            '<div class="course-detail" id="detail-' + c.id + '">' +
                '<div class="grade-table-wrap">' +
                    '<div class="loading-placeholder" style="text-align:center;padding:1rem;color:var(--text-muted);">Cargando detalle&hellip;</div>' +
                '</div>' +
            '</div>';

        const header = card.querySelector('.course-card-header');
        header.addEventListener('click', () => toggleCourse(card, c));
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCourse(card, c); }
        });

        courseList.appendChild(card);
    }
}

// ─── Toggle course expand ───
async function toggleCourse(card, course) {
    const expanded = card.classList.toggle('expanded');
    card.querySelector('.course-card-header').setAttribute('aria-expanded', expanded);

    if (expanded) {
        const detailEl = card.querySelector('.course-detail');
        if (detailEl && !detailEl.dataset.loaded) {
            detailEl.dataset.loaded = 'true';
            if (course._moodleId) {
                // Pure Moodle mode ("otra")
                await fetchMoodleGradeDetail(course, detailEl);
            } else {
                // SGA mode (with optional Moodle supplement)
                await loadHybridDetail(course, detailEl);
            }
        }
    }
}

// ─── Hybrid SGA + Moodle detail ───
async function loadHybridDetail(course, detailEl) {
    const wrap = detailEl.querySelector('.grade-table-wrap');
    try {
        const body = {
            sgaGrades: course.grades || [],
        };
        if (state.moodle && course.moodleCourseId) {
            body.moodleToken = state.moodle.token;
            body.moodleUrl = state.moodle.baseUrl;
            body.moodleUserId = state.moodle.userId;
            body.moodleCourseId = course.moodleCourseId;
        }
        const data = await api('/api/course-detail', body);
        wrap.innerHTML = buildHybridTable(course, data);
    } catch (err) {
        // Fallback to SGA-only
        wrap.innerHTML = buildSgaGradeTable(course, course.professor || '');
    }
}

// ─── Fetch Moodle grade detail (for "otra" mode) ───
async function fetchMoodleGradeDetail(course, detailEl) {
    const wrap = detailEl.querySelector('.grade-table-wrap');
    try {
        const data = await api('/api/moodle-grade-detail', {
            baseUrl: course._moodleBaseUrl,
            token: course._moodleToken,
            userId: course._moodleUserId,
            courseId: course._moodleId,
        });
        wrap.innerHTML = buildMoodleGradeTable(data);
    } catch (err) {
        wrap.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;font-size:0.85rem;">' + escapeHtml(err.message) + '</p>';
    }
}

// ─── Build Hybrid SGA + Moodle table ───
function buildHybridTable(course, detail) {
    const sga = detail.sga;
    const moodle = detail.moodle;
    const grades = sga.grades || [];

    if (grades.length === 0 && !moodle) {
        return '<p style="color:var(--text-muted);text-align:center;padding:1rem;font-size:0.85rem;">Sin calificaciones disponibles.</p>';
    }

    const gradeMap = {};
    for (const g of grades) gradeMap[g.name] = g.value;

    const hasRe = gradeMap['RE'] > 0;
    const baseTotal = (gradeMap['P1'] || 0) + (gradeMap['P2'] || 0) + (gradeMap['EXT'] || 0);
    const finalTotal = hasRe ? Math.ceil((baseTotal + gradeMap['RE']) / 2) : Math.round(baseTotal);

    let html = '';

    // ─── SGA Category Table ───
    html += '<table class="grade-table sga-table">';
    html += '<thead><tr>' +
        '<th class="col-name">Componente</th>' +
        '<th class="col-score">Nota</th>' +
        '<th class="col-max">M\u00e1x</th>' +
        '<th class="col-pct">Rendimiento</th>' +
        '<th class="col-contrib">Peso en nota final</th>' +
        '</tr></thead><tbody>';

    const GROUP_DEFS = [
        { key: 'N1', label: 'N1', max: 10, desc: 'Nota 1' },
        { key: 'N2', label: 'N2', max: 10, desc: 'Nota 2' },
        { key: 'EXP1', label: 'EXP1', max: 15, desc: 'Examen parcial 1' },
        { key: null, label: 'P1', max: 35, desc: 'Total parcial 1', computed: true },
        { key: 'N3', label: 'N3', max: 10, desc: 'Nota 3' },
        { key: 'N4', label: 'N4', max: 10, desc: 'Nota 4' },
        { key: 'EXP2', label: 'EXP2', max: 15, desc: 'Examen parcial 2' },
        { key: null, label: 'P2', max: 35, desc: 'Total parcial 2', computed: true },
        { key: 'EXT', label: 'EXT', max: 30, desc: 'Examen final' },
        { key: null, label: 'Total', max: 100, desc: 'Nota final del curso', finalRow: true },
        { key: 'RE', label: 'RE', max: 100, desc: 'Examen de recuperaci\u00f3n' },
    ];

    for (const group of GROUP_DEFS) {
        if (group.key === 'RE' && !hasRe) continue;

        const value = group.key ? (gradeMap[group.key] || 0) : null;
        const displayValue = group.computed
            ? (gradeMap[group.label] !== undefined ? gradeMap[group.label] : null)
            : value;

        if (group.finalRow) {
            const pct = finalTotal > 0 ? Math.round(finalTotal) : 0;
            html += '<tr class="total-row">' +
                '<td class="total-label">Nota final del curso</td>' +
                '<td class="col-score">' + formatNum(finalTotal) + '</td>' +
                '<td class="col-max">' + group.max + '</td>' +
                '<td class="col-pct">' + pct + '%</td>' +
                '<td class="col-contrib">' + formatNum(finalTotal) + ' / ' + group.max + '</td>' +
                '</tr>';
            continue;
        }

        const pct = (displayValue !== null && group.max > 0)
            ? Math.round(displayValue / group.max * 1000) / 10
            : 0;

        const isP1orP2 = group.label === 'P1' || group.label === 'P2';

        if (isP1orP2) {
            html += '<tr class="subtotal-row">' +
                '<td><strong>' + group.label + '</strong> <span class="text-muted">(' + group.desc + ')</span></td>' +
                '<td class="col-score"><strong>' + formatNum(displayValue) + '</strong></td>' +
                '<td class="col-max">' + group.max + '</td>' +
                '<td class="col-pct">' + pct + '%</td>' +
                '<td class="col-contrib"><strong>' + formatNum(displayValue) + '</strong> / ' + group.max + '</td>' +
                '</tr>';
        } else if (group.key) {
            html += '<tr class="grade-row">' +
                '<td class="col-name">' +
                    '<span class="mod-badge ' + group.key.toLowerCase() + '">' + group.key + '</span> ' +
                    '<span class="grade-desc">' + group.desc + '</span>' +
                '</td>' +
                '<td class="col-score">' + formatNum(displayValue) + '</td>' +
                '<td class="col-max">' + group.max + '</td>' +
                '<td class="col-pct">' +
                    '<span class="pct-bar">' +
                        '<span class="pct-bar-fill"><span class="fill" style="width:' + Math.min(pct, 100) + '%"></span></span>' +
                        '<span class="pct-text">' + pct + '%</span>' +
                    '</span>' +
                '</td>' +
                '<td class="col-contrib">' + formatNum(displayValue) + ' / ' + group.max + '</td>' +
                '</tr>';
        }
    }

    if (hasRe) {
        html += '<tr class="re-info">' +
            '<td colspan="5" style="padding:0.5rem 0.75rem;font-size:0.8rem;color:var(--text-muted);background:#f8f9fa;">' +
            '* Con RE (recuperaci\u00f3n): Nota final = techo((P1 + P2 + EXT + RE) / 2)' +
            '</td></tr>';
    }

    html += '</tbody></table>';

    // Formula legend
    html += '<div class="grade-legend" style="padding:0.5rem 0.75rem;font-size:0.8rem;color:var(--text-muted);border-top:1px solid #dee2e6;">';
    html += '<strong>F\u00f3rmula:</strong> P1 = N1 + N2 + EXP1 (m\u00e1x 35)  |  P2 = N3 + N4 + EXP2 (m\u00e1x 35)  |  EXT = Examen final (m\u00e1x 30)';
    if (hasRe) html += '  |  RE = Recuperaci\u00f3n';
    html += '</div>';

    // ─── Moodle Individual Activities (if available) ───
    if (moodle && (moodle.categories.length > 0 || moodle.extraItems.length > 0)) {
        html += '<div style="margin-top:1.2rem;border-top:2px solid var(--border-table);padding-top:1rem;">';
        html += '<h4 style="font-size:0.85rem;color:var(--navy);margin-bottom:0.75rem;font-family:var(--font-serif);">Detalle de actividades individuales</h4>';

        if (moodle.categories.length > 0) {
            html += '<table class="grade-table moodle-detail-table">';
            html += '<thead><tr>' +
                '<th class="col-name">Actividad</th>' +
                '<th class="col-score">Nota</th>' +
                '<th class="col-max">M\u00e1x</th>' +
                '<th class="col-pct">Rendimiento</th>' +
                '<th class="col-contrib">Aporte</th>' +
                '</tr></thead><tbody>';

            for (const cat of moodle.categories) {
                const catPct = (cat.raw !== null && cat.max) ? Math.round(cat.raw / cat.max * 1000) / 10 : null;
                if (cat.items.length > 0) {
                    html += '<tr class="cat-header">' +
                        '<td><span class="cat-label">' + escapeHtml(cat.name || 'General') + '</span> <span class="cat-max">(m\u00e1x ' + formatNum(cat.max) + ')</span></td>' +
                        '<td class="col-score cat-total">' + formatNum(cat.raw) + '</td>' +
                        '<td class="col-max">' + formatNum(cat.max) + '</td>' +
                        '<td class="col-pct">' + (catPct !== null ? catPct + '%' : '&mdash;') + '</td>' +
                        '<td class="col-contrib">' + formatNum(cat.raw) + ' / ' + formatNum(cat.max) + '</td>' +
                        '</tr>';

                    for (const item of cat.items) {
                        const badgeClass = item.module === 'quiz' ? 'quiz' : 'assign';
                        const badgeLabel = item.module === 'quiz' ? 'Quiz' : 'Tarea';
                        const rawVal = item.raw;
                        const maxVal = item.max;
                        const itemPct = (rawVal !== null && maxVal) ? Math.round(rawVal / maxVal * 1000) / 10 : null;
                        html += '<tr class="activity-row">' +
                            '<td class="col-name">' +
                                '<span class="mod-badge ' + badgeClass + '">' + badgeLabel + '</span> ' +
                                escapeHtml(item.name) +
                            '</td>' +
                            '<td class="col-score">' + (rawVal !== null ? formatNum(rawVal) : item.score) + '</td>' +
                            '<td class="col-max">' + (maxVal !== null ? formatNum(maxVal) : '&mdash;') + '</td>' +
                            '<td class="col-pct">' +
                                (itemPct !== null
                                    ? '<span class="pct-bar">' +
                                        '<span class="pct-bar-fill"><span class="fill" style="width:' + Math.min(itemPct, 100) + '%"></span></span>' +
                                        '<span class="pct-text">' + itemPct + '%</span>' +
                                    '</span>'
                                    : '&mdash;') +
                            '</td>' +
                            '<td class="col-contrib">' + (rawVal !== null ? formatNum(rawVal) + ' / ' + formatNum(maxVal) : '&mdash;') + '</td>' +
                            '</tr>';
                    }
                }
            }

            html += '</tbody></table>';
        }

        // Extra items (EXAMEN_FINAL, EXAMEN_RECUPERACION from Moodle)
        if (moodle.extraItems.length > 0) {
            for (const item of moodle.extraItems) {
                const rawVal = item.raw;
                const maxVal = item.max;
                const itemPct = (rawVal !== null && maxVal) ? Math.round(rawVal / maxVal * 1000) / 10 : null;
                if (rawVal !== null && rawVal > 0) {
                    html += '<div style="margin-top:0.5rem;padding:0.6rem 0.75rem;background:#f0f4f8;border-radius:4px;font-size:0.82rem;display:flex;justify-content:space-between;align-items:center;">' +
                        '<span><strong>' + escapeHtml(item.name) + '</strong></span>' +
                        '<span>' + formatNum(rawVal) + ' / ' + formatNum(maxVal) +
                        (itemPct !== null ? ' (' + itemPct + '%)' : '') + '</span>' +
                        '</div>';
                }
            }
        }

        html += '</div>';
    }

    return html;
}

// ─── Build SGA grade table (fallback) ───
function buildSgaGradeTable(course, teacherName) {
    const grades = course.grades || [];
    if (grades.length === 0) {
        return '<p style="color:var(--text-muted);text-align:center;padding:1rem;font-size:0.85rem;">Sin calificaciones disponibles.</p>';
    }

    const GROUPS = [
        { key: 'N1', label: 'N1', max: 10, desc: 'Nota 1' },
        { key: 'N2', label: 'N2', max: 10, desc: 'Nota 2' },
        { key: 'EXP1', label: 'EXP1', max: 15, desc: 'Examen parcial 1' },
        { key: null, label: 'P1', max: 35, desc: 'Total parcial 1', computed: true },
        { key: 'N3', label: 'N3', max: 10, desc: 'Nota 3' },
        { key: 'N4', label: 'N4', max: 10, desc: 'Nota 4' },
        { key: 'EXP2', label: 'EXP2', max: 15, desc: 'Examen parcial 2' },
        { key: null, label: 'P2', max: 35, desc: 'Total parcial 2', computed: true },
        { key: 'EXT', label: 'EXT', max: 30, desc: 'Examen final' },
        { key: null, label: 'Total', max: 100, desc: 'Nota final del curso', finalRow: true },
        { key: 'RE', label: 'RE', max: 100, desc: 'Examen de recuperaci\u00f3n' },
    ];

    const gradeMap = {};
    for (const g of grades) gradeMap[g.name] = g.value;

    const hasRe = gradeMap['RE'] > 0;
    const baseTotal = (gradeMap['P1'] || 0) + (gradeMap['P2'] || 0) + (gradeMap['EXT'] || 0);
    const finalTotal = hasRe ? Math.ceil((baseTotal + gradeMap['RE']) / 2) : Math.round(baseTotal);

    let html = '<table class="grade-table sga-table">';
    html += '<thead><tr>' +
        '<th class="col-name">Componente</th>' +
        '<th class="col-score">Nota</th>' +
        '<th class="col-max">M\u00e1x</th>' +
        '<th class="col-pct">Rendimiento</th>' +
        '<th class="col-contrib">Peso en nota final</th>' +
        '</tr></thead><tbody>';

    for (const group of GROUPS) {
        if (group.key === 'RE' && !hasRe) continue;

        const value = group.key ? (gradeMap[group.key] || 0) : null;
        const displayValue = group.computed
            ? (gradeMap[group.label] !== undefined ? gradeMap[group.label] : null)
            : value;

        if (group.finalRow) {
            const pct = finalTotal > 0 ? Math.round(finalTotal) : 0;
            html += '<tr class="total-row">' +
                '<td class="total-label">Nota final del curso</td>' +
                '<td class="col-score">' + formatNum(finalTotal) + '</td>' +
                '<td class="col-max">' + group.max + '</td>' +
                '<td class="col-pct">' + pct + '%</td>' +
                '<td class="col-contrib">' + formatNum(finalTotal) + ' / ' + group.max + '</td>' +
                '</tr>';
            continue;
        }

        const pct = (displayValue !== null && group.max > 0)
            ? Math.round(displayValue / group.max * 1000) / 10
            : 0;

        const isP1orP2 = group.label === 'P1' || group.label === 'P2';

        if (isP1orP2) {
            html += '<tr class="subtotal-row">' +
                '<td><strong>' + group.label + '</strong> <span class="text-muted">(' + group.desc + ')</span></td>' +
                '<td class="col-score"><strong>' + formatNum(displayValue) + '</strong></td>' +
                '<td class="col-max">' + group.max + '</td>' +
                '<td class="col-pct">' + pct + '%</td>' +
                '<td class="col-contrib"><strong>' + formatNum(displayValue) + '</strong> / ' + group.max + '</td>' +
                '</tr>';
        } else if (group.key) {
            html += '<tr class="grade-row">' +
                '<td class="col-name">' +
                    '<span class="mod-badge ' + group.key.toLowerCase() + '">' + group.key + '</span> ' +
                    '<span class="grade-desc">' + group.desc + '</span>' +
                '</td>' +
                '<td class="col-score">' + formatNum(displayValue) + '</td>' +
                '<td class="col-max">' + group.max + '</td>' +
                '<td class="col-pct">' +
                    '<span class="pct-bar">' +
                        '<span class="pct-bar-fill"><span class="fill" style="width:' + Math.min(pct, 100) + '%"></span></span>' +
                        '<span class="pct-text">' + pct + '%</span>' +
                    '</span>' +
                '</td>' +
                '<td class="col-contrib">' + formatNum(displayValue) + ' / ' + group.max + '</td>' +
                '</tr>';
        }
    }

    if (hasRe) {
        html += '<tr class="re-info">' +
            '<td colspan="5" style="padding:0.5rem 0.75rem;font-size:0.8rem;color:var(--text-muted);background:#f8f9fa;">' +
            '* Con RE (recuperaci\u00f3n): Nota final = techo((P1 + P2 + EXT + RE) / 2)' +
            '</td></tr>';
    }

    html += '</tbody></table>';

    html += '<div class="grade-legend" style="padding:0.5rem 0.75rem;font-size:0.8rem;color:var(--text-muted);border-top:1px solid #dee2e6;">';
    html += 'P1 = N1 + N2 + EXP1 (m\u00e1x 35) | P2 = N3 + N4 + EXP2 (m\u00e1x 35) | EXT = Examen final (m\u00e1x 30)';
    if (hasRe) html += ' | RE = Recuperaci\u00f3n';
    html += '</div>';

    return html;
}

// ─── Build Moodle grade table (for "otra" mode) ───
function buildMoodleGradeTable(data) {
    if (!data.categories || data.categories.length === 0) {
        return '<p style="color:var(--text-muted);text-align:center;padding:1rem;font-size:0.85rem;">Sin calificaciones disponibles.</p>';
    }

    let html = '<table class="grade-table">';
    html += '<thead><tr>' +
        '<th class="col-name">Actividad</th>' +
        '<th class="col-score">Nota</th>' +
        '<th class="col-max">M\u00e1x</th>' +
        '<th class="col-pct">Rendimiento</th>' +
        '<th class="col-contrib">Aporte</th>' +
        '</tr></thead><tbody>';

    for (const cat of data.categories) {
        const catPct = (cat.raw !== null && cat.max) ? Math.round(cat.raw / cat.max * 1000) / 10 : null;
        html += '<tr class="cat-header">' +
            '<td><span class="cat-label">' + escapeHtml(cat.name || 'General') + '</span> <span class="cat-max">(m\u00e1x ' + formatNum(cat.max) + ')</span></td>' +
            '<td class="col-score cat-total">' + cat.score + '</td>' +
            '<td class="col-max">' + formatNum(cat.max) + '</td>' +
            '<td class="col-pct">' + (catPct !== null ? catPct + '%' : '&mdash;') + '</td>' +
            '<td class="col-contrib cat-total">' + cat.score + ' / ' + formatNum(cat.max) + '</td>' +
            '</tr>';

        for (const item of cat.items) {
            const badgeClass = item.module === 'quiz' ? 'quiz' : 'assign';
            const badgeLabel = item.module === 'quiz' ? 'Quiz' : 'Tarea';
            const pctVal = item.percentage !== null ? Math.min(item.percentage, 100) : 0;
            const pctDisplay = item.percentage !== null ? item.percentage + '%' : '&mdash;';

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
                '<td class="col-contrib">' + (item.raw !== null ? formatNum(item.raw) + ' / ' + formatNum(item.max) : '&mdash;') + '</td>' +
                '</tr>';
        }
    }

    const total = data.courseTotal;
    const totalPct = (total.raw !== null && total.max) ? Math.round(total.raw / total.max * 1000) / 10 : null;
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
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatNum(n) {
    if (n === null || n === undefined) return '&mdash;';
    if (typeof n === 'number') {
        if (Number.isInteger(n)) return String(n);
        return n.toFixed(2).replace('.', ',');
    }
    return String(n).replace('.', ',');
}

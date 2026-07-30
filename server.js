const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants ───
const SGA_LOGIN_URL = 'https://sgaestudiante.unemi.edu.ec/api/auth/login.json';
const SGA_API_BASE = 'https://sga.unemi.edu.ec/api/1.0/jwt';
const MOODLE_URLS = {
    presencial: 'https://aulagradoa.unemi.edu.ec',
    enlinea: 'https://aulagradob.unemi.edu.ec',
};

// ─── Helpers ───

function cleanCareerName(display) {
    if (!display) return '';
    return display
        .replace(/ EN MODALIDAD (PRESENCIAL|EN LÍNEA|SEMIPRESENCIAL).*/i, '')
        .replace(/  +/g, ' ')
        .trim();
}

function decodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = Buffer.from(parts[1], 'base64').toString('utf8');
        return JSON.parse(payload);
    } catch (e) { return null; }
}

async function moodleWs(baseUrl, token, fn, params = {}) {
    const qs = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: 'json' });
    for (const [k, v] of Object.entries(params)) {
        if (Array.isArray(v)) v.forEach((val, i) => qs.append(k + '[' + i + ']', String(val)));
        else if (v !== null && v !== undefined) qs.append(k, String(v));
    }
    const r = await fetch(baseUrl + '/webservice/rest/server.php?' + qs.toString());
    return r.json();
}

function computeGroupSum(grades, names) {
    let sum = 0;
    let found = false;
    for (const g of grades) {
        if (names.includes(g.name)) {
            sum += g.value;
            found = true;
        }
    }
    return found ? Math.round(sum * 100) / 100 : null;
}

async function moodleLogin(moodleUrl, username, password) {
    const baseUrl = moodleUrl.replace(/\/+$/, '');
    const tokenRes = await fetch(
        `${baseUrl}/login/token.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&service=moodle_mobile_app`
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) return null;
    const siteInfo = await moodleWs(baseUrl, tokenData.token, 'core_webservice_get_site_info');
    return { token: tokenData.token, baseUrl, userId: siteInfo.userid };
}

// ─── Combined SGA + Moodle Login ───
app.post('/api/login-full', async (req, res) => {
    const { username, password, mode } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Faltan credenciales.' });
    }

    try {
        // 1. SGA Login
        const sgaLoginRes = await fetch(SGA_LOGIN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        if (!sgaLoginRes.ok) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }

        const loginData = await sgaLoginRes.json();
        const sgaToken = loginData.access;
        const refreshToken = loginData.refresh;

        // Decode JWT to get user data
        const jwtPayload = decodeJwtPayload(sgaToken);
        const fullname = (jwtPayload && jwtPayload.persona && jwtPayload.persona.nombre_completo) || username;
        const inscripcion = (jwtPayload && jwtPayload.inscripcion) || {};
        const perfiles = (jwtPayload && jwtPayload.perfiles) || [];

        // 2. Get career name from SGA
        let careerName = '';
        try {
            const materiasRes = await fetch(`${SGA_API_BASE}/alumno/materias`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${sgaToken}`,
                    'Content-Type': 'application/json',
                },
            });

            if (materiasRes.ok) {
                const materiasData = await materiasRes.json();
                if (materiasData.isSuccess && materiasData.data) {
                    const malla = materiasData.data.eMalla;
                    if (malla && malla.display) {
                        careerName = cleanCareerName(malla.display);
                    }
                }
            }
        } catch (e) { /* optional */ }

        // 3. Moodle Login (for UNEMI modes)
        let moodleData = null;
        if (mode && MOODLE_URLS[mode]) {
            try {
                moodleData = await moodleLogin(MOODLE_URLS[mode], username, password);
            } catch (e) { /* moodle is optional */ }
        }

        res.json({
            sgaToken,
            refreshToken,
            fullname,
            userId: (jwtPayload && jwtPayload.user_id) || '',
            careerName,
            inscripcion,
            perfiles,
            moodle: moodleData,
        });
    } catch (err) {
        res.status(500).json({ error: `Error de conexión: ${err.message}` });
    }
});

// ─── SGA Courses (with optional Moodle matching) ───
app.post('/api/sga-courses', async (req, res) => {
    const { token, moodleToken, moodleUrl, moodleUserId } = req.body;
    if (!token) return res.status(400).json({ error: 'No autenticado.' });

    try {
        const materiasRes = await fetch(`${SGA_API_BASE}/alumno/materias`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!materiasRes.ok) {
            return res.status(401).json({ error: 'Sesión expirada. Inicie sesión nuevamente.' });
        }

        const data = await materiasRes.json();
        if (!data.isSuccess) {
            return res.status(500).json({ error: data.message || 'Error al obtener materias.' });
        }

        const courses = data.data.eMateriasAsignadas || [];
        const matricula = data.data.eMatricula || {};
        const malla = data.data.eMalla || {};

        // Fetch Moodle courses for matching (if available)
        let moodleCourses = [];
        if (moodleToken && moodleUrl && moodleUserId) {
            try {
                const mc = await moodleWs(moodleUrl, moodleToken, 'core_enrol_get_users_courses', { userid: moodleUserId });
                if (Array.isArray(mc)) moodleCourses = mc.filter(c => c.id > 0);
            } catch (e) { /* optional */ }
        }

        // Build course list
        const result = courses.map(c => {
            const gradeItems = (c.evaluaciong || []).map(g => ({
                name: g.detallemodeloevaluativo.nombre,
                value: parseFloat(g.valor) || 0,
            }));

            const professor = c.materia && c.materia.profesor
                ? (c.materia.profesor.display || c.materia.profesor.nombre || '')
                : '';

            const shortName = c.materia && c.materia.asignatura
                ? c.materia.asignatura.nombre || ''
                : '';

            const fullname = (c.materia && c.materia.nombre_mostrar) || shortName;

            // Try to match with a Moodle course
            let moodleCourseId = null;
            let moodleCourseName = '';
            for (const mc of moodleCourses) {
                const mcName = (mc.fullname || mc.shortname || '').toLowerCase().replace(/&amp;/g, '&');
                const sgaName = (shortName || fullname).toLowerCase().replace(/&amp;/g, '&');
                // Match if the SGA short name is contained in the Moodle course name
                if (sgaName.length > 5 && mcName.includes(sgaName.substring(0, 25))) {
                    moodleCourseId = mc.id;
                    moodleCourseName = mc.fullname || mc.shortname || '';
                    break;
                }
            }

            return {
                id: c.materia && c.materia.id || '',
                fullname,
                shortname: shortName,
                professor,
                finalGrade: c.notafinal !== null && c.notafinal !== undefined ? Math.round(c.notafinal) : null,
                attendance: {
                    percentage: c.asistenciafinal,
                    real: c.asistencia_real,
                    plan: c.asistencia_plan,
                },
                status: c.estado && c.estado.display || '',
                statusId: c.estado && c.estado.idm || 0,
                dateRange: c.fecha_mostrar || '',
                grades: gradeItems,
                p1: computeGroupSum(gradeItems, ['N1', 'N2', 'EXP1']),
                p2: computeGroupSum(gradeItems, ['N3', 'N4', 'EXP2']),
                ext: computeGroupSum(gradeItems, ['EXT']),
                re: computeGroupSum(gradeItems, ['RE']),
                // Moodle course reference (optional)
                moodleCourseId,
                moodleCourseName,
            };
        });

        res.json({ courses: result, matricula, malla });
    } catch (err) {
        res.status(500).json({ error: `Error: ${err.message}` });
    }
});

// ─── Combined SGA + Moodle Course Detail ───
app.post('/api/course-detail', async (req, res) => {
    const {
        sgaGrades,    // array of {name, value}
        moodleToken, moodleUrl, moodleUserId, moodleCourseId,
    } = req.body;

    if (!sgaGrades) return res.status(400).json({ error: 'Faltan datos de SGA.' });

    // SGA category breakdown
    const sgaDetail = {
        grades: sgaGrades,
        p1: computeGroupSum(sgaGrades, ['N1', 'N2', 'EXP1']),
        p2: computeGroupSum(sgaGrades, ['N3', 'N4', 'EXP2']),
        ext: computeGroupSum(sgaGrades, ['EXT']),
        re: computeGroupSum(sgaGrades, ['RE']),
    };

    let moodleDetail = null;
    if (moodleToken && moodleUrl && moodleUserId && moodleCourseId) {
        try {
            const [gi, quizData, assignData] = await Promise.all([
                moodleWs(moodleUrl, moodleToken, 'gradereport_user_get_grade_items', {
                    courseid: moodleCourseId, userid: moodleUserId,
                }),
                moodleWs(moodleUrl, moodleToken, 'mod_quiz_get_quizzes_by_courses', {
                    courseids: [moodleCourseId],
                }).catch(() => ({ quizzes: [] })),
                moodleWs(moodleUrl, moodleToken, 'mod_assign_get_assignments', {
                    courseids: [moodleCourseId],
                }).catch(() => ({ courses: [] })),
            ]);

            const ug = gi.usergrades && gi.usergrades[0];
            if (ug) {
                const quizMax = {};
                for (const q of (quizData.quizzes || [])) quizMax[q.id] = q.grade || q.sumgrades;
                const assignMax = {};
                for (const c of (assignData.courses || []))
                    for (const a of (c.assignments || [])) assignMax[a.cmid] = a.grade;

                const catItems = ug.gradeitems.filter(i => i.itemtype === 'category');
                const modItems = ug.gradeitems.filter(i => i.itemtype === 'mod' && i.itemname);

                const categories = [];
                for (const cat of catItems) {
                    const children = modItems.filter(m => m.categoryid === cat.iteminstance);
                    if (children.length === 0) continue;

                    const items = [];
                    for (const ch of children) {
                        let maxGrade = ch.grademax;
                        if (!maxGrade || maxGrade <= 0) {
                            if (ch.itemmodule === 'quiz') maxGrade = quizMax[ch.iteminstance];
                            else if (ch.itemmodule === 'assign') maxGrade = assignMax[ch.cmid];
                        }
                        const raw = (ch.graderaw !== null && ch.graderaw !== undefined)
                            ? parseFloat(ch.graderaw) : null;
                        items.push({
                            name: ch.itemname,
                            module: ch.itemmodule,
                            score: ch.gradeformatted || '-',
                            raw,
                            max: maxGrade || null,
                        });
                    }

                    categories.push({
                        name: cat.itemname || '',
                        raw: cat.graderaw !== null && cat.graderaw !== undefined
                            ? parseFloat(cat.graderaw) : null,
                        max: Math.round(cat.grademax * 100) / 100,
                        items,
                    });
                }

                // Also pick up EXAMEN_FINAL and EXAMEN_RECUPERACION from grade items
                const extraItems = ug.gradeitems.filter(i =>
                    i.itemtype === 'mod' && i.itemname &&
                    (i.itemname.includes('EXAMEN') || i.itemname.includes('RECUPERACION'))
                ).map(i => ({
                    name: i.itemname,
                    module: i.itemmodule || 'quiz',
                    score: i.gradeformatted || '-',
                    raw: (i.graderaw !== null && i.graderaw !== undefined) ? parseFloat(i.graderaw) : null,
                    max: i.grademax || null,
                }));

                moodleDetail = { categories, extraItems };
            }
        } catch (e) { /* moodle detail is optional */ }
    }

    res.json({ sga: sgaDetail, moodle: moodleDetail });
});

// ─── Moodle Login (for "otra" mode) ───
app.post('/api/login', async (req, res) => {
    const { moodleUrl, username, password } = req.body;
    if (!moodleUrl || !username || !password) {
        return res.status(400).json({ error: 'Faltan credenciales.' });
    }
    try {
        const result = await moodleLogin(moodleUrl, username, password);
        if (!result) return res.status(401).json({ error: 'Credenciales inválidas.' });

        const siteInfo = await moodleWs(result.baseUrl, result.token, 'core_webservice_get_site_info');
        res.json({ token: result.token, baseUrl: result.baseUrl, userId: result.userId, fullname: siteInfo.fullname });
    } catch (err) {
        res.status(500).json({ error: `Error de conexión: ${err.message}` });
    }
});

// ─── Moodle Courses (for "otra" mode) ───
app.post('/api/moodle-courses', async (req, res) => {
    const { baseUrl, token, userId } = req.body;
    if (!baseUrl || !token) return res.status(400).json({ error: 'No autenticado.' });

    try {
        const courses = await moodleWs(baseUrl, token, 'core_enrol_get_users_courses', { userid: userId });
        if (!Array.isArray(courses)) return res.status(500).json({ error: 'Error al obtener cursos.' });

        const visible = courses.filter(c => c.id > 0);

        // Try to extract career name from categories
        let careerName = '';
        try {
            const catIds = [...new Set(visible.map(c => c.category).filter(id => id > 0))];
            if (catIds.length > 0) {
                const cats = await moodleWs(baseUrl, token, 'core_course_get_categories', { criteria: [] });
                if (Array.isArray(cats)) {
                    const catMap = {};
                    for (const cat of cats) catMap[cat.id] = cat;
                    const candidateNames = [];
                    for (const cid of catIds) {
                        let current = catMap[cid];
                        const seen = new Set();
                        const path = [];
                        while (current && !seen.has(current.id)) {
                            seen.add(current.id);
                            path.push(current);
                            if (current.parent && catMap[current.parent]) {
                                current = catMap[current.parent];
                            } else break;
                        }
                        for (const p of path) {
                            if (p.depth === 4 && p.name.length > 3 && !p.name.match(/^PER/i)) {
                                candidateNames.push(p.name);
                                break;
                            }
                        }
                    }
                    if (candidateNames.length > 0) {
                        const freq = {};
                        let maxFreq = 0;
                        for (const n of candidateNames) {
                            freq[n] = (freq[n] || 0) + 1;
                            if (freq[n] > maxFreq) { maxFreq = freq[n]; careerName = n; }
                        }
                        careerName = careerName
                            .replace(/ EN MODALIDAD (PRESENCIAL|EN LÍNEA|SEMIPRESENCIAL)$/i, '')
                            .replace(/  +/g, ' ')
                            .trim();
                    }
                }
            }
        } catch (e) { /* optional */ }

        res.json({ courses: visible, careerName });
    } catch (err) {
        res.status(500).json({ error: `Error: ${err.message}` });
    }
});

// ─── Moodle Grade Detail (for "otra" mode) ───
app.post('/api/moodle-grade-detail', async (req, res) => {
    const { baseUrl, token, userId, courseId } = req.body;
    if (!baseUrl || !token || !userId || !courseId) return res.status(400).json({ error: 'Faltan parámetros.' });

    try {
        const [gi, quizData, assignData] = await Promise.all([
            moodleWs(baseUrl, token, 'gradereport_user_get_grade_items', { courseid: courseId, userid: userId }),
            moodleWs(baseUrl, token, 'mod_quiz_get_quizzes_by_courses', { courseids: [courseId] }).catch(() => ({ quizzes: [] })),
            moodleWs(baseUrl, token, 'mod_assign_get_assignments', { courseids: [courseId] }).catch(() => ({ courses: [] })),
        ]);

        const ug = gi.usergrades && gi.usergrades[0];
        if (!ug) return res.status(404).json({ error: 'No hay calificaciones.' });

        const quizMax = {};
        for (const q of (quizData.quizzes || [])) quizMax[q.id] = q.grade || q.sumgrades;
        const assignMax = {};
        for (const c of (assignData.courses || []))
            for (const a of (c.assignments || [])) assignMax[a.cmid] = a.grade;

        const courseItem = ug.gradeitems.find(i => i.itemtype === 'course');
        const catItems = ug.gradeitems.filter(i => i.itemtype === 'category');
        const modItems = ug.gradeitems.filter(i => i.itemtype === 'mod' && i.itemname);

        const categories = [];
        for (const cat of catItems) {
            const children = modItems.filter(m => m.categoryid === cat.iteminstance);
            if (children.length === 0) continue;

            let catRaw = (cat.graderaw !== null && cat.graderaw !== undefined)
                ? parseFloat(cat.graderaw) : null;

            if (catRaw === null) {
                let sum = 0, hasAny = false;
                for (const ch of children) {
                    if (ch.graderaw !== null && ch.graderaw !== undefined) {
                        hasAny = true;
                        sum += parseFloat(ch.graderaw);
                    }
                }
                if (hasAny) catRaw = sum;
            }

            const items = [];
            for (const ch of children) {
                let maxGrade = ch.grademax;
                if (!maxGrade || maxGrade <= 0) {
                    if (ch.itemmodule === 'quiz') maxGrade = quizMax[ch.iteminstance];
                    else if (ch.itemmodule === 'assign') maxGrade = assignMax[ch.cmid];
                }
                const raw = (ch.graderaw !== null && ch.graderaw !== undefined)
                    ? parseFloat(ch.graderaw) : null;
                items.push({
                    name: ch.itemname,
                    module: ch.itemmodule,
                    score: ch.gradeformatted || '-',
                    raw,
                    max: maxGrade || null,
                });
            }

            categories.push({
                name: '',
                score: cat.gradeformatted || (catRaw !== null ? String(Math.round(catRaw * 100) / 100) : '-'),
                raw: catRaw,
                max: Math.round(cat.grademax * 100) / 100,
                items,
            });
        }

        res.json({
            courseName: ug.coursefullname || '',
            courseTotal: {
                formatted: courseItem ? courseItem.gradeformatted : '-',
                raw: courseItem ? courseItem.graderaw : null,
                max: 100,
            },
            categories,
        });
    } catch (err) {
        res.status(500).json({ error: `Error: ${err.message}` });
    }
});

// ─── Export for Vercel / Start for local ───
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n  Grade Insight running at http://localhost:${PORT}\n`);
    });
}
module.exports = app;

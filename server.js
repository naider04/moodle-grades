const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ───

async function ws(baseUrl, token, fn, params = {}) {
    const qs = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: 'json' });
    for (const [k, v] of Object.entries(params)) {
        if (Array.isArray(v)) v.forEach((val, i) => qs.append(k + '[' + i + ']', String(val)));
        else if (v !== null && v !== undefined) qs.append(k, String(v));
    }
    const r = await fetch(baseUrl + '/webservice/rest/server.php?' + qs.toString());
    return r.json();
}

// ─── Login ───

app.post('/api/login', async (req, res) => {
    const { moodleUrl, username, password } = req.body;
    if (!moodleUrl || !username || !password) {
        return res.status(400).json({ error: 'Faltan credenciales.' });
    }
    try {
        const baseUrl = moodleUrl.replace(/\/+$/, '');
        const tokenRes = await fetch(
            `${baseUrl}/login/token.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&service=moodle_mobile_app`
        );
        const tokenData = await tokenRes.json();
        if (tokenData.error) {
            return res.status(401).json({ error: tokenData.error || 'Credenciales inválidas.' });
        }

        const siteInfo = await ws(baseUrl, tokenData.token, 'core_webservice_get_site_info');
        const userId = siteInfo.userid;

        res.json({ token: tokenData.token, baseUrl, userId, fullname: siteInfo.fullname });
    } catch (err) {
        res.status(500).json({ error: `Error de conexión: ${err.message}` });
    }
});

// ─── Courses with grades + career info ───

app.post('/api/courses', async (req, res) => {
    const { baseUrl, token, userId } = req.body;
    if (!baseUrl || !token) return res.status(400).json({ error: 'No autenticado.' });

    try {
        const courses = await ws(baseUrl, token, 'core_enrol_get_users_courses', { userid: userId });
        if (!Array.isArray(courses)) return res.status(500).json({ error: 'Error al obtener cursos.' });

        const visible = courses.filter(c => c.id > 0);

        // ─── Extract career/program name from course categories ───
        let careerName = '';
        try {
            // Collect unique category IDs from all visible courses
            const catIds = [...new Set(visible.map(c => c.category).filter(id => id > 0))];
            if (catIds.length > 0) {
                const cats = await ws(baseUrl, token, 'core_course_get_categories', { criteria: [] });
                if (Array.isArray(cats)) {
                    // Build a map by id
                    const catMap = {};
                    for (const cat of cats) catMap[cat.id] = cat;

                    // For each course category, walk up to find the program level
                    // UNEMI hierarchy:
                    //   depth 1: Grado (root)
                    //   depth 2: Period (e.g. "REGULAR ABRIL - JULIO 2026...")
                    //   depth 3: Faculty (e.g. "FACULTAD DE EDUCACIÓN")
                    //   depth 4: Career/Program (e.g. "PEDAGOGÍA DE LOS IDIOMAS...")  ← target
                    //   depth 5: Level (e.g. "6TO NIVEL")
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
                        // Look for a category at depth 4 = career/program level
                        for (const p of path) {
                            if (p.depth === 4 && p.name.length > 3 && !p.name.match(/^PER/i)) {
                                candidateNames.push(p.name);
                                break;
                            }
                        }
                    }
                    // Use the most common candidate
                    // Shorten: remove "EN MODALIDAD PRESENCIAL" or "EN MODALIDAD EN LÍNEA" suffix
                    if (candidateNames.length > 0) {
                        const freq = {};
                        let maxFreq = 0;
                        for (const n of candidateNames) {
                            freq[n] = (freq[n] || 0) + 1;
                            if (freq[n] > maxFreq) { maxFreq = freq[n]; careerName = n; }
                        }
                        // Clean up the career name
                        careerName = careerName
                            .replace(/ EN MODALIDAD (PRESENCIAL|EN LÍNEA|SEMIPRESENCIAL)$/i, '')
                            .replace(/  +/g, ' ')
                            .trim();
                    }
                }
            }
        } catch (e) {
            // Career extraction is optional; silently fail
        }

        res.json({ courses: visible, careerName });
    } catch (err) {
        res.status(500).json({ error: `Error: ${err.message}` });
    }
});

// ─── Single course grades with contributions ───

app.post('/api/grade-detail', async (req, res) => {
    const { baseUrl, token, userId, courseId } = req.body;
    if (!baseUrl || !token || !courseId) return res.status(400).json({ error: 'Faltan parámetros.' });

    try {
        const [gi, quizData, assignData] = await Promise.all([
            ws(baseUrl, token, 'gradereport_user_get_grade_items', { courseid: courseId, userid: userId }),
            ws(baseUrl, token, 'mod_quiz_get_quizzes_by_courses', { courseids: [courseId] }).catch(() => ({ quizzes: [] })),
            ws(baseUrl, token, 'mod_assign_get_assignments', { courseids: [courseId] }).catch(() => ({ courses: [] })),
        ]);

        const ug = gi.usergrades && gi.usergrades[0];
        if (!ug) return res.status(404).json({ error: 'No hay calificaciones.' });

        // Max grade maps
        const quizMax = {};
        for (const q of (quizData.quizzes || [])) quizMax[q.id] = q.sumgrades;
        const assignMax = {};
        for (const c of (assignData.courses || []))
            for (const a of (c.assignments || [])) assignMax[a.cmid] = a.grade;

        // Get grade table for category names
        const gt = await ws(baseUrl, token, 'gradereport_user_get_grades_table', { courseid: courseId, userid: userId }).catch(() => null);

        // Parse category names from grade table
        const categoryNames = {};
        if (gt && gt.tables && gt.tables[0] && gt.tables[0].tabledata) {
            let catIdx = 0;
            let isFirstCategory = true;
            for (const row of gt.tables[0].tabledata) {
                const name = (row.itemname && row.itemname.content || '').replace(/<[^>]+>/g, '').trim();
                if (!name || name === '-') continue;
                
                // Skip the course name row (first match, contains the course title)
                const isActivity = name.startsWith('Tarea') || name.startsWith('Cuestionario') || name.startsWith('Foro');
                const isSubtotal = name.startsWith('Cálculo total');
                const isHeader = !isActivity && !isSubtotal;
                
                if (isHeader) {
                    if (isFirstCategory) {
                        isFirstCategory = false;
                        continue; // Skip course name
                    }
                    // Check it's short (category names are short: N1, N2, EXP1, etc.)
                    if (name.length <= 10) {
                        categoryNames[catIdx++] = name;
                    }
                }
            }
        }

        // Process grade items
        const courseItem = ug.gradeitems.find(i => i.itemtype === 'course');
        const catItems = ug.gradeitems.filter(i => i.itemtype === 'category');
        const modItems = ug.gradeitems.filter(i => i.itemtype === 'mod' && i.itemname);

        const categories = [];
        let catIndex = 0;
        let totalMax = 0;

        for (const cat of catItems) {
            const children = modItems.filter(m => m.categoryid === cat.iteminstance);
            if (children.length === 0) continue;

            let catMaxSum = 0, catCount = 0;
            const items = [];
            for (const ch of children) {
                let maxGrade = null;
                if (ch.itemmodule === 'quiz') maxGrade = quizMax[ch.iteminstance];
                else if (ch.itemmodule === 'assign') maxGrade = assignMax[ch.cmid];

                // Only count items with a valid max > 0
                if (maxGrade !== null && maxGrade !== undefined && maxGrade > 0) {
                    catMaxSum += maxGrade;
                    catCount++;
                }

                const raw = ch.graderaw;
                const pct = (raw !== null && raw !== undefined && maxGrade && maxGrade > 0)
                    ? (raw / maxGrade * 100) : null;

                items.push({
                    name: ch.itemname,
                    module: ch.itemmodule,
                    score: ch.gradeformatted || '-',
                    raw: raw,
                    max: maxGrade,
                    percentage: pct !== null ? Math.round(pct * 10) / 10 : null,
                });
            }

            if (catCount === 0) continue;

            const catAvgMax = catMaxSum / catCount;
            if (catAvgMax <= 0) continue;
            totalMax += catAvgMax;
            const catRaw = cat.graderaw !== null ? parseFloat(cat.graderaw) : null;

            // Item contributions (only for items with valid max > 0)
            for (const item of items) {
                if (item.raw !== null && item.max !== null && item.max > 0) {
                    const weightInCat = 1 / catCount;
                    item.pointsToFinal = Math.round((item.raw / item.max) * weightInCat * catAvgMax * 100) / 100;
                    item.maxPointsToFinal = Math.round(weightInCat * catAvgMax * 100) / 100;
                } else {
                    item.pointsToFinal = null;
                    item.maxPointsToFinal = catCount > 0 && catAvgMax > 0
                        ? Math.round((1 / catCount) * catAvgMax * 100) / 100
                        : null;
                }
            }

            categories.push({
                name: categoryNames[catIndex] || `C${catIndex + 1}`,
                score: cat.gradeformatted || '-',
                raw: catRaw,
                max: Math.round(catAvgMax * 100) / 100,
                items,
            });
            catIndex++;
        }

        const courseTotalRaw = (courseItem && courseItem.graderaw !== null && courseItem.graderaw !== undefined)
            ? parseFloat(courseItem.graderaw) : null;
        const courseTotalFormatted = courseItem ? courseItem.gradeformatted : '-';
        const courseName = ug.coursefullname || '';

        // Compute total from categories when course-level total is not set
        let computedRaw = 0;
        let computedMax = 0;
        let anyCatHasRaw = false;
        for (const cat of categories) {
            computedMax += cat.max;
            if (cat.raw !== null) {
                computedRaw += cat.raw;
                anyCatHasRaw = true;
            }
        }
        // If course total is not set but categories have grades, use computed
        const useComputed = (courseTotalRaw === null || courseTotalRaw === undefined) && anyCatHasRaw;
        const finalRaw = useComputed ? Math.round(computedRaw * 100) / 100 : courseTotalRaw;
        const finalFormatted = useComputed ? computedRaw.toFixed(2).replace('.', ',') : courseTotalFormatted;
        const finalMax = useComputed ? Math.round(computedMax * 100) / 100 : Math.round(totalMax * 100) / 100;

        res.json({
            courseName,
            courseTotal: {
                formatted: finalFormatted,
                raw: finalRaw,
                max: finalMax,
            },
            categories,
        });
    } catch (err) {
        res.status(500).json({ error: `Error: ${err.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`\n  Grade Insight running at http://localhost:${PORT}\n`);
});

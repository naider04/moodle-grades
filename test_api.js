// Test script for Grade Insight API
// Start the server first:  node server.js
// Then run:               node test_api.js
//
// Set credentials via environment variables:
//   MOODLE_URL=https://aulagradoa.unemi.edu.ec MOODLE_USER=username MOODLE_PASS=password node test_api.js
//
// Or edit the defaults below (but don't commit credentials!)

const fetch = require('./node_modules/node-fetch');
const BASE = 'http://localhost:3001';

async function main() {
    const MOODLE_URL = process.env.MOODLE_URL || 'https://aulagradob.unemi.edu.ec';
    const USERNAME = process.env.MOODLE_USER || 'usuario';
    const PASSWORD = process.env.MOODLE_PASS || 'contraseña';

    console.log(`Testing: ${MOODLE_URL}`);

    const login = await (await fetch(BASE + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moodleUrl: MOODLE_URL, username: USERNAME, password: PASSWORD }),
    })).json();

    if (login.error) { console.error('Login failed:', login.error); process.exit(1); }
    console.log('Login OK:', login.fullname);

    const courses = await (await fetch(BASE + '/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: login.baseUrl, token: login.token, userId: login.userId }),
    })).json();

    console.log('Courses:', courses.courses.length);
    console.log('Career:', courses.careerName || '(none)');

    for (const c of courses.courses.slice(0, 3)) {
        const detail = await (await fetch(BASE + '/api/grade-detail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseUrl: login.baseUrl, token: login.token, userId: login.userId, courseId: c.id }),
        })).json();

        if (detail.error) {
            console.log(`\n${c.fullname}: ${detail.error}`);
            continue;
        }
        console.log(`\n${detail.courseName}`);
        console.log(`  Total: ${detail.courseTotal.formatted} / ${detail.courseTotal.max}`);
        for (const cat of detail.categories || []) {
            console.log(`  ${cat.name}: ${cat.score} / ${cat.max}`);
            for (const item of cat.items.slice(0, 2)) {
                console.log(`    - ${item.name}: ${item.score} / ${item.max} -> ${item.pointsToFinal} pts`);
            }
            if (cat.items.length > 2) console.log(`    ... and ${cat.items.length - 2} more items`);
        }
    }

    console.log('\nOK');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

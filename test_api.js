// Test script for Grade Insight API
// Start the server first:  node server.js
// Then run:               node test_api.js
//
// Use environment variables:
//   MOODLE_USER=username MOODLE_PASS=password node test_api.js

const fetch = require('node-fetch');
const BASE = 'http://localhost:3001';

async function main() {
    const USERNAME = process.env.MOODLE_USER || 'usuario';
    const PASSWORD = process.env.MOODLE_PASS || 'contraseña';
    const MODE = process.env.MOODLE_MODE || 'enlinea'; // 'presencial' | 'enlinea'

    console.log(`Testing mode: ${MODE}`);

    const login = await (await fetch(BASE + '/api/login-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USERNAME, password: PASSWORD, mode: MODE }),
    })).json();

    if (login.error) { console.error('Login failed:', login.error); process.exit(1); }
    console.log('User:', login.fullname);
    console.log('Career:', login.careerName);

    const sga = await (await fetch(BASE + '/api/sga-courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            token: login.sgaToken,
            moodleToken: login.moodle?.token,
            moodleUrl: login.moodle?.baseUrl,
            moodleUserId: login.moodle?.userId,
        }),
    })).json();

    if (sga.error) { console.error('SGA failed:', sga.error); process.exit(1); }
    console.log(`\n${sga.courses.length} courses found:\n`);
    for (const c of sga.courses) {
        console.log(`${c.shortname || c.fullname}`);
        console.log(`  Status: ${c.status}  |  Final: ${c.finalGrade !== null ? c.finalGrade + '/100' : 'N/A'}`);
        console.log(`  P1: ${c.p1 || 0}  P2: ${c.p2 || 0}  EXT: ${c.ext || 0}  RE: ${c.re || 0}`);
        console.log('');
    }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

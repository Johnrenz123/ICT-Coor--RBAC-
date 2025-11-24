const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432
});

pool.query('SELECT id, section_name, grade_level, adviser_name FROM sections WHERE id IN (17, 18)')
    .then(r => {
        console.log('Sections:');
        r.rows.forEach(s => {
            console.log(`  ID ${s.id}:`);
            console.log(`    section_name: "${s.section_name}"`);
            console.log(`    grade_level: "${s.grade_level}"`);
            console.log(`    adviser: "${s.adviser_name}"`);
        });
        pool.end();
    })
    .catch(e => {
        console.error(e.message);
        pool.end();
    });

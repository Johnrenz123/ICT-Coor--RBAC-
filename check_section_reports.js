const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432
});

async function checkReports() {
    try {
        // Check sections with reports
        const sectionReports = await pool.query(`
            SELECT 
                r.section_id, 
                sec.section_name, 
                sec.adviser_name, 
                sec.adviser_teacher_id, 
                COUNT(*) as report_count
            FROM student_behavior_reports r
            JOIN sections sec ON sec.id = r.section_id
            GROUP BY r.section_id, sec.section_name, sec.adviser_name, sec.adviser_teacher_id
            ORDER BY r.section_id
        `);
        
        console.log('\n=== Reports by Section ===');
        sectionReports.rows.forEach(row => {
            console.log(`Section ${row.section_id} (${row.section_name}): ${row.report_count} reports`);
            console.log(`  Adviser: ${row.adviser_name || 'None'}`);
            console.log(`  Adviser ID: ${row.adviser_teacher_id || 'None'}`);
        });

        // Check teachers
        const teachers = await pool.query(`
            SELECT id, username, first_name, last_name
            FROM teachers
            ORDER BY id
        `);
        
        console.log('\n=== Teachers ===');
        teachers.rows.forEach(row => {
            console.log(`Teacher ${row.id}: ${row.first_name} ${row.last_name} (${row.username})`);
        });

        // Sample a few reports
        const sampleReports = await pool.query(`
            SELECT 
                r.id,
                r.section_id,
                r.student_id,
                r.teacher_id,
                r.category,
                r.severity,
                CONCAT(s.last_name, ', ', s.first_name) as student_name,
                sec.section_name
            FROM student_behavior_reports r
            JOIN students s ON s.id = r.student_id
            JOIN sections sec ON sec.id = r.section_id
            ORDER BY r.id
            LIMIT 5
        `);

        console.log('\n=== Sample Reports ===');
        sampleReports.rows.forEach(row => {
            console.log(`Report ${row.id}: ${row.student_name} (Section: ${row.section_name})`);
            console.log(`  Category: ${row.category}, Severity: ${row.severity}`);
            console.log(`  Teacher ID: ${row.teacher_id}, Section ID: ${row.section_id}`);
        });

        pool.end();
    } catch (err) {
        console.error('Error:', err);
        pool.end();
    }
}

checkReports();

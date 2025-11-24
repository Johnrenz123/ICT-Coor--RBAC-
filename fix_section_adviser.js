const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432
});

async function fixAdviser() {
    try {
        // Check if adviser_teacher_id column exists
        const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'sections' 
            AND column_name IN ('adviser_teacher_id', 'adviser_name')
            ORDER BY column_name
        `);
        
        console.log('Available columns:', columnCheck.rows.map(r => r.column_name));

        // Get teacher info
        const teacher = await pool.query('SELECT id, first_name, last_name FROM teachers WHERE id = 3');
        if (teacher.rows.length === 0) {
            console.log('Teacher ID 3 not found');
            pool.end();
            return;
        }

        const teacherName = `${teacher.rows[0].first_name} ${teacher.rows[0].last_name}`;
        console.log(`\nAssigning: ${teacherName} to Section 17`);

        // Try to update based on available columns
        if (columnCheck.rows.some(r => r.column_name === 'adviser_teacher_id')) {
            await pool.query(
                'UPDATE sections SET adviser_teacher_id = $1, adviser_name = $2 WHERE id = 17',
                [3, teacherName]
            );
            console.log('✓ Updated with adviser_teacher_id');
        } else {
            await pool.query(
                'UPDATE sections SET adviser_name = $1 WHERE id = 17',
                [teacherName]
            );
            console.log('✓ Updated with adviser_name only');
        }

        // Verify the update
        const verify = await pool.query('SELECT * FROM sections WHERE id = 17');
        console.log('\nSection 17 after update:', verify.rows[0]);

        pool.end();
    } catch (err) {
        console.error('Error:', err.message);
        pool.end();
    }
}

fixAdviser();

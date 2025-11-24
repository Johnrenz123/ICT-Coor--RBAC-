const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432,
});

async function fixTeacherSections() {
    const client = await pool.connect();
    
    try {
        console.log('\n========================================');
        console.log('FIXING TEACHER-SECTION ASSIGNMENTS');
        console.log('========================================\n');

        await client.query('BEGIN');

        // Check if adviser_teacher_id column exists
        const columnCheck = await client.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_schema = 'public' 
                AND table_name = 'sections' 
                AND column_name = 'adviser_teacher_id'
            ) AS has_column
        `);

        if (!columnCheck.rows[0].has_column) {
            console.log('❌ Column adviser_teacher_id does not exist in sections table.');
            console.log('   Run this SQL command first:');
            console.log('   ALTER TABLE sections ADD COLUMN IF NOT EXISTS adviser_teacher_id INTEGER REFERENCES teachers(id);');
            await client.query('ROLLBACK');
            return;
        }

        console.log('✓ Column adviser_teacher_id exists\n');

        // Find and fix sections with adviser_name but no adviser_teacher_id
        console.log('Searching for sections with names but no teacher ID link...\n');
        
        const result = await client.query(`
            UPDATE sections s
            SET adviser_teacher_id = t.id,
                updated_at = CURRENT_TIMESTAMP
            FROM teachers t
            WHERE s.adviser_teacher_id IS NULL
              AND s.adviser_name IS NOT NULL
              AND s.adviser_name != ''
              AND (
                -- Try exact match on concatenated name
                s.adviser_name = CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name)
                OR
                -- Try match with normalized spacing
                REPLACE(s.adviser_name, '  ', ' ') = REPLACE(CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name), '  ', ' ')
                OR
                -- Try match without middle name
                s.adviser_name = CONCAT(t.first_name, ' ', t.last_name)
              )
            RETURNING s.id, s.section_name, s.adviser_name, s.adviser_teacher_id
        `);

        if (result.rows.length > 0) {
            console.log(`✓ Fixed ${result.rows.length} section(s):\n`);
            console.table(result.rows);
        } else {
            console.log('ℹ No sections needed fixing (all already linked or no matching teachers found)\n');
        }

        // Show final status
        console.log('\nFinal Section Status:');
        console.log('─'.repeat(80));
        const finalStatus = await client.query(`
            SELECT s.id, s.section_name, s.grade_level, 
                   s.adviser_name, s.adviser_teacher_id,
                   t.username as teacher_username,
                   COUNT(st.id) as student_count
            FROM sections s
            LEFT JOIN teachers t ON s.adviser_teacher_id = t.id
            LEFT JOIN students st ON st.section_id = s.id AND st.enrollment_status = 'active'
            WHERE s.is_active = true
            GROUP BY s.id, s.section_name, s.grade_level, s.adviser_name, s.adviser_teacher_id, t.username
            ORDER BY s.section_name
        `);
        console.table(finalStatus.rows);

        await client.query('COMMIT');
        
        console.log('\n========================================');
        console.log('FIX COMPLETE!');
        console.log('========================================\n');

        console.log('Teachers can now:');
        console.log('1. Logout if currently logged in');
        console.log('2. Login again at http://localhost:3000/teacher-login');
        console.log('3. View their section and students\n');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Error during fix:', err);
        console.error('\nDetails:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

fixTeacherSections();
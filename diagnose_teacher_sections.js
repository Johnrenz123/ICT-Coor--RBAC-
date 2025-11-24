const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432,
});

async function diagnoseTeacherSections() {
    try {
        console.log('\n========================================');
        console.log('TEACHER-SECTION DIAGNOSTIC REPORT');
        console.log('========================================\n');

        // 1. Check all teachers
        console.log('1. ALL TEACHERS:');
        console.log('─'.repeat(80));
        const teachers = await pool.query(`
            SELECT id, username, first_name, middle_name, last_name, 
                   CONCAT(first_name, ' ', COALESCE(middle_name || ' ', ''), last_name) AS full_name,
                   is_active
            FROM teachers
            ORDER BY id
        `);
        console.table(teachers.rows);

        // 2. Check if adviser_teacher_id column exists
        console.log('\n2. CHECKING SECTIONS TABLE STRUCTURE:');
        console.log('─'.repeat(80));
        const columnCheck = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'sections' 
              AND column_name IN ('adviser_name', 'adviser_teacher_id')
            ORDER BY column_name
        `);
        console.table(columnCheck.rows);

        // 3. Check all sections
        console.log('\n3. ALL ACTIVE SECTIONS:');
        console.log('─'.repeat(80));
        const sections = await pool.query(`
            SELECT id, section_name, grade_level, adviser_name, 
                   adviser_teacher_id, current_count, max_capacity, is_active
            FROM sections
            WHERE is_active = true
            ORDER BY section_name
        `);
        console.table(sections.rows);

        // 4. Check students per section
        console.log('\n4. STUDENT COUNT PER SECTION:');
        console.log('─'.repeat(80));
        const studentCounts = await pool.query(`
            SELECT s.id, s.section_name, s.adviser_name,
                   COUNT(st.id) as actual_student_count,
                   s.current_count as recorded_count
            FROM sections s
            LEFT JOIN students st ON st.section_id = s.id AND st.enrollment_status = 'active'
            WHERE s.is_active = true
            GROUP BY s.id, s.section_name, s.adviser_name, s.current_count
            ORDER BY s.section_name
        `);
        console.table(studentCounts.rows);

        // 5. Find sections that might belong to teachers (by name pattern)
        console.log('\n5. SECTIONS MATCHED TO TEACHERS (by name):');
        console.log('─'.repeat(80));
        const matches = await pool.query(`
            SELECT s.id as section_id, s.section_name, s.adviser_name,
                   s.adviser_teacher_id as linked_teacher_id,
                   t.id as matching_teacher_id, t.username,
                   CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name) as teacher_full_name,
                   CASE 
                     WHEN s.adviser_teacher_id = t.id THEN '✓ Linked'
                     WHEN s.adviser_teacher_id IS NULL THEN '✗ Not Linked'
                     ELSE '! Mismatch'
                   END as status
            FROM sections s
            LEFT JOIN teachers t ON (
                s.adviser_name = CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name)
                OR REPLACE(s.adviser_name, '  ', ' ') = REPLACE(CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name), '  ', ' ')
                OR s.adviser_name = CONCAT(t.first_name, ' ', t.last_name)
                OR s.adviser_name LIKE CONCAT('%', t.last_name, '%')
            )
            WHERE s.is_active = true
            ORDER BY s.section_name
        `);
        console.table(matches.rows);

        // 6. Teachers without sections
        console.log('\n6. TEACHERS WITHOUT ASSIGNED SECTIONS:');
        console.log('─'.repeat(80));
        const unassignedTeachers = await pool.query(`
            SELECT t.id, t.username,
                   CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name) as full_name,
                   t.is_active
            FROM teachers t
            WHERE NOT EXISTS (
                SELECT 1 FROM sections s 
                WHERE (s.adviser_teacher_id = t.id OR s.adviser_name = CONCAT(t.first_name, ' ', COALESCE(t.middle_name || ' ', ''), t.last_name))
                AND s.is_active = true
            )
            ORDER BY t.last_name, t.first_name
        `);
        if (unassignedTeachers.rows.length === 0) {
            console.log('(All teachers have sections assigned)');
        } else {
            console.table(unassignedTeachers.rows);
        }

        // 7. Sections without teachers
        console.log('\n7. SECTIONS WITHOUT TEACHERS:');
        console.log('─'.repeat(80));
        const unassignedSections = await pool.query(`
            SELECT s.id, s.section_name, s.grade_level, s.adviser_name,
                   s.current_count, s.max_capacity
            FROM sections s
            WHERE s.adviser_teacher_id IS NULL
              AND (s.adviser_name IS NULL OR s.adviser_name = '')
              AND s.is_active = true
            ORDER BY s.section_name
        `);
        if (unassignedSections.rows.length === 0) {
            console.log('(All active sections have advisers assigned)');
        } else {
            console.table(unassignedSections.rows);
        }

        console.log('\n========================================');
        console.log('DIAGNOSTIC COMPLETE');
        console.log('========================================\n');

        console.log('NEXT STEPS:');
        console.log('─'.repeat(80));
        console.log('1. If you see sections with "✗ Not Linked" status, run:');
        console.log('   node fix_teacher_sections.js');
        console.log('');
        console.log('2. If teachers have no sections, assign them via ICT Coordinator interface');
        console.log('');
        console.log('3. If sections have 0 students, assign students via ICT Coordinator interface');
        console.log('');

    } catch (err) {
        console.error('Error during diagnostic:', err);
    } finally {
        await pool.end();
    }
}

diagnoseTeacherSections();

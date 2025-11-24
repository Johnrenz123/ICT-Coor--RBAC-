/**
 * CREATE SAMPLE STUDENTS FOR DSS TEST DATA
 */

const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432,
});

async function createSampleStudents() {
    try {
        console.log('🎓 Creating sample students...\n');

        // Get first section
        const sectionResult = await pool.query('SELECT id FROM sections LIMIT 1');
        if (sectionResult.rows.length === 0) {
            console.error('❌ No sections found!');
            process.exit(1);
        }
        const sectionId = sectionResult.rows[0].id;

        const sampleStudents = [
            { first_name: 'Maria', last_name: 'Garcia', sex: 'Female', birthday: '2015-03-15' },
            { first_name: 'Carlos', last_name: 'Lopez', sex: 'Male', birthday: '2015-06-20' },
            { first_name: 'Juan', last_name: 'Rodriguez', sex: 'Male', birthday: '2015-09-10' },
            { first_name: 'Miguel', last_name: 'Santos', sex: 'Male', birthday: '2015-01-25' },
            { first_name: 'Anna', last_name: 'Martinez', sex: 'Female', birthday: '2015-05-08' },
            { first_name: 'Pedro', last_name: 'Flores', sex: 'Male', birthday: '2015-11-12' },
            { first_name: 'Sofia', last_name: 'Hernandez', sex: 'Female', birthday: '2015-04-18' },
            { first_name: 'Diego', last_name: 'Moreno', sex: 'Male', birthday: '2015-07-30' },
            { first_name: 'Rafael', last_name: 'Diaz', sex: 'Male', birthday: '2015-02-14' },
            { first_name: 'Leo', last_name: 'Vargas', sex: 'Male', birthday: '2015-08-22' },
        ];

        let created = 0;
        for (const student of sampleStudents) {
            try {
                await pool.query(
                    `INSERT INTO students (first_name, last_name, sex, birthday, section_id, lrn) 
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (lrn) DO NOTHING`,
                    [
                        student.first_name,
                        student.last_name,
                        student.sex,
                        student.birthday,
                        sectionId,
                        `LRN${Date.now()}${Math.random()}`
                    ]
                );
                console.log(`✅ ${student.first_name} ${student.last_name}`);
                created++;
            } catch (err) {
                console.log(`⚠️  ${student.first_name} - skipped`);
            }
        }

        console.log(`\n✅ Created ${created} sample students`);
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        await pool.end();
        process.exit(1);
    }
}

createSampleStudents();

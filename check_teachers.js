const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432,
});

async function checkTeachers() {
    try {
        console.log('Checking teachers in database...\n');
        
        const result = await pool.query(
            'SELECT id, username, first_name, last_name, email, is_active FROM teachers ORDER BY id'
        );
        
        if (result.rows.length === 0) {
            console.log('❌ No teachers found in the database!');
            console.log('You need to create a teacher account first.');
        } else {
            console.log(`✅ Found ${result.rows.length} teacher(s):\n`);
            result.rows.forEach((teacher, index) => {
                console.log(`${index + 1}. ID: ${teacher.id}`);
                console.log(`   Username: ${teacher.username}`);
                console.log(`   Name: ${teacher.first_name} ${teacher.last_name}`);
                console.log(`   Email: ${teacher.email || 'N/A'}`);
                console.log(`   Active: ${teacher.is_active ? 'Yes' : 'No'}`);
                console.log('');
            });
        }
        
    } catch (error) {
        console.error('❌ Error checking teachers:', error.message);
    } finally {
        await pool.end();
    }
}

checkTeachers();

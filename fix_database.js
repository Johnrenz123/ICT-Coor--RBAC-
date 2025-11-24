// Fix database schema and test queries
const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432
});

async function fixDatabase() {
    try {
        console.log('========================================');
        console.log('Checking and fixing database schema...');
        console.log('========================================\n');
        
        // 1. Add assigned_section column if it doesn't exist
        console.log('1. Adding assigned_section column...');
        await pool.query(`
            ALTER TABLE early_registration 
            ADD COLUMN IF NOT EXISTS assigned_section VARCHAR(100)
        `);
        console.log('✅ assigned_section column added/verified\n');
        
        // 2. Test the exact query used in registrar dashboard
        console.log('2. Testing REGISTRAR query:');
        const registrarResult = await pool.query(`
            SELECT id, school_year, grade_level, 
                   CONCAT(last_name, ', ', first_name, ' ', COALESCE(middle_name, ''), ' ', COALESCE(ext_name, '')) as learner_name,
                   lrn, mother_name, contact_number, registration_date, created_at
            FROM early_registration 
            ORDER BY created_at DESC
        `);
        console.log(`Found ${registrarResult.rows.length} students (REGISTRAR VIEW)`);
        console.log('Students:', JSON.stringify(registrarResult.rows, null, 2));
        console.log('\n');
        
        // 3. Test the exact query used in ICT Coordinator
        console.log('3. Testing ICT COORDINATOR query:');
        const ictcoorResult = await pool.query(`
            SELECT id, 
                   CONCAT(last_name, ', ', first_name, ' ', COALESCE(middle_name, ''), ' ', COALESCE(ext_name, '')) as full_name,
                   lrn, grade_level, sex, age, contact_number, 
                   assigned_section, school_year, created_at
            FROM early_registration 
            ORDER BY grade_level, last_name, first_name
        `);
        console.log(`Found ${ictcoorResult.rows.length} students (ICT COORDINATOR VIEW)`);
        console.log('Students:', JSON.stringify(ictcoorResult.rows, null, 2));
        console.log('\n');
        
        console.log('========================================');
        console.log('✅ Database check complete!');
        console.log('========================================');
        
    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error(err);
    } finally {
        await pool.end();
    }
}

fixDatabase();

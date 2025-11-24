const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432
});

async function checkColumns() {
    try {
        const result = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'students' 
            ORDER BY ordinal_position
        `);
        console.log('Students table columns:', result.rows.map(r => r.column_name).join(', '));
        
        // Also check one row
        const sample = await pool.query('SELECT * FROM students LIMIT 1');
        if (sample.rows.length > 0) {
            console.log('\nSample row columns:', Object.keys(sample.rows[0]).join(', '));
        }
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        pool.end();
    }
}

checkColumns();

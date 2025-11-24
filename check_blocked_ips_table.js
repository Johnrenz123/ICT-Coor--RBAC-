const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432
});

async function checkTable() {
    try {
        const result = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'blocked_ips' 
            ORDER BY ordinal_position
        `);
        
        console.log('\n✅ blocked_ips table columns:');
        console.log('================================');
        result.rows.forEach(col => {
            console.log(`  ${col.column_name.padEnd(20)} - ${col.data_type}`);
        });
        console.log('================================\n');
        
        // Check if unblocked_by and unblocked_at exist
        const cols = result.rows.map(r => r.column_name);
        const missing = [];
        if (!cols.includes('unblocked_by')) missing.push('unblocked_by');
        if (!cols.includes('unblocked_at')) missing.push('unblocked_at');
        
        if (missing.length > 0) {
            console.log('❌ MISSING COLUMNS:', missing.join(', '));
            console.log('\n💡 Run this SQL to add them:');
            console.log(`
ALTER TABLE blocked_ips 
ADD COLUMN IF NOT EXISTS unblocked_by INTEGER,
ADD COLUMN IF NOT EXISTS unblocked_at TIMESTAMP;
            `);
        } else {
            console.log('✅ All required columns exist!');
        }
        
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await pool.end();
    }
}

checkTable();

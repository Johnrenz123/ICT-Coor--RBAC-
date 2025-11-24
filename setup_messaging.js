const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432,
});

async function createMessagingTable() {
    try {
        console.log('Creating guidance_teacher_messages table...');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guidance_teacher_messages (
                id SERIAL PRIMARY KEY,
                guidance_id INTEGER NOT NULL REFERENCES guidance_accounts(id) ON DELETE CASCADE,
                teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
                message TEXT NOT NULL,
                is_read BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log('✓ Table created successfully');
        
        console.log('Creating indexes...');
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_gtm_teacher ON guidance_teacher_messages(teacher_id, created_at DESC);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_gtm_guidance ON guidance_teacher_messages(guidance_id, created_at DESC);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_gtm_unread ON guidance_teacher_messages(teacher_id, is_read) WHERE is_read = false;`);
        
        console.log('✓ Indexes created successfully');
        console.log('\n✅ Messaging system setup complete!');
        
        process.exit(0);
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
}

createMessagingTable();

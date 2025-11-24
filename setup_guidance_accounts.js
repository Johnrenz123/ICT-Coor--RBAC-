/**
 * Setup script to create guidance_accounts table and insert default account
 * Run this with: node setup_guidance_accounts.js
 */

const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432,
});

async function setupGuidanceAccounts() {
    try {
        console.log('========================================');
        console.log('Setting up Guidance Accounts...');
        console.log('========================================\n');

        // 1. Create the guidance_accounts table
        console.log('1. Creating guidance_accounts table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS guidance_accounts (
                id SERIAL PRIMARY KEY,
                fullname VARCHAR(100) NOT NULL,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                email VARCHAR(100),
                contact_number VARCHAR(20),
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Table created successfully\n');

        // 2. Create indexes
        console.log('2. Creating indexes...');
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_guidance_username ON guidance_accounts(username)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_guidance_active ON guidance_accounts(is_active)
        `);
        console.log('✅ Indexes created successfully\n');

        // 3. Check if default account exists
        console.log('3. Checking for existing accounts...');
        const existing = await pool.query('SELECT COUNT(*) FROM guidance_accounts');
        const count = parseInt(existing.rows[0].count);
        
        if (count === 0) {
            console.log('No accounts found. Creating default account...');
            
            // Hash the default password 'admin123'
            const hashedPassword = await bcrypt.hash('admin123', 10);
            
            await pool.query(`
                INSERT INTO guidance_accounts (fullname, username, password, email)
                VALUES ($1, $2, $3, $4)
            `, ['Guidance Counselor', 'admin', hashedPassword, 'guidance@school.edu']);
            
            console.log('✅ Default account created successfully');
            console.log('   Username: admin');
            console.log('   Password: admin123');
            console.log('   ⚠️  Please change this password after first login!\n');
        } else {
            console.log(`✅ Found ${count} existing account(s)\n`);
        }

        // 4. Display all accounts
        console.log('4. Current Guidance Accounts:');
        console.log('─'.repeat(80));
        const accounts = await pool.query(`
            SELECT id, fullname, username, email, is_active, created_at
            FROM guidance_accounts
            ORDER BY id
        `);
        console.table(accounts.rows);

        console.log('\n========================================');
        console.log('Setup completed successfully! ✅');
        console.log('========================================\n');
        console.log('Next steps:');
        console.log('1. Start your server: node server.js');
        console.log('2. Login as ICT Coordinator');
        console.log('3. Go to Settings > Guidance Account');
        console.log('4. Manage guidance accounts from there\n');

    } catch (error) {
        console.error('❌ Error during setup:', error);
    } finally {
        await pool.end();
    }
}

setupGuidanceAccounts();

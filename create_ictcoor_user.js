// Script to create an ICT Coordinator user account
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432
});

async function createIctCoorUser() {
    try {
        // Check if users table exists and has data
        const usersCheck = await pool.query('SELECT * FROM users');
        console.log('Current users in database:');
        console.log(usersCheck.rows);
        
        // Check if ictcoor user already exists
        const existingUser = usersCheck.rows.find(u => u.username === 'ictcoor' || u.role === 'ictcoor');
        
        if (existingUser) {
            console.log('\n✅ ICT Coordinator user already exists:');
            console.log('Username:', existingUser.username);
            console.log('Role:', existingUser.role);
        } else {
            // Create new ICT Coordinator user
            const hashedPassword = await bcrypt.hash('admin123', 10);
            
            const result = await pool.query(
                'INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING *',
                ['ictcoor', hashedPassword, 'ictcoor']
            );
            
            console.log('\n✅ ICT Coordinator user created successfully:');
            console.log('Username: ictcoor');
            console.log('Password: admin123');
            console.log('Role: ictcoor');
            console.log('\nYou can now log in at http://localhost:3000/login');
        }
        
        // Check early_registration table
        const studentsCheck = await pool.query('SELECT COUNT(*) as count FROM early_registration');
        console.log(`\n📊 Total students in early_registration table: ${studentsCheck.rows[0].count}`);
        
    } catch (err) {
        console.error('Error:', err.message);
        
        if (err.message.includes('relation "users" does not exist')) {
            console.log('\n❌ The "users" table does not exist in your database.');
            console.log('Creating users table...\n');
            
            await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(255) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    role VARCHAR(50) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            console.log('✅ Users table created. Running script again...\n');
            await createIctCoorUser();
        }
    } finally {
        await pool.end();
    }
}

createIctCoorUser();

const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'ICTCOORdb',
    password: 'bello0517',
    port: 5432,
});

async function resetRegistrarPassword() {
    try {
        const username = 'Tantan';
        const newPassword = 'admin123';
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        
        const result = await pool.query(
            'UPDATE registraraccount SET password = $1 WHERE username = $2 RETURNING *',
            [hashedPassword, username]
        );
        
        if (result.rows.length > 0) {
            console.log('✅ Password reset successfully!');
            console.log('   Username:', username);
            console.log('   New Password:', newPassword);
            console.log('\nYou can now login at: http://localhost:3000/registrarlogin');
        } else {
            console.log('❌ User not found');
        }
        
        await pool.end();
    } catch (err) {
        console.error('❌ Error:', err.message);
        await pool.end();
    }
}

resetRegistrarPassword();

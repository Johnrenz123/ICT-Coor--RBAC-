const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// PostgreSQL installation paths
const pgBin = path.join('C:', 'Program Files', 'PostgreSQL', '17', 'bin');
const pgData = path.join('C:', 'Program Files', 'PostgreSQL', '17', 'data');

// Create a temporary SQL script for password reset
const sqlScript = path.join(__dirname, 'reset_password.sql');
const sqlContent = `ALTER ROLE postgres WITH PASSWORD 'postgres';
ALTER ROLE postgres WITH LOGIN;`;

console.log('Creating password reset SQL script...');
fs.writeFileSync(sqlScript, sqlContent);

// Try to execute psql
const psqlPath = path.join(pgBin, 'psql.exe');
const cmd = `"${psqlPath}" -U postgres -d postgres -f "${sqlScript}" -h localhost`;

console.log('Attempting to reset postgres password...');
console.log(`Command: ${cmd.replace(/postgres/g, '***')}\n`);

exec(cmd, (err, stdout, stderr) => {
    if (err) {
        console.error('❌ Error executing psql:');
        console.error(stderr || err.message);
        console.log('\nAlternative: You may need to modify pg_hba.conf to use trust authentication');
    } else {
        console.log('✅ Password reset attempted');
        console.log(stdout);
    }
    
    // Clean up
    fs.unlinkSync(sqlScript);
});

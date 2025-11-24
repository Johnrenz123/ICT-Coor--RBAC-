const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'ICTCOORdb',
  password: 'bello0517',
  port: 5432
});

async function checkAccounts() {
  try {
    const result = await pool.query(`
      SELECT id, fullname, username, email, contact_number, is_active, created_at 
      FROM guidance_accounts 
      ORDER BY created_at DESC
    `);
    
    console.log('\n📋 GUIDANCE ACCOUNTS IN DATABASE:\n');
    console.log('Total accounts:', result.rows.length);
    console.log('\n' + '='.repeat(60));
    
    result.rows.forEach((acc, i) => {
      console.log(`\n${i+1}. ${acc.fullname}`);
      console.log(`   Username: ${acc.username}`);
      console.log(`   Email: ${acc.email || 'N/A'}`);
      console.log(`   Contact: ${acc.contact_number || 'N/A'}`);
      console.log(`   Active: ${acc.is_active ? 'Yes' : 'No'}`);
      console.log(`   Created: ${acc.created_at}`);
      console.log('   ' + '-'.repeat(58));
    });
    
    console.log('\n✅ These accounts can be used to login at:');
    console.log('   http://localhost:3000/guidance/login\n');
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    pool.end();
  }
}

checkAccounts();

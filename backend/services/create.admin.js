require('dotenv').config();

const bcrypt = require('bcrypt');
const db = require('../db');

async function run() {
  const [email, password, fullName] = process.argv.slice(2);
  
  if (!email || !password || !fullName) {
    console.log('Usage: node createAdmin.js <email> <password> <fullName>');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);

  await db.query(
    `INSERT INTO admins (email, full_name, password_hash, is_active)
     VALUES ($1, $2, $3, TRUE)`,
    [email, fullName, hash]
  );

  console.log('Admin created:', email);
  process.exit();
}

run();
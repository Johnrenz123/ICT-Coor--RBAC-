-- Create the registraraccount table for storing registrar accounts
CREATE TABLE registraraccount (
    id SERIAL PRIMARY KEY,
    fullname VARCHAR(100) NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL
);

-- Example: Insert a registrar account (password should be hashed in the app, not here)
-- INSERT INTO registraraccount (fullname, username, password) VALUES ('Registrar Name', 'registraruser', 'hashedpassword');

-- To view all registrar accounts:
-- SELECT id, fullname, username FROM registraraccount;

-- To view the hashed password
-- SELECT id, fullname, username, password FROM registraraccount;

-- To delete a registrar account by id:
-- DELETE FROM registraraccount WHERE id = 1;

-- To update a registrar account's name or username:
-- UPDATE registraraccount SET fullname = 'New Name', username = 'newuser' WHERE id = 1;



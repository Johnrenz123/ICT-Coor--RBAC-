-- Create the guidance_accounts table for storing guidance counselor accounts
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
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_guidance_username ON guidance_accounts(username);
CREATE INDEX IF NOT EXISTS idx_guidance_active ON guidance_accounts(is_active);

-- Add comment
COMMENT ON TABLE guidance_accounts IS 'Stores guidance counselor accounts for behavior tracking and analytics';

-- Example: Insert a default guidance account (password should be hashed in the app)
-- The password 'admin123' hashed with bcrypt
-- INSERT INTO guidance_accounts (fullname, username, password) 
-- VALUES ('Guidance Counselor', 'admin', '$2b$10$rZ5YrZk4c7p3W8QGXzjSu.FqLt8YdqPDTR.YGJXz3kMK8Xy3RhJHi');
    
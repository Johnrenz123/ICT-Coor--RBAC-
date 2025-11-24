-- Create the teachers table for storing teacher accounts and demographic information
CREATE TABLE IF NOT EXISTS teachers (
    id SERIAL PRIMARY KEY,
    
    -- Login Credentials
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    
    -- Personal Information
    first_name VARCHAR(50) NOT NULL,
    middle_name VARCHAR(50),
    last_name VARCHAR(50) NOT NULL,
    ext_name VARCHAR(10), -- Jr., Sr., III, etc.
    
    -- Contact Information
    email VARCHAR(100),
    contact_number VARCHAR(20),
    
    -- Additional Information
    birthday DATE,
    sex VARCHAR(10),
    address TEXT,
    
    -- Employment Details
    employee_id VARCHAR(50) UNIQUE,
    department VARCHAR(100),
    position VARCHAR(100),
    specialization VARCHAR(100),
    date_hired DATE,
    
    -- Account Status
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_teachers_username ON teachers(username);
CREATE INDEX IF NOT EXISTS idx_teachers_employee_id ON teachers(employee_id);
CREATE INDEX IF NOT EXISTS idx_teachers_is_active ON teachers(is_active);

-- Add comment
COMMENT ON TABLE teachers IS 'Stores teacher accounts and demographic information';

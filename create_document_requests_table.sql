-- Create document_requests table
CREATE TABLE IF NOT EXISTS document_requests (
    id SERIAL PRIMARY KEY,
    request_token VARCHAR(20) UNIQUE NOT NULL,
    
    -- Requester Information
    student_name VARCHAR(255) NOT NULL,
    student_id VARCHAR(100),
    contact_number VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    
    -- Request Details
    document_type VARCHAR(100) NOT NULL,
    purpose TEXT NOT NULL,
    additional_notes TEXT,
    
    -- Adviser Information
    adviser_name VARCHAR(255),
    adviser_school_year VARCHAR(50),
    
    -- Requester Type
    student_type VARCHAR(20) CHECK (student_type IN ('student', 'alumni')),
    
    -- Status Tracking
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'completed', 'rejected')),
    
    -- Processing Information
    processed_by INTEGER REFERENCES guidance_accounts(id),
    processed_at TIMESTAMP,
    completion_notes TEXT,
    rejection_reason TEXT,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster token lookups
CREATE INDEX idx_document_requests_token ON document_requests(request_token);
CREATE INDEX idx_document_requests_status ON document_requests(status);
CREATE INDEX idx_document_requests_email ON document_requests(email);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_document_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_document_requests_updated_at
    BEFORE UPDATE ON document_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_document_requests_updated_at();

COMMENT ON TABLE document_requests IS 'Stores document requests from students and alumni';
COMMENT ON COLUMN document_requests.request_token IS 'Unique token for tracking request status';
COMMENT ON COLUMN document_requests.status IS 'pending: newly submitted, processing: being prepared, ready: ready for pickup, completed: released, rejected: denied';

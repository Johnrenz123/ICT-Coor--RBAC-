-- Create submission_logs table for security monitoring
-- This tracks all form submissions for spam/abuse detection

CREATE TABLE IF NOT EXISTS submission_logs (
    id SERIAL PRIMARY KEY,
    submission_type VARCHAR(50) NOT NULL, -- 'enrollment' or 'document_request'
    ip_address VARCHAR(45) NOT NULL, -- IPv4 or IPv6
    user_agent TEXT,
    email VARCHAR(255),
    lrn VARCHAR(12),
    form_data JSONB, -- Store key form fields for analysis
    status VARCHAR(20) NOT NULL, -- 'success', 'duplicate', 'rate_limited', 'honeypot', 'validation_failed'
    error_message TEXT,
    request_token VARCHAR(20), -- Token if submission succeeded
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_submission_logs_ip ON submission_logs(ip_address);
CREATE INDEX IF NOT EXISTS idx_submission_logs_email ON submission_logs(email);
CREATE INDEX IF NOT EXISTS idx_submission_logs_type ON submission_logs(submission_type);
CREATE INDEX IF NOT EXISTS idx_submission_logs_status ON submission_logs(status);
CREATE INDEX IF NOT EXISTS idx_submission_logs_created ON submission_logs(created_at);

-- Comment for documentation
COMMENT ON TABLE submission_logs IS 'Security log of all form submissions for monitoring spam and abuse';

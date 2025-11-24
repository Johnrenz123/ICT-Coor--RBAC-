-- Create blocked_ips table for IP blocklist management
-- Allows admins to permanently or temporarily block malicious IPs

CREATE TABLE IF NOT EXISTS blocked_ips (
    id SERIAL PRIMARY KEY,
    ip_address VARCHAR(45) UNIQUE NOT NULL, -- IPv4 or IPv6
    reason TEXT NOT NULL, -- Why this IP was blocked
    blocked_by INTEGER REFERENCES guidance_accounts(id), -- Admin who blocked it (can be guidance or registrar)
    blocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP, -- NULL = permanent block, date = temporary block
    is_active BOOLEAN DEFAULT true, -- Can be manually unblocked
    unblocked_by INTEGER REFERENCES guidance_accounts(id),
    unblocked_at TIMESTAMP,
    notes TEXT -- Additional notes or history
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_blocked_ips_address ON blocked_ips(ip_address);
CREATE INDEX IF NOT EXISTS idx_blocked_ips_active ON blocked_ips(is_active);
CREATE INDEX IF NOT EXISTS idx_blocked_ips_expires ON blocked_ips(expires_at);

-- Comment for documentation
COMMENT ON TABLE blocked_ips IS 'IP blocklist for security - blocks malicious IPs from submitting forms';

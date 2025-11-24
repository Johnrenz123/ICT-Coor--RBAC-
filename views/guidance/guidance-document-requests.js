// Guidance Document Requests Management
let allRequests = [];
let currentTab = 'pending';

// Load data on page load
document.addEventListener('DOMContentLoaded', function() {
    loadRequests();
    
    // Handle status form submission
    document.getElementById('statusForm').addEventListener('submit', handleStatusUpdate);
    
    // Show/hide rejection reason based on status
    document.getElementById('newStatus').addEventListener('change', function() {
        const rejectionGroup = document.getElementById('rejectionGroup');
        const notesGroup = document.getElementById('notesGroup');
        if (this.value === 'rejected') {
            rejectionGroup.classList.remove('hidden');
            notesGroup.classList.add('hidden');
            document.getElementById('rejectionReason').required = true;
        } else {
            rejectionGroup.classList.add('hidden');
            notesGroup.classList.remove('hidden');
            document.getElementById('rejectionReason').required = false;
        }
    });
});

async function loadRequests() {
    try {
        const response = await fetch('/api/guidance/document-requests');
        const result = await response.json();
        
        if (result.success) {
            allRequests = result.requests;
            updateStats();
            renderRequests();
        } else {
            console.error('Failed to load requests:', result.message);
        }
    } catch (error) {
        console.error('Error loading requests:', error);
    }
}

function updateStats() {
    const pending = allRequests.filter(r => r.status === 'pending').length;
    const processing = allRequests.filter(r => r.status === 'processing').length;
    const ready = allRequests.filter(r => r.status === 'ready').length;
    const completed = allRequests.filter(r => r.status === 'completed').length;
    
    const statsHTML = `
        <div class="stat-card yellow">
            <div class="stat-number">${pending}</div>
            <div class="stat-label">Pending Requests</div>
        </div>
        <div class="stat-card blue">
            <div class="stat-number">${processing}</div>
            <div class="stat-label">Processing</div>
        </div>
        <div class="stat-card green">
            <div class="stat-number">${ready}</div>
            <div class="stat-label">Ready for Pickup</div>
        </div>
        <div class="stat-card purple">
            <div class="stat-number">${completed}</div>
            <div class="stat-label">Completed</div>
        </div>
    `;
    
    document.getElementById('statsGrid').innerHTML = statsHTML;
    
    // Populate document type filter
    const docTypes = [...new Set(allRequests.map(r => r.document_type))];
    const filterSelect = document.getElementById('filterDocTypePending');
    filterSelect.innerHTML = '<option value="">All Document Types</option>' + 
        docTypes.map(type => `<option value="${type}">${type}</option>`).join('');
}

function renderRequests() {
    renderPendingRequests();
    renderProcessingRequests();
    renderReadyRequests();
    renderHistoryRequests();
}

function renderPendingRequests() {
    const pending = allRequests.filter(r => r.status === 'pending');
    const tbody = document.getElementById('pendingTableBody');
    
    if (pending.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No pending requests</td></tr>';
        return;
    }
    
    tbody.innerHTML = pending.map(req => `
        <tr>
            <td><strong>${req.request_token}</strong></td>
            <td>${req.student_name}</td>
            <td>${req.document_type}</td>
            <td>
                ${req.email}<br>
                <small>${req.contact_number}</small>
            </td>
            <td>${formatDate(req.created_at)}</td>
            <td>
                <button class="action-btn btn-view" onclick="viewDetails(${req.id})">View</button>
                <button class="action-btn btn-process" onclick="openStatusModal(${req.id})">Process</button>
            </td>
        </tr>
    `).join('');
}

function renderProcessingRequests() {
    const processing = allRequests.filter(r => r.status === 'processing');
    const tbody = document.getElementById('processingTableBody');
    
    if (processing.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No requests being processed</td></tr>';
        return;
    }
    
    tbody.innerHTML = processing.map(req => `
        <tr>
            <td><strong>${req.request_token}</strong></td>
            <td>${req.student_name}</td>
            <td>${req.document_type}</td>
            <td>
                ${req.email}<br>
                <small>${req.contact_number}</small>
            </td>
            <td>${formatDate(req.processed_at || req.updated_at)}</td>
            <td>
                <button class="action-btn btn-view" onclick="viewDetails(${req.id})">View</button>
                <button class="action-btn btn-process" onclick="openStatusModal(${req.id})">Update</button>
            </td>
        </tr>
    `).join('');
}

function renderReadyRequests() {
    const ready = allRequests.filter(r => r.status === 'ready');
    const tbody = document.getElementById('readyTableBody');
    
    if (ready.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No documents ready for pickup</td></tr>';
        return;
    }
    
    tbody.innerHTML = ready.map(req => `
        <tr>
            <td><strong>${req.request_token}</strong></td>
            <td>${req.student_name}</td>
            <td>${req.document_type}</td>
            <td>
                ${req.email}<br>
                <small>${req.contact_number}</small>
            </td>
            <td>${formatDate(req.processed_at || req.updated_at)}</td>
            <td>
                <button class="action-btn btn-view" onclick="viewDetails(${req.id})">View</button>
                <button class="action-btn btn-process" onclick="openStatusModal(${req.id})">Complete</button>
            </td>
        </tr>
    `).join('');
}

function renderHistoryRequests() {
    const history = allRequests.filter(r => r.status === 'completed' || r.status === 'rejected');
    const tbody = document.getElementById('historyTableBody');
    
    if (history.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No completed requests yet</td></tr>';
        return;
    }
    
    tbody.innerHTML = history.map(req => `
        <tr>
            <td><strong>${req.request_token}</strong></td>
            <td>${req.student_name}</td>
            <td>${req.document_type}</td>
            <td><span class="status-badge status-${req.status}">${req.status.toUpperCase()}</span></td>
            <td>${formatDate(req.created_at)}</td>
            <td>${formatDate(req.processed_at)}</td>
            <td>
                <button class="action-btn btn-view" onclick="viewDetails(${req.id})">View</button>
                <button class="action-btn btn-reject" onclick="deleteRequest(${req.id})">Delete</button>
            </td>
        </tr>
    `).join('');
}

// Show confirmation modal for deleting a request; actual delete performed by performDelete
let _pendingDeleteId = null;
function deleteRequest(requestId) {
    _pendingDeleteId = requestId;
    // Optionally update modal text with token / requester for clarity
    const req = allRequests.find(r => String(r.id) === String(requestId));
    const contentEl = document.getElementById('deleteConfirmContent');
    if (req && contentEl) {
        contentEl.innerHTML = `
            <p>Are you sure you want to permanently delete the request <strong>${req.request_token || ''}</strong> for <strong>${req.student_name || 'this requester'}</strong>? This action cannot be undone.</p>
        `;
    }

    // Show modal and bind confirm handler (one-time)
    const btn = document.getElementById('confirmDeleteBtn');
    const handler = async function () {
        btn.disabled = true;
        await performDelete(_pendingDeleteId);
        btn.disabled = false;
        btn.removeEventListener('click', handler);
    };
    btn.addEventListener('click', handler);
    document.getElementById('deleteConfirmModal').classList.add('show');
}

// Perform the actual DELETE request and update UI
async function performDelete(requestId) {
    try {
        const res = await fetch(`/api/guidance/document-requests/${requestId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });

        // Handle non-JSON responses gracefully
        const contentType = res.headers.get('content-type') || '';
        let data = null;
        if (contentType.includes('application/json')) {
            data = await res.json();
        } else {
            // If not JSON, try to read text for debugging
            const text = await res.text();
            console.error('Expected JSON response for delete, got:', text);
            showToast('Failed to delete request: unexpected server response', 'error');
            closeModal('deleteConfirmModal');
            return;
        }

        if (!res.ok || !data || !data.success) {
            const msg = (data && data.message) ? data.message : (data && data.error) ? data.error : 'Unknown error';
            showToast('Failed to delete request: ' + msg, 'error');
            closeModal('deleteConfirmModal');
            return;
        }

        // Remove from local cache and re-render tables
        allRequests = allRequests.filter(r => String(r.id) !== String(requestId));
        renderRequests();
        showToast('Request deleted successfully', 'success');
        closeModal('deleteConfirmModal');
    } catch (err) {
        console.error('Delete error:', err);
        showToast('An error occurred while deleting the request.', 'error');
        closeModal('deleteConfirmModal');
    }
}

function switchTab(tab) {
    currentTab = tab;
    
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    const tabMap = {
        'pending': 'pendingTab',
        'processing': 'processingTab',
        'ready': 'readyTab',
        'history': 'historyTab'
    };
    
    document.getElementById(tabMap[tab]).classList.add('active');
}

function filterRequests(tab) {
    const searchId = `search${tab.charAt(0).toUpperCase() + tab.slice(1)}`;
    const searchValue = document.getElementById(searchId).value.toLowerCase();
    
    let filterValue = '';
    if (tab === 'pending') {
        filterValue = document.getElementById('filterDocTypePending').value;
    } else if (tab === 'history') {
        filterValue = document.getElementById('filterStatusHistory').value;
    }
    
    const tbodyId = `${tab}TableBody`;
    const rows = document.querySelectorAll(`#${tbodyId} tr`);
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        const matchesSearch = text.includes(searchValue);
        
        let matchesFilter = true;
        if (filterValue) {
            matchesFilter = text.includes(filterValue.toLowerCase());
        }
        
        row.style.display = (matchesSearch && matchesFilter) ? '' : 'none';
    });
}

function viewDetails(requestId) {
    const request = allRequests.find(r => r.id === requestId);
    if (!request) return;
    
    const detailsHTML = `
        <div class="detail-grid">
            <div class="detail-item">
                <div class="detail-label">Tracking Token:</div>
                <div class="detail-value"><strong>${request.request_token}</strong></div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Status:</div>
                <div class="detail-value">
                    <span class="status-badge status-${request.status}">${request.status.toUpperCase()}</span>
                </div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Student Name:</div>
                <div class="detail-value">${request.student_name}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Student ID/LRN:</div>
                <div class="detail-value">${request.student_id || 'N/A'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Email:</div>
                <div class="detail-value">${request.email}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Contact Number:</div>
                <div class="detail-value">${request.contact_number}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Document Type:</div>
                <div class="detail-value">${request.document_type}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Purpose:</div>
                <div class="detail-value">${request.purpose}</div>
            </div>
            ${request.additional_notes ? `
            <div class="detail-item">
                <div class="detail-label">Additional Notes:</div>
                <div class="detail-value">${request.additional_notes}</div>
            </div>
            ` : ''}
            <div class="detail-item">
                <div class="detail-label">Adviser Name:</div>
                <div class="detail-value">${request.adviser_name || 'N/A'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">School Year:</div>
                <div class="detail-value">${request.adviser_school_year || 'N/A'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Requester Type:</div>
                <div class="detail-value">${request.student_type === 'student' ? 'Current Student' : 'Alumni'}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Request Date:</div>
                <div class="detail-value">${formatDateTime(request.created_at)}</div>
            </div>
            ${request.processed_at ? `
            <div class="detail-item">
                <div class="detail-label">Processed Date:</div>
                <div class="detail-value">${formatDateTime(request.processed_at)}</div>
            </div>
            ` : ''}
            ${request.completion_notes ? `
            <div class="detail-item">
                <div class="detail-label">Completion Notes:</div>
                <div class="detail-value">${request.completion_notes}</div>
            </div>
            ` : ''}
            ${request.rejection_reason ? `
            <div class="detail-item">
                <div class="detail-label">Rejection Reason:</div>
                <div class="detail-value" style="color: #c62828;">${request.rejection_reason}</div>
            </div>
            ` : ''}
        </div>
        <div class="modal-actions">
            ${request.status !== 'completed' && request.status !== 'rejected' ? 
                `<button class="btn-submit" onclick="closeModal('viewModal'); openStatusModal(${request.id})">Update Status</button>` : ''}
            <button class="btn-cancel" onclick="closeModal('viewModal')">Close</button>
        </div>
    `;
    
    document.getElementById('viewModalContent').innerHTML = detailsHTML;
    document.getElementById('viewModal').classList.add('show');
}

function openStatusModal(requestId) {
    const request = allRequests.find(r => r.id === requestId);
    if (!request) return;
    
    document.getElementById('requestId').value = requestId;
    document.getElementById('newStatus').value = '';
    document.getElementById('completionNotes').value = '';
    document.getElementById('rejectionReason').value = '';
    document.getElementById('rejectionGroup').classList.add('hidden');
    document.getElementById('notesGroup').classList.remove('hidden');
    
    document.getElementById('statusModal').classList.add('show');
}

async function handleStatusUpdate(e) {
    e.preventDefault();
    
    const requestId = document.getElementById('requestId').value;
    const newStatus = document.getElementById('newStatus').value;
    const completionNotes = document.getElementById('completionNotes').value;
    const rejectionReason = document.getElementById('rejectionReason').value;
    
    const data = {
        status: newStatus,
        completion_notes: newStatus === 'rejected' ? null : completionNotes,
        rejection_reason: newStatus === 'rejected' ? rejectionReason : null
    };
    
    try {
        const response = await fetch(`/api/guidance/document-requests/${requestId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeModal('statusModal');
            loadRequests(); // Reload data
            showToast('Status updated successfully!', 'success');
        } else {
            showToast('Error: ' + (result.message || 'Failed to update status'), 'error');
        }
    } catch (error) {
        console.error('Error updating status:', error);
        showToast('An error occurred while updating the status.', 'error');
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

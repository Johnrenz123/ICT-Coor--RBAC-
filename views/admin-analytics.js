// Shared client-side script for registrar & guidance analytics dashboards
(function(){
  const type = window.ANALYTICS_TYPE; // 'enrollment' or 'document_request'

  const el = id => document.getElementById(id);
  const statIds = [
    'success','duplicate','honeypot','rate_limited','suspicious','ip_blocked','validation_failed','error'
  ];

  async function fetchJSON(url, options={}) {
    const res = await fetch(url, Object.assign({ headers: { 'Accept': 'application/json','Content-Type':'application/json' }}, options));
    if(!res.ok) throw new Error('Request failed '+res.status);
    return res.json();
  }

  function formatDate(ts){
    const d = new Date(ts);
    return d.toLocaleString();
  }

  async function loadStats(){
    try {
      const data = await fetchJSON(`/api/analytics/stats?type=${encodeURIComponent(type)}`);
      const rows = (data && data.stats) ? data.stats : [];
      // Aggregate counts by status
      const counts = {};
      rows.forEach(r => {
        counts[r.status] = (counts[r.status] || 0) + parseInt(r.count || 0);
      });
      // Suspicious rows
      const suspiciousRows = (data && data.suspicious) ? data.suspicious : [];
      // Derive suspicious IP list
      const suspiciousIPs = suspiciousRows.map(r => r.ip_address);
      // Populate stat cards (default zero)
      statIds.forEach(s => {
        const box = el('stat-'+s);
        if(box) box.textContent = counts[s] || 0;
      });
      // For 'suspicious' card show number of suspicious IPs if no direct count
      const suspiciousBox = el('stat-suspicious');
      if(suspiciousBox && !counts['suspicious']) {
        suspiciousBox.textContent = suspiciousIPs.length;
      }
      renderSuspicious(suspiciousIPs);
    } catch(err){ console.error('[stats] error:', err); }
  }

  function renderSuspicious(list){
    const container = el('suspiciousList');
    if(!container) return;
    if(!list || !list.length){ container.textContent = 'None'; return; }
    container.innerHTML = '<ul style="margin:0; padding-left:18px;">'+list.map(ip => `<li>${ip}</li>`).join('')+'</ul>';
  }

  function buildLogRow(r){
    const token = r.request_token || '';
    return `<tr>
      <td>${formatDate(r.created_at)}</td>
      <td>${r.status}</td>
      <td>${r.email||''}</td>
      <td>${r.ip_address}</td>
      <td>${r.submission_type}</td>
      <td>${token}</td>
    </tr>`;
  }

  async function loadLogs(){
    console.log('[Analytics] Loading logs...');
    const email = el('filterEmail')?.value?.trim() || '';
    const ip = el('filterIP')?.value?.trim() || '';
  const status = el('filterStatus')?.value || '';
  const dateFrom = el('filterDateFrom')?.value || '';
  const dateTo = el('filterDateTo')?.value || '';
    const limit = el('limitSelect')?.value || '100';
    const params = new URLSearchParams();
    params.set('type', type);
    params.set('limit', limit);
    if(email) params.set('email', email);
    if(ip) params.set('ip', ip);
    if(status) params.set('status', status);
    try {
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const data = await fetchJSON('/api/analytics/submission-logs?'+params.toString());
      const rows = data.logs || [];
      console.log('[Analytics] Loaded', rows.length, 'logs');
      const tbody = el('logsTbody');
      if(!tbody) {
        console.error('[Analytics] logsTbody element not found!');
        return;
      }
      if(!rows.length){ tbody.innerHTML = '<tr><td colspan="6" class="muted">No logs</td></tr>'; return; }
      tbody.innerHTML = rows.map(buildLogRow).join('');
    } catch(err){ 
      console.error('[Analytics] logs error:', err);
      alert('Failed to load logs: ' + err.message);
    }
  }

  async function loadBlockedIPs(){
    try {
      const data = await fetchJSON('/api/security/blocked-ips');
      const list = data.blockedIPs || [];
      const container = el('blockedIpsList');
      if(!list.length){ container.textContent = 'None'; return; }
      container.innerHTML = '<table style="width:100%; border-collapse:collapse;">\n<thead><tr><th>IP</th><th>Reason</th><th>Blocked At</th><th>Expires</th><th>Blocked By</th><th>Action</th></tr></thead><tbody>'+
        list.map(b => `<tr>
          <td>${b.ip_address}</td>
          <td>${b.reason||''}</td>
          <td>${formatDate(b.blocked_at)}</td>
          <td>${b.expires_at?formatDate(b.expires_at):'—'}</td>
          <td>${b.blocked_by_name||b.blocked_by||''}</td>
          <td><button class="mini-unblock" data-ip="${b.ip_address}">Unblock</button></td>
        </tr>`).join('')+"</tbody></table>";
    } catch(err){ console.error('[blockedIPs] error:', err); }
  }

  async function blockIP(){
    const ip = el('blockIpAddress')?.value?.trim();
    const reason = el('blockReason')?.value?.trim() || 'Suspicious activity';
    const duration = el('blockDuration')?.value || '24';
    
    console.log('[Analytics] blockIP called:', { ip, reason, duration });
    
    if(!ip){ 
      alert('Please enter an IP address'); 
      return; 
    }
    
    try {
      console.log('[Analytics] Sending block request...');
      const result = await fetchJSON('/api/security/block-ip', {
        method:'POST',
        body: JSON.stringify({ ipAddress: ip, reason, duration })
      });
      console.log('[Analytics] Block successful:', result);
      
      if(el('blockIpAddress')) el('blockIpAddress').value = '';
      if(el('blockReason')) el('blockReason').value = '';
      loadBlockedIPs();
      alert('IP blocked successfully!');
    } catch(err){ 
      console.error('[Analytics] Block failed:', err);
      alert('Failed to block IP: ' + err.message); 
    }
  }

  async function unblockIP(ip){
    console.log('[Analytics] unblockIP called:', ip);
    try {
      console.log('[Analytics] Sending unblock request...');
      const result = await fetchJSON('/api/security/unblock-ip', {
        method:'POST',
        body: JSON.stringify({ ipAddress: ip })
      });
      console.log('[Analytics] Unblock successful:', result);
      loadBlockedIPs();
      alert('IP unblocked successfully!');
    } catch(err){ 
      console.error('[Analytics] Unblock failed:', err);
      alert('Failed to unblock IP: ' + err.message); 
    }
  }

  function wireEvents(){
    console.log('[Analytics] Wiring events...');
    const applyBtn = el('applyFiltersBtn');
    if(applyBtn) {
      console.log('[Analytics] Apply button found');
      applyBtn.addEventListener('click', () => {
        console.log('[Analytics] Apply clicked');
        loadLogs();
      });
    } else {
      console.error('[Analytics] Apply button NOT found');
    }
    
    const refreshBtn = el('refreshLogsBtn');
    if(refreshBtn) {
      console.log('[Analytics] Refresh button found');
      refreshBtn.addEventListener('click', () => {
        console.log('[Analytics] Refresh clicked');
        loadLogs();
      });
    } else {
      console.error('[Analytics] Refresh button NOT found');
    }
    
    const blockBtn = el('blockIpBtn');
    if(blockBtn) {
      console.log('[Analytics] Block IP button found');
      blockBtn.addEventListener('click', () => {
        console.log('[Analytics] Block IP clicked');
        blockIP();
      });
    } else {
      console.error('[Analytics] Block IP button NOT found');
    }
    
    document.body.addEventListener('click', e => {
      if(e.target.classList.contains('mini-block')){
        console.log('[Analytics] Mini-block clicked');
        const ip = e.target.getAttribute('data-ip');
        el('blockIpAddress').value = ip;
        el('blockReason').value = 'Rapid suspicious activity';
        el('blockDuration').value = '24';
        blockIP();
      }
      if(e.target.classList.contains('mini-unblock')){
        console.log('[Analytics] Mini-unblock clicked');
        const ip = e.target.getAttribute('data-ip');
        if(confirm('Unblock '+ip+'?')) unblockIP(ip);
      }
    });
  }

  function init(){
    console.log('[Analytics] Initializing... Type:', type);
    wireEvents();
    loadStats();
    loadLogs();
    loadBlockedIPs();
    // periodic refresh of stats every 60s
    setInterval(loadStats, 60000);
    console.log('[Analytics] Initialization complete');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already loaded
    init();
  }
})();

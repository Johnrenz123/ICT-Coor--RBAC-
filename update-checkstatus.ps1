$filePath = "C:\Users\John Renz\ICT-Coor--RBAC-\views\checkStatus.ejs"
$content = Get-Content $filePath -Raw

# Find the position where we need to insert the download section
$searchText = '<div class="alert alert-info py-2" role="alert">
          <strong>Reminder:</strong> Save your token. You''ll need it to check your enrollment status later.
        </div>

        <div class="row g-3 mb-3">'

$downloadSection = @'
<!-- Download/Copy Options -->
        <div class="card bg-light mb-4" style="border: 2px solid #e3f2fd;">
          <div class="card-body">
            <h6 class="card-title mb-3">📥 Download or Copy Your Form</h6>
            <div class="d-grid gap-2">
              <button type="button" class="btn btn-primary btn-sm" onclick="downloadEnrollment(''<%= request.request_token %>'', ''txt'')">
                📄 Download as Text
              </button>
              <button type="button" class="btn btn-primary btn-sm" onclick="downloadEnrollment(''<%= request.request_token %>'', ''json'')">
                📊 Download as JSON
              </button>
              <button type="button" class="btn btn-info btn-sm" onclick="copyFormToClipboard(''<%= request.request_token %>'')">
                📋 Copy to Clipboard
              </button>
            </div>
          </div>
        </div>

        <div class="row g-3 mb-3">'

$newContent = $content -replace [regex]::Escape($searchText), $downloadSection

# Update the script section
$scriptSearch = @'
  <script>
    document.addEventListener('DOMContentLoaded', function() {'@

$newScript = @'
  <script>
    // Download enrollment form
    function downloadEnrollment(token, format) {
      const url = `/download-enrollment/${token}?format=${format}`;
      const a = document.createElement('a');
      a.href = url;
      a.click();
    }

    // Copy form to clipboard
    function copyFormToClipboard(token) {
      fetch(`/api/enrollment/${token}`)
        .then(res => res.json())
        .then(data => {
          let text = `ENROLLMENT FORM COPY\n`;
          text += `====================\n`;
          for (const [key, value] of Object.entries(data)) {
            text += `${key}: ${value}\n`;
          }
          navigator.clipboard.writeText(text).then(() => {
            alert('Enrollment form copied to clipboard!');
          }).catch(err => {
            console.error('Failed to copy:', err);
            alert('Failed to copy to clipboard');
          });
        })
        .catch(err => {
          console.error('Error fetching form data:', err);
          alert('Error copying form data');
        });
    }

    document.addEventListener('DOMContentLoaded', function() {'@

$finalContent = $newContent -replace [regex]::Escape($scriptSearch), $newScript

Set-Content -Path $filePath -Value $finalContent
Write-Host "✅ checkStatus.ejs updated successfully!"

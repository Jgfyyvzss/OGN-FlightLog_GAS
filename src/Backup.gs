// Backup.gs - call via ?action=backup

function getBackupText() {
  const scriptId = ScriptApp.getScriptId();
  const token = ScriptApp.getOAuthToken();
  const url = 'https://script.google.com/feeds/download/export?id=' + scriptId + '&format=json';
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    muteHttpExceptions: true,
    followRedirects: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Export failed (' + response.getResponseCode() + '): ' + response.getContentText().substring(0, 300));
  }
  const json = JSON.parse(response.getContentText());
  return (json.files || []).map(function(f) {
    const ext = f.type === 'server_js' ? 'gs' : (f.type || 'txt');
    const bar = '='.repeat(60);
    return bar + '\n// FILE: ' + f.name + '.' + ext + '\n' + bar + '\n\n' + (f.source || '(empty)');
  }).join('\n\n\n');
}

function saveBackupToDoc() {
  const scriptId = ScriptApp.getScriptId();
  const token = ScriptApp.getOAuthToken();
  const url = 'https://script.google.com/feeds/download/export?id=' + scriptId + '&format=json';
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    muteHttpExceptions: true,
    followRedirects: true
  });
  const files = JSON.parse(response.getContentText()).files || [];
  const doc = DocumentApp.create('Script Backup ' + new Date().toISOString().substring(0, 10));
  const body = doc.getBody();
  body.clear();
  files.forEach(function(f) {
    const ext = f.type === 'server_js' ? 'gs' : (f.type || 'txt');
    const bar = '='.repeat(60);
    body.appendParagraph(bar + '\n// FILE: ' + f.name + '.' + ext + '\n' + bar);
    body.appendParagraph(f.source || '(empty)');
    body.appendParagraph('\n');
  });
  doc.saveAndClose();
  Logger.log('Done: ' + doc.getUrl());
}

function testBackup() {
  Logger.log(getBackupText());
}

function buildBackupPage() {
  var content = '';
  var error = '';
  try {
    content = getBackupText();
  } catch (e) {
    error = e.message;
  }
  var escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return '<!DOCTYPE html>' +
    '<html><head><style>' +
    'body{font-family:monospace;background:#1e1e1e;color:#d4d4d4;margin:0;padding:20px}' +
    'h2{color:#9cdcfe;margin-top:0}' +
    '#output{white-space:pre-wrap;background:#252526;padding:16px;border-radius:6px;' +
    'border:1px solid #3c3c3c;font-size:13px;line-height:1.5;overflow-x:auto}' +
    'button{background:#0e639c;color:white;border:none;padding:10px 20px;' +
    'font-size:14px;cursor:pointer;border-radius:4px;margin-bottom:16px}' +
    'button:hover{background:#1177bb}' +
    '#msg{color:#4ec9b0;margin-left:12px;font-size:13px}' +
    '.error{color:#f48771;padding:12px;background:#3c2020;border-radius:4px;margin-bottom:16px}' +
    '</style></head><body>' +
    '<h2>Script Backup</h2>' +
    (error ? '<div class="error">Error: ' + error + '</div>' : '') +
    (content ? '<button onclick="copyAll()">Copy All to Clipboard</button><span id="msg"></span>' : '') +
    '<div id="output">' + escaped + '</div>' +
    '<script>function copyAll(){var text=document.getElementById("output").innerText;' +
    'navigator.clipboard.writeText(text).then(function(){var m=document.getElementById("msg");' +
    'm.textContent="Copied!";setTimeout(function(){m.textContent=""},2000)})}<\/script>' +
    '</body></html>';
}

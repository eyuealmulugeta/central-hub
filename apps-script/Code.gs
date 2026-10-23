// Google Apps Script for Central Hub. Deployed as a web app, it does two things
// for the app, both guarded by the same shared secret:
//
//   1. saves backup files into a Drive folder          (no "action" in the request); keeps the last 8 weekly copies
//   2. emails a document as a PDF attachment           (action: 'email')
//
// Script Properties required (Project Settings > Script properties):
//   TOKEN     = your shared secret (the "Shared secret" typed in Central Hub, Backup)
//   FOLDER_ID = ID of the Drive folder (the part after /folders/ in its URL)
// Optional:
//   SENDER_NAME = the name recipients see, for example "Amistad Prefab"
//
// After pasting a new version: Deploy > Manage deployments > pencil > Version: New version > Deploy.
// The first time the email part runs, Google asks you to allow the script to send email as you.
// Emails are sent from the Google account that owns this script. A consumer Gmail account
// may send to about 100 recipients a day through a script.

var MAX_RECIPIENTS = 5;
var MAX_FILES = 5;                       // PDF files added by hand, besides the document itself
var MAX_FILE_BYTES = 15 * 1024 * 1024;   // all of them together

var WEEKLY_PREFIX = 'central-hub-weekly-';   // the weekly full copies Central Hub sends by itself
var WEEKLY_KEEP = 8;                          // how many are kept; older ones go to the Drive bin (restorable for 30 days)

/** Keep the newest WEEKLY_KEEP weekly copies in the folder; move the older ones to the bin. Other files are never touched. */
function pruneWeekly_(folder) {
  const list = [];
  const it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); if (f.getName().indexOf(WEEKLY_PREFIX) === 0) list.push(f); }
  list.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  list.slice(WEEKLY_KEEP).forEach(function (f) { f.setTrashed(true); });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const body = JSON.parse(e.postData.contents);

    if (!body.token || body.token !== props.getProperty('TOKEN')) {
      return json_({ ok: false, error: 'unauthorized' });
    }
    if (body.action === 'email') return sendEmail_(props, body);
    if (body.action === 'ping') return json_({ ok: true, email: true, quota: MailApp.getRemainingDailyQuota() });

    const folder = DriveApp.getFolderById(props.getProperty('FOLDER_ID'));
    const name = String(body.name || 'file_' + Date.now()).replace(/[\\/:*?"<>|]/g, '_');
    const mime = body.mimeType || 'application/octet-stream';
    const bytes = Utilities.base64Decode(body.dataBase64);
    const file = folder.createFile(Utilities.newBlob(bytes, mime, name));
    if (name.indexOf(WEEKLY_PREFIX) === 0) pruneWeekly_(folder);

    return json_({ ok: true, id: file.getId(), url: file.getUrl(), name: file.getName() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** Split "a@x.com, b@y.com" into checked addresses, or throw naming the bad one. */
function addresses_(value) {
  const list = String(value || '').split(/[,;\s]+/).filter(function (s) { return s; });
  list.forEach(function (a) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) throw new Error('Not an email address: ' + a);
  });
  return list;
}

function escape_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Body: { action: 'email', token, to, cc, subject, message, html, filename, files }
 *   message   the covering note, plain text
 *   html      the whole document as one HTML page; it is turned into a PDF attachment (optional)
 *   filename  name of that attachment, without ".pdf"
 *   files     further PDF files to attach: [{ name, dataBase64 }] (optional)
 */
function sendEmail_(props, body) {
  const to = addresses_(body.to);
  const cc = addresses_(body.cc);
  if (!to.length) throw new Error('Enter who the email is for.');
  if (to.length + cc.length > MAX_RECIPIENTS) throw new Error('No more than ' + MAX_RECIPIENTS + ' recipients in one email.');
  const subject = String(body.subject || '').trim();
  if (!subject) throw new Error('The email needs a subject.');
  if (MailApp.getRemainingDailyQuota() < to.length + cc.length) throw new Error('Google\'s daily email limit for this account has been reached. Try again tomorrow.');

  const message = String(body.message || '');
  const options = {
    to: to.join(','),
    subject: subject,
    body: message,
    htmlBody: '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2328">'
      + escape_(message).replace(/\n/g, '<br>') + '</div>',
  };
  if (cc.length) options.cc = cc.join(',');
  const sender = props.getProperty('SENDER_NAME');
  // the name shown as sender: the person who pressed Send in Central Hub, then the company (Script property SENDER_NAME)
  const person = String(body.fromName || '').replace(/[\r\n<>"]+/g, ' ').trim().slice(0, 60);
  const shown = person ? (sender ? person + ', ' + sender : person) : sender;
  if (shown) options.name = shown;
  // replies go to that person's address when Central Hub says so, else to the Script property REPLY_TO (for example info@amistadprefab.com)
  const asked = String(body.replyTo || '').trim();
  const replyTo = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(asked) ? asked : props.getProperty('REPLY_TO');
  if (replyTo) options.replyTo = replyTo;

  const attachments = [];
  if (body.html) {
    const name = String(body.filename || 'document').replace(/[\\/:*?"<>|]/g, '_');
    attachments.push(Utilities.newBlob(String(body.html), 'text/html', name + '.html').getAs('application/pdf').setName(name + '.pdf'));
  }
  const files = body.files || [];
  if (files.length > MAX_FILES) throw new Error('No more than ' + MAX_FILES + ' files can be added to one email.');
  let size = 0;
  files.forEach(function (f) {
    const bytes = Utilities.base64Decode(String(f.dataBase64 || ''));
    // every PDF file starts with the characters %PDF
    if (bytes.length < 5 || bytes[0] !== 37 || bytes[1] !== 80 || bytes[2] !== 68 || bytes[3] !== 70) throw new Error('Not a PDF file: ' + f.name);
    size += bytes.length;
    if (size > MAX_FILE_BYTES) throw new Error('The added files are too large together. The limit is 15 MB.');
    const name = String(f.name || 'attachment.pdf').replace(/[\\/:*?"<>|]/g, '_');
    attachments.push(Utilities.newBlob(bytes, 'application/pdf', /\.pdf$/i.test(name) ? name : name + '.pdf'));
  });
  if (attachments.length) options.attachments = attachments;
  // With the Script property FROM_ADDRESS (an address added in Gmail under Settings, Accounts, Send mail as, and verified) the email is sent
  // from that address instead of the Gmail address. It needs Google's permission to use Gmail once, when the script is deployed again.
  const from = props.getProperty('FROM_ADDRESS');
  if (from) {
    const gmail = { cc: options.cc, htmlBody: options.htmlBody, name: options.name, replyTo: options.replyTo, from: from, attachments: options.attachments };
    Object.keys(gmail).forEach(function (k) { if (gmail[k] === undefined) delete gmail[k]; });
    GmailApp.sendEmail(options.to, options.subject, options.body, gmail);
  } else {
    MailApp.sendEmail(options);
  }
  const names = attachments.map(function (a) { return a.getName(); });
  return json_({ ok: true, to: to, cc: cc, attached: names.join(', '), attachments: names, quota: MailApp.getRemainingDailyQuota() });
}

function doGet() {
  return json_({ ok: true, status: 'alive' });
}

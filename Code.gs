/**
 * 一斉メール送信システム - Google Apps Script
 *
 * executeAs : USER_ACCESSING（アクセスしたユーザーのGmail・権限で動作）
 * access    : ANYONE（URLを知っていれば誰でも使用可能）
 *
 * 認証チェックは doGet() でサーバー側に一元化。
 * 未承認ユーザーには承認ページを返す。承認済みなら直接アプリを返す。
 */

// ============================================================
// スプレッドシート設定（固定）
// ============================================================

var SPREADSHEET_ID = '1jvt9gzQDxIrwTr4gwZS1Umhu1CULhi8GMKd8F1UFTKQ';
var SHEET_NAME     = 'メールアドレス一覧';

// ============================================================
// Web アプリ エントリポイント
// ============================================================

/**
 * GETリクエストのエントリポイント。
 * 未承認ユーザーには承認ページを、承認済みにはアプリを返す。
 */
function doGet(e) {
  // 承認状態を確認
  var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  var needsAuth = authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED;

  if (needsAuth) {
    // 未承認 → 承認ページを返す
    var authUrl = authInfo.getAuthorizationUrl();
    return buildAuthPage_(authUrl);
  }

  // 承認済み → アプリ本体を返す
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('一斉メール送信システム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 承認ページのHTMLを生成する
 * @private
 */
function buildAuthPage_(authUrl) {
  var html = '<!DOCTYPE html><html lang="ja"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>承認が必要です</title>' +
    '<style>' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'font-family:"Helvetica Neue",Arial,"Hiragino Kaku Gothic ProN",Meiryo,sans-serif;' +
    'background:#F9FAFB;}' +
    '.card{text-align:center;padding:48px 36px;background:#fff;border-radius:12px;' +
    'box-shadow:0 10px 15px rgba(0,0,0,.1);max-width:400px;width:90%;}' +
    '.icon{font-size:3rem;margin-bottom:16px;}' +
    'h2{margin:0 0 10px;color:#111827;font-size:1.3rem;}' +
    'p{color:#6B7280;font-size:0.875rem;line-height:1.7;margin-bottom:8px;}' +
    '.scopes{background:#F3F4F6;border-radius:8px;padding:12px 16px;text-align:left;' +
    'margin:16px 0 24px;font-size:0.82rem;color:#374151;}' +
    '.scopes li{list-style:none;padding:3px 0;}' +
    '.scopes li::before{content:"✅ ";}' +
    '.btn{display:inline-block;padding:13px 28px;background:#4F46E5;color:#fff;' +
    'border-radius:8px;text-decoration:none;font-weight:700;font-size:0.95rem;' +
    'transition:background .2s;}' +
    '.btn:hover{background:#4338CA;}' +
    '</style></head><body>' +
    '<div class="card">' +
    '<div class="icon">🔐</div>' +
    '<h2>アプリの承認が必要です</h2>' +
    '<p>初回利用時にGoogleアカウントの<br>承認が必要です。</p>' +
    '<div class="scopes"><ul>' +
    '<li>Gmailでの下書き作成・送信</li>' +
    '<li>Googleスプレッドシートの閲覧</li>' +
    '<li>メールアドレスの確認</li>' +
    '</ul></div>' +
    '<a href="' + authUrl + '" class="btn">Googleで承認する →</a>' +
    '<p style="margin-top:16px;font-size:0.78rem;color:#9CA3AF;">' +
    '承認後、自動的にアプリに戻ります</p>' +
    '</div></body></html>';

  return HtmlService.createHtmlOutput(html).setTitle('一斉メール送信システム');
}

// ============================================================
// 認証・ユーザー情報（承認済み前提で呼ばれる）
// ============================================================

/**
 * ログイン中のユーザーのメールアドレスを返す
 * @returns {{ email: string }}
 */
function getAuthInfo() {
  var email = Session.getEffectiveUser().getEmail();
  return { email: email || '' };
}

// ============================================================
// スプレッドシート読み込み
// ============================================================

var NAME_KEYWORDS  = ['名前', 'name', '氏名', '姓名', 'お名前', 'フルネーム', '担当者'];
var EMAIL_KEYWORDS = ['メールアドレス', 'email', 'mail', 'e-mail', 'メール', 'アドレス', 'address'];

function findColumnIndex_(headers, keywords) {
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i].toLowerCase();
    for (var j = 0; j < keywords.length; j++) {
      if (h.indexOf(keywords[j].toLowerCase()) !== -1) return i;
    }
  }
  return -1;
}

/**
 * 固定スプレッドシートから宛先リストを読み込む
 */
function loadRecipients() {
  var ss;
  try {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    throw new Error('スプレッドシートを開けませんでした。\n詳細: ' + e.message);
  }

  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    var names = ss.getSheets().map(function(s){ return s.getName(); }).join(', ');
    throw new Error('シート「' + SHEET_NAME + '」が見つかりません。\n存在するシート: ' + names);
  }

  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    throw new Error('シートにデータがありません（ヘッダー行のみ、または空）');
  }

  var headers   = data[0].map(function(h){ return String(h || '').trim(); });
  var nameIdx   = findColumnIndex_(headers, NAME_KEYWORDS);
  var emailIdx  = findColumnIndex_(headers, EMAIL_KEYWORDS);

  if (nameIdx === -1) {
    throw new Error('「名前」列が見つかりません。\n現在のヘッダー: ' + headers.join(', '));
  }
  if (emailIdx === -1) {
    throw new Error('「メールアドレス」列が見つかりません。\n現在のヘッダー: ' + headers.join(', '));
  }

  var recipients = [];
  for (var i = 1; i < data.length; i++) {
    var name  = String(data[i][nameIdx]  || '').trim();
    var email = String(data[i][emailIdx] || '').trim();
    if (!name && !email) continue;
    if (!email || email.indexOf('@') === -1) continue;
    recipients.push({ name: name, email: email });
  }

  if (recipients.length === 0) {
    throw new Error('有効な宛先が1件も見つかりませんでした');
  }

  return {
    recipients:  recipients,
    total:       recipients.length,
    sheetTitle:  sheet.getName(),
    nameColumn:  headers[nameIdx],
    emailColumn: headers[emailIdx]
  };
}

// ============================================================
// メール構築
// ============================================================

function buildHtmlBody_(recipientName, bodyText, imageBase64) {
  var bodyHtml = bodyText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  var imageSection = imageBase64
    ? '<div style="margin-top:24px;text-align:center;">' +
      '<img src="' + imageBase64 + '" style="max-width:100%;height:auto;" alt="添付画像"/></div>'
    : '';

  return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body>' +
    '<div style="font-family:\'Helvetica Neue\',Arial,Meiryo,sans-serif;' +
    'max-width:600px;margin:0 auto;padding:20px;color:#333;">' +
    '<p style="margin-bottom:16px;">' + recipientName + '様</p>' +
    '<div style="line-height:1.8;">' + bodyHtml + '</div>' +
    imageSection +
    '</div></body></html>';
}

function stripHtml_(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .trim();
}

// ============================================================
// テストメール送信
// ============================================================

function sendTestEmail(params) {
  var htmlBody = buildHtmlBody_(
    params.previewName || 'テスト受信者',
    params.body,
    params.imageBase64 || null
  );
  try {
    GmailApp.sendEmail(
      params.to,
      '[テスト] ' + params.subject,
      stripHtml_(htmlBody),
      { htmlBody: htmlBody }
    );
  } catch (e) {
    throw new Error('メール送信に失敗しました: ' + e.message);
  }
  return { success: true };
}

// ============================================================
// 下書き一斉作成（バッチ）
// ============================================================

function createDraftBatch(params) {
  var recipients = params.recipients;
  var subject    = params.subject;
  var body       = params.body;
  var imageBase64 = params.imageBase64 || null;
  var success = 0;
  var errors  = [];

  for (var i = 0; i < recipients.length; i++) {
    var r = recipients[i];
    try {
      var htmlBody = buildHtmlBody_(r.name, body, imageBase64);
      GmailApp.createDraft(r.email, subject, stripHtml_(htmlBody), { htmlBody: htmlBody });
      success++;
    } catch (e) {
      errors.push({ name: r.name, email: r.email, error: e.message });
      Logger.log('下書き作成エラー [%s]: %s', r.email, e.message);
    }
    if (i < recipients.length - 1) Utilities.sleep(100);
  }

  return { success: success, failed: errors.length, errors: errors };
}

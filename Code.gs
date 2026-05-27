/**
 * 一斉メール送信システム - Google Apps Script
 *
 * executeAs : USER_ACCESSING（アクセスしたユーザーのGmail・権限で動作）
 * access    : ANYONE（URLを知っていれば誰でも使用可能）
 *
 * ★ 初回アクセス時はOAuth承認が必要。フロントで承認URLを案内する。
 */

// ============================================================
// スプレッドシート設定（固定）
// ============================================================

/** 宛先管理スプレッドシートID */
const SPREADSHEET_ID_ = '1jvt9gzQDxIrwTr4gwZS1Umhu1CULhi8GMKd8F1UFTKQ';
/** 宛先管理シート名 */
const SHEET_NAME_ = 'メールアドレス一覧';

// ============================================================
// Web アプリ エントリポイント
// ============================================================

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('一斉メール送信システム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// 認証状態チェック（フロントが最初に呼ぶ）
// ============================================================

/**
 * ユーザーの OAuth 承認状態を確認する。
 * 未承認の場合は承認URLを返す（フロントでボタン表示）。
 *
 * @returns {{ authorized: boolean, email?: string, authUrl?: string }}
 */
function getAuthStatus() {
  try {
    const authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    const isRequired =
      authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED;

    if (isRequired) {
      return { authorized: false, authUrl: authInfo.getAuthorizationUrl() };
    }

    const email = Session.getEffectiveUser().getEmail();
    return { authorized: true, email: email || '' };

  } catch (e) {
    // 承認チェック自体が失敗した場合（まれ）
    return { authorized: false, authUrl: '', error: e.message };
  }
}

// ============================================================
// スプレッドシート読み込み
// ============================================================

/** 名前列として認識するキーワード */
const NAME_KEYWORDS_  = ['名前', 'name', '氏名', '姓名', 'お名前', 'フルネーム', '担当者'];
/** メールアドレス列として認識するキーワード */
const EMAIL_KEYWORDS_ = ['メールアドレス', 'email', 'mail', 'e-mail', 'メール', 'アドレス', 'address'];

/**
 * ヘッダー行からキーワードにマッチする列インデックスを返す
 */
function findColumnIndex_(headers, keywords) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (keywords.some(kw => h.includes(kw.toLowerCase()))) return i;
  }
  return -1;
}

/**
 * 固定スプレッドシートから宛先リストを読み込む
 * @returns {{ recipients, total, sheetTitle, nameColumn, emailColumn }}
 */
function loadRecipients() {
  // --- スプレッドシートを開く ---
  let ss;
  try {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID_);
  } catch (e) {
    // 生のエラーメッセージをそのまま返すことで原因を特定しやすくする
    throw new Error('スプレッドシートを開けませんでした。\n詳細: ' + e.message);
  }

  // --- シートを名前で取得 ---
  const sheet = ss.getSheetByName(SHEET_NAME_);
  if (!sheet) {
    const sheetNames = ss.getSheets().map(s => s.getName()).join(', ');
    throw new Error(
      'シート「' + SHEET_NAME_ + '」が見つかりません。\n' +
      '存在するシート: ' + sheetNames
    );
  }

  // --- データ取得 ---
  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    throw new Error('シートにデータが1件もありません（ヘッダー行のみ、または空）');
  }

  // --- ヘッダー解析 ---
  const headers  = data[0].map(h => String(h || '').trim());
  const nameIdx  = findColumnIndex_(headers, NAME_KEYWORDS_);
  const emailIdx = findColumnIndex_(headers, EMAIL_KEYWORDS_);

  if (nameIdx === -1) {
    throw new Error(
      '「名前」列が見つかりません。\n' +
      'ヘッダーに「名前」「name」「氏名」などを含めてください。\n' +
      '現在のヘッダー: ' + headers.join(', ')
    );
  }
  if (emailIdx === -1) {
    throw new Error(
      '「メールアドレス」列が見つかりません。\n' +
      'ヘッダーに「メールアドレス」「email」「mail」などを含めてください。\n' +
      '現在のヘッダー: ' + headers.join(', ')
    );
  }

  // --- データ行を解析 ---
  const recipients = [];
  for (let i = 1; i < data.length; i++) {
    const name  = String(data[i][nameIdx]  || '').trim();
    const email = String(data[i][emailIdx] || '').trim();
    if (!name && !email) continue;
    if (!email || !email.includes('@')) {
      Logger.log('行 %s をスキップ（無効なアドレス: %s）', i + 1, email);
      continue;
    }
    recipients.push({ name, email });
  }

  if (recipients.length === 0) {
    throw new Error('有効な宛先が1件も見つかりませんでした');
  }

  return {
    recipients,
    total: recipients.length,
    sheetTitle: sheet.getName(),
    nameColumn: headers[nameIdx],
    emailColumn: headers[emailIdx],
  };
}

// ============================================================
// メール構築（共通）
// ============================================================

function buildHtmlBody_(recipientName, bodyText, imageBase64) {
  const bodyHtml = bodyText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  const imageSection = imageBase64
    ? '<div style="margin-top:24px;text-align:center;">' +
      '<img src="' + imageBase64 + '" style="max-width:100%;height:auto;" alt="添付画像"/>' +
      '</div>'
    : '';

  return '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body>' +
    '<div style="font-family:\'Helvetica Neue\',Arial,\'Hiragino Kaku Gothic ProN\',Meiryo,sans-serif;' +
    'max-width:600px;margin:0 auto;padding:20px;color:#333;">' +
    '<p style="margin-bottom:16px;">' + recipientName + '様</p>' +
    '<div style="line-height:1.8;">' + bodyHtml + '</div>' +
    imageSection +
    '</div></body></html>';
}

function stripHtml_(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim();
}

// ============================================================
// テストメール送信
// ============================================================

/**
 * テストメールを送信する（送信者 = アクセスしたユーザー）
 */
function sendTestEmail(params) {
  const htmlBody = buildHtmlBody_(
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

/**
 * 下書きをバッチ作成する（送信者 = アクセスしたユーザー）
 * フロントエンドから10件ずつ繰り返し呼ばれる。
 */
function createDraftBatch(params) {
  const { recipients, subject, body, imageBase64 } = params;
  let success = 0;
  const errors = [];

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    try {
      const htmlBody = buildHtmlBody_(r.name, body, imageBase64 || null);
      GmailApp.createDraft(
        r.email,
        subject,
        stripHtml_(htmlBody),
        { htmlBody: htmlBody }
      );
      success++;
    } catch (e) {
      errors.push({ name: r.name, email: r.email, error: e.message });
      Logger.log('下書き作成エラー [%s]: %s', r.email, e.message);
    }
    if (i < recipients.length - 1) Utilities.sleep(100);
  }

  return { success, failed: errors.length, errors };
}

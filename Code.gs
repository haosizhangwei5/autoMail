/**
 * 一斉メール送信システム - Google Apps Script
 * executeAs: USER_ACCESSING（アクセス者のGmail・Sheetsを使用）
 */

// ============================================================
// Web アプリ エントリポイント
// ============================================================

/**
 * GETリクエストでHTMLページを返す
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('一斉メール送信システム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// 認証・ユーザー情報
// ============================================================

/**
 * ログイン中のユーザー情報を返す
 * @returns {{ email: string }}
 */
function getAuthInfo() {
  const email = Session.getEffectiveUser().getEmail();
  if (!email) throw new Error('ユーザー情報を取得できませんでした。再読み込みしてください。');
  return { email };
}

// ============================================================
// スプレッドシート読み込み
// ============================================================

/** 名前列として認識するキーワード */
const NAME_KEYWORDS_ = ['名前', 'name', '氏名', '姓名', 'お名前', 'フルネーム', '担当者'];
/** メールアドレス列として認識するキーワード */
const EMAIL_KEYWORDS_ = ['メールアドレス', 'email', 'mail', 'e-mail', 'メール', 'アドレス', 'address'];

/**
 * SpreadsheetのURLまたはIDからIDを抽出する
 * @param {string} input
 * @returns {string}
 */
function extractSpreadsheetId_(input) {
  const urlMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[a-zA-Z0-9\-_]+$/.test(input.trim())) return input.trim();
  throw new Error('スプレッドシートのURLまたはIDの形式が正しくありません');
}

/**
 * ヘッダー行からキーワードにマッチする列インデックスを返す
 * @param {string[]} headers
 * @param {string[]} keywords
 * @returns {number} インデックス（見つからない場合-1）
 */
function findColumnIndex_(headers, keywords) {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (keywords.some(kw => h.includes(kw.toLowerCase()))) return i;
  }
  return -1;
}

/**
 * スプレッドシートから宛先リストを読み込む
 * @param {string} spreadsheetInput - URLまたはID
 * @returns {{ recipients: Array<{name:string, email:string}>, total:number, sheetTitle:string, nameColumn:string, emailColumn:string }}
 */
function loadRecipients(spreadsheetInput) {
  const id = extractSpreadsheetId_(spreadsheetInput);

  let ss;
  try {
    ss = SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error(
      'スプレッドシートを開けません。URLを確認するか、このGoogleアカウントに共有されているか確認してください。'
    );
  }

  const sheet = ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();

  if (!data || data.length === 0) {
    throw new Error('スプレッドシートにデータが見つかりません');
  }

  const headers = data[0].map(h => String(h || '').trim());
  const nameIdx  = findColumnIndex_(headers, NAME_KEYWORDS_);
  const emailIdx = findColumnIndex_(headers, EMAIL_KEYWORDS_);

  if (nameIdx === -1) {
    throw new Error(
      '「名前」列が見つかりません。1行目のヘッダーに「名前」「name」「氏名」などを含めてください。\n' +
      '検出されたヘッダー: ' + headers.join(', ')
    );
  }
  if (emailIdx === -1) {
    throw new Error(
      '「メールアドレス」列が見つかりません。1行目のヘッダーに「メールアドレス」「email」などを含めてください。\n' +
      '検出されたヘッダー: ' + headers.join(', ')
    );
  }

  const recipients = [];
  for (let i = 1; i < data.length; i++) {
    const name  = String(data[i][nameIdx]  || '').trim();
    const email = String(data[i][emailIdx] || '').trim();
    if (!name && !email) continue; // 空行スキップ
    if (!email || !email.includes('@')) {
      Logger.log('行 %s: 無効なメールアドレス「%s」をスキップ', i + 1, email);
      continue;
    }
    recipients.push({ name, email });
  }

  if (recipients.length === 0) {
    throw new Error('有効な宛先が1件も見つかりませんでした。スプレッドシートのデータを確認してください。');
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
// メール構築
// ============================================================

/**
 * HTMLメール本文を生成する
 * @param {string} recipientName - 受信者名
 * @param {string} bodyText - 本文（改行区切り）
 * @param {string|null} imageBase64 - data:image/...;base64,... 形式
 * @returns {string} HTML文字列
 */
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

  return '<!DOCTYPE html>\n' +
    '<html lang="ja"><head><meta charset="UTF-8"></head><body>\n' +
    '<div style="font-family:\'Helvetica Neue\',Arial,\'Hiragino Kaku Gothic ProN\',Meiryo,sans-serif;' +
    'max-width:600px;margin:0 auto;padding:20px;color:#333;">\n' +
    '  <p style="margin-bottom:16px;">' + recipientName + '様</p>\n' +
    '  <div style="line-height:1.8;">' + bodyHtml + '</div>\n' +
    imageSection + '\n' +
    '</div>\n' +
    '</body></html>';
}

/**
 * HTMLタグを除去したプレーンテキストを返す（GmailApp の body 引数用）
 * @param {string} html
 * @returns {string}
 */
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
 * テストメールを実際に送信する
 * @param {{ to:string, subject:string, body:string, imageBase64:string|null, previewName:string }} params
 * @returns {{ success:boolean, message:string }}
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

  return { success: true, message: params.to + ' へ送信しました' };
}

// ============================================================
// 下書き一斉作成（バッチ処理）
// ============================================================

/**
 * 宛先リストの一部（バッチ）の下書きをまとめて作成する。
 * フロントエンドから10件ずつ繰り返し呼ばれる。
 *
 * @param {{ recipients: Array<{name:string, email:string}>, subject:string, body:string, imageBase64:string|null }} params
 * @returns {{ success:number, failed:number, errors:Array<{name:string, email:string, error:string}> }}
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

    // APIレート制限対策（最後の1件以外は100ms待機）
    if (i < recipients.length - 1) {
      Utilities.sleep(100);
    }
  }

  return { success, failed: errors.length, errors };
}

'use strict';

const { google } = require('googleapis');

// 名前列として認識するキーワード（小文字で比較）
const NAME_KEYWORDS = ['名前', 'name', '氏名', '姓名', 'お名前', 'フルネーム', '担当者'];

// メールアドレス列として認識するキーワード（小文字で比較）
const EMAIL_KEYWORDS = ['メールアドレス', 'email', 'mail', 'e-mail', 'メール', 'アドレス', 'address'];

/**
 * スプレッドシートURLまたはIDからスプレッドシートIDを抽出する
 * @param {string} input - URLまたはID文字列
 * @returns {string} スプレッドシートID
 */
function extractSpreadsheetId(input) {
  // URLからIDを抽出
  const urlMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) return urlMatch[1];

  // IDとして直接使用（英数字・ハイフン・アンダースコアのみ）
  if (/^[a-zA-Z0-9-_]+$/.test(input.trim())) return input.trim();

  throw new Error('スプレッドシートのURLまたはIDの形式が正しくありません');
}

/**
 * ヘッダー行から列インデックスを検索する
 * @param {string[]} headers - ヘッダー行の配列
 * @param {string[]} keywords - 検索キーワード配列
 * @returns {number} 列インデックス（見つからない場合は -1）
 */
function findColumnIndex(headers, keywords) {
  return headers.findIndex((header) =>
    keywords.some((kw) => header.toLowerCase().includes(kw.toLowerCase()))
  );
}

/**
 * スプレッドシートから宛先リストを読み込む
 * @param {google.auth.OAuth2} authClient - 認証済みOAuth2クライアント
 * @param {string} spreadsheetInput - スプレッドシートのURLまたはID
 * @returns {Promise<{ recipients: Array<{name: string, email: string}>, total: number, sheetTitle: string }>}
 */
async function loadRecipients(authClient, spreadsheetInput) {
  const spreadsheetId = extractSpreadsheetId(spreadsheetInput);

  const sheets = google.sheets({ version: 'v4', auth: authClient });

  // スプレッドシートのメタデータを取得（シート名確認）
  const metaRes = await sheets.spreadsheets.get({ spreadsheetId });
  const firstSheet = metaRes.data.sheets[0];
  const sheetTitle = firstSheet.properties.title;

  // データを取得（最大1000行）
  const range = `${sheetTitle}!A1:Z1000`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });

  const rows = res.data.values;
  if (!rows || rows.length === 0) {
    throw new Error('スプレッドシートにデータが見つかりません');
  }

  // ヘッダー行の解析
  const headers = rows[0].map((h) => String(h || '').trim());

  const nameIdx = findColumnIndex(headers, NAME_KEYWORDS);
  const emailIdx = findColumnIndex(headers, EMAIL_KEYWORDS);

  if (nameIdx === -1) {
    throw new Error(
      `「名前」列が見つかりません。列名に「名前」「name」「氏名」などを含めてください。\n検出されたヘッダー: ${headers.join(', ')}`
    );
  }
  if (emailIdx === -1) {
    throw new Error(
      `「メールアドレス」列が見つかりません。列名に「メールアドレス」「email」「mail」などを含めてください。\n検出されたヘッダー: ${headers.join(', ')}`
    );
  }

  // データ行を解析（空行はスキップ）
  const recipients = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = String(row[nameIdx] || '').trim();
    const email = String(row[emailIdx] || '').trim();

    // 名前またはメールアドレスが空の行はスキップ
    if (!name && !email) continue;

    // 簡易メールアドレスバリデーション
    if (!email || !email.includes('@')) {
      console.warn(`行 ${i + 1}: 無効なメールアドレス「${email}」をスキップしました`);
      continue;
    }

    recipients.push({ name, email });
  }

  if (recipients.length === 0) {
    throw new Error('有効な宛先が1件も見つかりませんでした。スプレッドシートのデータを確認してください');
  }

  return {
    recipients,
    total: recipients.length,
    sheetTitle,
    nameColumn: headers[nameIdx],
    emailColumn: headers[emailIdx],
  };
}

module.exports = {
  extractSpreadsheetId,
  loadRecipients,
};

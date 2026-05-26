'use strict';

const { google } = require('googleapis');

/**
 * 件名を RFC 2047 形式（UTF-8 Base64）にエンコードする
 * @param {string} subject - 件名文字列
 * @returns {string} エンコードされた件名
 */
function encodeSubject(subject) {
  // ASCII文字のみの場合はそのまま返す
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  const encoded = Buffer.from(subject, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

/**
 * HTMLメールのMIMEメッセージを構築する
 * @param {object} options
 * @param {string} options.from - 送信元アドレス
 * @param {string} options.to - 宛先アドレス
 * @param {string} options.subject - 件名
 * @param {string} options.htmlBody - HTMLボディ
 * @returns {string} Base64URLエンコードされたRawメッセージ
 */
function buildRawMessage({ from, to, subject, htmlBody }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const encodedSubject = encodeSubject(subject);

  // テキスト版（HTMLのタグを除去した簡易版）
  const textBody = htmlBody
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

  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(textBody, 'utf-8').toString('base64'),
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(htmlBody, 'utf-8').toString('base64'),
    ``,
    `--${boundary}--`,
  ];

  const rawMessage = lines.join('\r\n');
  // Base64URL エンコード（Gmail API が要求する形式）
  return Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * HTMLメール本文を構築する
 * @param {string} recipientName - 受信者名
 * @param {string} bodyText - 本文テキスト（改行を<br>に変換）
 * @param {string|null} imageBase64 - 画像のBase64文字列（data:image/...;base64,... 形式）
 * @returns {string} HTML文字列
 */
function buildHtmlBody(recipientName, bodyText, imageBase64) {
  // 改行を <br> に変換
  const bodyHtml = bodyText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  const imageSection = imageBase64
    ? `<div style="margin-top: 24px; text-align: center;">
        <img src="${imageBase64}" style="max-width: 100%; height: auto;" alt="添付画像" />
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"></head>
<body>
<div style="font-family: 'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', Meiryo, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <p style="margin-bottom: 16px;">${recipientName}様</p>
  <div style="line-height: 1.8;">${bodyHtml}</div>
  ${imageSection}
</div>
</body>
</html>`;
}

/**
 * Gmail 下書きを作成する
 * @param {google.auth.OAuth2} authClient - 認証済みOAuth2クライアント
 * @param {object} options
 * @param {string} options.from - 送信元アドレス
 * @param {string} options.to - 宛先アドレス
 * @param {string} options.recipientName - 受信者名
 * @param {string} options.subject - 件名
 * @param {string} options.bodyText - 本文テキスト
 * @param {string|null} [options.imageBase64] - 画像Base64
 * @returns {Promise<object>} 作成された下書きオブジェクト
 */
async function createDraft(authClient, { from, to, recipientName, subject, bodyText, imageBase64 }) {
  const gmail = google.gmail({ version: 'v1', auth: authClient });
  const htmlBody = buildHtmlBody(recipientName, bodyText, imageBase64 || null);
  const raw = buildRawMessage({ from, to, subject, htmlBody });

  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw },
    },
  });

  return res.data;
}

/**
 * テストメールを実際に送信する
 * @param {google.auth.OAuth2} authClient - 認証済みOAuth2クライアント
 * @param {object} options
 * @param {string} options.from - 送信元アドレス
 * @param {string} options.to - 宛先アドレス
 * @param {string} options.recipientName - 受信者名（プレビュー用）
 * @param {string} options.subject - 件名
 * @param {string} options.bodyText - 本文テキスト
 * @param {string|null} [options.imageBase64] - 画像Base64
 * @returns {Promise<object>} 送信結果
 */
async function sendMail(authClient, { from, to, recipientName, subject, bodyText, imageBase64 }) {
  const gmail = google.gmail({ version: 'v1', auth: authClient });
  const htmlBody = buildHtmlBody(recipientName, bodyText, imageBase64 || null);
  const raw = buildRawMessage({ from, to, subject, htmlBody });

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return res.data;
}

/**
 * 複数の下書きを順次作成する（レート制限対策: 100ms間隔）
 * @param {google.auth.OAuth2} authClient - 認証済みOAuth2クライアント
 * @param {object} options
 * @param {string} options.from - 送信元アドレス
 * @param {Array<{name: string, email: string}>} options.recipients - 宛先リスト
 * @param {string} options.subject - 件名
 * @param {string} options.bodyText - 本文テキスト
 * @param {string|null} [options.imageBase64] - 画像Base64
 * @param {Function} options.onProgress - 進捗コールバック (index, total, recipient)
 * @returns {Promise<{ success: number, failed: number, errors: Array }>}
 */
async function createDrafts(authClient, { from, recipients, subject, bodyText, imageBase64, onProgress }) {
  let success = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i];
    try {
      await createDraft(authClient, {
        from,
        to: recipient.email,
        recipientName: recipient.name,
        subject,
        bodyText,
        imageBase64: imageBase64 || null,
      });
      success++;
    } catch (err) {
      failed++;
      errors.push({
        index: i + 1,
        name: recipient.name,
        email: recipient.email,
        error: err.message,
      });
      console.error(`下書き作成エラー [${recipient.email}]:`, err.message);
    }

    // 進捗通知
    if (typeof onProgress === 'function') {
      onProgress(i + 1, recipients.length, recipient);
    }

    // APIレート制限対策: 最後の1件以外は100ms待機
    if (i < recipients.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return { success, failed, errors };
}

module.exports = {
  buildHtmlBody,
  buildRawMessage,
  createDraft,
  sendMail,
  createDrafts,
};

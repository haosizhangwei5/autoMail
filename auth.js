'use strict';

const { google } = require('googleapis');

// OAuth2 スコープ
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * OAuth2 クライアントを生成する
 * @returns {google.auth.OAuth2}
 */
function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/**
 * Google 認証URLを生成する
 * @returns {string} 認証URL
 */
function getAuthUrl() {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // リフレッシュトークンを必ず取得
  });
}

/**
 * 認証コードからトークンを取得し、セッションに保存する
 * @param {string} code - OAuth コールバックで受け取ったコード
 * @param {object} session - Express セッションオブジェクト
 * @returns {Promise<google.auth.OAuth2>} 認証済みクライアント
 */
async function getTokenFromCode(code, session) {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // セッションにトークンを保存
  session.tokens = tokens;

  // ユーザーのメールアドレスを取得して保存
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  session.userEmail = data.email;

  return oauth2Client;
}

/**
 * セッションからOAuth2クライアントを復元する
 * @param {object} session - Express セッションオブジェクト
 * @returns {google.auth.OAuth2 | null} 認証済みクライアント、未認証の場合はnull
 */
function getAuthClientFromSession(session) {
  if (!session.tokens) return null;

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials(session.tokens);

  // トークンリフレッシュ時にセッションを更新
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      session.tokens.refresh_token = tokens.refresh_token;
    }
    session.tokens.access_token = tokens.access_token;
    session.tokens.expiry_date = tokens.expiry_date;
  });

  return oauth2Client;
}

/**
 * 認証済みかどうかを確認する
 * @param {object} session - Express セッションオブジェクト
 * @returns {boolean}
 */
function isAuthenticated(session) {
  return !!(session && session.tokens);
}

module.exports = {
  getAuthUrl,
  getTokenFromCode,
  getAuthClientFromSession,
  isAuthenticated,
};

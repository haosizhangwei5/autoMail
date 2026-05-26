'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const { getAuthUrl, getTokenFromCode, getAuthClientFromSession, isAuthenticated } = require('./auth');
const { loadRecipients } = require('./sheets');
const { createDrafts, sendMail } = require('./gmail');

const app = express();
const PORT = process.env.PORT || 3000;

// ミドルウェア設定
app.use(express.json({ limit: '50mb' })); // 画像Base64のため大きめに設定
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'default-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // localhost開発時はHTTP
      maxAge: 24 * 60 * 60 * 1000, // 24時間
    },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// 認証エンドポイント
// ============================================================

// OAuth認証開始
app.get('/auth', (req, res) => {
  const authUrl = getAuthUrl();
  res.redirect(authUrl);
});

// OAuth コールバック
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('OAuth エラー:', error);
    return res.redirect('/?error=auth_failed');
  }

  if (!code) {
    return res.redirect('/?error=no_code');
  }

  try {
    await getTokenFromCode(code, req.session);
    res.redirect('/');
  } catch (err) {
    console.error('トークン取得エラー:', err);
    res.redirect('/?error=token_failed');
  }
});

// ログアウト
app.get('/auth/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ============================================================
// API エンドポイント
// ============================================================

// 認証状態確認
app.get('/api/auth/status', (req, res) => {
  if (!isAuthenticated(req.session)) {
    return res.json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    email: req.session.userEmail || '不明',
  });
});

// スプレッドシート読み込み
app.post('/api/sheets/load', async (req, res) => {
  if (!isAuthenticated(req.session)) {
    return res.status(401).json({ error: 'Googleアカウントでログインしてください' });
  }

  const { spreadsheetId } = req.body;
  if (!spreadsheetId) {
    return res.status(400).json({ error: 'スプレッドシートのURLまたはIDを入力してください' });
  }

  try {
    const authClient = getAuthClientFromSession(req.session);
    const result = await loadRecipients(authClient, spreadsheetId);
    res.json({
      success: true,
      recipients: result.recipients,
      total: result.total,
      sheetTitle: result.sheetTitle,
      nameColumn: result.nameColumn,
      emailColumn: result.emailColumn,
    });
  } catch (err) {
    console.error('スプレッドシート読み込みエラー:', err);
    const message = err.message || 'スプレッドシートの読み込みに失敗しました';
    // Google APIエラーの場合はわかりやすいメッセージに変換
    if (err.code === 403) {
      return res.status(403).json({
        error: 'スプレッドシートへのアクセス権がありません。共有設定を確認してください',
      });
    }
    if (err.code === 404) {
      return res.status(404).json({
        error: 'スプレッドシートが見つかりません。URLまたはIDを確認してください',
      });
    }
    res.status(500).json({ error: message });
  }
});

// テストメール送信
app.post('/api/mail/test', async (req, res) => {
  if (!isAuthenticated(req.session)) {
    return res.status(401).json({ error: 'Googleアカウントでログインしてください' });
  }

  const { to, subject, body, imageBase64, previewName } = req.body;

  if (!to || !subject || !body) {
    return res.status(400).json({ error: '宛先・件名・本文はすべて必須です' });
  }

  // 簡易メールアドレスバリデーション
  if (!to.includes('@')) {
    return res.status(400).json({ error: '有効なメールアドレスを入力してください' });
  }

  try {
    const authClient = getAuthClientFromSession(req.session);
    const from = req.session.userEmail;
    const recipientName = previewName || 'テスト受信者';

    await sendMail(authClient, {
      from,
      to,
      recipientName,
      subject: `[テスト] ${subject}`,
      bodyText: body,
      imageBase64: imageBase64 || null,
    });

    res.json({
      success: true,
      message: `テストメールを ${to} に送信しました`,
    });
  } catch (err) {
    console.error('テストメール送信エラー:', err);
    res.status(500).json({
      error: `テストメールの送信に失敗しました: ${err.message}`,
    });
  }
});

// 一斉下書き作成（Server-Sent Events でリアルタイム進捗）
app.post('/api/mail/drafts', async (req, res) => {
  if (!isAuthenticated(req.session)) {
    return res.status(401).json({ error: 'Googleアカウントでログインしてください' });
  }

  const { recipients, subject, body, imageBase64 } = req.body;

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: '宛先リストが空です。スプレッドシートを読み込んでください' });
  }
  if (!subject || !body) {
    return res.status(400).json({ error: '件名と本文は必須です' });
  }

  // Server-Sent Events ヘッダー設定
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const authClient = getAuthClientFromSession(req.session);
    const from = req.session.userEmail;

    sendEvent({ type: 'start', total: recipients.length });

    const result = await createDrafts(authClient, {
      from,
      recipients,
      subject,
      bodyText: body,
      imageBase64: imageBase64 || null,
      onProgress: (current, total, recipient) => {
        sendEvent({
          type: 'progress',
          current,
          total,
          recipient: { name: recipient.name, email: recipient.email },
        });
      },
    });

    sendEvent({
      type: 'complete',
      success: result.success,
      failed: result.failed,
      errors: result.errors,
    });
  } catch (err) {
    console.error('下書き一斉作成エラー:', err);
    sendEvent({
      type: 'error',
      error: `下書きの作成中にエラーが発生しました: ${err.message}`,
    });
  } finally {
    res.end();
  }
});

// ============================================================
// サーバー起動
// ============================================================

app.listen(PORT, () => {
  console.log('========================================');
  console.log('  一斉メール送信システム 起動中');
  console.log(`  URL: http://localhost:${PORT}`);
  console.log('========================================');

  // 環境変数チェック
  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'your_google_client_id_here') {
    console.warn('\n⚠️  警告: GOOGLE_CLIENT_ID が設定されていません');
    console.warn('   .env ファイルを作成して環境変数を設定してください');
    console.warn('   設定方法は README.md を参照してください\n');
  }
});

一斉メール送信システム — CLAUDE.md
プロジェクト概要
Googleスプレッドシートに記載された宛先リストへ、パーソナライズされたHTMLメールを一斉送信するWebアプリ。 Gmail APIを使って下書き保存し、Gmail上で送信予約（時間指定）を行う方式を採用する。


技術スタック
レイヤー
技術
フロントエンド
HTML / CSS / Vanilla JS（単一ファイル）
バックエンド
Node.js + Express
Google連携
Google Sheets API v4 / Gmail API v1
認証
OAuth 2.0（googleapis ライブラリ）
環境変数管理
dotenv



ディレクトリ構成
project/

├── CLAUDE.md              # このファイル

├── .env                   # 環境変数（要作成・gitignore対象）

├── .env.example           # 環境変数テンプレート

├── .gitignore

├── package.json

├── server.js              # Expressサーバー + APIエンドポイント

├── auth.js                # Google OAuth2 認証モジュール

├── sheets.js              # Google Sheets API モジュール

├── gmail.js               # Gmail API モジュール（下書き作成）

└── public/

    └── index.html         # フロントエンド（単一ファイル）


機能要件
1. スプレッドシート読み込み
フォームにスプレッドシートのURLまたはIDを入力
1行目をヘッダー行とみなし、名前 と メールアドレス 列を自動検出
読み込んだ宛先一覧をプレビュー表示（送信対象の確認）
2. メール作成
件名：自由入力
本文：テキストエリア（複数行対応）
本文先頭に {名前}様\n\n を自動付与（送信時に各受信者の名前へ置換）
画像添付：ファイル選択 → HTMLメールのボディ末尾にインライン表示（Base64埋め込み）
リアルタイムHTMLプレビュー
3. テストメール送信
テスト送信先メールアドレスを入力（デフォルト：OAuth認証アカウント）
テストメールは宛先リストの1件目の名前でプレビュー送信（実際に送信）
テスト送信完了後、「確認済み」チェックボックスが出現
チェックしないと「本番送信」ボタンが押せない
4. 一斉下書き作成（本番送信）
確認済みチェック後に「下書き一斉作成」ボタンが活性化
宛先リスト全員分の下書きをGmail APIで作成
進捗バー表示（〇件 / 全〇件）
完了後、Gmailの下書き画面へのリンクを表示
ユーザーはGmail上で下書きを選択し「送信日時を指定」で予約送信
5. レスポンシブUI
PC・スマホ両対応（モバイルファースト設計）
ステップ形式のUI（① 宛先読込 → ② メール作成 → ③ テスト送信 → ④ 下書き作成）


APIエンドポイント設計
メソッド
パス
説明
GET
/auth
OAuth認証開始（Googleログイン）
GET
/auth/callback
OAuth コールバック
GET
/api/auth/status
認証状態確認
POST
/api/sheets/load
スプレッドシート読み込み
POST
/api/mail/test
テストメール送信
POST
/api/mail/drafts
一斉下書き作成



環境変数（.env）
GOOGLE_CLIENT_ID=your_client_id

GOOGLE_CLIENT_SECRET=your_client_secret

GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

SESSION_SECRET=any_random_string

PORT=3000


Google Cloud Console 設定（事前に必要）
Google Cloud Console でプロジェクト作成
以下のAPIを有効化：
Google Sheets API
Gmail API
OAuth 2.0 クライアントID作成（アプリの種類：Webアプリケーション）
承認済みリダイレクトURIに http://localhost:3000/auth/callback を追加
クライアントIDとシークレットを .env に設定


Gmail API スコープ
https://www.googleapis.com/auth/gmail.compose

https://www.googleapis.com/auth/spreadsheets.readonly

※ gmail.compose は下書き作成・送信のみ許可。受信トレイへのアクセスなし。


メールHTML構造
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">

  <p>{名前}様</p>

  <div>{本文}</div>

  <!-- 画像がある場合 -->

  <div style="margin-top: 24px;">

    <img src="data:image/...;base64,..." style="max-width:100%;" />

  </div>

</div>


実装上の注意事項
レート制限：Gmail APIは1秒あたり約10リクエスト。下書き作成は setTimeout で100msずつ間隔を開けること
Base64画像：フロントで FileReader を使いBase64変換し、サーバーへJSON送信
セッション管理：express-session でOAuthトークンをサーバーサイドで保持
エラーハンドリング：各APIエラーを捕捉し、フロントへわかりやすいメッセージで返す
文字コード：件名は =?UTF-8?B?...?= でBase64エンコード（日本語対応）
MIMEメッセージ：GmailのRAW形式で送信。mailcomposer または手動で構築


禁止事項・制約
.env はgitignoreに含め、リポジトリへコミットしない
認証情報をフロントエンドのコードに直接書かない
本番環境ではHTTPS必須（localhost開発時はHTTP可）


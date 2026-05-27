# 一斉メール送信システム（Google Apps Script版）

GoogleスプレッドシートとGmailをGoogle Apps Script（GAS）だけで動かすWebアプリです。  
サーバー不要・無料・Googleアカウントだけで動作します。

## 機能

- 📊 スプレッドシートのURLを貼るだけで宛先リストを自動取得
- ✍️ HTMLメール作成（リアルタイムプレビュー・画像添付対応）
- 📨 テスト送信で内容確認
- 🚀 Gmail下書きを10件ずつバッチ作成・進捗リアルタイム表示
- 📅 Gmailの「送信日時を指定」で一括予約送信

---

## デプロイ方法

### 方法A：ブラウザのみで設定（推奨・簡単）

#### 1. Google Apps Script プロジェクトを作成

1. [script.google.com](https://script.google.com) を開く
2. 「新しいプロジェクト」をクリック
3. プロジェクト名を「auto-mail」などに変更

#### 2. ファイルを貼り付ける

**`コード.gs`（デフォルトのファイル）の中身を `Code.gs` の内容に置き換える:**
- エディタ左の「コード.gs」をクリック
- 中身を全選択して削除
- `Code.gs` の内容をコピー＆ペースト

**`index.html` を追加する:**
- エディタ左の「＋」→「HTML」→ファイル名を `index` に設定
- `index.html` の内容をコピー＆ペースト

**`appsscript.json` を編集する:**
- エディタ左のメニュー「プロジェクトの設定」→「appsscript.jsonマニフェストファイルをエディタで表示する」をオン
- `appsscript.json` が左メニューに出たらクリック
- 内容を `appsscript.json` の内容に置き換える

#### 3. Webアプリとしてデプロイ

1. 右上「デプロイ」→「新しいデプロイ」
2. 種類: **ウェブアプリ**
3. 次のユーザーとして実行: **自分（ウェブアプリにアクセスしているユーザー）**  
   → ※「USER_ACCESSING」設定により、アクセスした人のGmail・Sheetsが使われます
4. アクセスできるユーザー: **Googleアカウントを持つ全員**（または自分のみ）
5. 「デプロイ」→ 初回は権限承認が求められるので「許可」
6. 表示された **ウェブアプリURL** をブックマーク ✅

---

### 方法B：claspでCLIから自動デプロイ

#### 1. claspのインストール
```bash
npm install -g @google/clasp
clasp login
```

#### 2. GASプロジェクト作成
[script.google.com](https://script.google.com) で新規プロジェクトを作り、
プロジェクト設定からスクリプトID（`scriptId`）をコピー。

#### 3. `.clasp.json` を編集
```json
{
  "scriptId": "コピーしたスクリプトID",
  "rootDir": "."
}
```

#### 4. プッシュ＆デプロイ
```bash
clasp push
clasp deploy --description "v1"
```

---

## スプレッドシートの形式

| 名前 | メールアドレス |
|------|-------------|
| 山田太郎 | yamada@example.com |
| 鈴木花子 | suzuki@example.com |

- **1行目はヘッダー行**（データは2行目から）
- 名前列: `名前` `name` `氏名` `姓名` などを自動検出
- メールアドレス列: `メールアドレス` `email` `mail` などを自動検出
- スプレッドシートはアクセスしたGoogleアカウントから見えるものを使用

---

## 使い方

| ステップ | 操作 |
|---------|------|
| ① 宛先読込 | スプレッドシートのURLを貼り付けて「読み込む」 |
| ② メール作成 | 件名・本文入力、画像添付（任意）、プレビュー確認 |
| ③ テスト送信 | テスト送信先を入力 → 送信 → 受信確認 → チェック |
| ④ 下書き作成 | 「下書きを一斉作成する」→ 完了後にGmailで予約送信 |

---

## 注意事項

- `executeAs: USER_ACCESSING` のため、アクセスしたGoogleアカウントのGmail・Sheetsを使用します
- GmailのAPIレート制限対策として100ms間隔（10件ずつバッチ処理）を設けています
- 画像Base64が大きい場合（目安5MB以上）、GASの制限によりエラーになる場合があります
- GASの1回の実行時間上限は6分（通常の利用では問題なし）
- OAuth同意画面が「テスト」状態の場合は、テストユーザーとして登録したアカウントのみ使用可能

---

## ファイル構成

```
auto-mail/
├── Code.gs           # サーバーサイドロジック（GAS）
├── index.html        # フロントエンドUI（GAS HtmlService）
├── appsscript.json   # GASマニフェスト（スコープ・デプロイ設定）
├── .clasp.json       # clasp CLIの設定（scriptIdを設定）
├── .gitignore
└── README.md
```

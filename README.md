# 🎯 StudyCommander — 学習司令塔

**試験日までに終わらせるため、教材量と実績から毎日の勉強計画を自動で再設計するPWA。**

ただのToDo・カレンダー・勉強記録アプリではありません。「予定はズレる」前提で設計されており、実績を記録するたびに残りの計画全体を組み直します。

- 📱 iPhone / iPad / Androidスマホ・タブレット向けに最適化(PC専用UIなし)
- 🏠 ホーム画面に追加するとネイティブアプリのように動作(PWA / オフライン起動対応)
- 🔑 username / password だけのシンプルなアカウント制(メール認証・OAuth・2FAなし)
- ☁️ データはCloudflare D1(アカウントに紐づくクラウドDB)に保存、オフライン時は端末に一時保存して復帰後に自動同期
- 🚀 Cloudflare Pages + Pages Functions + D1 でそのまま公開可能

---

## 主な機能

| 画面 | 内容 |
| --- | --- |
| **今日** | 試験日カウントダウン、達成率リング、最優先タスク、今すぐ開始、未達成タスク、復習期限、一言分析 |
| **計画** | 1週間の学習ブロック(科目色分け・固定予定・空き時間)、タスク移動・時間変更、「今日は無理」「今週を再設計」 |
| **教材** | 総量・進捗・残り量・今日の目安・完了見込み日・遅れ/順調/危険の状態表示、追加・編集・削除 |
| **記録** | タイマー/手動の学習ログ、予定vs実績グラフ、科目別時間、連続学習日数、週・月合計 |
| **分析** | 試験日までに終わる見込み、不足時間、科目バランス、要注意科目ランキング、教材別完了予測、学習ヒートマップ、実データからの自動改善コメント |
| **タイマー** | 全画面集中モード → 終了後3タップで記録 → 教材進捗・復習タスク・計画に自動反映 |

### 自動スケジューリング
- 教材の残り量から学習タスク(25〜90分のコマ)を自動生成
- 優先度スコア = 試験切迫度 + 目標完了日切迫度 + 科目重要度 + 苦手度 + 教材優先度 + 遅れ具合 + 復習期限 + 過去の正答率/達成率(`src/lib/scheduler.ts`)
- 固定予定(学校・塾など)を避けて配置、1日の上限・同一科目の連続・1科目の占有率を制御
- 未達成タスクは「翌日に積む」のではなく**全体を再計算**して吸収
- 残り学習量が確保可能時間を超えるとキャパシティ警告

### 復習システム(忘却曲線)
- タスク完了時に 1 → 3 → 7 → 14 → 30日後 の復習を段階的に自動生成
- 正答率が低い→間隔短縮+間違い直しタスク生成、高い→間隔延長、難教材→復習1回追加(`src/lib/review.ts`)

---

## アカウントとデータの仕組み

- 初回はログイン/新規登録画面が表示されます。必要な入力は **username(3〜24文字)** と **password(4文字以上)** のみ
- パスワードはサーバー側で **salt + PBKDF2(SHA-256, 10万回)ハッシュ化**して保存し、平文は保持しません
- ログイン状態は `HttpOnly; Secure; SameSite=Lax; Path=/` のセッションCookie(有効期限30日)で管理し、トークンやパスワードをlocalStorageに保存することはありません
- ログイン後、学習データ(AppState)はCloudflare D1に保存され、**D1が正データ**として扱われます
- ログイン前に端末内に既存データがある場合は、初回ログイン時に自動でD1へ移行されます
- オフライン中の変更は端末内に一時保存され、オンライン復帰後に自動でD1へ同期されます(設定画面に同期状態を表示)
- メール認証・パスワード再設定・2FA・OAuth・管理者機能・課金機能はありません(シンプルな個人用アカウントのみ)

---

## 起動方法(ローカル)

```bash
npm install
npm run dev        # http://localhost:5173/ (フロントエンドのみ、/api は動きません)
```

```bash
npm run build      # dist/ を生成(型チェック込み)
npm run preview    # ビルド結果をプレビュー
npx vite-node scripts/smoke.ts   # スケジューラー/復習/分析ロジックのスモークテスト
npm run typecheck:functions      # Pages Functions (functions/) の型チェック
```

`/api/*` を含めてフルスタックでローカル確認したい場合は下記の「Cloudflare Pages + D1 で公開する」を参照してください(`npm run pages:dev` でWrangler経由のローカル実行ができます)。

## スマホのホーム画面に追加(PWA)

- **iPhone / iPad**: Safariで開く → 共有ボタン → 「ホーム画面に追加」
- **Android**: Chromeで開く → メニュー → 「アプリをインストール」

standalone表示・セーフエリア(ノッチ/Dynamic Island/ホームバー)・オフライン起動に対応しています。

---

## Cloudflare Pages + D1 で公開する

### 1. D1データベースを作成する

```bash
npx wrangler login
npx wrangler d1 create studycommander-db
```

出力された `database_id` を `wrangler.toml` の `REPLACE_WITH_YOUR_D1_DATABASE_ID` に貼り付けます。

### 2. スキーマを適用する

```bash
npm run d1:schema          # 本番(--remote)に users / sessions / user_data テーブルを作成
npm run d1:schema:local    # ローカル(wrangler pages dev)用に作成する場合
```

### 3. Cloudflare Pagesプロジェクトを作成してGitHub連携する

1. Cloudflareダッシュボード → **Workers & Pages → Create → Pages → Connect to Git** でこのリポジトリを選択
2. ビルド設定
   - Build command: `npm run build`
   - Build output directory: `dist`
3. **Settings → Functions → D1 database bindings** で 変数名 `DB` として手順1で作成したデータベースを紐付ける(`wrangler.toml` の `[[d1_databases]]` を認識しない場合はここで必ず設定してください)
4. `main` ブランチへのプッシュで自動ビルド&デプロイされます(GitHub Actionsは不要です)

### 4. ローカルでAPIごと動作確認する

```bash
npm run pages:dev   # ビルド後、wrangler pages dev で /api を含めてローカル起動
```

---

## データについて

- ログイン後の学習データはCloudflare D1(アカウント単位)に保存されます
- オフライン時は端末内に一時保存し、オンライン復帰後に自動で同期します
- 設定(⚙️)から **JSONエクスポート/インポート**(バックアップ用)と**初期化**が可能
- 初回オンボーディングでは「自分のデータを作る」か「デモデータで試す」を選択可能(デモは設定画面に明示されます)

## 技術構成

```
src/
├── types/        全データ型 (AppState, Material, StudyTask, StudySession, ...)
├── lib/
│   ├── scheduler.ts   優先度スコア・自動配置・再スケジューリング・キャパシティ計算
│   ├── review.ts      忘却曲線ベースの復習タスク生成
│   ├── analytics.ts   進捗予測・科目統計・自動コメント生成
│   ├── storage.ts     localStorage永続化(オフラインキャッシュ) + エクスポート/インポート
│   ├── api.ts         /api/* へのfetchクライアント
│   └── date.ts        日付ユーティリティ
├── state/        AppContext (学習データ、D1同期) / AuthContext (ログイン状態)
├── data/         デモデータ・デフォルト設定
├── screens/      ログイン・今日・計画・教材・記録・分析・オンボーディング・設定
└── components/   タイマー・記録フォーム・カード・UI部品・ナビ

functions/
├── api/auth/     register / login / logout / me (Cloudflare Pages Functions)
├── api/data.ts   学習データ(AppState)のGET/PUT
└── _shared/      パスワードハッシュ・セッションCookie・D1アクセスの共通処理

schema/schema.sql  D1テーブル定義 (users / sessions / user_data)
wrangler.toml      Cloudflare Pages / D1 バインディング設定
```

- React 18 + TypeScript(strict) + Vite
- Cloudflare Pages Functions + D1(サーバーレスAPI、Web Crypto APIによるPBKDF2ハッシュ)
- チャートは自作SVG(外部チャートライブラリなし)
- vite-plugin-pwa(Workbox)によるオフラインキャッシュ

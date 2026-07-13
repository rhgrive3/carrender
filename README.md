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
| **今日** | 試験日カウントダウン、達成率リング、最優先タスク、今すぐ開始、未達成タスク、一言分析 |
| **計画** | 1週間の学習ブロック(科目色分け・固定予定・空き時間)、タスク移動・時間変更、「今日は無理」「今週を再設計」 |
| **教材** | 総量・進捗・残り量・今日の目安・完了見込み日・遅れ/順調/危険の状態表示、追加・編集・削除 |
| **記録** | タイマー/手動の学習ログ、予定vs実績グラフ、科目別時間、連続学習日数、週・月合計 |
| **分析** | 試験日までに終わる見込み、不足時間、科目バランス、要注意科目ランキング、教材別完了予測、学習ヒートマップ、実データからの自動改善コメント |
| **タイマー** | 全画面集中モード(ストップウォッチ / 🍅ポモドーロ) → 終了後3タップで記録 → 教材進捗・復習タスク・計画に自動反映 |
| **暗記** | ローカルファーストの英語暗記カード。セット・カード編集、復習、成績分析、JSON入出力、端末間同期と競合確認 |

### タイマー・モチベーション機能
- **ポモドーロ**: 集中/休憩/長い休憩を自動サイクル(分数・回数は設定で変更可)。休憩を除いた実勉強時間だけが記録される
- **フェーズ切替の合図**: チャイム(WebAudio合成)・バイブレーション・通知(許可制)
- **環境音**: ホワイトノイズ / 雨音をその場で合成(音源ファイル不要・オフラインOK)
- **画面消灯防止**: タイマー中はScreen Wake Lockで画面をつけたまま(設定でオフ可)
- **フリータイマー**: 計画にない勉強も科目を選ぶだけで即計測(今日画面のタイマーアイコン)
- **週間目標**: 週の目標学習時間を設定すると記録画面に進捗バーを表示
- **実績バッジ**: 累計時間・連続日数・朝型・復習・教材完走など17種(すべて実データから毎回計算)
- **シェア画像**: 今日の学習記録を1080×1350のPNGに生成してSNS共有(Web Share API / ダウンロード)
- **CSVエクスポート**: 学習ログをExcelで開けるCSVで書き出し(設定 → データ管理)

### 自動スケジューリング
- 教材の残り量から学習タスク(25〜90分のコマ)を自動生成
- 優先度スコア = 試験切迫度 + 目標完了日切迫度 + 科目重要度 + 苦手度 + 教材優先度 + 遅れ具合 + タスク期限 + 過去の達成率(`src/lib/scheduler.ts`)
- 固定予定(学校・塾など)を避けて配置、1日の上限・同一科目の連続・1科目の占有率を制御
- 未達成タスクは「翌日に積む」のではなく**全体を再計算**して吸収
- 残り学習量が確保可能時間を超えるとキャパシティ警告

### 復習システム(忘却曲線)
- タスク完了時に 1 → 3 → 7 → 14 → 30日後 の復習を段階的に自動生成
- 難教材は復習を1回追加(`src/lib/review.ts`)

---

## アカウントとデータの仕組み

- 初回はログイン/新規登録画面が表示されます。必要な入力は **username(3〜24文字)** と **password(4文字以上)** のみ
- パスワードはサーバー側で **salt + PBKDF2(SHA-256, 10万回)ハッシュ化**して保存し、平文は保持しません
- ログイン状態は `HttpOnly; Secure; SameSite=Lax; Path=/` のセッションCookie(有効期限30日)で管理し、トークンやパスワードをlocalStorageに保存することはありません
- ログイン後、学習データ(AppState)はCloudflare D1に保存され、**D1が正データ**として扱われます
- ログイン前に端末内に既存データがある場合は、初回ログイン時に自動でD1へ移行されます
- オフライン中の変更は端末内に一時保存され、オンライン復帰後に自動でD1へ同期されます(設定画面に同期状態を表示)。別端末更新との競合では、古い端末キャッシュでクラウドを自動上書きしません
- 暗記カードはIndexedDBへ先に保存し、カード編集は即時、回答ログは20件ごと(セッション完了時・オンライン復帰時は即時)にD1へ同期します
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

## スマホのホーム画面に追加(PWA) — 任意

ホーム画面に追加すると、全画面表示・高速起動・オフライン起動が利用できます。ブラウザからもそのまま利用でき、インストールは必須ではありません。

- **iPhone / iPad**: Safariで開く → 共有ボタン → 「ホーム画面に追加」
- **Android**: 「ホーム画面に追加する」ボタン1タップでインストール(`beforeinstallprompt`)
- **LINE等のアプリ内ブラウザ**: 追加不可のため、Safari/Chromeで開き直す手順とURLコピーを案内
- **デスクトップ**: インストール可能な場合のみ非ブロッキングのバナーを表示

standalone表示・セーフエリア(ノッチ/Dynamic Island/ホームバー)・オフライン起動に対応しています。

開発・検証用: 通常はインストールゲートを表示しません。`?pwa-gate=on` で互換用の案内画面を強制表示、`?pwa-gate=off` で明示的に無効化できます(`src/lib/pwa.ts`)。

---

## Cloudflare Pages + D1 で公開する

### 1. D1データベースを作成する

```bash
npx wrangler login
npx wrangler d1 create studycommander-db
```

出力された `database_id` を `wrangler.toml` の `REPLACE_WITH_YOUR_D1_DATABASE_ID` に貼り付けます。

### 2. スキーマとmigrationを適用する

```bash
npm run d1:schema          # 本番(--remote)に users / sessions / user_data テーブルを作成
npm run d1:schema:local    # ローカル(wrangler pages dev)用に作成する場合
npm run d1:migrate         # 本番へ既存migrationを適用(暗記カード機能に必須)
npm run d1:migrate:local   # ローカルD1へmigrationを適用
```

既に本番DBを作成済みの場合も、暗記カード同期を使う前に必ず `npm run d1:migrate` を実行してください。`migrations/0002_memory.sql` が未適用だと暗記同期APIは利用できません。

### 3. Cloudflare Pagesプロジェクトを作成してGitHub連携する

1. Cloudflareダッシュボード → **Workers & Pages → Create → Pages → Connect to Git** でこのリポジトリを選択
2. ビルド設定
   - Build command: `npm run build`
   - Build output directory: `dist`
3. **Settings → Functions → D1 database bindings** で 変数名 `DB` として手順1で作成したデータベースを紐付ける(`wrangler.toml` の `[[d1_databases]]` を認識しない場合はここで必ず設定してください)
4. `main` ブランチへのプッシュで自動ビルド&デプロイされます(GitHub Actionsは不要です)

GitHub ActionsのCIは、pushとPull Requestごとにlint・型検査・ユニット/回帰テスト・本番ビルドを実行します。

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
├── api/memory/    暗記カードの差分同期
└── _shared/      パスワードハッシュ・セッションCookie・D1アクセスの共通処理

schema/schema.sql  D1テーブル定義 (users / sessions / user_data)
migrations/        D1 migration(0002_memory.sql は暗記カード同期用)
wrangler.toml      Cloudflare Pages / D1 バインディング設定
```

- React 18 + TypeScript(strict) + Vite
- Cloudflare Pages Functions + D1(サーバーレスAPI、Web Crypto APIによるPBKDF2ハッシュ)
- チャートは自作SVG(外部チャートライブラリなし)
- vite-plugin-pwa(Workbox)によるオフラインキャッシュ

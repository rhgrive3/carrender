# 🎯 StudyCommander — 学習司令塔

**試験日までに教材を終わらせるため、教材量・期限・実績から毎日の勉強計画を自動で組み直すPWA。**

> [!IMPORTANT]
> このリポジトリは**作者本人の個人利用・限定利用を前提**にしています。不特定多数へ公開する一般向けサービスとしては設計していません。
> メール認証、パスワード再設定、2FA、管理者機能、公開サービス向けの不正利用対策などは意図的に対象外です。インターネット上へ一般公開して第三者のデータを預かる用途には使用しないでください。

- iPhone / iPad / Android向けモバイルUI
- ホーム画面追加に対応したPWA・オフライン起動
- Cloudflare Pages Functions + D1による個人用クラウド保存
- 予定がズレることを前提にした再スケジューリング
- ローカルファーストの英語暗記カード

---

## 主な機能

| 画面 | 内容 |
| --- | --- |
| **今日** | 試験日カウントダウン、予定タスク完了率、最優先タスク、未達成タスク、状態分析 |
| **計画** | 週間計画、固定予定、空き時間、タスク移動・時刻変更、再設計 |
| **教材** | 総量、進捗、残量、必要ペース、完了予測、編集・停止・アーカイブ |
| **記録** | タイマー・手入力ログ、編集・削除、予定対実績、科目別時間、連続学習日数 |
| **分析** | 容量不足、科目バランス、教材別完了予測、ヒートマップ、改善コメント |
| **暗記** | セット・カード編集、日→英/英→日/文脈、セッション内再出題、JSON入出力、差分同期 |

### 自動スケジューリング

- 教材残量から学習ブロックを自動生成
- 固定予定・日別例外・勉強可能時間を考慮
- strict期限、通常期限、安全完了日、負荷平準化を考慮
- `preferredCadence`、`dailyTarget`、`weeklyTarget`を配分へ反映
- 未達成時は単純な翌日送りではなく、残り計画全体を再計算
- 固定条件の競合、未配置作業、容量不足を画面に表示

### 記録・タイマー

- ストップウォッチ / ポモドーロ
- フリータイマー
- 画面消灯防止、通知、バイブレーション、環境音
- 記録編集・削除時に教材進捗と生成済み復習を再構築
- CSV・JSONエクスポート

---

## データ同期

メイン予定データと暗記データは同期方式が異なります。

### メイン予定データ

- AppStateは端末へ先に保存し、D1へ条件付きPUTします
- 最後に同期したクラウド世代と「未同期変更あり」を端末へ永続化します
- オフラインで編集してアプリを閉じても、次回起動時に未同期版をクラウド版で自動上書きしません
- ローカル変更の基準世代とクラウド世代が一致すれば自動送信します
- 両方が更新されている場合は自動上書きせず、設定画面で次を選択します
  - 両方を1つのJSONへ保存
  - この端末版を残す
  - クラウド版を残す
- 競合解決前の両版は端末の復旧用バックアップへも退避します
- D1へ保存するAppStateはサーバー側でも構造検証します

### 暗記データ

- IndexedDBへ先に保存
- content mutationは差分同期
- 回答ログは追記型で同期
- revision、tombstone、mutation IDによって競合を管理

重要な変更前には、設定からJSONバックアップも作成してください。

---

## アカウントの前提

- username: 3〜24文字
- password: 4文字以上
- パスワードはsalt付きPBKDF2-SHA-256で保存
- セッションはHttpOnly / Secure / SameSite=Lax Cookie
- メール認証、パスワード再設定、2FA、OAuth、課金、管理者機能はありません
- 個人利用前提のため、一般公開サービス向けセキュリティ機能は実装対象外です

---

## 起動方法

```bash
npm install
npm run dev
```

フロントエンドのみのVite開発サーバーが起動します。`/api/*`も含める場合はD1を準備して次を使います。

```bash
npm run pages:dev
```

### 検証

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration:api
npm run test:integration:browser
npm run test:e2e
npm run build
```

GitHub Actionsでも同じ系統の検証を実行します。

---

## D1セットアップ

```bash
npx wrangler login
npx wrangler d1 create studycommander-db
```

作成されたdatabase IDを`wrangler.toml`へ設定し、Cloudflare PagesのD1 binding名を`DB`にします。

```bash
npm run d1:schema
npm run d1:migrate
```

ローカルD1の場合:

```bash
npm run d1:schema:local
npm run d1:migrate:local
```

`migrations/0002_memory.sql`が未適用の場合、暗記同期APIは利用できません。

---

## PWA

モバイルではSafari / Chromeからホーム画面へ追加して使用します。

- iPhone / iPad: Safari → 共有 → ホーム画面に追加
- Android: ブラウザのインストールまたはホーム画面追加
- 画面のセーフエリア、standalone表示、オフライン起動に対応
- `?pwa-gate=on`でインストール案内を強制表示
- `?pwa-gate=off`で案内を無効化

---

## 技術構成

```text
src/
├── state/        メインAppState・認証・D1同期
├── lib/          scheduler / analytics / storage / sync / API
├── features/     暗記カードのdomain / application / infrastructure / UI
├── screens/      今日・計画・教材・記録・分析・設定・初期設定
└── components/   タイマー・フォーム・チャート・共通UI

functions/
├── api/auth/     register / login / logout / me
├── api/data.ts   メインAppState GET / PUT
├── api/memory/   暗記データ差分同期
└── _shared/      D1・Cookie・password・入力検証
```

- React 18
- TypeScript strict
- Vite / vite-plugin-pwa
- Cloudflare Pages Functions / D1
- Playwright

# Production deployment

本番Pagesは `.github/workflows/deploy-production.yml` からだけデプロイする。

## 初回設定

GitHubの `production` Environmentへ次のSecretsを登録する。

- `CLOUDFLARE_API_TOKEN`: D1 migrationsとPages deployを実行できる最小権限トークン
- `CLOUDFLARE_ACCOUNT_ID`: 対象CloudflareアカウントID

Cloudflare PagesのGit連携による自動production deployは無効化する。残っている場合も、Pagesビルド環境では`prebuild`がmigration gate未通過のビルドを停止する。

## デプロイ順序

1. `main`のCIが全成功
2. `npm run d1:migrate`で本番D1 migrationを適用
3. `npm run d1:verify:remote`で`app_schema_version`を確認
4. `MIGRATION_GATE_PASSED=5`をそのビルドだけへ渡してproduction build
5. `wrangler pages deploy`で検証済み`dist`をデプロイ

migrationまたはversion確認に失敗した場合、Pages deploy stepは実行されない。

## schema version更新ルール

Pages Functionsが新しいテーブル・列を必須にする変更では、同じPull Requestで以下を更新する。

1. 新しい`migrations/NNNN_*.sql`
2. migration内の`app_schema_version`
3. `functions/_shared/schemaVersion.ts`の`REQUIRED_D1_SCHEMA_VERSION`
4. `scripts/verify-pages-build-gate.mjs`と`scripts/verify-d1-schema-remote.mjs`の要求version
5. production workflowの`MIGRATION_GATE_PASSED`

アプリ起動時は`GET /api/schema`を確認する。サーバーがschema不足を明示した場合だけ起動を停止し、通信不能時は既存PWAのオフライン利用を継続する。

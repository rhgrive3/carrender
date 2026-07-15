# Production deployment

Cloudflare PagesのGit連携による自動production deployと、GitHub Actionsのmigration付きproduction workflowを併用できる。

## 通常の自動デプロイ

Cloudflare Pagesのproduction branchを`main`に設定し、Git連携の自動deployを有効にする。

通常のPages buildでは`MIGRATION_GATE_PASSED`は不要で、`npm run build`は警告を出したうえで継続する。アプリ起動時は`GET /api/schema`を確認し、本番D1が要求version未満の場合だけ起動を停止するため、互換性のない状態でデータを書き込まない。

`MIGRATION_GATE_PASSED`をCloudflare Pagesの恒久環境変数として設定しない。未設定が通常のGit build、整数version付きが検証済みworkflow buildを表す。

## D1 migrationを含むデプロイ

GitHubの`production` Environmentへ次のSecretsを登録する。

- `CLOUDFLARE_API_TOKEN`: D1 migrationsとPages deployを実行できる最小権限トークン
- `CLOUDFLARE_ACCOUNT_ID`: 対象CloudflareアカウントID

`.github/workflows/deploy-production.yml`は次の順序で実行する。

1. `main`のCIが全成功
2. `npm run d1:migrate`で本番D1 migrationを適用
3. `npm run d1:verify:remote`で`app_schema_version`を確認
4. `MIGRATION_GATE_PASSED=5`をそのビルドだけへ渡してproduction build
5. `wrangler pages deploy`で検証済み`dist`をデプロイ

migrationまたはversion確認に失敗した場合、GitHub Actions側のPages deploy stepは実行されない。Cloudflare Git deployが先に完了しても、runtime schema gateが互換性確認までアプリ起動を止める。

## schema version更新ルール

Pages Functionsが新しいテーブル・列を必須にする変更では、同じPull Requestで以下を更新する。

1. 新しい`migrations/NNNN_*.sql`
2. migration内の`app_schema_version`
3. `functions/_shared/schemaVersion.ts`の`REQUIRED_D1_SCHEMA_VERSION`
4. `scripts/verify-pages-build-gate.mjs`と`scripts/verify-d1-schema-remote.mjs`の要求version
5. production workflowの`MIGRATION_GATE_PASSED`

通信不能時は既存PWAのオフライン利用を継続する。

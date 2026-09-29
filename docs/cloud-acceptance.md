# クラウド接続・受け入れ確認記録

2026-09-29。限定試験の準備中。実サービスでのログイン・保存・配布の合格記録ではない。

## 管理画面で確認済み

- 専用Supabase：DEKIRU-GameCreator / xrqgsujvduyxtrbegzri / ruriru Free / 東京。
- 専用Google Cloud：DEKIRU-GameCreator / dekiru-gamecreator。
- 所有者がGoogle Auth Platformの初期設定・OAuthクライアント作成を完了。
- 所有者がGoogle接続情報をSupabaseへ直接登録。Google providerのEnabled表示を確認。
- Site URL：`https://ruriru-app.github.io/DEKIRU-GameCreator/app/index.html`。
- Redirect URLs：`https://ruriru-app.github.io/DEKIRU-GameCreator/app/account/callback.html` の完全一致1件。
- Allow new users to sign up：OFF、保存成功。その後の管理画面でもOFFを確認。
- 所有者が自分のGoogleメールアドレスで試用ユーザーを手動追加。利用者一覧への追加を確認。通常のGoogleログインとの自動連携は未検証。
- Allow anonymous sign-insとAllow manual linkingはOFF。Confirm emailはON。
- 所有者がEmail providerを無効化。保存成功とEmail Disabled / Google Enabledを確認。
- 初期設定前にpublicが空、privateが未作成であることを確認。既存2 migrationを未改変でBEGIN/COMMIT内にまとめ、SQL Editorへ貼り付けられた全文のSHA-256が準備ファイルと一致することを確認した。
- 所有者が初期設定SQLを実行。2026-09-29、管理画面で `Success. No rows returned` を確認。Table Editorのprivateにaccounts / games / plan_limits / publications / read_limits / requests / service_controlの7表が表示された。初期設定は再実行しない。
- 既存のPublishable keyがあることを確認。新しいキーは作成せず、Secret keyの表示・コピーも行っていない。アプリの設定には未反映。
- 所有者がCronを導入して定期処理を登録。Jobs一覧は1件で、名前 `dekiru-cloud-cleanup-hourly`、毎時0分、SQL `select private.purge_expired_cloud_records();` が準備した値と一致。2026-09-29の確認時点では初回未実行、次回は14:00:00（+0900）と表示。登録は確認済みだが、実行成功・期限切れ行の除去はまだ未検証。

Google client secret、DBパスワード、試用ユーザーのパスワードは読取り・記録・公開していない。ユーザーのメールアドレス・UUIDも記載しない。

## まだ確認・設定していないもの

- Googleの要求scopeがopenid/email/profileだけであることを実際のログイン画面でも確認すること。
- ホストの権限試験、匿名API配置、信頼できる接続元の実測、登録済み短期記録除去ジョブの実行確認。migrationの適用成功と、実際の利用者による権限試験の合格は区別する。
- 公開可能キーによるアプリ接続。本物のGoogleログイン成功・キャンセル・編集復帰。
- 所有者別の保存、公開更新、別ブラウザー再生、公開停止、削除、上限・競合の実環境確認。
- 全体の独立レビューと、承認された公開範囲への最終反映。

`core/cloud/config.js` は引き続き `enabled:false`。公開中のmain、FUERU、Fドライブ原本、襖ゲーム本体は変更していない。有料契約・カード登録・アップグレードは行っていない。

## 手元の共有入口テスト

サーバー側の接続処理と単一ファイルの起動部を追加。Nodeの134件（追加10件含む）が成功し、失敗・スキップ0件。環境変数不足時の遮断、秘密の取扱い、IPv6の正規化、日替わりHMAC、通信中断、固定RPCの引数、生成物の起動を確認した。API通信は模擬で、ホストへの配置・接続元の偽装耐性・実際のDeno実行はまだ検証していない。公開前チェックはクラウド設定と問い合わせ先の2点で意図どおり停止する。

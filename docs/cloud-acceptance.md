# クラウド接続・受け入れ確認記録

2026-09-29。限定試験の準備中。実サービスでのログイン・保存・配布の合格記録ではない。

## 最新の接続確認（同日14:23以降）

所有者が本人限定の公開サイト更新を承認。公開用configをenabled:trueへ変更し、データ説明に管理者の試験運用中・一般新規登録停止を明記。問い合わせ先未確定の一般公開ゲートは解除しない。接続済み本人によるOAuth・保存・配布の最終試験は、公開サイト反映後に実施する。

- 所有者がDEKIRU_CLIENT_IP_MODEの保存を完了。成功表示を確認した。秘密の表示・読取りは行っていない。
- 標準の共有入口へ、文書用の存在しない22文字IDで認証情報なしのGETを1回実施。従来の503から404 / UNAVAILABLE「このゲームは現在公開されていません。」へ変わり、許可Originとno-storeも保持。配布済みハンドラーでは制限カウンターと読取りRPCの両方が成功しなければこの応答に到達しないため、接続と空の検索結果を確認できた。実際の教材の公開・再生とは区別する。
- 既存Publishable keyのみを取得。匿名のread_shared_gameとlist_games呼出しはどちらも401 / 42501で拒否。公開認証設定でdisable_signup=true、Google=true、Email=false、anonymous_users=falseを確認。所有者間の分離や本人のGoogleログインは未検証。
- 手元のcore/cloud/config.jsへ公開可能キー・固定URLのみ反映し、enabled:falseを維持。管理キー・HMAC秘密・OAuth秘密は含めていない。mainと公開サイトは未変更。次の本人限定の公開サイト接続試験は反映承認待ち。問い合わせ先など一般公開のゲートは未解除。
- この公開設定準備後のNode試験137/137成功、失敗・スキップ0。enabled:trueを渡す設定検証も成功し、実設定はfalse、共有URLは75文字と確認。git diff --check成功、変更はconfigと運用・検証記録のみ。完成済みゲーム本体は未変更。

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
- 実環境検証と、承認された範囲での最終反映。今回の変更のCI・全体の独立レビューは下記まで完了。

`core/cloud/config.js` は引き続き `enabled:false`。公開中のmain、FUERU、Fドライブ原本、襖ゲーム本体は変更していない。有料契約・カード登録・アップグレードは行っていない。

## 手元の共有入口テスト

サーバー側の接続処理と単一ファイルの起動部を追加。Nodeの134件（追加10件含む）が成功し、失敗・スキップ0件。環境変数不足時の遮断、秘密の取扱い、IPv6の正規化、日替わりHMAC、通信中断、固定RPCの引数、生成物の起動を確認した。API通信は模擬で、ホストへの配置・接続元の偽装耐性・実際のDeno実行はまだ検証していない。公開前チェックはクラウド設定と問い合わせ先の2点で意図どおり停止する。

## 独立レビュー後の回帰確認

全体レビューで、キャッシュされた「戻る」操作でログイン前の退避が残る問題、クラウド読込み中の貼り付けが消える問題、保存競合からの復帰操作不足を検出した。まず失敗するテストを確認し、順に修正。最終Nodeテスト137件と実ブラウザーのオンライン操作26件が成功した。レビュー担当による再点検でも3件を解消と確認。実ブラウザー試験の通信・認証は模擬で、本物のGoogleログインの代替とはしない。

所有者が送信先・ブランチ・内容を確認して承認した後、`feature/cloud-sharing` を `c627eebe6f19ed0590a44cc2bc1b733b7c44fdf5` まで送信した。GitHub Actions [36523144811](https://github.com/ruriru-app/DEKIRU-GameCreator/actions/runs/36523144811) は成功。ログでNode137件、pgTAP89件、実際の使い捨てAuth環境による統合2件の成功・失敗0件を確認。認証SDKと共有入口の再ビルド差分もなし。これは専用の実サービスの受け入れ試験とは区別する。

## 共有入口の配置準備

最新確認（以下の準備経過より後）：所有者が配置とshared-gameだけのJWT検証OFFを完了。管理画面で保存済みOFFを確認し、実匿名GETが503 / アプリ固有のSERVICE_UNAVAILABLE / 固定許可Origin / no-storeを返した。関数起動と未設定時の遮断は確認済みだが、DB通信・共有の受け入れ成功ではない。所有者が2026-09-29 14:15（日本時間）にDEKIRU_RATE_HMAC_KEYを登録済み。名前と成功表示だけを確認し、秘密の値・ダイジェストは記録しない。

同日14:19、専用の標準HTTPS入口へ認証情報なしで3要求だけ実施。通常GETはアプリ503、利用者がCF-Connecting-IPを指定したGETは入口で403（アプリ応答ではない）、X-Forwarded-ForとX-Real-IPを文書用IPで指定したGETはアプリ503。後者と通常要求の実行記録で、cf_connecting_ipが同一であり、指定した文書用IPとは異なることをメモリ内比較で確認した。Cloudflare経由・supabase-edge-runtime実行を確認。生IP・位置情報はこの記録に残さない。

[Cloudflareのヘッダー仕様](https://developers.cloudflare.com/fundamentals/reference/http-headers/)と[Supabaseの実行記録仕様](https://supabase.com/docs/guides/observability/log-field-reference)を併用し、今回の標準入口で本人限定の接続試験へ進む根拠とした。これは任意の将来の独自ドメイン・プロキシ経路の保証ではない。経路変更時は再検証する。DEKIRU_CLIENT_IP_MODE=cloudflare-verifiedを入力欄に準備しただけで、Saveは未操作。保存後のDB接続、実際の匿名取得・制限カウンターの試験は引き続き必要。

Cronは既存1件の2026-09-29 14:00:00 (+0900) Succeededを確認。次回15:00、Active。手動再実行・ジョブ追加なし。初回定期実行は成功したが、実データの保持期間境界による除去試験は未実施。

専用SupabaseのEdge Functionsに既存の関数がないことを確認し、新規作成画面に `shared-game` とテスト済み `index.ts` を入力した。入力後にエディター全文をコピーして、改行正規化・前後空白除去後のSHA-256がローカル生成物と一致することを確認した（`e5587818a3d035a22d056ba90ff0a92bcac2ddddafb0a7d51f3a76431dae724a`）。Deploy functionはまだ押していない。最終登録は所有者の確認待ち。HMAC秘密・接続元信頼モード・JWT設定は変更していない。必要設定がない間は処理内でデータ取得を遮断する。公開サイトの設定も無効のまま。

その後、所有者から登録後の `shared-game` 設定画面を受領。エンドポイント表示と「Verify JWT with legacy secret」がONであることを確認。認証情報なしの実HTTP GETも401を返した。配置は確認できたが、関数本体の実行・データ取得が成功した意味ではない。この関数だけのJWT設定をOFFにする操作を所有者へ案内し、まだ変更後の確認はしていない。HMAC秘密・接続元信頼モードも未設定。オンライン保存や共有が利用可能になったとは扱わない。

# DEKIRU Game Creator Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一般の先生・保護者が自分の問題をオンライン保存し、子どもに短いURLを渡して、完成済みの襖ゲームで遊んでもらえるようにする。

**Architecture:** 静的な作成画面に、独立した認証・クラウド保存層を追加する。Supabase Authと所有者別DBで下書き・公開スナップショットを管理し、匿名閲覧専用APIと既存ランタイムを再利用するプレイヤーを接続する。決済は実装せず、プラン制限だけサーバーに置く。

**Tech Stack:** 既存のHTML/CSS/JavaScript ES modules、Node.js 22以上、node:test、Supabase Auth/Postgres/Edge Functions、pgTAP。認証SDKは `@supabase/supabase-js@2.117.2`、SDKの静的バンドル作成は `esbuild@0.25.5` に固定する。

**Spec:** `docs/superpowers/specs/2026-09-29-game-sharing-design.md`（2026-09-29にユーザー承認済み）

## Global Constraints

- 「作成・プレビュー・既存のHTML書き出し・編集用ファイル保存は、登録不要で残す。」
- 「遊ぶ子どもにはアカウントを作らせない。」
- 「完成した襖ゲームの画像、入力判定、動き、BGM、画面構成は変更しない。」
- 「無料試験運用の上限は、保存20件／同時公開10件／1件200問・256 KiBとする。」
- 「題名80文字、各問の問題文1000文字、正解200文字、よみ200文字、ヒント800文字、ID128文字以内。」
- 「更新番号の一致を条件に更新する。不一致は競合表示とし、自動上書きしない。」
- 「所有者向け書き込みはDB関数経由とし、通常の表への直接書き込み権限を与えない。」
- 「公開読取り用DB関数の実行はサーバー専用ロールに限定する。」
- 作成者の更新系操作：1分20回／1日500回。同一接続元の公開読取り：1分600回。
- IDは暗号学的乱数128ビット・Base64url 22文字。現在の公開URLは75文字、上限80文字。
- 認証前の編集退避は同じタブで2時間。公開読取りの接続元ハッシュは24時間以内に失効・除去する。
- 現行の編集用ファイルの5 MB制限を変えない。クラウド制限をローカル機能に適用しない。
- クラウド障害・未設定でもローカル機能を維持する。秘密情報をGitHub・ブラウザー・ゲームHTML・ログに入れない。
- 作業は通常実装（この担当が順に実装）。完成時の独立レビューを含める。大量の実装サブエージェントは使わない。
- この計画作成時点では製品コード未変更。外部アカウント作成・有料契約・公開先移転は別途確認する。

## Review Focus

1. ログイン復帰時に貼り付け欄だけ失う／期限切れデータが別教材を上書きする → Task 4・5で未反映テキストと復帰の原子性を検査。
2. 保存応答を待つ間の編集、別アカウントへの切替、二つのタブからの公開 → Task 2・5で古い応答と競合を拒否。
3. 学校の共用回線で一斉起動／偽装ヘッダーで回数制限を回避 → Task 3・8で600回境界と信頼する接続元情報を検査。
4. 日本語・結合文字・絵文字・不正な制御文字による文字数／UTF-8容量の不一致 → Task 1・2で共通ケースを検査。
5. ブラウザーの戻る操作・キャッシュ・一部通信障害で停止済み教材が新規起動する → Task 7・8で公開状態の再取得と通信エラーの区別を検査。

---

## 作業環境・保護対象・検証環境

- Git管理された作業元：`work/publication/DEKIRU-GameCreator`。作業開始時は `521ddf8`（公開済み `bf15e63`＋設計書のみ）。
- 実装時はusing-git-worktreesの手順で、このGit履歴から隔離した作業場所を用意する。ここでは新規worktreeを作らない。
- `F:\DEKIRU Game Creator`、バックアップ、配布済みHTML、現在稼働中のローカルサーバーは変更・停止しない。
- `Typing/core/`、`Typing/templates/fusuma/`、`core/audio-manager.js`、`core/html-exporter.js` は公開済みコミットとの内容一致を検査する。
- 手元のNodeは24.19.0。pnpmはアプリ付属版を使用可能。npm/Supabase CLI/Docker/DenoはPATH上で見つかっていない。
- Nodeの単体試験は手元で行う。DB試験はDocker環境が必要なため、専用のGitHub Actions検証ジョブを用意し、一時的なローカルSupabaseを起動して試す。課金用・本番DBは使わない。
- CIが利用できない場合、DB試験を「未実施」と記録し、UI・単体試験の作業は進めても接続公開は止める。OSへのDockerインストールを勝手に行わない。
- Supabase CLIは実装時に公式公開版を確認して厳密なバージョンに固定し、workflowへ記録する。Actionsも確認したコミットSHAで固定する。
- 以下のコマンドは実装用作業場所のルートから実行する。pnpmがPATHにないこのPCでは、確認済みのアプリ付属 `pnpm.cmd` をフルパスで呼ぶ。

## ファイル分担

| 位置 | 責任 |
| --- | --- |
| `core/cloud/project-validation.js`, `share-url.js`, `contracts.js` | クラウド専用の検証、短いURL、型・エラー契約 |
| `core/cloud/config.js`, `sdk-entry.js`, `auth.js`, `auth-resume.js` | 安全な設定、認証、編集中データの退避・復帰 |
| `core/cloud/owner-api.js`, `public-api.js`, `cloud-state.js` | 所有者API、匿名API、保存・公開状態の分離 |
| `Typing/creator/cloud-controls.js` | 既存エディターとの接続だけを担当 |
| `app/account/index.html`, `account.js`, `account.css`, `callback.html`, `callback.js` | 自分のゲーム一覧、操作確認、認証復帰 |
| `p/index.html`, `player.js`, `player.css`, `runtime-registry.js` | 公開1件の取得と既存ゲーム起動 |
| `supabase/migrations/`, `supabase/tests/` | データ構造、権限、上限、DB試験 |
| `supabase/functions/shared-game/index.ts`, `handler.js` | 匿名閲覧APIと短期レート制限 |
| `tools/build-cloud-sdk.mjs`, `vendor/`, `package.json`, `pnpm-lock.yaml` | 固定依存のブラウザー用ビルド。アプリ本体全体はバンドルしない |
| `tests/cloud-*.test.mjs`, `tests/integration/`, `tests/cloud-browser-tests.html` | 単体・権限・並行処理・ブラウザーの検証 |

## 共通データ・API契約

`contracts.js` にJSDocとして以下を定義する。保存には既存Projectをそのまま使い、任意の所有者・素材URL・コードを取り込まない。

- `Project`：既存のschemaVersion=1/title/gameType=typing/templateId=fusuma/settings/questions。
- `Publication`：`{ shareId, status:'published'|'stopped', version, sourceVersion, runtimeVersion:'fusuma-1' }`。
- `GameMeta`：`{ id, version, title, questionCount, updatedAt, publication:Publication|null, publicationDirty:boolean }`。publicationDirtyはDBで下書きと公開スナップショットの内容を比較して決め、操作によるversion増加だけではtrueにしない。
- `GameRecord`：`GameMeta & { project:Project }`。
- `Context`：`{ ownerId, status:'active'|'disabled', plan:'free', limits, counts, capabilities }`。権限と上限はサーバー由来。
- `Result<T>`：`{ok:true,data:T}` または `{ok:false,error:{code,message,retryAfterSeconds?}}`。
- エラーcode：`NOT_CONFIGURED / UNAUTHENTICATED / FORBIDDEN / UNAVAILABLE / VALIDATION / LIMIT / RATE_LIMIT / CONFLICT / REQUEST_MISMATCH / NETWORK / SERVICE_UNAVAILABLE`。内部SQLや認証情報をmessageへ出さない。
- 匿名公開データ：`{schemaVersion:1,project,runtimeVersion:'fusuma-1',publicationVersion}`。所有者や下書きは含めない。
- 所有者RPC：`creator_context()`、`list_games()`、`load_game(p_game_id uuid)`、`mutate_game(p_command text,p_args jsonb)`。すべてResultを返す。
- `mutate_game` のcommand：`save / publish / unpublish / republish / delete`。
- 全変更のargs：`requestId:uuid`。新規saveは `gameId:null,expectedVersion:0,projectText:string`。既存saveはgameIdと期待versionを付ける。
- 公開系・deleteはgameIdとexpectedVersionを必須とする。publishはその保存済み下書きを公開する。republishは既存の公開スナップショットを再開する。
- 変更成功はGameMeta、deleteだけは `{id,deleted:true}`。ゲームを変更する各操作でversionが1増える。失敗では増やさない。
- 公開スナップショットの更新時だけpublication.versionを増やし、元の下書きversionをsourceVersionに保存する。停止・再開でスナップショットを書き換えない。
- 公開HTTP：`GET /functions/v1/shared-game?g=<22文字>`。成功は匿名公開データ、欠落／停止／削除は同じ404、過剰アクセス429、サービス障害503。全応答にno-store。
- 不正形式の公開IDは同じ404。複数g、他の照会パラメーター、GET以外（OPTIONSを除く）はデータを返さない。

---

### Task 1: 検証ルール・短いURL・保護用テスト

**Files:** Create `core/cloud/{contracts,project-validation,share-url}.js`, `tests/fixtures/cloud-projects.mjs`, `tests/cloud-{validation,url,protected-files}.test.mjs`, `tests/fixtures/runtime-baseline.json`; Modify `tools/preview-server.mjs`, `tests/preview-server.test.mjs`。

**Interfaces:** `validateCloudProject(project,{mode:'draft'|'publish'}) -> Result<Project>`; `serializeCloudProject(project) -> string`; `buildShareUrl(appBaseUrl,shareId) -> string`; `parseShareId(url) -> string|null`。Fixtureは `projectWith(count)` をexportし、各IDを一意にする。

- [ ] Step 1 — 新機能用に失敗する試験を書く。境界は200/201問、262144/262145 UTF-8 bytes、文字数上限、空欄下書き／公開、重複ID、未知フィールド・テンプレート、URL二重パラメーター。
  ```js
  assert.equal(validateCloudProject(projectWith(200), {mode:'publish'}).ok, true);
  assert.equal(validateCloudProject(projectWith(201), {mode:'publish'}).error.code, 'LIMIT');
  assert.equal(buildShareUrl('https://ruriru-app.github.io/DEKIRU-GameCreator/', 'G7m2Pk8wQ4t9R3vX6nYzAa').length, 75);
  assert.equal(parseShareId('https://example.invalid/p/?g=a&g=b'), null);
  ```
- [ ] Step 2 — `node --test tests/cloud-validation.test.mjs tests/cloud-url.test.mjs` を実行し、未実装による失敗を確認する。既存 `node --test tests/*.test.mjs` の実数も記録する。
- [ ] Step 3 — 上記関数を実装。文字数はUnicodeコードポイント、容量は固定順に直列化したJSONのUTF-8 bytesで判定。改行・タブは文字列として許可し、NULと不正な単独サロゲートはクラウド保存だけ拒否する。SQLにも同じケースを渡せるfixtureを作る。
- [ ] Step 4 — 既存公開コミットの保護対象SHA-256一覧を記録し、一致するテストを書く。preview-serverにディレクトリのindex.html配信と任意の `basePath` を追加し、`/p/?g=...` と `/DEKIRU-GameCreator/p/?g=...`、パストラバーサル拒否をテストする。
- [ ] Step 5 — 関連テストと全既存テストで失敗0を確認し、このTaskのファイルだけを `feat: define cloud project and sharing contracts` としてコミットする。

### Task 2: 所有者別保存・公開スナップショット・サーバー側上限

**Files:** Create `supabase/config.toml`, `supabase/migrations/202609290001_cloud_storage.sql`, `supabase/tests/{validation,ownership,quotas,publication,idempotency}.test.sql`, `tests/integration/{cloud-db.test,local-supabase}.mjs`, `.github/workflows/cloud-tests.yml`。Modify `.gitignore`（秘密情報・CLI一時ファイル除外）。

**Interfaces:** 共通契約の4 RPC。補助関数は `private.validate_project(project_text text, mode text)`、`private.purge_expired_cloud_records()`。秘密テーブルはprivate schema、公開RPCだけpublic schemaに配置する。

- [ ] Step 1 — pgTAPで「所有者Aだけ取得可」「B・anonの直接select/insert/update/deleteとプラン改変不可」「特権関数実行不可」を先に書く。publicの関数権限と固定search_pathも検査する。例：`has_table_privilege('anon','private.games','select') = false`、`has_function_privilege('anon','public.mutate_game(text,jsonb)','execute') = false`。
- [ ] Step 2 — CIに一時DB起動と `supabase test db` を設定し、featureブランチで不足関数／テーブルによる失敗を確認する。workflowはcontents:read、時間制限15分、本番秘密情報なし。自動デプロイは入れない。
- [ ] Step 3 — accounts/plan_limits/games/publications、サービス停止設定、短期カウンター、冪等性記録を作る。private表にもRLSを有効にし、ブラウザー用ロールの直接権限を撤回。RPCはauth.uid()と所有権を毎回検査し、アカウント行をロックして数の確認と変更を同一トランザクションにする。
- [ ] Step 4 — DBでProjectを再検証し、文字・容量のケースをJSと一致させる。新規アカウントはfree固定で重複作成不可。共有IDは `gen_random_bytes(16)` から22文字にして一意制約で保護する。requestIdを所有者単位で24時間保持し、同じ操作・内容は同じ結果、異なる内容での再利用はREQUEST_MISMATCH。失敗時は下書き／公開版を変更しない。
- [ ] Step 5 — 20/21保存、10/11公開、200/201問、262144/262145 bytes、20/21回毎分、500/501回UTC日、別所有者、停止ユーザー、古いversion、停止後再公開、削除後公開不可の試験を追加する。回数制限の拒否・検証失敗でも必要なカウンターは維持するが、教材更新は行わない。
- [ ] Step 6 — `local-supabase.mjs` に `createLocalTestClients() -> {ownerA,ownerB,anon,admin,cleanup()}` を作る。CI内localhostの一時環境だけを許可し、ローカルAuthの管理APIで架空のA/Bを作成、ランダムなテスト用パスワードでJWTを取得する。実在するメールを使わず、メールを送信しない。設定はメモリー内で取得し、秘密をログへ出さず、終了時は作成したfixtureだけを除去する。`node --test tests/integration/cloud-db.test.mjs` で実DBへの並行2リクエストを実行し、残り1保存枠／公開枠では成功が1件、旧versionはCONFLICT、応答喪失の再試行は二重作成なしと確認する。
- [ ] Step 7 — pgTAP全件と並行テスト失敗0を確認し、`feat: enforce owner-scoped cloud storage and publishing` としてコミットする。DB実行環境が使えない場合は未完了扱いのまま、依存しない作業へ進める。

### Task 3: 匿名閲覧APIとクラウド接続層

**Files:** Create `supabase/migrations/202609290002_shared_read.sql`, `supabase/functions/shared-game/{index.ts,handler.js}`, `supabase/functions/deno.json`, `supabase/tests/shared-read.test.sql`, `core/cloud/{config,owner-api,public-api}.js`, `tests/cloud-{api,public-handler}.test.mjs`。

**Interfaces:** `createOwnerApi({client}) -> {getContext(),listGames(),loadGame(id),saveDraft({gameId,expectedVersion,project,requestId}),publishGame({gameId,expectedVersion,requestId}),setPublished({gameId,expectedVersion,requestId,published}),deleteGame({gameId,expectedVersion,requestId})}`。全関数Promise<Result>。 `fetchSharedGame({endpoint,shareId,fetchImpl,signal}) -> Promise<Result<PublicGame>>`。 `createSharedGameHandler({lookup,consumeLimit,getClientAddress,hashAddress,now,allowedOrigins}) -> (Request)=>Promise<Response>`。

- [ ] Step 1 — 404の同一応答、503との区別、600/601回、GET/OPTIONS以外、複数ID、CORS、no-store、所有者情報不在をテストする。owner-apiでNETWORKとCONFLICTを混同せず、同じrequestIdで再試行することも検査する。
- [ ] Step 2 — `node --test tests/cloud-api.test.mjs tests/cloud-public-handler.test.mjs` の失敗を確認する。
- [ ] Step 3 — Handlerを依存注入した純粋JSで実装し、index.tsでDeno.serveとサーバー専用clientを接続する。匿名で呼べるのはこの関数だけとし、`public.read_shared_game(p_share_id text)` と `public.consume_shared_read(p_client_hash text)` のexecuteはservice_roleだけに与える。前者は公開データまたはnull、後者は `{allowed,retry_after_seconds}` を返す。カウンターの時刻はDBで決める。データ・件数・プランをブラウザー設定で上書きさせない。
- [ ] Step 4 — 公開読取りカウンターをDBのサーバー専用処理で原子的に更新。接続元はプラットフォームが保証する値だけ使い、日付入りHMACを保存して生IPは保存しない。時刻はサーバーUTC。短期カウンターは1時間ごとのジョブで23時間より古いものを除去し、24時間の保持上限を守る。
- [ ] Step 5 — `private.purge_expired_cloud_records()` に期限切れ処理を追加し、読取り関数にも期限・アカウント停止・公開状態検査を入れる。クライアント指定の時刻・hash・所有者を採用しない。公開データのキャッシュは禁止、GET再試行は利用者操作によるものだけとする。
- [ ] Step 6 — owner-api/public-apiの通信を15秒で打ち切り、NETWORKとして内容保持・手動再試行へ戻すテストを追加する。JS＋SQL試験を実行し、handler出力が公開データの許可フィールドだけであることを確認。`feat: add protected anonymous game retrieval` としてコミットする。

### Task 4: Google認証と編集内容の退避

**Files:** Create `package.json`, `pnpm-lock.yaml`, `tools/build-cloud-sdk.mjs`, `core/cloud/{sdk-entry,auth,auth-resume}.js`, `vendor/supabase.js`, `vendor/THIRD_PARTY_NOTICES.md`, `app/account/{callback.html,callback.js}`, `tests/cloud-{auth,resume,sdk}.test.mjs`。Modify `core/cloud/config.js`。

**Interfaces:** `createAuth({client,storage,appBaseUrl}) -> {getUser(),subscribe(fn),startGoogleSignIn({returnTo}),completeCallback(url),signOut()}`。 `saveAuthResume(storage,payload,nowMs)`, `takeAuthResume(storage,nowMs)`, `clearAuthResume(storage)`。payloadは `{project,pasteText,fileState,cloudLink,returnTo}`。

- [ ] Step 1 — 認証退避の容量エラー／JSON破損／2時間境界／未反映貼り付け欄／不正な戻り先／アカウント変更をテストする。
  ```js
  saveAuthResume(storage, payload, 0);
  assert.deepEqual(takeAuthResume(storage, 7199999), payload);
  saveAuthResume(storage, payload, 0);
  assert.equal(takeAuthResume(storage, 7200000), null);
  ```
- [ ] Step 2 — `node --test tests/cloud-auth.test.mjs tests/cloud-resume.test.mjs` の失敗を確認する。
- [ ] Step 3 — pnpmで指定のSDKとビルド専用esbuildを厳密バージョン・lock付きで導入。build-cloud-sdk.mjsはsdk-entryだけをESMにbundleし、ライセンスを添付。SDKは同じサイトから読込み、外部CDNのlatestは使わない。インストール時にビルドスクリプトが必要ならesbuildだけを許可し、他のパッケージには一括許可しない。
- [ ] Step 4 — Supabase clientをPKCE、sessionStorage、アプリ専用storageKey、許可済みcallbackで作る。auto URL処理と手動コード交換を二重実行しない。callbackでは成功・失敗とも認証パラメーターを履歴から取り除いて退避先へ戻す。書き込み・公開は自動実行しない。
- [ ] Step 5 — 外部returnTo、保存不可時の遷移、期限切れ復帰、ログアウト後残留、子ども用経路からのSDK importを拒否する試験を通す。callbackページはno-referrer、第三者scriptなし。退避したcloudLinkは本人IDが一致した時だけ再接続する。
- [ ] Step 6 — `node tools/build-cloud-sdk.mjs`、関連Nodeテスト、生成物の秘密情報・外部import検査を通し、`feat: add creator sign-in with safe draft recovery` としてコミットする。

### Task 5: 既存エディターへ保存・配布操作を追加

**Files:** Create `core/cloud/cloud-state.js`, `Typing/creator/cloud-controls.js`, `tests/cloud-state.test.mjs`, `tests/cloud-controls.test.mjs`, `tests/cloud-browser-tests.html`。Modify `Typing/creator/{index.html,creator.css,creator.js,creator-state.js}`, `tests/creator-state.test.mjs`。

**Interfaces:** `createCloudState({getProject}) -> {getState(),subscribe(fn),attach({ownerId,record}),detach(),beginSave({ownerId,requestId,snapshot}),markSaved({ownerId,requestId,snapshot,meta}),markPublished({ownerId,meta}),isCloudSaved(project)}`。getStateは `{ownerId,gameMeta,cloudDirty,publicationDirty,pendingRequestId}` を返す。publicationDirtyは最後のGameMetaの値またはその後の編集がある場合にtrue。`mountCloudControls({root,store,auth,api,cloudState,getPasteText,setPasteText}) -> {destroy()}`。storeの `loadProject(project,{source='file'}={})` にcloud/temporaryを追加し、`restoreEditingSession({project,fileState})` を提供する。fileStateは既存のdirty/previewDirty/unsavedChanges/hasProjectFileの4フラグ。

- [ ] Step 1 — cloud保存・file保存・export・previewを別々に追跡する失敗テストを書く。保存中の編集、アカウント変更後の遅延応答、ファイル読込み後の旧gameId混入を検査する。
  ```js
  assert.equal(cloudState.isCloudSaved(newerProject), false); // 古い保存応答の後
  assert.equal(store.getState().hasProjectFile, false);       // cloudから初めて開いた後
  assert.equal(cloudState.getState().publicationDirty, true); // 下書きだけ更新した後
  ```
- [ ] Step 2 — `node --test tests/cloud-state.test.mjs tests/cloud-controls.test.mjs tests/creator-state.test.mjs` で新規テストの失敗、既存テストの維持を確認する。
- [ ] Step 3 — 既存関数を大幅に分解せずcloud-controlsへ接続。未設定時はクラウド操作のみ無効、その他の起動を妨げない。ファイルを開くとcloudLinkを外す。cloud/temporary読込みでファイル保存済みと偽らない。
- [ ] Step 4 — 「オンライン保存」「共有URLを作る」「配布内容を更新」とURLコピーを追加。公開前に題名・件数・リンク公開の注意を示す。未保存変更はsave成功後のversionを使ってpublishし、競合・途中失敗では旧公開版を残す。保存のみで自動公開しない。
- [ ] Step 5 — beforeunloadは最新内容がファイルにもクラウドにも保全されていない場合と、未反映pasteがある場合に警告する。ログイン退避のための許可済み遷移と区別する。ログアウトは「編集内容を残す／ファイル保存して消す／キャンセル」を確認し、黙って破棄しない。
- [ ] Step 6 — Unit試験と `tests/cloud-browser-tests.html` で、設定なし、未ログイン、成功、容量超過、競合、クリップボード拒否、複数保存を検査し、既存 `project-file-browser-tests.html` も通す。`feat: connect creator to cloud save and sharing` としてコミットする。

### Task 6: マイゲームと管理操作

**Files:** Create `app/account/{index.html,account.js,account.css}`, `tests/cloud-account.test.mjs`。Modify `app/index.html`, `Typing/creator/index.html`, `Typing/creator/cloud-controls.js`, `tests/cloud-browser-tests.html`。

**Interfaces:** `mountAccountPage({root,auth,api,appBaseUrl}) -> {destroy()}`。一覧はTask 3の `listGames() -> Promise<Result<GameMeta[]>>` を利用。編集リンクは `Typing/creator/index.html?game=<uuid>` に固定する。

- [ ] Step 1 — 他人ID、未ログイン、一覧取得失敗、ログアウト直後の遅延取得、削除キャンセル／成功、公開停止／再開、旧versionをテストする。例：`deleteCalls.length === 0`（確認キャンセル）、`visibleRows.length === 0`（別ユーザーへ切替）。
- [ ] Step 2 — `node --test tests/cloud-account.test.mjs` の失敗を確認する。
- [ ] Step 3 — ログイン案内、所有者本人の一覧、枠残数、編集、URLコピー、公開停止／再開、削除確認を実装する。取得エラーを空一覧と混同せず、利用者が操作した行だけ状態更新する。
- [ ] Step 4 — 公開停止・削除でダウンロード済みHTMLまでは止められない説明を表示。編集画面に未保存内容がある時は置換確認を経てからクラウド教材を読む。保存枠超過でも削除・ファイルへの保存を妨げない。
- [ ] Step 5 — Unitとブラウザー試験で一覧と操作結果、モバイル幅、キーボード操作を確認し、`feat: add creator game library and publication controls` としてコミットする。

### Task 7: 共有プレイヤーと既存ゲームの再利用

**Files:** Create `p/{index.html,player.js,player.css,runtime-registry.js}`, `tests/cloud-player.test.mjs`, `tests/shared-player-browser-tests.html`。既存のゲーム内部は変更しない。

**Interfaces:** `resolveRuntime('fusuma-1') -> {manifest,mount}`、`startSharedPlayer({host,pageUrl,endpoint,fetchImpl,loadRuntime}) -> Promise<{destroy()}>`。`mount` は既存mountFusumaGameへのアダプター。

- [ ] Step 1 — 共有ID不正、公開停止404、503、未対応runtimeVersion、悪意あるprojectフィールド、no-store取得、認証・成績通信なしを先にテスト。復帰時の再取得も検査する：`fetchCalls.at(-1).cache === 'no-store'`。
- [ ] Step 2 — `node --test tests/cloud-player.test.mjs` で失敗を確認する。
- [ ] Step 3 — fixed registryから既存manifest・音声管理・入力変換・engine・controller・rendererを読み、同じ依存注入で起動する。データから任意import/画像URLを組み立てない。HTML出力と同じ全画面CSS設定を新しいページ側へ置く。
- [ ] Step 4 — noindex/no-referrer、読込み中、同一404案内、通信再試行を実装。ページ離脱時に音声とゲームを終了し、bfcacheから復帰した場合は表示前に再取得する。開始済みゲームを公開停止だけで遠隔回収できるとは扱わない。
- [ ] Step 5 — `shared-player-browser-tests.html` で開始→接近→出題→正解→襖が開く→移動→次問→クリアの順序を、既存ランタイムで確認。別オリジンのサービスから問題を取得する場合も、画像・音声はサイト側の正しい相対パスで動く。
- [ ] Step 6 — 新規試験と保護対象hashを通し、`feat: play published games from compact share URLs` としてコミットする。

### Task 8: 全体回帰・公開設定チェック・運用手順

**Files:** Create `tools/check-cloud-release.mjs`, `tests/cloud-release.test.mjs`, `docs/cloud-operations.md`, `app/account/privacy.html`。Modify `README.md`, `.github/workflows/cloud-tests.yml`, `supabase/config.toml`, `tests/cloud-browser-tests.html`。

**Interfaces:** `checkCloudRelease({repoRoot,publicConfig,baseline}) -> {ok,errors,warnings}`。環境を変更せず、未設定・秘密情報・保護対象変更・URL長・公開用ファイルを検査する。

- [ ] Step 1 — 配布物に管理キーが紛れたケース、クラウド未設定、保護対象改変、未記入の問い合わせ先、80文字超URLをfixtureで作り、release checkerが拒否する失敗テストを書く。例：`result.errors.includes('PROTECTED_RUNTIME_CHANGED')`。
- [ ] Step 2 — `node --test tests/cloud-release.test.mjs` の失敗を確認する。
- [ ] Step 3 — checkerと運用手順を実装。利用者説明には「登録不要時は端末内処理」「オンライン保存・公開操作後はサーバーへ送信」「リンクを知る人は閲覧可能」を分けて明記する。成績未収集と通常アクセスログを混同しない。
- [ ] Step 4 — 認証済み本人からの削除申請→公開停止→教材削除→認証情報削除、不正投稿停止、freeの休止からの復帰、バックアップ・復元、新規保存／公開の一時停止、期限切れ記録の除去を、管理者専用手順として記載する。
- [ ] Step 5 — CIで `pnpm install --frozen-lockfile`、SDK build、`node --test tests/*.test.mjs`、`supabase test db`、localhost専用integrationを実行し、失敗0を確認する。ブラウザー試験は別途実画面で実施する。
- [ ] Step 6 — 保護対象が公開済みコミットと一致し、HTML出力に認証SDKが入らないこと、既存ブラウザー試験の保存・入力・枠色・襖遷移・音声が維持されていることを記録する。
- [ ] Step 7 — 最終段階で独立したコードレビューを実施し、指摘修正を再試験する。新機能の実環境試験はTask 9未完了なら未実施と明記し、`test: verify cloud isolation and preserve fusuma gameplay` としてコミットする。

### Task 9: 所有者の外部設定・接続試験・限定公開

**Files:** Modify `core/cloud/config.js`, `docs/cloud-operations.md`, `app/account/privacy.html`。Create `docs/cloud-acceptance.md`（秘密や個人教材は含めない）。

**Interfaces:** 公開可能なconfigは `{enabled,supabaseUrl,publishableKey,appBaseUrl,sharedEndpoint}` だけ。defaultはenabled:false。URL基準は固定した所有サイト、認証callbackはapp/account/callback.html。秘密はホストの秘密管理だけに置く。

- [ ] Step 1 — 所有者に、Supabaseの所有アカウント・無料プロジェクト作成先・保存地域、Google OAuth設定の管理者を確認する。ログイン・同意が必要なら本人に依頼。料金・無料休止条件・規約を設定直前に再確認し、有料化やカード登録はしない。
- [ ] Step 2 — 専用の検証プロジェクトを用意し、migration差分と対象を確認して適用する。Googleログインの最小scope、許可origin・callback、PKCE、匿名登録無効、関数権限を設定する。既存プロジェクトのリセットや共有DBへの破壊的操作は禁止。
- [ ] Step 3 — Edge Functionの環境へHMAC秘密情報と管理キーを安全に設定し、公開読取り関数だけ匿名起動を許可する。信頼する接続元情報が外部から偽装できないことを実測し、保証できない場合は公開を止めて入口を見直す。任意ヘッダーをそのまま信用しない。
- [ ] Step 4 — 期限切れ記録の除去ジョブを設定して実行結果を確認。設定済み公開キーとURLだけをconfigへ反映し、操作A（所有者）／B（別の検証用作成者）／未ログインの実試験を行う。外部に試験用アカウントを作る場合も所有者の承認範囲を確認する。
- [ ] Step 5 — 公開先の専用オリジン・独自ドメイン採否、問い合わせ／削除窓口、バックアップ保持期間、運営費と稼働方針を所有者と決める。初回の少人数試験と広い一般公開を分け、決まらない項目があれば広い公開は行わない。
- [ ] Step 6 — 認証成功／中断、保存・配布更新・停止・削除、学校共用回線の想定負荷、別ブラウザーでの再生を確認する。Classroomへ勝手に試験投稿しない。実機未確認の端末を対応確認済みとしない。
- [ ] Step 7 — 最終承認済みの公開範囲だけに反映し、実際の共有URLで再試験する。公開したURL・設定したもの・費用の状態・未確認事項・戻し方を報告する。利用者教材や秘密情報をリポジトリへ追加しない。
- [ ] Step 8 — 検証記録を `docs: record verified cloud sharing release` としてコミットする。外部設定で止まった場合はローカル実装の完了範囲と、共有URLがまだ発行できない理由を明示する。

## 設計との対応と完了判定

| 設計の項目 | 実装Task |
| --- | --- |
| 短いURL、許可データ、既存ゲーム維持 | 1・7・8 |
| 会員・所有者・free上限・将来のプラン | 2・3・4 |
| 下書きと公開版、更新・停止・削除 | 2・5・6 |
| 通信失敗・二重操作・並行処理 | 2・3・5 |
| 認証復帰、端末内保存、未反映paste | 4・5 |
| 匿名閲覧・権限・秘密情報・負荷対策 | 2・3・7・8・9 |
| 費用、公開先、削除・停止・バックアップ運用 | 8・9 |
| 既存57件の再検証、ブラウザー、実環境 | 1・8・9 |

「画面実装済み」「DB権限試験済み」「本物のログインと共有URLを確認済み」を分けて報告する。最終完了はTask 9の公開範囲で実際に動くURLを確認した時点。確認前に「配布できるようになった」と言わない。

## 参照した一次資料

- [Supabase SDK 2.117.2の公開情報](https://registry.npmjs.org/@supabase/supabase-js/2.117.2) — Node 22以上と固定バージョンの確認。
- [esbuild 0.25.5公式リリース](https://github.com/evanw/esbuild/releases/tag/v0.25.5) — 静的なSDKビルドに使用する固定版。
- [Supabase DB試験](https://supabase.com/docs/guides/database/testing)、[CLI試験](https://supabase.com/docs/guides/local-development/cli/testing-and-linting)、[GitHub Actionsでの試験](https://supabase.com/docs/guides/deployment/ci/testing) — 本番DBを使わない検証経路。
- [Supabase秘密情報の管理](https://supabase.com/docs/guides/functions/secrets) — ブラウザー用公開キーとサーバー専用秘密情報の分離。

## 実装への引継ぎ

この計画は未実施。ユーザーが内容を確認した後、以前指定された通常実装を維持して `superpowers:executing-plans` へ進む。外部サービスやOSへの重要な変更が必要になった時だけ、その具体的な操作を確認する。

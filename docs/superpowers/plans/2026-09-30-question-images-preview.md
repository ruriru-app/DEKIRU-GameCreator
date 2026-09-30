# Question Images and Per-Question Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 問題に画像を1枚追加し、上下左右の自動配置を右側ですぐ確認でき、ファイル保存・HTML配布・クラウド共有でも画像が保持されるようにする。

**Architecture:** 画像はブラウザー内で縮小し、教材データに同梱する。静止プレビューと本番の問題表示を共用し、ゲームの判定・演出制御は維持する。プロジェクト1と2を併用し、クラウドの読取り側を先に互換対応してから新形式の書込みを有効化する。

**Tech Stack:** 既存のJavaScript ES modules、HTML/CSS、Canvas、Node組込みテスト、PostgreSQL/pgTAP、Supabase、GitHub Pages。既存依存と固定バージョンを維持し、新規ライブラリー・有料サービスは追加しない。

**Spec:** `docs/superpowers/specs/2026-09-30-question-images-preview-design.md`（2026-09-30承認済み）。

## Global Constraints

- 元ファイルは10 MiB以下、長辺8192 px以下・2500万画素以下。JPEG・PNG・WebPのみ。
- 保存画像はJPEGまたはPNG、長辺1280 px以下、Base64化前128 KiB以下。配置は `top/bottom/left/right`、説明は200文字以下。
- JPEG品質は0.85から0.65まで、縮小長辺は1280 pxから640 pxまで。小さい元画像は拡大せず、元寸法を下限にする。
- オンラインのプロジェクト2は正規化JSONで2 MiB以下、画像を除く部分は256 KiB以下。プロジェクト1は従来の256 KiB以下。DBの正規化前 `projectText` は4 MiB以下。
- 編集用ファイル5 MiB、オンライン200問・保存20件・同時公開10件、既存回数制限を維持する。上限超過で画像を黙って消さない。
- ゲーム画面の78%以内のパネル、左右画像幅約32%、表示幅600 px以下では左→上・右→下。写真の縦横比を維持し全体を表示する。
- PCの問題プレビューは1280×720の縮小表示。編集画面880 px以下では縦並びと端末幅に応じた表示。
- 旧教材・共有ID・登録制限を保持。ローマ字変換、Typingエンジン、音声管理、イベント制御、素材と各演出時間を変更しない。
- 本番DBをresetしない。旧migrationを編集・再実行しない。秘密情報、実教材、私的メールをテストや公開ファイルに含めない。
- 既存の分離済み作業場所 `.worktrees/cloud-sharing` を再利用する。開始点は設計書commit `9464cde`、アプリの基準は `bb74741`。実装計画の承認まで製品コードを編集しない。

## Review Focus

1. 同一問題に画像A→Bと素早く選ぶ、処理中に問題削除・教材読込み：古い非同期結果が戻らない（Task 2/4）。
2. プレビュー選択後の並び替え・削除、キーボード編集中の即時更新：表示対象とフォーカスを失わない（Task 4）。
3. 最大画像を含む教材でGoogleログイン退避が容量不足：画像を失わず画面遷移を止める（Task 1/4）。
4. 画像付き下書き保存後も配布版は旧画像、画像だけの変更中に通信成功：公開版・保存状態を誤認しない（Task 5）。
5. 静止プレビューは正しいが書き出したHTMLで画像や追加コードが欠落：オフラインの実配布物でも同じ問題を表示する（Task 3/6）。

## 進め方・ファイルの責任

以前のユーザー希望「通常実装」を引き継ぎ、同じ担当が順に実装し、最後に独立したコードレビューを行う。各Taskはテスト失敗→最小実装→成功確認→対象だけコミット。下記Taskは一つの承認済み機能の依存順であり、別サービスの並行新設ではない。

| ファイル | 責任 |
| --- | --- |
| 新規 `core/image-format.js` | バイト列の形式・寸法検査。DOM・ネットワークに依存しない |
| 新規 `core/question-image.js` | 保存画像の検証と定数 |
| 新規 `core/project-format.js` | 旧・新プロジェクトの安全な正規化 |
| 新規 `Typing/creator/image-processor.js`、`question-image-controller.js` | ファイル処理、競合する画像選択の管理 |
| 新規 `Typing/creator/preview-controller.js` | 問題選択、静止／全体の切替えと後片付け |
| 既存 `renderer.js`、`style.css` | 共通の問題表示と静止プレビュー入口。新しい実行モジュール依存は追加しない |
| 既存 creator／project-file／cloud 関連ファイル | 編集UI、保存・ログイン退避・公開の接続 |
| 新規 `supabase/migrations/202609300001_question_images.sql` | 新形式、容量検証、ランタイム互換、段階公開の書込みゲート |

## Task 1: 画像データと編集ファイルの互換性

**Files:** Create 上記 `core/` の3ファイル、`tests/question-image.test.mjs`、`tests/fixtures/question-images.mjs`。Modify `Typing/creator/project-file.js`、`creator-state.js`、`core/cloud/auth-resume.js`。Test 既存 `project-file.test.mjs`、`creator-state.test.mjs`、`cloud-resume.test.mjs`。

**Interfaces:** `readImageInfo(bytes:Uint8Array): {mime,width,height}` はJPEG/PNG/WebPの有効なヘッダーを有限走査し、不正ならError。`normalizeQuestionImage(value): Image` は厳密な5キーを持つ `{dataUrl,width,height,placement,alt}` を返すかError。`normalizeProjectData(value,{strictKeys=false}={}): ProjectV1|ProjectV2` は正規化したコピーを返す。storeに `setQuestionImage(id,image|null):void` を追加し、画像追加時だけ1→2へ昇格する。存在しないIDには変更・昇格・通知を行わない。

- [ ] テストfixtureに実際にデコードできる小さいJPEG/PNG/WebPの固定データを用意する。公開・個人画像を使わない。画像末尾や寸法の破損、JPEGコメントによる容量境界用のfixtureもここに集約する。
- [ ] 次の失敗テストを追加する。旧ファイルのバイト互換、未知形式、SVG/HTTP/blob URL、Base64不正、寸法偽装、重複ID、説明201文字も拒否する。
  ```js
  assert.equal(normalizeQuestionImage(imageAtBytes(131072)).width, 1);
  assert.throws(() => normalizeQuestionImage(imageAtBytes(131073)));
  assert.deepEqual(parseProjectFile(serializeProject(projectV2)), projectV2);
  store.setQuestionImage('q1', pngImage); assert.equal(store.getSnapshot().schemaVersion, 2);
  store.setQuestionImage('q1', null); assert.equal(store.getSnapshot().schemaVersion, 2);
  assert.equal(saveAuthResume(quotaThrowingStorage, imageResume).ok, false);
  ```
  `imageAtBytes(n)` は正しいJPEGにコメントセグメントを挿入して指定長へ調整するfixture関数。元画像のpixel寸法を変えない。
- [ ] `node --test tests/question-image.test.mjs tests/project-file.test.mjs tests/creator-state.test.mjs tests/cloud-resume.test.mjs` を実行し、新しい機能の未実装による失敗を確認する。
- [ ] インターフェースを実装する。原画像検査は拡張子でなくバイト署名を使い、区間長・EOF・寸法・整数を検証する。保存画像はJPEG/PNGだけ、正規Base64と容量・1280 px上限を確認する。旧local importの未知フィールド除去を維持し、新形式では想定外キーを拒否する。ファイル外側versionとproject.schemaVersionを一致させる。
- [ ] 同じテストを再実行して全成功を確認する。画像を含む複製・保存状態比較・ログイン復元、5 MiBちょうど／超過も試験する。`core/cloud/auth-resume.js` は画像が保持されれば無用に変更しない。
- [ ] 対象ファイルだけをコミットする：`feat: preserve question images in project files`。

## Task 2: ブラウザー内の画像縮小と選択競合の防止

**Files:** Create `Typing/creator/image-processor.js`、`question-image-controller.js`、`tests/image-processor-browser-tests.html`、`tests/question-image-controller.test.mjs`。

**Interfaces:** `processQuestionImage(file,{signal,placement='top',alt='問題の画像'}={}): Promise<Image>`。`createQuestionImageController({store,processImage=processQuestionImage,onStateChange=()=>{}})` は `select(id,file):Promise<void>`、`remove(id)`、`setPlacement(id,value)`、`setAlt(id,value)`、`reset()`、`getState():{busy:boolean,pendingIds:string[],errors:Record<string,string>}`、`subscribe(listener):()=>void`、`destroy()` を返す。Task 1の形式検査・画像正規化・store APIを使う。

- [ ] 失敗テストを書く：10 MiB超、長辺8193、面積25000001はデコード前に拒否。JPEGのEXIF向き、PNG透過、WebP、元寸法が640未満、壊れた画像を用意し、出力は長辺≤1280・バイト数≤131072、撮影メタデータなし、元ファイル不変とする。
  ```js
  const a = controller.select('q1', fileA), b = controller.select('q1', fileB);
  resolveB(pngImage); await b; resolveA(jpegImage); await a;
  assert.deepEqual(store.getSnapshot().questions[0].image, pngImage);
  controller.reset(); assert.equal(controller.getState().busy, false);
  ```
- [ ] Nodeのcontrollerテストとブラウザーのprocessorページを実行し、未実装の失敗を確認する。ブラウザーは実際のCanvasデコード・再エンコードで検証する。
- [ ] 長辺候補 `[1280,1024,800,640]` を元寸法で上限処理・重複除去し、JPEG品質 `[0.85,0.75,0.65]` の順に最初の容量内を選ぶ。透過はPNGのまま縮小する。非透過の写真はJPEGにする。WebPは最初のフレームを静止画像化する。どの候補も収まらなければ元画像を保持してエラーにする。
- [ ] デコード後のbitmap、object URLは必ず解放する。AbortSignalと問題ごとの採番、教材切替えのepochで古い結果を破棄する。画像データ更新は成功時の1回だけ行い、配置・説明の最新編集も上書きしない。
- [ ] 再試験し、A→B、処理中の問題削除、別教材に同じIDがある場合、破棄後の完了、透明な図の容量超過で元の画像が残ることを確認する。
- [ ] コミット：`feat: prepare bounded question images locally`。

## Task 3: 本番と静止プレビュー共通の問題表示

**Files:** Modify `Typing/templates/fusuma/renderer.js`、`style.css`、`core/html-exporter.js`、`tests/fixtures/runtime-baseline.json`。Create `tests/question-layout-browser-tests.html`。Test `html-exporter.test.mjs`、`standalone-browser-tests.html`、`feedback-browser-tests.html`、`title-browser-tests.html`。

**Interfaces:** renderer内に共通の非公開 `renderQuestionContent(root,question)` を設ける。新規export `mountFusumaQuestionPreview({host,project,questionId,manifest})` → `{update({project,questionId}),destroy()}`。実ゲームの `mountFusumaGame` インターフェースは不変。内部shell生成を共用するが静止側はengine/audio/controllerを一切生成しない。

- [ ] 失敗テストを追加する：同じ1280×720の本番と静止で、問題・画像・入力欄の矩形が1 px以内で一致。4配置、320/600/601/1280幅、長文、縦長・透過画像、画像あり→なし、壊れた画像を確認する。
  ```js
  assert(imageRect.right <= panelRect.right && imageRect.bottom <= panelRect.bottom);
  assert(inputRect.bottom <= panelRect.bottom && panelRect.height <= frameRect.height * .78 + 1);
  assert.equal(audioCalls.length, 0); // 静止プレビューの初期化・更新・破棄を通して
  assert.equal(quiz.classList.contains('is-shaking'), false);
  ```
- [ ] ブラウザーテストで既存表示が画像に対応していないことを確認する。画像データ文字列をHTMLへ挿入するテスト実装は使わない。
- [ ] 画像付きのときだけ問題内容部分をgrid/flexにし、入力・ヒントを内容スクロールから分ける。共通更新処理で画像srcは保存形式の許可パターン・サイズを再確認し、同じ画像ならsrcを再設定しない。static側の入力はreadonly、送信と自動focusを無効にする。
- [ ] static側は到着後の同じ襖合成を表示し、問題N/総数とタイトルを設定する。実ゲームは既存showQuestionへ共通更新処理を追加するだけに留める。新しいimportをrendererに追加せず、単一HTMLのモジュール構成を保つ。
- [ ] `buildStandaloneHtml` は画像付き入力をTask 1の正規化で検証し、画像をproject JSONへ埋め込む。画像エラー時はダウンロードを始めない。既存HTML/画像なしfixtureの挙動を維持する。
- [ ] 新テスト、既存の入力・feedback・title・standaloneブラウザーテストを実行し全成功を確認する。差分がrenderer/style/exporterだけであることを確認後、それらだけ基準hashを更新し、全Nodeテストを通す。ほかの保護対象hashは変更しない。
- [ ] コミット：`feat: share image question layout with still preview`。

## Task 4: 問題カード・プレビュー切替え・処理中ガード

**Files:** Create `Typing/creator/preview-controller.js`、`tests/preview-controller.test.mjs`、`tests/question-images-creator-browser-tests.html`。Modify `Typing/creator/creator.js`、`creator.css`、`index.html`、`cloud-controls.js`。Test `cloud-controls.test.mjs`、`cloud-browser-tests.html`。

**Interfaces:** `createPreviewController({store,host,manifest,audioManager,mountGame,mountQuestion,onStateChange})` → `{selectQuestion(id),showGame(),restartGame(),getState(),setVolume(n),setMuted(b),reset(),destroy()}`。状態は `{mode:'game'|'question',selectedId:string|null}`。`mountGame({host,project,manifest,audioManager})` はcreator側で既存engine/converter/controllerを渡すアダプター、`mountQuestion` はTask 3の入口。Task 2の処理中状態をcloud-controlsへ `canCommit:()=>boolean` と `subscribeCommitState:listener=>unsubscribe` として渡す（既存呼出しは許可既定値）。

- [ ] 失敗テストを書く：カードの操作順「↑ ↓ 複製 削除 プレビュー」、画像追加/配置/alt/差し替え/削除、選択印、文字入力中のfocus維持、選択だけではdirty不変、画像変更だけでdirty、並び替え後の同じID、削除後の隣接選択、0問・別教材。
  ```js
  preview.selectQuestion('q2'); store.moveQuestion('q2', -1);
  assert.equal(preview.getState().selectedId, 'q2');
  assert.equal(store.getState().previewDirty, true); // 静止更新は全体試遊への反映ではない
  assert.equal(preview.getState().mode, 'question');
  assert.equal(document.activeElement, editingInput);
  ```
- [ ] Nodeとブラウザーで未実装の失敗を確認する。
- [ ] creatorの既存イベント委譲を拡張する。カード全体の作り直しを入力ごとに行わない。選択変更・画像の完了・説明・位置・文章・題名を共通previewへ反映する。PCの静止表示は1280×720を右ペインへscaleし、ResizeObserverを破棄時に解除する。
- [ ] 全体→静止で `game.destroy()` と `audioManager.stopAll()` を呼び、保留タイマーを残さない。静止→全体は最新の有効な教材で開始画面を作る。必須欄エラーでは開始せず編集欄へ案内する。説明に「ゲーム全体に戻すと最初から」を表示する。静止表示で音量設定自体は失わない。
- [ ] 処理中は端末保存・export・クラウドsave/publish/copy/retry/loginをUIとハンドラー両方で拒否する。確認ダイアログの確定直前にも再確認する。離脱警告には処理中も含める。教材読込み・表の置換・ログアウトによる消去では画像controller/preview選択をresetする。
- [ ] 画面幅≤880のボタン操作時だけプレビューへ移動する。縮小画像のサムネイルはlazy loading、並べ替えや編集中に勝手にスクロールしない。容量表示と権利・個人情報の注意を追加する。
- [ ] テストを全成功にし、ログイン退避失敗時の画像保持、通信中画像だけ変更、ミュート状態、処理中にダイアログが開いていた場合も確認してコミット：`feat: add per-question preview controls`。

## Task 5: クラウド・DB・共有プレイヤーの旧新互換

**Files:** Modify `core/cloud/project-validation.js`、`contracts.js`、`public-api.js`、`p/runtime-registry.js`、`Typing/creator/cloud-controls.js`。Create `supabase/migrations/202609300001_question_images.sql`、`supabase/tests/question-images.test.sql`。Update 既存cloud-validation/resume/state/controls/public-handler/playerテスト、`tests/integration/cloud-db.test.mjs`、`supabase/functions/shared-game/index.ts`（生成物）。

**Interfaces:** 既存 `serializeCloudProject(p)`、`validateCloudProject(p,{mode})`、`checkedPublicGame(value)` を両形式に拡張し戻り値は維持。`CLOUD_LIMITS` に `imageProjectBytes:2097152` を追加し、既存 `bytes:262144` を文章上限として残す。`resolveRuntime` は `fusuma-1` と `fusuma-2` の固定許可リスト、同じ検証済みrendererを使う。

- [ ] JS/SQLの失敗テストを追加する。旧形式を一切緩めず、image付きv1、未知imageキー、不正寸法、形式不一致、131073 bytes、文字256 KiB超、全体2 MiB超を拒否する。文字・全体サイズは上限ちょうどを許可。正規化JSONのキー順はimage末尾、image内部はdataUrl/width/height/placement/altで統一しSQLと一致させる。
  ```js
  assert.equal(checkedPublicGame({schemaVersion:1,project:projectV2,runtimeVersion:'fusuma-2',publicationVersion:1}).ok, true);
  assert.equal(checkedPublicGame({schemaVersion:1,project:projectV2,runtimeVersion:'fusuma-1',publicationVersion:1}).ok, false);
  assert.notEqual(serializeCloudProject(oldImageDraft), serializeCloudProject(newImageDraft));
  ```
- [ ] 画像付きの正規化JSONで2 MiB境界、画像を除いた正規化JSONで256 KiB境界を生成し、各フィールド制限も満たしたfixtureであることをassertする。Nodeテストと一時DBのpgTAPで、新機能が拒否されるREDを確認する。本番DBでは失敗試験しない。
- [ ] DB migrationはtransaction内で関数を置換する。`private.project_text`、`validate_project`、`apply_mutation`、`public.creator_context` を両形式対応にする。`private.validate_question_image(image jsonb):boolean` を追加しBase64・バイト署名・ヘッダー寸法・容量・許可キー・配置を検証する。schema private内の新関数も実行権限を明示的にrevokeする。
- [ ] publicationsのruntime制約を許可2値に拡張し、publish時はproject.schemaVersionから値を決める。旧行・shareIdを変えない。republishは保存下書きではなく以前の公開snapshot/runtimeを再公開する。
- [ ] 段階公開のため `private.service_control.question_images_enabled boolean not null default false` を追加する。falseなら新形式のsave/publish/republishだけ拒否し、read/load/unpublish/deleteとv1操作は継続する。save/publishは対象下書き、republishは既存snapshotの形式で判定する。context.capabilities.questionImagesでUIへ伝え、オンライン上限情報も更新する。サーバーが未対応の場合はfalse扱い。ローカル編集・ファイル配布にはこのフラグを要求しない。
- [ ] `node tools/build-shared-function.mjs` で生成物を再構築する。秘密・外部importなしを維持。Nodeテスト、一時DBの `supabase test db`、`node --test tests/integration/cloud-db.test.mjs` を成功させる。ローカルSupabaseがない環境は既存GitHub Actionsで実施し、未実施を成功扱いしない。
- [ ] 実JWT所有者A/B/匿名、保存中の画像変更、公開snapshot不変、同時操作・上限・停止・削除、旧公開URLが同じshareIdで継続することを試験してコミット：`feat: support image projects in cloud sharing`。

## Task 6: 総合受入れと独立レビュー

**Files:** Extend `tests/standalone-browser-tests.html`、`tests/shared-player-browser-tests.html`、`tests/cloud-browser-tests.html`。Create `docs/question-images-acceptance.md`。Modify `docs/cloud-operations.md`、`app/account/privacy.html`。

**Interfaces:** Task 1–5のAPIだけを使う。新しい製品APIは追加しない。ブラウザー試験ページは既存と同じ `body[data-status='pass'|'fail']` と各結果を表示する。

- [ ] HTML配布物を画像付きで実生成し、ネットワークを必要としない条件で開く失敗テストを追加する。画像を次問へ持ち越さず、公開プレイヤーでも同じ配置になることをassertする。
- [ ] `node --test tests/*.test.mjs`、Endpoint再ビルドと差分検査、DB/実JWT試験を実行する。全成功が条件。製品ソースを使うブラウザーでcreator、画像処理、配置、入力、feedback、title、standalone、共有プレイヤーのページを実行し、失敗0と画像を残す。
- [ ] 画像なし／ありの実ゲームで「開始→移動→問題1→正解→襖開く→奥へ移動→問題2→クリア→再挑戦」を確認し、通常と復習・かな入力のオレンジ枠も確認する。無音の静止確認だけをゲーム全体の合格としない。
- [ ] 保存容量、画像の同梱、画像の権利と個人情報、画像が多い教材の制限、停止で既読込分を回収できない点を既存保存・プライバシー案内へ反映する。一般登録・課金設定は変更しない。
- [ ] `verification-before-completion` と `requesting-code-review` の手順に従い、全差分を一度独立レビューする。入力形式・旧データ互換・処理競合・画像漏洩・配布HTMLを重点にし、指摘は再現テストを追加して修正する。
- [ ] 全保護対象差分を `bb74741` と比較する。renderer/style/exporter以外の入力・制御・素材のhashは一致を要求する。最後の試験結果と未確認項目を受入れ記録へ記載しコミット：`test: verify image question sharing end to end`。

## Task 7: 既存URLを維持した段階公開

**Files:** `docs/question-images-acceptance.md`、`docs/cloud-operations.md`、実装済み配布物のみ。DB/Edge Function/GitHub Pagesの専用対象以外は触らない。

- [ ] 実装とレビュー結果をユーザーへ示し、本番更新の対象を確認する。対象は `ruriru-app/DEKIRU-GameCreator` とSupabase `xrqgsujvduyxtrbegzri`。FUERU、他アプリ、Authの登録制限、支払設定を変更しない。
- [ ] リモート差分・教材件数・現行schemaを読取り確認する。所有者の教材と公開版・共有IDのバックアップは公開repoの外の作業用 `work/cloud-backups/` に保存し、認証情報・Authテーブル・秘密鍵を含めない。取得に必要な権限がなければその段階で本人へ依頼する。本番テストには実教材を上書きしない。
- [ ] まずPagesの旧新読取り互換版を公開し、既存共有URLを確認する。次に追加migrationを適用（画像書込みfalse）、Edge Functionの両形式対応版を配置してv1の匿名取得を確認する。構成不足で古い配布版が消えたら、書込み有効化へ進まない。
- [ ] DB/共有入口の新形式検証が揃ったことを確認後、専用フラグをtrueにする。所有者が画像付き試験教材を保存・公開し、匿名の別ブラウザーで画像を確認する。試験教材の更新・停止・再公開・削除はその教材だけで実施する。
- [ ] Pages配信commit、反映したmigrationとEdge Function、実ブラウザーの結果を記録する。既存の14問教材URLでも題名・開始・問題表示を確認する。試験で作ったデータを残すか消すかは対象を特定して扱う。
- [ ] 不具合時は画像の書込みフラグをfalseにし、両形式の読取り版と保存データを維持する。旧コードへ一括巻戻しして画像を落とさない。実際に検証できた範囲と残作業を最終報告する。

## 計画の自己確認と実行待ち

- 仕様1–5：Task 2–4、仕様6–8：Task 1/3/5、仕様9：Task 6/7、仕様10：全体制約に対応。
- 回帰範囲を入力・演出まで含め、画像容量・ログイン退避・非同期競合・公開版との分離を各Taskの試験へ割当てた。
- 計画作成時のNode基準試験は137件成功。DB・ブラウザーの新機能試験は未実施であり、承認後に実装と併せて行う。
- [ ] ユーザーによる本計画の確認（通常実装の希望を維持）
- [ ] `executing-plans` を使ってTask 1から実装開始

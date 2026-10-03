# Shared Question Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native implementation in this chat. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create per-task implementer agents. Request one independent whole-change review after local verification.

**Goal:** 同一画像を1回だけ保存し、提供された32問の教材を画質・内容を変えずオンライン上限2 MiB内に収める。

**Architecture:** 保存用schemaVersion 3に画像プールと参照を追加し、編集・描画は従来の展開済み形式を使う。旧形式1・2の読み取りと既存共有URLを維持する。新形式の書き込みは専用フラグを使い、読取り側の反映と検証後に有効化する。

**Tech Stack:** 既存のJavaScript ES modules、Node.jsテスト、PostgreSQL/Supabase、GitHub Pages。新しいサービスや製品依存は追加しない。

**Spec:** `docs/superpowers/specs/2026-10-03-shared-question-images-design.md`（2026-10-03承認済み）

## Global Constraints

- オンライン全体2 MiB、文章256 KiB、200問、画像1枚128 KiB／長辺1280pxは維持。
- 端末保存ファイル5 MiB、画像本体・参照とも最大200件、展開後36 MiBの上限。
- 新形式は `images:[{id,dataUrl,width,height}]`、問題のimageは `{imageId,placement,alt}`。初出順に `img1` から採番し、dataUrl完全一致でまとめる。
- 画質・画像データ・問題内容・並び順・配置・襖の動き・音声を変えない。単一HTMLは従来の自己完結形式を維持し、その軽量化は範囲外。
- 保存件数・公開件数・所有者権限・認証・通信制限・課金設定・他プロジェクトには触れない。
- 既存教材の一括変換・削除はしない。実教材は端末内で検証し、GitHub/CI/外部サービスに送らない。
- 作業チェックアウトは既存 `feature/cloud-sharing`。実装開始時にattached worktreeと差分を確認して再利用し、別作業の変更を巻き込まない。

## Review Focus

1. 画像を複製した問題の配置変更・画像削除が、他の問題まで変えてしまう事故（Task 1・3）。
2. 新旧形式の違いだけで未保存判定になったり、応答消失後の再送が別操作になる事故（Task 2・4）。
3. 新形式を検証後に再展開して送信し、通信容量が元に戻る事故（Task 2・4）。
4. 多数の画像参照・欠落参照・画像重複・寸法不一致による過大展開や検査抜け（Task 1・4）。
5. 本番切替中の旧タブ・旧URL・ログイン復帰が教材を失う事故（Task 2・3・5）。

---

## Task 1: 共通の画像プール変換と端末保存

**Files:** 新規 `core/project-image-pool.js`, `tests/project-image-pool.test.mjs`。変更 `core/project-format.js`, `Typing/creator/project-file.js`, `tests/question-image.test.mjs`, `tests/project-file.test.mjs`。

**Interfaces:**
- `packProjectImages(project)`：検証済みの内部形式1・2を受け、画像があれば決定的な形式3、画像がなければ従来形式を返す。引数は変更しない。
- `unpackProjectImages(project)`：形式3のキー・画像・参照を検証し、独立した各問題のimageを持つ内部形式2を返す。形式1・2は既存検証へ回す。
- 画像プールモジュールは `question-image.js` に依存し、`project-format.js` をimportしない。通常の問題・設定の検査は既存normalizerに残し、循環依存を作らない。
- `normalizeProjectData` は形式3を上記で展開して既存検査を適用する。`serializeProject` は外側versionとproject.schemaVersionを揃えて形式3を保存し、`parseProjectFile` は1・2・3を受け、内部形式を返す。

- [ ] 合成画像で「同じ画像25回→画像本体8個」「配置・altだけ違っても本体共有」「展開後は内容・画像バイト列完全一致」「入力不変」「1問変更が他問へ波及しない」の失敗テストを作る。
- [ ] 欠落/重複/未使用ID、重複画像本体、非正規ID、余計なキー、寸法不一致、不正画像、201件、36 MiB超を拒否するテストを追加する。プール内IDは `img[1-9][0-9]*` の範囲に限定し、正規化時は初出順に再採番する。
- [ ] `node --test tests/project-image-pool.test.mjs` で機能未実装による失敗を確認する。
- [ ] 上記変換を実装する。件数・文字列長を展開前に制限し、既存画像検査を各画像本体に適用する。参照先のimageオブジェクトを問題間で共有しない。
- [ ] 古い編集ファイルの読み込み、新ファイルの保存/再読込み、5 MiB境界と失敗時の元状態維持をテストし、該当テスト群と全Nodeテストを通す。
- [ ] この単位のコード・テストのみをコミットする。実教材は追加しない。

## Task 2: クラウドの読み書き・共有プレイヤーの境界

**Files:** 変更 `core/cloud/project-validation.js`, `core/cloud/owner-api.js`, `core/cloud/public-api.js`, `core/cloud/contracts.js`, `Typing/creator/cloud-controls.js`, `p/runtime-registry.js`, `tests/cloud-images.test.mjs`, `tests/cloud-controls.test.mjs`。新規 `tests/cloud-image-pool.test.mjs`。

**Interfaces:**
- `serializeCloudProject(project,{withoutImages=false})` は入力の形式を保って正規化文字列を作る。形式3は既存トップレベル項目、questions、imagesの順。画像本体は配列順、要素はid/dataUrl/width/height順、問題imageはimageId/placement/alt順。withoutImages時はimagesと各imageを除く。
- `validateCloudProject(project,{mode='draft'})` は1・2・3を検証し、受信形式を保った結果を返す。旧形式の上限判定はそのまま、新形式はプール込み2 MiBと画像を除く文章256 KiBを別々に検査する。
- 新規 `prepareCloudProject(project,{mode='draft',sharedImagesEnabled=false})` は内部形式を受け、フラグON時のみpackしてからvalidateする。出力は既存 `{ok,data}` / `{ok:false,error}`。
- `createCloudEditor` に `sharedImagesEnabled=()=>false` を追加する。saveDraft操作には不変の内部snapshotと `useSharedImages` を保持し、再送でも同じrequestId・形式を使う。
- `createOwnerApi.saveDraft({gameId,expectedVersion,requestId,project,useSharedImages=false})` はprepare結果だけをRPCへ送る。useSharedImagesはRPC引数へ含めない。loadGameは受信教材を検証して内部形式へ戻す。
- `checkedPublicGame` は `3 ↔ fusuma-3` を許可し、形式3を展開せず返す。既存Edge handlerはそのまま小さい応答を送れる。`resolveRuntime('fusuma-3')` のmount境界で内部形式へ戻し、同じ襖rendererに渡す。

- [ ] フラグOFF時の旧動作、ON時の重複除去、受信1・2・3、公開runtime不一致拒否を失敗テストにする。
- [ ] 重複前2 MiB超・除去後2 MiB未満がON時のみ保存可能となること、RPC本文と公開HTTP本文が形式3かつ2 MiB以内であることをassertする。
- [ ] save/load直後が未保存にならないこと、通信失敗後に同じ形式・requestIdで再送すること、保存中に編集してもsnapshotが変わらないことをassertする。
- [ ] `node --test tests/cloud-image-pool.test.mjs` のRED後に境界処理を実装する。状態管理には展開済みsnapshotだけを渡し、保存表現の差をdirty判定に持ち込まない。
- [ ] `node --test tests/*.test.mjs` で既存の認証・競合・所有者分離・共有停止等のテストも通し、この単位をコミットする。

## Task 3: 容量表示・ログイン復帰・ブラウザー互換

**Files:** 変更 `Typing/creator/creator.js`, `Typing/creator/cloud-controls.js`, `core/cloud/auth-resume.js`, `tests/cloud-auth.test.mjs`, `tests/project-file-browser-tests.html`, `tests/question-images-cloud-browser-tests.html`, `tests/shared-player-browser-tests.html`。新規 `tests/shared-images-browser-tests.html`。

**Interfaces:**
- 容量表示はTask 2の保存形式準備処理に合わせる。フラグ取得前/無効時は旧容量、有効時は実際に送信するプール形式の容量を表示する。変更通知をmountCloudControlsの追加callback `onStorageCapabilities({sharedImages})` で渡す。
- `saveAuthResume` はprojectとcloudLink.record.projectをそれぞれpackした状態でstorageへ格納し、`takeAuthResume` は内部形式へ戻す。既存の保存キー・TTL・returnTo制限と旧payloadの読取りは維持する。

- [ ] 同一画像の複製・配置変更・削除が独立すること、新旧ファイルの読込み、容量表示とRPC本文バイト数一致、フラグ取得失敗時に新形式で送信しないことを失敗テストにする。
- [ ] ログイン復帰用の保存値も重複除去されること、旧payloadも復帰できること、保存失敗・期限切れで未保存教材を勝手に置き換えないことをassertする。
- [ ] 関連NodeテストのRED後、上記表示と一時保存を修正する。ゲームのCSS・入力判定・遷移アニメーションは変更しない。
- [ ] ブラウザーで合成画像の作成→保存→再読込み→プレビュー→単一HTML再生を確認する。schema3共有プレイヤーと旧1・2の起動も確認する。
- [ ] 提供教材を端末内でのみ変換し、32問・25回添付・8画像・保存サイズ2 MiB未満・復元前後deepEqualを確認する。元ファイルは変更しない。
- [ ] 全Nodeテストを通してコミットし、画面確認の証跡は公開リポジトリ外へ保存する。

## Task 4: Supabase追加migrationと隔離DB試験

**Files:** 新規 `supabase/migrations/202610030001_shared_question_images.sql`, `supabase/tests/shared-question-images.test.sql`, `tests/fixtures/shared-image-projects.mjs`。変更 `tests/integration/cloud-db.test.mjs`, `tests/integration/local-supabase.mjs`。再生成 `supabase/functions/shared-game/index.ts`。

**Interfaces:**
- `private.service_control.shared_question_images_enabled boolean not null default false` を追加し、`creator_context().data.capabilities.sharedImages` として返す。
- 隔離試験専用adminに `setSharedImageWrites(enabled)` を追加する。既存の `setImageWrites(enabled)` と同様に一時DBだけを操作し、試験終了時にOFFへ戻す。
- `private.project_text(p jsonb)` と `private.validate_project(project_text text,mode text)` に形式3を追加する。文字列の正規化順はTask 2と一致させ、1・2の判定を維持する。
- `public.mutate_game` の新形式保存/公開/再公開には既存画像フラグと新フラグを両方要求する。runtime制約と選択をfusuma-3まで拡張する。読み取りは新フラグOFFでも既存の新形式を許可する。
- 公開スナップショット・共有ID・版番号・requestIdの規則と、所有者/RLS/GRANTを維持する。フラグ以外のプラン上限を変更しない。

- [ ] 旧形式成功、新形式フラグOFF拒否、ON保存/読込み/公開、同一URL更新、停止/再公開、所有者分離、同一requestId再送をpgTAPと実JWT試験に追加する。
- [ ] JS/SQLで同じ合成fixtureを使い、全体2,097,152/2,097,153 bytes、文章262,144/262,145 bytes、200/201件、画像131,072/131,073 bytes、壊れた参照の判定一致をassertする。
- [ ] 上記試験のREDを隔離DBで確認し、追加migrationだけで実装する。既存migrationを編集せず、本番では失敗試験をしない。
- [ ] `node tools/build-shared-function.mjs` で関数を再生成し、`node --test tests/*.test.mjs`、隔離DBの `supabase test db`、`node --test tests/integration/cloud-db.test.mjs` を通す。
- [ ] ローカルDBが利用不能なら既存のCloud isolation testsをfeatureブランチで一度起動する。全結果が出るまで本番へ進めない。認証情報・実教材をCIへ渡さない。
- [ ] 再生成が再現可能であることを確認し、コード・migration・テスト・生成物をコミットする。

## Task 5: レビュー・バックアップ・段階反映

**Files:** 更新 `docs/question-images-acceptance.md`, `docs/cloud-operations.md`。本番対象は既存Game CreatorリポジトリとSupabase `xrqgsujvduyxtrbegzri` のみ。

**Interfaces:** GitHub mainは公開アプリ、featureブランチは隔離試験。新形式書込みの停止/開始はTask 4の専用フラグだけを使う。

- [ ] 全変更を1回の独立コードレビューに渡す。上記Review Focusと、旧教材・公開配信・フラグOFF時の動作を重点確認し、重要な指摘を修正/再検証する。
- [ ] 教材・公開版・共有ID・版・件数と更新対象関数の現状を読み取り、公開リポジトリ外へバックアップする。権限や秘密の値は出力しない。対象プロジェクト不一致や保全できない場合は本番反映を止める。
- [ ] 既存共有URLの基準を取得したうえで、読取り互換アプリをPagesへ反映し、成功したcommitと公開コードを確認する。
- [ ] 追加migrationと生成済みshared-gameを専用Supabaseに反映する。新フラグはOFFのまま、旧教材・共有ID・旧形式の取得をバックアップと照合する。
- [ ] すべて合格してから新フラグをONにする。料金プラン・ログイン設定・公開対象ユーザーは変更しない。
- [ ] 合成画像の確認用教材で保存→読み戻し→匿名共有を実測し、最後は公開停止する。恒久削除や利用者の実教材の公開はしない。検証用教材が残る場合は利用者に件数を伝える。
- [ ] 最後に旧共有URL、公開関数の圧縮済み本文、元教材の不変性、単一HTMLを確認し、実行済み/未確認を区別して記録する。新形式の保存後は旧コードへ単純に戻さず、問題時は新規書込みだけ停止する。

## 実装開始前の確認

この計画はまだ実行していない。通常実装（このチャットで担当）を維持し、計画承認後にTask 1から順に進める。本番にログインできない場合や操作時の安全確認が必要な場合は、その箇所だけ利用者へ依頼する。

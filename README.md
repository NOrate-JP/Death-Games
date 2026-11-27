# DEATH GAMES

ローポリ3Dのテーブルを囲んで遊ぶ、デスゲーム風テーブルゲーム集。
Firebase（匿名ログイン + Realtime Database）と GitHub Pages だけで動きます。最大6人 + 観戦者。

## セットアップ

1. **Firebaseプロジェクトを作成**
   - Authentication → ログイン方法 → **匿名** を有効化
   - Realtime Database を作成（ロケーションはどこでも可）
   - Realtime Database → ルール に `database.rules.json` の中身を貼り付けて公開（首の向き同期用に `looks` も必要）
2. **設定値を貼る**（※配布zipには `js/firebase-config.js` を含めていません。初回だけ下の内容で作成し、以降は上書きされません）
   - プロジェクトの設定 → マイアプリ → Webアプリを追加 → 表示される `firebaseConfig` を
     `js/firebase-config.js` に貼り付け（`databaseURL` を必ず含める）
3. **GitHub Pagesで公開**
   - このフォルダの中身をリポジトリに push → Settings → Pages → Branch: main / root
   - Firebase の Authentication → 設定 → 承認済みドメイン に `ユーザー名.github.io` を追加

ローカルで試すときは `python -m http.server` などで配信してください（`file://` 直開きは不可）。
Firebase未設定でも「オフライン練習（CPU戦）」は遊べます。

## カード画像の差し替え

INDIAN SUM は `assets/cards/indian-sum/` に n0〜n5 / n10 / n15 / n20 / nm5 / nm10 / night / x2 / max0 / q / back（.png）。

RUSSIAN DECK は `assets/cards/russian-deck/` に dead / revive / attack / give / cancel / shuffle / skip / search / ma〜me / back（.png）。

LUCK BUTTON は `assets/cards/luck-button/` に skip.png / reverse.png / discard.png / double.png / danger.png / taboo.png / onehit.png / analyze.png / xray.png / shuffle.png / back.png を置くと差し替わります。


`assets/cards/count-cards/` に以下の名前でPNGを置くと自動で差し替わります（無いカードは仮カードを自動生成）。
推奨サイズ 200×300（2:3）。

| ファイル名 | カード | ファイル名 | カード |
|---|---|---|---|
| n0.png〜n9.png | 0〜9 | eq0.png | =0 |
| nm1.png | -1 | eqmax.png | =MAX |
| nm5.png | -5 | reverse.png | REVERSE |
| back.png | カード裏面 | plus2.png | +2 |
| shot.png | SHOT | double.png | DOUBLE |
| random.png | RANDOM | shield.png | SHIELD |

画像が無いカードはブラウザのコンソールに404が出ますが、動作に問題はありません。

## ファイル構成

```
index.html / css/style.css
js/app.js              画面遷移・ロビー・同期・演出キュー・ホスト代行(CPU/切断者/進行)
js/net.js              Firebase通信 / オフライン用ローカル実装（同じインターフェース）
js/match.js            全ゲーム共通の試合進行（ラウンド→敗者→処刑→次ラウンド/決着）
js/damage.js           ダメージ方式（ライフ / リボルバー / ラウンドライフ）
js/scene/scene.js      共通3Dシーン（部屋・テーブル・席・各席のリボルバー・警報・配札・カメラ・ポスト処理）
js/audio.js            効果音（すべてWebAudio合成）
js/card-art.js         カード画像ローダー
js/games/index.js      ゲーム登録所
js/games/count-cards/  COUNT CARDS（cards.js 定義 / rules.js ルール / view.js 表示）
js/games/liar-dice/    LIAR'S DICE（rules.js ルール / view.js 表示）
js/games/sprint-brain/  SPRINT BRAIN（rules.js 問題生成・判定 / view.js モニター・各問題UI）
js/games/luck-button/   LUCK BUTTON（rules.js ルール・カード / view.js ボタン装置・手札）
js/games/indian-sum/    INDIAN SUM（rules.js ルール・合計計算・CPU / view.js おでこのカード・判定演出）
js/games/russian-deck/  RUSSIAN DECK（rules.js ルール・CANCEL受付・CPU / view.js 山札・CANCELバー・各種選択）
js/hand-ui.js          カードゲーム共通の扇形手札（マウスオーバー/1回目タップで拡大＋効果テキスト）
```

## 新しいゲームの追加方法

1. `js/games/<ゲームID>/` を作り、`rules.js` と `view.js` を用意
2. `js/games/index.js` の `GAMES` に1行追加

`rules.js` が export するもの：

- `meta` … `{ id, name, subtitle, minPlayers, maxPlayers, options:[…], rulesHtml }`（options はロビーに自動でフォーム化）
- `startRound(m)` … ラウンド開始。状態は `m.sub` に置く
- `applyAction(m, uid, action)` … 不正なら throw。敗者が決まったら `m.loser = { uid, reason, text, times }`（times＝引き金を引く回数）
- ラウンドをまたいで残したい状態は `m.gs` に置く（例：LIAR'S DICE の各自のダイス数）
- 全員同時に動くゲームは `currentActor` で null を返し、`pendingAuto(m, now)` / `applyAuto` でCPUの行動や時間切れをホスト役に実行させる（SPRINT BRAIN 参照）。時刻は match.js の `now()`（サーバー時刻補正済み）を使う
- `currentActor(m)` … 入力待ちのプレイヤー
- `cpuAction(m, uid)` … CPU/切断者の代打ち
- `describeEvent(ev, name)` … ログ用の文章

演出用のイベントは `pushEvent(m, {...})` で積み、`view.js` の `animate(ev, m)` で再生します。
敗者が決まると共通側が「警報（赤い照明＋サイレン）→ 敗者が自分のタイミングで引き金を引く → 結果」を処理し、
ダメージ・死亡・観戦・勝敗判定（生存人数まで減ったら終了）も共通側が行います。

## 仕様メモ（解釈した部分）

- **=MAX** は「場の数字が目標値と同じになる」として実装（指示文では「0になる」でしたが=0と同じになるため）
- 山札は無限（重み付きランダム）。出やすさは `cards.js` の `DEFAULT_WEIGHTS`
- **DOUBLE** 中の制限：+2の制限は1枚目のみ。RANDOM は2枚とも強制。1枚目が REVERSE/SHOT なら DOUBLE（2枚）が移った先に適用。SHIELD なら効果ごと無効
- **SHIELD** は +2 中でも出せる。RANDOM を受けた時は手札にあれば自動で使われる。何も受けていない時に出すと単にパス
- SHOT は自分以外の生存者のみ指定可。RANDOM で SHOT が出た場合は相手もランダム
- スタートプレイヤーは毎ラウンドランダム、順番は毎ラウンド正順に戻る
- 手札情報はDB上で全員に見える構造です（身内向け。気になる場合は将来Cloud Functions化）
- 切断したプレイヤーの手番は約4秒後、引き金は約7秒後にCPUが代行
- 画質（ドットの細かさ）はゲーム中右上で切替。テーブル・カードのテクスチャは常に高解像度

### js/firebase-config.js の雛形（初回のみ作成）

```js
export const firebaseConfig = {
  apiKey: '...', authDomain: '...', databaseURL: '...', projectId: '...',
  storageBucket: '...', messagingSenderId: '...', appId: '...',
};
```

## LIAR'S DICE 仕様メモ（解釈した部分）

- ブラフ宣言者が負けた場合のペナルティは「実際の個数 − 宣言個数」（ちょうどなら1回）。差分ペナルティOFFなら常に1回
- ペナルティ回数＝引き金を引く回数（ライフ方式なら回数分ライフ減、リボルバー方式なら回数分引く）
- 次ラウンドは前ラウンドの敗者から開始（死亡していれば次の席の人）。宣言の順番は常に正順
- 個数の上限は場のダイス合計数。これ以上レイズできない時はブラフのみ
- 振りなおしは最初の宣言時にも使える

## SPRINT BRAIN 仕様メモ

- 判定は「ボタンを押した時刻（サーバー時刻補正済み）」の順。決着しそうな解答が届いたら1秒間「判定中…」で待ち、その間に届いた解答も含めて押した時刻順で決める（rules.js の GRACE_MS で調整可）
- 最後の2人以上の正解、または不正解2人以上が完全に同じ時刻（ミリ秒単位）なら、該当者だけでサドンデス問題
- 正解発表は問題を表示したまま、下部に「答えはこれでした」と正解者の順位・タイムを表示
- 問題・答えはランダム生成。CPUは出題形式ごとの目安時間でランダムに解答（たまに不正解）
- 制限時間（デフォルト90秒）を設定に追加。時間切れの場合は未正解者からランダムに1人が敗者
- 出題前に全員の準備（モニター設置・カメラのズーム）完了を待ってから3カウント開始（切断者がいる場合は最大12秒で開始）
- Count Cube は土台 4×4 / 5×5、立方体18〜60個
- Quick Math はカード4枚。数字→記号→数字で計算し、結果は後に押したカードの位置に出る。小数第1位まで表せない数は分数表記
- 観戦者・死亡者も問題画面を（操作なしで）見られる

## LUCK BUTTON 仕様メモ（解釈した部分）

- ラウンドごとに手札は配り直し（前ラウンドの残りは破棄）。次ラウンドは前ラウンドの敗者から
- DOUBLE を受けた人がボタン付きのカードを使った場合、そのカードで押す1つも「2つ」に含める
- カードは1ターン1枚、ボタンを押す前にだけ使える
- DISCARD の対象は「その時点のターン順で次の人」
- SHUFFLE 使用時は全員の ANALYZE / X-RAY 情報を消去（位置が変わったため）
- OUTを押した瞬間に警報（サイレン）。他のOUTボタンの位置は公開しない
- ANALYZE / X-RAY の光（光の柱）は使った本人の画面で、そのターンにボタンを押すまでの間だけ表示

## 共通設定

- ペナルティ「自動で引き金を引く」：ONなら敗者の引き金は約2秒後に自動
- 高度な設定「カードの出現率」（COUNT CARDS / LUCK BUTTON）：各カードの値 ÷ 全カードの合計 が出現確率。デフォルトは全部10

## INDIAN SUM 仕様メモ（コヨーテ日本語版準拠）

- 36枚：1〜5 各4 / 10×3 / 15×2 / 20×1 / 0×3 / −5×2 / −10×1 / 夜0・×2・MAX→0・？ 各1
- 合計の計算順：？（山札から1枚引いて置き換え）→ MAX→0（一番大きい数のカード1枚を0）→ 合計 → ×2
- 宣言が合計を超えていたら宣言者の負け、ぴったり以下ならダウトした人の負け
- 使ったカードは捨て札。山札切れで捨て札をシャッフル。夜カードが出たら次ラウンド開始時に全36枚で山札を作り直す
- 次ラウンドは敗者から（死亡していれば次の席）。ライフは共通のペナルティ設定を使用
- チャレンジの宣言名は「ダウト！」

## 首の向きの同期（全ゲーム共通）

- 自分のカメラの向きを `looks/部屋コード/uid` に送信（向きが変わった時だけ、最大 約7回/秒）。部屋データとは別の場所なのでゲームの同期には影響しない
- 受け取った向きで相手の頭（65%）と上半身（35%）をなめらかに回す
- CPUは各端末で、手番の人を見る／ときどき視線を外す動きをする
- **Firebaseのルールに `looks` の項目を追加する必要あり**（database.rules.json 参照）

## RUSSIAN DECK 仕様メモ

- 毎ラウンド準備からやり直し。DEADは「生存者数÷2（切り上げ）」枚、REVIVEは全員に1枚＋余り（2〜3人は2枚、4人2枚、5人1枚、6人0枚）を山札へ
- DEADを引いてREVIVEがあれば自動使用。戻す位置は本人だけが選び、他の人には見えない
- CANCELはカードがプレイされるたびに全員へ3秒の受付バー（カード公開の演出ぶん開始を約1.2秒遅らせる）。CANCELされるとまた3秒。持っていない人は毎回待つ（情報が漏れない）
- 自分のプレイにはCANCEL不可。自分のプレイへのCANCELにはCANCEL返し可（最後に出したのが自分でなければ使える）
- ATTACKを受けている時のATTACKは「残りターン＋2」を次の人へ
- GIVEは指名された人が渡すカードを選ぶ（CPU・切断者はREVIVEを優先的に残す）
- 1枚のMATCHは効果なし（CANCEL受付もなし）

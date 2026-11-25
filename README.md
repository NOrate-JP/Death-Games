# DEATH GAMES

ローポリ3Dのテーブルを囲んで遊ぶ、デスゲーム風テーブルゲーム集。
Firebase（匿名ログイン + Realtime Database）と GitHub Pages だけで動きます。最大6人 + 観戦者。

## セットアップ

1. **Firebaseプロジェクトを作成**
   - Authentication → ログイン方法 → **匿名** を有効化
   - Realtime Database を作成（ロケーションはどこでも可）
   - Realtime Database → ルール に `database.rules.json` の中身を貼り付けて公開
2. **設定値を貼る**
   - プロジェクトの設定 → マイアプリ → Webアプリを追加 → 表示される `firebaseConfig` を
     `js/firebase-config.js` に貼り付け（`databaseURL` を必ず含める）
3. **GitHub Pagesで公開**
   - このフォルダの中身をリポジトリに push → Settings → Pages → Branch: main / root
   - Firebase の Authentication → 設定 → 承認済みドメイン に `ユーザー名.github.io` を追加

ローカルで試すときは `python -m http.server` などで配信してください（`file://` 直開きは不可）。
Firebase未設定でも「オフライン練習（CPU戦）」は遊べます。

## カード画像の差し替え

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
```

## 新しいゲームの追加方法

1. `js/games/<ゲームID>/` を作り、`rules.js` と `view.js` を用意
2. `js/games/index.js` の `GAMES` に1行追加

`rules.js` が export するもの：

- `meta` … `{ id, name, subtitle, minPlayers, maxPlayers, options:[…], rulesHtml }`（options はロビーに自動でフォーム化）
- `startRound(m)` … ラウンド開始。状態は `m.sub` に置く
- `applyAction(m, uid, action)` … 不正なら throw。敗者が決まったら `m.loser = { uid, reason }`
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

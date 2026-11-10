# 号砲スターター

陸上のスタート練習用の号砲Webアプリ（PWA）です。
スタートを押すと「On your marks」→「Set」→ 号砲 の順に鳴ります。

- 掛け声は Web Speech API（端末内蔵の音声）、号砲は Web Audio API で合成（音源ファイルなし）
- Service Worker によりオフラインでも動作
- iPhone の Safari で「ホーム画面に追加」するとアプリとして使えます

## 設定項目

| 項目 | 内容 |
| --- | --- |
| 開始までの待ち時間 | スタートを押してから「On your marks」までの秒数（スタブロにつく時間） |
| On your marks → Set | 掛け声が終わってから「Set」までの秒数 |
| Set → 号砲（基準） | 「Set」が終わってから号砲までの基準秒数 |
| ランダム幅（±） | 基準秒数からのばらつき。例: 基準 2.0 / 幅 0.5 → 1.5〜2.5秒のどこか |
| 掛け声 | English（On your marks / Set）または 日本語（位置について / 用意） |
| 声 | 読み上げに使う声。「自動」は男性の声を優先して選びます（英語: Daniel → Arthur → Aaron …、日本語: Otoya → Hattori …） |
| 声の高さ | 低くすると太い声になります |
| 号砲の音量 | 号砲の音量 |

設定は端末に保存されます。号砲が鳴ると、今回の Set → 号砲 の秒数が表示されます。

## ファイル構成

```
index.html      画面
style.css       デザイン
app.js          本体（シーケンス・号砲合成・音声）
sw.js           Service Worker（オフライン用キャッシュ）
manifest.json   PWA マニフェスト
icons/          アイコン（apple-touch-icon は iPhone のホーム画面用）
.nojekyll       GitHub Pages で Jekyll 処理を無効化
```

パスはすべて相対パスなので、`https://<ユーザー名>.github.io/<リポジトリ名>/` のようなサブパスでもそのまま動きます。

## GitHub Pages で公開する

### A. ブラウザだけで公開する（Git 不要）

1. GitHub で新しいリポジトリを作成（例: `start-gun`、Public）
2. リポジトリ画面の **Add file → Upload files** で、このフォルダの中身（`index.html` など全ファイルと `icons` フォルダ）をドラッグ＆ドロップして **Commit changes**
   - `.nojekyll` は隠しファイルなのでドラッグで入らないことがあります。入らなくても動作します
3. **Settings → Pages** を開き、**Source: Deploy from a branch**、**Branch: main / (root)** を選んで **Save**
4. 1〜2分待つと `https://<ユーザー名>.github.io/start-gun/` で公開されます

### B. Git コマンドで公開する

```bash
cd start-gun
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/start-gun.git
git push -u origin main
```

その後、A の手順 3 と同じく Settings → Pages で main / (root) を選びます。

## iPhone で使う

1. iPhone の **Safari** で公開URLを開く
2. 共有ボタン →「**ホーム画面に追加**」
3. ホーム画面のアイコンから起動（一度開けば、以降はオフラインでも動きます）

### 使うときの注意

- **音量**: 本体の音量ボタンで上げておいてください。号砲テストボタンで確認できます
- **マナーモード**: iOS 17 以降はマナーモードでも号砲が鳴るよう設定しています。鳴らない場合はマナーモードを解除してください
- 実行中は画面が消えないようにしています（対応端末のみ）。アプリを切り替えるとシーケンスは中止されます
- 掛け声の声は iPhone 内蔵の音声を使います。

### 男性の声にする（iPhone）

アプリで選べる声は、iPhone に入っている声だけです。男性の声が一覧にない場合は追加してください。

1. iPhone の **設定 → アクセシビリティ → 読み上げコンテンツ → 声**
2. **英語** → 「**Daniel**」（イギリス英語・男性）や「Arthur」「Aaron」を選び、ダウンロード（「拡張」版がおすすめ）
3. **日本語** → 「**Otoya**」（男性）をダウンロード
4. アプリを完全に終了して開き直し、設定の「声」で選ぶ（「自動」のままなら男性の声が優先されます）

※ Siri の声は Web アプリからは使えません。

## 更新したとき

ファイルを修正して再アップロードしたら、`sw.js` の `CACHE_VERSION`（例: `v1.0.0` → `v1.0.1`）も変更してください。
古いキャッシュが残っていると変更が反映されません。iPhone ではアプリを一度完全に閉じて開き直すと更新されます。

## ローカルで動作確認する（PC）

```bash
cd start-gun
python -m http.server 8000
```

ブラウザで http://localhost:8000 を開きます（Service Worker は `file://` では動かないため、サーバー経由で開いてください）。

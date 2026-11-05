// 声で聞いて、声で答えて、最後に登録先のカレンダーをボタンで選ぶ。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const Step = { IDLE: 0, TITLE: 1, DATE: 2, DESC: 3, READY: 4 };

  let step = Step.IDLE, title = '', desc = '', date = null, dateRaw = '', descAsked = false;
  let retries = 0, returnToReady = false, gen = 0;
  let rec = null, afterSpeak = null, speakWatch = null, speakGen = 0;
  let recDenied = 0, editing = null;
  let icsUrl = null, currentIcs = '', icsVer = 0;
  let destAt = 0, awayMode = '', picking = false, askingGcal = false;
  const ICS_PATH = 'ics/yotei.ics';

  const ua = navigator.userAgent;
  const isIPhone = /iPhone|iPod/.test(ua);
  const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIOS = isIPhone || isIPad;
  const isAndroid = /Android/.test(ua);
  const deviceName = isIPhone ? 'iPhone' : isIPad ? 'iPad' : isAndroid ? 'スマホ' : 'パソコン';

  function setPrompt(t) { $('prompt').textContent = t; }
  function setMic(t, cls) { const m = $('mic'); m.textContent = t; m.className = cls || ''; }

  // iPhone のページからはアプリの有無を調べられないので、最初に 1 回だけ聞いて覚える
  function gcalAnswer() { try { return localStorage.getItem('onsei.gcalApp'); } catch (e) { return null; } }
  function setGcalAnswer(v) {
    try { if (v) localStorage.setItem('onsei.gcalApp', v); else localStorage.removeItem('onsei.gcalApp'); } catch (e) { /* 覚えられないときは次も聞く */ }
  }

  function refresh() {
    $('vTitle').textContent = title || '（まだ）';
    $('vDate').textContent = date ? DateParser.speak(date) : '（まだ）';
    $('vDesc').textContent = !descAsked ? '（まだ）' : desc || 'なし';
    const ready = !!title && !!date;
    $('dest').classList.toggle('hide', picking || askingGcal || !ready || step === Step.TITLE || step === Step.DATE || step === Step.DESC);
    $('ctl').classList.toggle('hide', picking || askingGcal);
    $('gcalAsk').classList.toggle('hide', !askingGcal);
    $('gcalReset').classList.toggle('hide', !isIOS || !gcalAnswer());
    // Android の Chrome では .ics がただのダウンロードになるので、Google カレンダーだけにする
    $('bIcs').classList.toggle('hide', isAndroid);
    $('fileLink').classList.toggle('hide', isAndroid);
    $('fixPick').classList.toggle('hide', !picking);
    $('bStart').classList.toggle('hide', step !== Step.IDLE || ready);
    $('androidNote').classList.toggle('hide', !isAndroid || step !== Step.IDLE || ready);
    $('bMic').textContent = step === Step.IDLE || step === Step.READY ? '項目ごとに修正' : 'もう一度聞く';
    $('bMic').classList.toggle('hide', step === Step.IDLE && !ready);
    if (ready) updateLinks();
  }

  function updateLinks() {
    const ics = DateParser.buildIcs(title, desc, date);
    $('bIcs').textContent = deviceName + ' のカレンダーへ';
    if (icsUrl) URL.revokeObjectURL(icsUrl);
    icsUrl = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    $('fileLink').href = icsUrl;
    currentIcs = ics;
    if (isIOS) {
      // iPhone は data: や blob: を開かない。sw.js が普通のファイルのように渡す（中身はスマホの外に出ない）
      $('bIcs').removeAttribute('download');
      $('bIcs').href = ICS_PATH + '?v=' + (++icsVer);
    } else {
      $('bIcs').setAttribute('download', 'yotei.ics');
      $('bIcs').href = icsUrl;
    }
    $('bGoogle').href = DateParser.googleUrl(title, desc, date);
  }

  // 予定のファイルを sw.js から渡せる状態にする。渡せるようになったら true
  async function prepareIcs() {
    if (!('serviceWorker' in navigator) || !('caches' in window)) return false;
    const c = await caches.open('onsei-ics');
    await c.put(ICS_PATH, new Response(currentIcs, { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } }));
    for (let i = 0; i < 12; i++) {
      try {
        const res = await fetch($('bIcs').href, { cache: 'no-store' });
        if (res.ok && (res.headers.get('Content-Type') || '').includes('text/calendar')) return true;
      } catch (e) { /* もう一度 */ }
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  $('bIcs').addEventListener('click', async e => {
    if (!isIOS) return;
    e.preventDefault();
    stopSpeaking();
    setMic('予定のファイルを開いています');
    let ok = false;
    try { ok = await prepareIcs(); } catch (er) { ok = false; }
    setMic('待っています');
    if (ok) { destAt = Date.now(); location.href = $('bIcs').href; }
    else setPrompt('開けませんでした。ページを開き直してもう一度押すか、下の「予定のファイルを保存する」を使ってください。');
  });

  // ---------- 話す ----------
  function ttsOk() { return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'; }

  function say(text, then) {
    stopListening();
    setPrompt(text);
    setMic('話しています', 'speak');
    afterSpeak = then || null;
    clearTimeout(speakWatch);
    const my = ++speakGen;
    const done = () => {
      if (my !== speakGen) return;
      speakGen++;
      clearTimeout(speakWatch);
      const r = afterSpeak;
      afterSpeak = null;
      if (r) r(); else if (!rec) setMic('待っています');
    };
    if (!ttsOk()) { done(); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 1.05;
      const v = speechSynthesis.getVoices().find(x => /^ja/i.test(x.lang));
      if (v) u.voice = v;
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
      // 終わりの合図が来ないときも止まらないように
      speakWatch = setTimeout(done, 4000 + text.length * 280);
    } catch (e) { done(); }
  }

  function stopSpeaking() {
    speakGen++;
    afterSpeak = null;
    clearTimeout(speakWatch);
    if (ttsOk()) speechSynthesis.cancel();
  }

  // ---------- 聞く ----------
  function stopListening() {
    gen++;
    if (rec) { try { rec.abort(); } catch (e) { /* すでに止まっている */ } rec = null; }
  }

  const delay = ms => new Promise(r => setTimeout(r, ms));
  let recEnded = Promise.resolve();
  let diag = '';
  // 設定で変えられる時間（ミリ秒）
  const SETTINGS = {
    quiet: { key: 'onsei.quietMs', def: 2000, min: 1000, max: 5000, step: 100 },    // 話し終わりと決めるまで（iPhone 任せだと、まばらになる）
    after: { key: 'onsei.afterMs', def: 400, min: 0, max: 2000, step: 100 },        // 読み上げが終わってから聞き始めるまで
    listen: { key: 'onsei.listenMs', def: 10000, min: 5000, max: 60000, step: 1000 }, // 黙っていても、この間は聞き続ける
  };
  const val = {};
  for (const k of Object.keys(SETTINGS)) {
    const t = SETTINGS[k];
    val[k] = t.def;
    try {
      const raw = localStorage.getItem(t.key);
      const v = raw === null ? NaN : Number(raw);
      if (v >= t.min && v <= t.max) val[k] = v;
    } catch (e) { /* 覚えられないときは初めの値 */ }
  }

  let captureRetries = 0;
  function listen(extraMs) {
    stopListening();
    if (!SR || recDenied >= 2) { openTyper(step, true); return; }
    const my = gen;
    if (!retries) $('heard').textContent = '';  // 聞き直しのときは、理由を残す
    setMic('準備しています');
    // 前の聞き取りが完全に終わってから次を始める
    Promise.race([recEnded, delay(1000)]).then(() => delay(val.after + (extraMs || 0))).then(() => { if (my === gen) startRec(my); });
  }

  function startRec(my) {
    let r;
    try { r = new SR(); } catch (e) { openTyper(step, true); return; }
    rec = r;
    r.lang = 'ja-JP';
    r.continuous = true;   // 話し終わりは iPhone に任せず、設定の無音の時間で決める
    r.interimResults = true;
    r.maxAlternatives = 5;
    let markEnd;
    recEnded = new Promise(res => { markEnd = res; });
    let interim = '', alts = null, finished = false, quiet = null, sawAudio = false, sawSpeech = false, lastErr = '';
    const heardList = () => (!interim ? [] : alts && alts.length ? alts : [interim]);
    // Android の Chrome は自分で聞き取りを終える（話し終わりの約 1 秒、黙っていると約 5 秒）。Web からは変えられない。
    // 聞き直すと、音が鳴り、つなぎ目で言葉が切れた（v19）ので、終わったところで進む。時間切れは止まらないときの保険だけ
    const hard = setTimeout(() => { if (!lastErr) lastErr = '時間切れ'; finish(heardList()); }, isAndroid ? 60000 : val.listen);
    function finish(list) {
      if (finished) return;
      finished = true;
      clearTimeout(hard); clearTimeout(quiet);
      if (my !== gen) return;
      rec = null;
      diag = 'マイク' + (sawAudio ? '○' : '×') + ' 声' + (sawSpeech ? '○' : '×') + (lastErr ? ' ' + lastErr : '');
      try { if (list.length) r.abort(); else r.stop(); } catch (e) { /* すでに止まっている */ }
      if (list.length) $('heard').textContent = '「' + list[0].trim() + '」';
      Promise.race([recEnded, delay(400)]).then(() => { if (my === gen) onHeard(list); });
    }
    r.onstart = () => { if (my === gen) setMic('聞いています。どうぞ', 'listen'); };
    r.onaudiostart = () => { sawAudio = true; };
    r.onspeechstart = () => { sawSpeech = true; };
    r.onresult = e => {
      if (my !== gen || finished) return;
      let got = [];
      for (let i = 0; i < e.results.length; i++) if (e.results[i][0].transcript) got.push(e.results[i]);
      // Android の Chrome は、結果がそれまでの全部を含む形で何度も届く（全部つなぐと二重になる）。最後の 1 つが文の全部
      if (isAndroid) got = got.slice(-1);
      const text = got.map(x => x[0].transcript).join('');
      if (text) {
        interim = text;
        // ひと続きのときは、日時を読むために、ほかの候補も取っておく
        alts = null;
        if (got.length === 1) {
          alts = [];
          for (let k = 0; k < got[0].length; k++) if (got[0][k].transcript) alts.push(got[0][k].transcript);
        }
        $('heard').textContent = text;
      }
      sawSpeech = true;
      if (isAndroid) return;  // Chrome が終わるのを待つ
      clearTimeout(hard);  // 話している間は、時間切れにしない
      clearTimeout(quiet);
      quiet = setTimeout(() => finish(heardList()), val.quiet);
    };
    r.onerror = e => {
      lastErr = e.error || '';
      if (my !== gen || finished) return;
      if (e.error === 'no-speech' || e.error === 'aborted') return; // onend でまとめて扱う
      finished = true;
      clearTimeout(hard); clearTimeout(quiet);
      rec = null;
      if (e.error === 'audio-capture') {
        // ほかのアプリから戻った直後などに、一時的にマイクを取れないことがある。少し待って自分でやり直す
        if (captureRetries < 3) {
          captureRetries++;
          setMic('マイクの準備を待っています');
          listen(captureRetries * 1000);
          return;
        }
        captureRetries = 0;
        waitForTap('マイクを使えませんでした。ほかのアプリがマイクを使っていないか確かめて、「もう一度聞く」を押してください。');
        return;
      }
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        recDenied++;
        if (recDenied >= 2) { openTyper(step, true); return; }
        waitForTap('マイクが使えません。設定でマイクを許可して「もう一度聞く」を押してください。');
      } else if (e.error === 'network') {
        waitForTap('音声認識につながりません。インターネットを確かめて、「もう一度聞く」を押してください。');
      } else {
        waitForTap('音声認識でエラーが出ました（' + e.error + '）。「もう一度聞く」を押してください。');
      }
    };
    r.onend = () => {
      markEnd();
      if (my !== gen || finished) return;
      finish(heardList());
    };
    try { r.start(); } catch (e) { markEnd(); rec = null; waitForTap('「もう一度聞く」を押してください。'); }
  }

  function didNotHear() {
    retries++;
    $('heard').textContent = '（' + diag + '）';
    // iPhone は、黙ったまま終わったあとに自動で聞き直すと、声が入らなくなる。押してもらってから聞く
    waitForTap('聞き取れませんでした。「もう一度聞く」を押してください。');
  }

  function waitForTap(text) {
    stopListening();
    say(text, null);
  }

  // ---------- 進め方 ----------
  const PROMPT = {
    [Step.TITLE]: 'タイトルを言ってください。',
    [Step.DATE]: '日にちと時間を言ってください。',
    [Step.DESC]: '説明を言ってください。なければ、なし、と言ってください。',
  };

  function summary() {
    const s = 'タイトルは、' + title + '。日時は、' + DateParser.speak(date);
    return (desc ? s + '。説明は、' + desc : s + '。説明はなし') + '。よければ、登録先のボタンを押してください。';
  }

  function ask(s) {
    closeTyper();
    step = s;
    retries = 0;
    captureRetries = 0;
    refresh();
    if (s === Step.READY) { say(summary(), null); return; }
    say(PROMPT[s], listen);
  }

  function clearAll() {
    title = ''; desc = ''; date = null; dateRaw = ''; descAsked = false; returnToReady = false; picking = false; askingGcal = false;
    $('heard').textContent = '';
  }

  function begin() {
    clearAll();
    ask(Step.TITLE);
  }

  function next(s) {
    if (returnToReady) { returnToReady = false; ask(Step.READY); }
    else ask(s);
  }

  const isNone = w => ['なし', '無し', 'ありません', 'ない', '結構です', 'いらない', 'いりません', '説明なし', 'なしで'].includes(w);

  function onHeard(list) {
    if (!list || !list.length) { didNotHear(); return; }
    const best = list[0].trim();
    $('heard').textContent = '「' + best + '」';
    const w = best.replace(/[\s、。!！?？]/g, '');
    if (['キャンセル', '中止', 'やめる', 'やめます', '終わり'].includes(w)) {
      stopListening();
      if (returnToReady) { returnToReady = false; ask(Step.READY); return; }  // 修正をやめるだけ。入れた内容は消さない
      clearAll();
      step = Step.IDLE;
      refresh();
      say('やめました。', () => { setMic('待っています'); setPrompt('やめました。「開始」で、もう一度始められます。'); });
      return;
    }
    if (['戻る', '戻って', 'ひとつ前'].includes(w)) {
      if (step === Step.DATE) { ask(Step.TITLE); return; }
      if (step === Step.DESC) { ask(Step.DATE); return; }
    }
    if (step === Step.TITLE) {
      title = best;
      next(Step.DATE);
    } else if (step === Step.DATE) {
      let r = null, used = best;
      for (const c of list) { r = DateParser.parse(c); if (r) { used = c; break; } }
      if (!r) {
        retries++;
        if (retries > 2) { waitForTap('日時が分かりませんでした。「もう一度聞く」を押すか、「日時」をタップして文字で入れてください。'); return; }
        say('日時が分かりませんでした。例えば、あしたの午後3時、のように言ってください。', listen);
        return;
      }
      date = r;
      dateRaw = used;
      next(Step.DESC);
    } else if (step === Step.DESC) {
      desc = isNone(w) ? '' : best;
      descAsked = true;
      returnToReady = false;
      ask(Step.READY);
    }
  }

  // ---------- 文字で入れる ----------
  function openTyper(s, answering) {
    stopListening();
    stopSpeaking();
    if (picking || askingGcal) { picking = false; askingGcal = false; refresh(); }
    editing = { s, answering };
    const label = s === Step.TITLE ? 'タイトル' : s === Step.DATE ? '日時（例: あしたの午後3時から5時まで）' : '説明（なければ空のまま）';
    $('typeLabel').textContent = label;
    $('typeBox').value = answering ? '' : s === Step.TITLE ? title : s === Step.DATE ? dateRaw : desc;
    $('typeVoice').classList.toggle('hide', answering);
    $('typeTip').classList.toggle('hide', !answering);
    $('typer').classList.remove('hide');
    setMic('待っています');
    if (answering) setPrompt(label + 'を入れて「決定」を押してください。');
    $('typeBox').focus();
  }

  function closeTyper() {
    editing = null;
    if (picking) { picking = false; refresh(); }
    $('typer').classList.add('hide');
  }

  function typedOk() {
    if (!editing) return;
    const { s, answering } = editing;
    const t = $('typeBox').value.trim();
    if (answering) {
      closeTyper();
      if (s === Step.DESC) { desc = t; descAsked = true; returnToReady = false; ask(Step.READY); return; }
      if (!t) { openTyper(s, true); return; }
      step = s;
      onHeard([t]);
      return;
    }
    if (s === Step.DATE) {
      const r = DateParser.parse(t);
      if (!r) { setPrompt('日時が分かりませんでした。例: あしたの午後3時'); return; }
      date = r; dateRaw = t;
    } else if (s === Step.TITLE) title = t;
    else { desc = t; descAsked = true; }
    closeTyper();
    step = title && date ? Step.READY : Step.IDLE;
    refresh();
    setMic('待っています');
    setPrompt(title && date ? 'よければ、登録先のボタンを押してください。' : '残りの欄を入れてください。');
  }

  // ---------- 設定 ----------
  function showSetting(k) {
    const t = SETTINGS[k];
    $(k + 'Val').textContent = (t.step >= 1000 ? String(val[k] / 1000) : (val[k] / 1000).toFixed(1)) + ' 秒';
    $(k + 'Down').disabled = val[k] <= t.min;
    $(k + 'Up').disabled = val[k] >= t.max;
  }
  function changeSetting(k, d) {
    const t = SETTINGS[k];
    val[k] = Math.min(t.max, Math.max(t.min, val[k] + d));
    try { localStorage.setItem(t.key, String(val[k])); } catch (e) { /* この間だけ使う */ }
    showSetting(k);
  }
  for (const k of Object.keys(SETTINGS)) {
    $(k + 'Down').onclick = () => changeSetting(k, -SETTINGS[k].step);
    $(k + 'Up').onclick = () => changeSetting(k, SETTINGS[k].step);
  }
  $('setAndroid').classList.toggle('hide', !isAndroid);
  $('bSet').onclick = () => { Object.keys(SETTINGS).forEach(showSetting); $('setPanel').classList.toggle('hide'); };
  $('setClose').onclick = () => $('setPanel').classList.add('hide');

  // ---------- ボタン ----------
  $('bStart').onclick = () => {
    // iPhone は、タップの中で一度話さないと、そのあと音が出ない
    if (ttsOk()) { try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch (e) { /* */ } }
    recDenied = 0;
    begin();
  };
  $('bMic').onclick = () => {
    stopSpeaking();
    recDenied = 0;
    retries = 0;
    closeTyper();
    if (step === Step.IDLE || step === Step.READY) {
      picking = true;
      refresh();
      say('どの項目を直しますか？', () => setMic('待っています'));
      return;
    }
    ask(step);
  };
  function fixItem(s) {
    stopSpeaking();
    recDenied = 0;
    picking = false;
    returnToReady = true;
    ask(s);
  }
  $('fixTitle').onclick = () => fixItem(Step.TITLE);
  $('fixDate').onclick = () => fixItem(Step.DATE);
  $('fixDesc').onclick = () => fixItem(Step.DESC);
  $('fixCancel').onclick = () => {
    stopSpeaking();
    picking = false;
    refresh();
    setMic('待っています');
    setPrompt('よければ、登録先のボタンを押してください。');
  };
  $('bNew').onclick = () => {
    stopSpeaking();
    stopListening();
    closeTyper();
    recDenied = 0;
    begin();
  };
  function askGcal() {
    askingGcal = true;
    $('gcalYes').href = $('bGoogle').href;
    refresh();
    say('Google カレンダーのアプリは入っていますか？', () => setMic('待っています'));
  }
  function gcalMissing() {
    say('Google カレンダーはインストールされていません。', () => setMic('待っています'));
  }
  $('bGoogle').addEventListener('click', e => {
    if (isIOS && gcalAnswer() !== 'yes') {
      e.preventDefault();
      if (gcalAnswer() === 'no') gcalMissing(); else askGcal();
      return;
    }
    destAt = Date.now();
  });
  $('gcalYes').addEventListener('click', () => {
    stopSpeaking();
    setGcalAnswer('yes');
    askingGcal = false;
    destAt = Date.now();
    refresh();
    setMic('待っています');
    setPrompt('よければ、登録先のボタンを押してください。');
  });
  $('gcalNo').onclick = () => {
    setGcalAnswer('no');
    askingGcal = false;
    refresh();
    gcalMissing();
  };
  $('gcalReset').addEventListener('click', e => {
    e.preventDefault();
    setGcalAnswer(null);
    askGcal();
  });
  $('cTitle').onclick = () => openTyper(Step.TITLE, false);
  $('cDate').onclick = () => openTyper(Step.DATE, false);
  $('cDesc').onclick = () => openTyper(Step.DESC, false);
  $('typeOk').onclick = typedOk;
  $('typeCancel').onclick = () => {
    const was = editing;
    closeTyper();
    if (was && was.answering) { setPrompt('止めました。「もう一度聞く」で続きから聞きます。'); return; }
    setPrompt(title && date ? 'よければ、登録先のボタンを押してください。' : '止めました。');
    if (step !== Step.READY) step = title && date ? Step.READY : Step.IDLE;
    refresh();
  };
  $('typeVoice').onclick = () => {
    const was = editing;
    if (!was) return;
    returnToReady = !!title && !!date;
    recDenied = 0;
    ask(was.s);
  };

  // 裏に回ったら止める。戻ってきたら最初から始める
  // 登録先のボタンを押して離れたときは、消すだけで話さない（すぐ戻ったときは開けなかったと見て、画面を残す）
  const DEST_LEFT_MS = 10000, DEST_SHORT_MS = 5000;
  function cleanScreen(text) {
    closeTyper();
    recDenied = 0;
    clearAll();
    step = Step.IDLE;
    refresh();
    setMic('待っています');
    setPrompt(text);
  }
  function afterDest() {
    cleanScreen('次の予定を入れるときは、「開始」を押してください。');
  }
  function goneAway() {
    stopSpeaking();
    stopListening();
    setMic('待っています');
    awayMode = destAt && Date.now() - destAt < DEST_LEFT_MS ? 'dest' : 'fresh';
  }
  function cameBack() {
    const mode = awayMode, since = Date.now() - destAt;
    awayMode = '';
    destAt = 0;
    if (mode === 'dest') {
      if (since >= DEST_SHORT_MS) afterDest();
      return;
    }
    // iPhone は押さずに始めるとマイクが不安定なので、勝手に話さず「開始」を待つ
    if (mode === 'fresh') cleanScreen('「開始」を押すと、声で聞いていきます。');
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) goneAway(); else cameBack(); });
  // カレンダーの追加の画面は、ページが裏に回らずに閉じることがある
  window.addEventListener('focus', () => {
    if (document.hidden || awayMode || !destAt || Date.now() - destAt < DEST_SHORT_MS) return;
    destAt = 0;
    afterDest();
  });

  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
  refresh();
})();

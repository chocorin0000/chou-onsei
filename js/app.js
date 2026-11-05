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
  let icsUrl = null;

  const ua = navigator.userAgent;
  const isIPhone = /iPhone|iPod/.test(ua);
  const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIOS = isIPhone || isIPad;
  const deviceName = isIPhone ? 'iPhone' : isIPad ? 'iPad' : /Android/.test(ua) ? 'スマホ' : 'パソコン';

  function setPrompt(t) { $('prompt').textContent = t; }
  function setMic(t, cls) { const m = $('mic'); m.textContent = t; m.className = cls || ''; }

  function refresh() {
    $('vTitle').textContent = title || '（まだ）';
    $('vDate').textContent = date ? DateParser.speak(date) : '（まだ）';
    $('vDesc').textContent = !descAsked ? '（まだ）' : desc || 'なし';
    const ready = !!title && !!date;
    $('dest').classList.toggle('hide', !ready || step === Step.TITLE || step === Step.DATE || step === Step.DESC);
    $('bStart').classList.toggle('hide', step !== Step.IDLE || ready);
    $('bMic').textContent = step === Step.IDLE || step === Step.READY ? '声で入れ直す' : 'もう一度聞く';
    $('bMic').classList.toggle('hide', step === Step.IDLE && !ready);
    if (ready) updateLinks();
  }

  function updateLinks() {
    const ics = DateParser.buildIcs(title, desc, date);
    $('bIcs').textContent = deviceName + ' のカレンダーへ';
    $('bIcs').href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    if (isIOS) $('bIcs').removeAttribute('download'); else $('bIcs').setAttribute('download', 'yotei.ics');
    if (icsUrl) URL.revokeObjectURL(icsUrl);
    icsUrl = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    $('fileLink').href = icsUrl;
    $('bGoogle').href = DateParser.googleUrl(title, desc, date);
  }

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

  function listen() {
    stopListening();
    if (!SR || recDenied >= 2) { openTyper(step, true); return; }
    const my = gen;
    let r;
    try { r = new SR(); } catch (e) { openTyper(step, true); return; }
    rec = r;
    r.lang = 'ja-JP';
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 5;
    let interim = '', finished = false, quiet = null;
    const hard = setTimeout(() => { try { r.stop(); } catch (e) { /* */ } }, 15000);
    const finish = list => {
      if (finished || my !== gen) return;
      finished = true;
      clearTimeout(hard); clearTimeout(quiet);
      rec = null;
      onHeard(list);
    };
    r.onstart = () => { if (my === gen) setMic('聞いています。どうぞ', 'listen'); };
    r.onresult = e => {
      if (my !== gen) return;
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const x = e.results[i];
        if (x.isFinal) {
          const list = [];
          for (let k = 0; k < x.length; k++) if (x[k].transcript) list.push(x[k].transcript);
          finish(list);
          try { r.stop(); } catch (er) { /* */ }
          return;
        }
        text += x[0].transcript;
      }
      interim = text;
      $('heard').textContent = text;
      // 話し終わっても終わりの合図を出さない機種がある
      clearTimeout(quiet);
      quiet = setTimeout(() => { try { r.stop(); } catch (er) { /* */ } }, 2500);
    };
    r.onerror = e => {
      if (my !== gen || finished) return;
      if (e.error === 'no-speech' || e.error === 'aborted') return; // onend でまとめて扱う
      finished = true;
      clearTimeout(hard); clearTimeout(quiet);
      rec = null;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        recDenied++;
        if (recDenied >= 2) { openTyper(step, true); return; }
        waitForTap('マイクが使えません。設定でマイクを許可して「もう一度聞く」を押してください。');
      } else if (e.error === 'network') {
        waitForTap('音声認識につながりません。インターネットを確かめて、「もう一度聞く」を押してください。');
      } else {
        waitForTap('音声認識でエラーが出ました。「もう一度聞く」を押してください。');
      }
    };
    r.onend = () => {
      if (my !== gen || finished) return;
      if (interim) finish([interim]); else finish([]);
    };
    $('heard').textContent = '';
    setMic('準備しています');
    try { r.start(); } catch (e) { rec = null; waitForTap('もう一度聞くを押してください。'); }
  }

  function didNotHear() {
    retries++;
    if (retries > 2) { waitForTap('聞き取れませんでした。「もう一度聞く」を押してください。'); return; }
    say('聞き取れませんでした。もう一度お願いします。', listen);
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
    refresh();
    if (s === Step.READY) { say(summary(), null); return; }
    say(PROMPT[s], listen);
  }

  function clearAll() {
    title = ''; desc = ''; date = null; dateRaw = ''; descAsked = false; returnToReady = false;
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
      if (!title) ask(Step.TITLE);
      else if (!date) ask(Step.DATE);
      else { returnToReady = false; ask(Step.TITLE); }
      return;
    }
    listen();
  };
  $('bNew').onclick = () => {
    stopSpeaking();
    stopListening();
    closeTyper();
    recDenied = 0;
    begin();
  };
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

  // 裏に回ったら止める
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    const going = step === Step.TITLE || step === Step.DATE || step === Step.DESC;
    stopSpeaking();
    stopListening();
    if (going) { setMic('待っています'); setPrompt('止めました。「もう一度聞く」で続きから聞きます。'); }
    else setMic('待っています');
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  refresh();
})();

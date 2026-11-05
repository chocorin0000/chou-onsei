// 話した日本語（「来週の水曜の午後3時から5時まで」など）を日時にする。Android 版の DateParser.java と同じ動き。
// 日は「1970-01-01 からの日数」、時刻は「0 時からの分」で持つ。
(function (root) {
  'use strict';
  const WEEK = ['月', '火', '水', '木', '金', '土', '日'];
  const pad = n => String(n).padStart(2, '0');

  const toDay = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 864e5);
  const ymd = day => { const t = new Date(day * 864e5); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };
  const isoWeek = day => { const w = new Date(day * 864e5).getUTCDay(); return w === 0 ? 7 : w; };

  // ない日（2月31日）は例外
  function of(y, m, d) {
    const day = toDay(y, m, d), c = ymd(day);
    if (c[0] !== y || c[1] !== m || c[2] !== d) throw new Error('no such date');
    return day;
  }
  function plusMonths(day, n) {
    const [y, m, d] = ymd(day);
    const t = (y * 12 + (m - 1)) + n, ny = Math.floor(t / 12), nm = t % 12 + 1;
    const last = ymd(toDay(ny, nm + 1, 0))[2];
    return toDay(ny, nm, Math.min(d, last));
  }
  function withDay(day, d) { const [y, m] = ymd(day); return of(y, m, d); }
  const plusYears = (day, n) => { const [y, m, d] = ymd(day); const last = ymd(toDay(y + n, m + 1, 0))[2]; return toDay(y + n, m, Math.min(d, last)); };
  const nextOrSame = (day, w) => day + ((w - isoWeek(day) + 7) % 7);
  const mondayOf = day => day - (isoWeek(day) - 1);

  const REPL = [
    ['しあさって', '明々後日'], ['明明後日', '明々後日'], ['あさって', '明後日'], ['あした', '明日'], ['あす', '明日'],
    ['きょう', '今日'], ['本日', '今日'], ['さらいしゅう', '再来週'], ['らいしゅう', '来週'], ['こんしゅう', '今週'],
    ['さらいげつ', '再来月'], ['らいげつ', '来月'], ['こんげつ', '今月'], ['さらいねん', '再来年'], ['らいねん', '来年'],
    ['ごぜん', '午前'], ['ごご', '午後'], ['正午', '昼12時'],
    ['〜', 'から'], ['~', 'から'], ['より', 'から'],
    ['ヶ月', 'か月'], ['カ月', 'か月'], ['ヵ月', 'か月'], ['ケ月', 'か月'], ['箇月', 'か月'],
  ];

  function kanjiNumber(k) {
    const digits = '〇一二三四五六七八九';
    if (!k.includes('十') && !k.includes('百')) {
      let v = 0;
      for (const c of k) v = v * 10 + (c === '零' ? 0 : digits.indexOf(c));
      return v;
    }
    let total = 0, cur = 0;
    for (const c of k) {
      if (c === '十') { total += (cur === 0 ? 1 : cur) * 10; cur = 0; }
      else if (c === '百') { total += (cur === 0 ? 1 : cur) * 100; cur = 0; }
      else cur = c === '零' ? 0 : digits.indexOf(c);
    }
    return total + cur;
  }

  function normalize(raw) {
    let s = raw.normalize('NFKC').toLowerCase().replace(/[\s、。,.]/g, '');
    for (const [a, b] of REPL) s = s.split(a).join(b);
    return s.replace(/[〇零一二三四五六七八九十百]+/g, kanjiNumber);
  }

  // [時, 翌日なら 1]
  function hour24(h, p) {
    if (h === 24) return [0, 1];
    if (!p) return [h >= 1 && h <= 6 ? h + 12 : h, 0]; // 「3時」は、ふつう午後
    switch (p) {
      case '午前': case 'am': case '朝': case '早朝': return [h === 12 ? 0 : h, 0];
      case '午後': case 'pm': case '夕方': case '夕': case '晩': return [h < 12 ? h + 12 : h, 0];
      case '夜': return h === 12 ? [0, 1] : [h < 12 ? h + 12 : h, 0];
      case '昼': return [h <= 5 ? h + 12 : h, 0];
      case '深夜': return [h === 12 ? 0 : h, 0];
      default: return [h, 0];
    }
  }

  function findDate(s, today) {
    let m;
    if (s.includes('明々後日')) return today + 3;
    if (s.includes('明後日')) return today + 2;
    if (s.includes('明日')) return today + 1;
    if (s.includes('今日')) return today;
    if ((m = /(\d+)日後/.exec(s))) return today + +m[1];
    if ((m = /(\d+)週間後/.exec(s))) return today + 7 * +m[1];
    if ((m = /(\d+)か月後/.exec(s))) return plusMonths(today, +m[1]);

    const thisYear = ymd(today)[0];
    let year = null;
    if ((m = /(\d{4})年/.exec(s))) year = +m[1];
    else if (s.includes('再来年')) year = thisYear + 2;
    else if (s.includes('来年')) year = thisYear + 1;

    m = /(\d{1,2})月(\d{1,2})日/.exec(s);
    let mon, dd;
    if (m) { mon = +m[1]; dd = +m[2]; }
    else if ((m = /(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?!\d)/.exec(s))) { mon = +m[1]; dd = +m[2]; }
    if (m) {
      let d = of(year !== null ? year : thisYear, mon, dd);
      if (year === null && d < today) d = plusYears(d, 1);
      return d;
    }

    if ((m = /(再来週|来週|今週)?の?([月火水木金土日])曜/.exec(s))) {
      const w = WEEK.indexOf(m[2]) + 1;
      if (!m[1]) return nextOrSame(today, w);
      const weeks = m[1] === '再来週' ? 2 : m[1] === '来週' ? 1 : 0;
      return nextOrSame(mondayOf(today) + weeks * 7, w);
    }
    if (s.includes('再来週')) return today + 14;
    if (s.includes('来週')) return today + 7;

    if ((m = /(\d{1,2})日(?!後|間|中)/.exec(s))) {
      const day = +m[1];
      if (s.includes('再来月')) return withDay(plusMonths(today, 2), day);
      if (s.includes('来月')) return withDay(plusMonths(today, 1), day);
      if (s.includes('今月')) return withDay(today, day);
      const d = withDay(today, day);
      return d < today ? withDay(plusMonths(today, 1), day) : d;
    }
    return null;
  }

  function timed(day, min) {
    const e = day * 1440 + min + 60;
    return { allDay: false, date: day, start: min, endDate: Math.floor(e / 1440), end: e % 1440 };
  }

  function parse0(s0, nowDay, nowMin) {
    let s = s0, m;
    const nowAbs = nowDay * 1440 + nowMin;
    if ((m = /(\d+)時間(半)?後/.exec(s))) {
      const t = nowAbs + +m[1] * 60 + (m[2] ? 30 : 0);
      return timed(Math.floor(t / 1440), t % 1440);
    }
    if ((m = /(\d+)分後/.exec(s))) {
      const t = nowAbs + +m[1];
      return timed(Math.floor(t / 1440), t % 1440);
    }

    const allDayWord = ['終日', '1日中', '丸1日', '1日ずっと'].some(w => s.includes(w));
    for (const w of ['1日中', '丸1日', '1日ずっと', '終日']) s = s.split(w).join('');

    const kara = s.indexOf('から');
    const head = kara >= 0 ? s.slice(0, kara) : s;
    const tail = kara >= 0 ? s.slice(kara + 2) : '';

    let date = findDate(head, nowDay), endDate = null;
    if (date !== null && (m = /(?:(\d{1,2})月)?(\d{1,2})日(?!後|間|中)/.exec(tail))) {
      const [y0, m0] = ymd(date);
      const mon = m[1] ? +m[1] : m0;
      endDate = of(y0, mon, +m[2]);
      if (endDate < date) endDate = m[1] ? plusYears(endDate, 1) : plusMonths(endDate, 1);
    }
    if (date !== null && (m = /(\d+)日間/.exec(s))) endDate = date + Math.max(0, +m[1] - 1);

    const times = [];
    const re = /(午前|午後|早朝|朝|昼|夕方|夕|夜|晩|深夜|am|pm)?の?(\d{1,2})(?:時(?!間)(?:(\d{1,2})分|(半))?|:(\d{2}))/g;
    while ((m = re.exec(s))) {
      const h = +m[2];
      const min = m[3] ? +m[3] : m[4] ? 30 : m[5] ? +m[5] : 0;
      if (h > 24 || min > 59) return null;
      times.push({ h, min, p: m[1] || null });
    }

    if (allDayWord || !times.length) {
      if (date === null) return null;
      return { allDay: true, date, endDate: endDate !== null ? endDate : date, start: null, end: null };
    }

    const st = hour24(times[0].h, times[0].p);
    const start = st[0] * 60 + times[0].min;
    if (date === null) {
      date = nowDay;
      if (date * 1440 + start < nowAbs) date++;
    }
    if (st[1]) date++;
    const sAbs = date * 1440 + start;
    let eAbs;
    if (times.length >= 2) {
      const { h, min, p } = times[1];
      let next = 0, eh;
      if (p) { const e = hour24(h, p); eh = e[0]; next = e[1]; }
      else if (h === 24) { eh = 0; next = 1; }
      else { eh = h; if (st[0] >= 12 && h < 12) eh = h + 12; }
      const ed = endDate !== null ? endDate : date;
      eAbs = (ed + next) * 1440 + eh * 60 + min;
      if (eAbs <= sAbs && !p && h < 12) {
        // 午前に始まるなら午後の時刻、午後に始まるなら次の日の朝（夜11時から1時まで）
        eAbs = st[0] < 12 ? eAbs + 720 : (ed + 1) * 1440 + h * 60 + min;
      }
      if (eAbs <= sAbs) eAbs += 1440;
    } else {
      let minutes = 60;
      if ((m = /(\d+)時間(半)?/.exec(s))) minutes = +m[1] * 60 + (m[2] ? 30 : 0);
      else if ((m = /(\d+)分間/.exec(s))) minutes = +m[1];
      else if ((m = /から(\d+)分/.exec(s))) minutes = +m[1];
      if (minutes <= 0) minutes = 60;
      eAbs = sAbs + minutes;
      if (endDate !== null) eAbs = endDate * 1440 + (eAbs % 1440);
    }
    return { allDay: false, date, start, endDate: Math.floor(eAbs / 1440), end: eAbs % 1440 };
  }

  /** 日時が分からなければ null。now は Date（省略で今）。 */
  function parse(raw, now) {
    now = now || new Date();
    const day = toDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
    try {
      return parse0(normalize(String(raw)), day, now.getHours() * 60 + now.getMinutes());
    } catch (e) {
      return null;
    }
  }

  function dayText(day, today) {
    const [y, m, d] = ymd(day);
    const yy = y !== ymd(today)[0] ? y + '年' : '';
    return yy + m + '月' + d + '日、' + WEEK[isoWeek(day) - 1] + '曜日';
  }
  function timeText(min) {
    const h = Math.floor(min / 60), mi = min % 60;
    const p = h === 12 ? '昼の12時' : h < 12 ? '午前' + h + '時' : '午後' + (h - 12) + '時';
    return mi === 0 ? p : p + mi + '分';
  }

  /** 読み上げと画面に使う文。 */
  function speak(r, now) {
    now = now || new Date();
    const today = toDay(now.getFullYear(), now.getMonth() + 1, now.getDate());
    let b = dayText(r.date, today);
    if (r.allDay) {
      if (r.endDate !== r.date) b += 'から' + dayText(r.endDate, today) + 'まで';
      return b + '、終日';
    }
    b += '、' + timeText(r.start) + 'から';
    if (r.endDate !== r.date) b += dayText(r.endDate, today) + 'の';
    return b + timeText(r.end) + 'まで';
  }

  const dateStr = day => ymd(day).map((n, i) => i ? pad(n) : String(n).padStart(4, '0')).join('');
  const dt = (day, min) => { const [y, m, d] = ymd(day); return new Date(y, m - 1, d, Math.floor(min / 60), min % 60, 0); };
  const utcStr = t => t.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const localStr = (day, min) => dateStr(day) + 'T' + pad(Math.floor(min / 60)) + pad(min % 60) + '00';

  function icsEscape(t) {
    return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  // 1 行は 75 バイトまで（字の途中で切らない）
  function fold(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const out = [];
    let cur = '', n = 0;
    for (const c of line) {
      const b = enc.encode(c).length;
      if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; n = 0; }
      cur += c; n += b;
    }
    out.push(cur);
    return out.join('\r\n ');
  }

  /** iPhone のカレンダーなどに渡すファイルの中身。時刻つきの予定には 10 分前の通知を付ける。 */
  function buildIcs(title, desc, r, now) {
    now = now || new Date();
    const uid = now.getTime().toString(36) + '-' + Math.random().toString(36).slice(2) + '@chou-onsei';
    const l = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CHOCORIN//chou-onsei//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + utcStr(now), 'SUMMARY:' + icsEscape(title)];
    if (desc) l.push('DESCRIPTION:' + icsEscape(desc));
    if (r.allDay) {
      l.push('DTSTART;VALUE=DATE:' + dateStr(r.date), 'DTEND;VALUE=DATE:' + dateStr(r.endDate + 1));
    } else {
      l.push('DTSTART:' + utcStr(dt(r.date, r.start)), 'DTEND:' + utcStr(dt(r.endDate, r.end)));
      l.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(title), 'TRIGGER:-PT10M', 'END:VALARM');
    }
    l.push('END:VEVENT', 'END:VCALENDAR');
    return l.map(fold).join('\r\n') + '\r\n';
  }

  /** 内容の入った Google カレンダーの登録画面の URL。 */
  function googleUrl(title, desc, r) {
    const q = new URLSearchParams();
    q.set('action', 'TEMPLATE');
    q.set('text', title);
    if (r.allDay) q.set('dates', dateStr(r.date) + '/' + dateStr(r.endDate + 1));
    else {
      q.set('dates', localStr(r.date, r.start) + '/' + localStr(r.endDate, r.end));
      try { q.set('ctz', Intl.DateTimeFormat().resolvedOptions().timeZone); } catch (e) { /* なければ Google の設定の時間帯 */ }
    }
    if (desc) q.set('details', desc);
    return 'https://calendar.google.com/calendar/render?' + q.toString();
  }

  const api = { parse, speak, buildIcs, googleUrl, normalize, ymd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DateParser = api;
})(typeof window !== 'undefined' ? window : globalThis);

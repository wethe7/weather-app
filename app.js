/* ============================================================================
   app.js — Telegram Mini App «Погода»
   ----------------------------------------------------------------------------
   • Только статика, без бэкенда: данные берутся напрямую из Open-Meteo.
       поиск города : https://geocoding-api.open-meteo.com/v1/search
       погода       : https://api.open-meteo.com/v1/forecast
   • Спрайты-фоны лежат рядом, пути относительные — работает и локально,
     и на GitHub Pages. Общие: backGROUNDS.png, back_2.png, back_2uki-e.png.
     Per-city: back_<story>.png (карточки) и back_2_<story>.png (детальный
     экран); сетки у сюжетов разные — см. STORY_CARD_FIT / STORY_DETAIL_FIT.
   • Основной фон приложения — слой #app-bg: back_gif.gif или свой фон темы
     из IndexedDB (ключи customBg_pixel / customBg_ukiyoe, Blob, до 5 МБ).
   ========================================================================== */
(function () {
  'use strict';

  /* ═════════════════════════ 1. Константы ═════════════════════════ */

  var KEY_CITIES  = 'savedCities';
  var KEY_THEME   = 'theme';
  var KEY_CACHE   = 'weatherCache';

  var GEO_API      = 'https://geocoding-api.open-meteo.com/v1/search';
  var FORECAST_API = 'https://api.open-meteo.com/v1/forecast';

  var REFRESH_MS = 10 * 60 * 1000;   // автообновление погоды
  var CLOCK_MS   = 15 * 1000;        // тик локальных часов
  var CACHE_TTL  = 5 * 60 * 1000;    // свежесть кэша, мс

  /* Спрайты. Пути относительные — важно для GitHub Pages. */
  var SPRITE_CARDS   = 'backGROUNDS.png';   // 2 колонки × 5 строк
  var SPRITE_DETAIL  = { pixel: 'back_2.png', 'ukiyo-e': 'back_2uki-e.png' }; // 5 × 2

  /* Per-city сюжеты: свой спрайт вместо общего. Ключ — name города в нижнем регистре. */
  var CITY_STORIES = {
    'токио': 'tokyo', 'киото': 'kyoto',
    'tokyo': 'tokyo', 'kyoto': 'kyoto'
  };

  /* back_<story>.png — карточки, back_2_<story>.png — детальный экран.
     Сетки у сюжетов разные, поэтому геометрия задана отдельно для каждого:
       tokyo — 2 строки (pixel | ukiyo-e) × 2 колонки (день | ночь);
       kyoto — 1 строка: 2 колонки (день | ночь), вид от темы не зависит. */
  var STORY_CARDS  = { tokyo: 'back_tokyo.png', kyoto: 'back_kyoto.png' };
  var STORY_DETAIL = { tokyo: 'back_2_tokyo.png', kyoto: 'back_2_kyoto.png' };

  /* Геометрия карточек. Оба сюжетных листа — 1536 px в ширину, 2 колонки
     (день слева, ночь справа) и одна строка, поэтому тема вид не меняет.
     Панели нарисованы с тёмными полями, а карточка всегда 3.75 : 1, поэтому
     спрайт накладывается «cover»-подгонкой по ширине (205.62 % = 1536 / 747),
     по вертикали карточке достаётся окно 199 строк (747 / 3.75); положение окна
     выбрано по максимуму детализации кадра.

     tokyo: back_tokyo.png 1536 × 347, панель 747 × 309 (2.42 : 1), окно от y = 134;
     kyoto: back_kyoto.png 1536 × 346, панель 746 × 319 (2.34 : 1), окно от y = 136. */
  var STORY_CARD_FIT = {
    tokyo: {
      size: '205.62% 174.20%',                       // 1536/747 и 347 · 3.75/747
      posX: { day: '1.9%', night: '98.35%' },        // x = 15 / 776
      posY: { pixel: '90.66%', 'ukiyo-e': '90.66%' } // y = 134
    },
    kyoto: {
      size: '205.62% 173.69%',                       // 1536/747 и 346 · 3.75/747
      posX: { day: '1.9%', night: '98.35%' },        // x = 15 / 776
      posY: { pixel: '92.64%', 'ukiyo-e': '92.64%' } // y = 136
    }
  };

  /* Геометрия детального экрана: у обоих листов 2 колонки (день слева,
     ночь справа) и одна строка, поэтому по высоте берётся весь кадр. */
  var STORY_DETAIL_FIT = {
    tokyo: { size: '200% 100%', posY: { pixel: 0, 'ukiyo-e': 0 } },
    kyoto: { size: '200% 100%', posY: { pixel: 0, 'ukiyo-e': 0 } }
  };

  /* backGROUNDS.png: строки сверху вниз — Ясно, Ночь, Облачно, Дождь, Закат */
  var CARD_ROWS = { clear: 0, night: 1, cloudy: 2, rain: 3, sunset: 4 };

  /* back_2*.png: 5 колонок × 2 строки — [колонка, строка] */
  var DETAIL_CELL = {
    clear:   [0, 0], sunset: [1, 0], night:  [2, 0], rain: [3, 0], spring: [4, 0],
    aurora:  [0, 1], fog:    [1, 1], evening:[2, 1], snow: [3, 1], thunder:[4, 1]
  };

  var WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var WEEKDAYS_FULL  = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var MONTHS_GEN     = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  /* Расшифровка кодов WMO (Open-Meteo weather_code) */
  var WMO = {
    0: 'Ясно', 1: 'Преимущественно ясно', 2: 'Переменная облачность', 3: 'Пасмурно',
    45: 'Туман', 48: 'Туман с изморозью',
    51: 'Слабая морось', 53: 'Морось', 55: 'Сильная морось',
    56: 'Ледяная морось', 57: 'Сильная ледяная морось',
    61: 'Небольшой дождь', 63: 'Дождь', 65: 'Сильный дождь',
    66: 'Ледяной дождь', 67: 'Сильный ледяной дождь',
    71: 'Небольшой снег', 73: 'Снег', 75: 'Сильный снег', 77: 'Снежная крупа',
    80: 'Небольшой ливень', 81: 'Ливень', 82: 'Сильный ливень',
    85: 'Снегопад', 86: 'Сильный снегопад',
    95: 'Гроза', 96: 'Гроза с градом', 99: 'Сильная гроза с градом'
  };

  /* ═════════════════════════ 2. Состояние ═════════════════════════ */

  var state = {
    theme: 'pixel',
    cities: [],            // [{id,name,admin1,country,latitude,longitude,timezone}]
    weather: {},           // id -> нормализованные данные
    errors: {},            // id -> текст ошибки
    loading: {},           // id -> Promise
    cardNodes: {},         // id -> DOM-узел карточки
    renderedIds: '',
    activeCityId: null,
    searchToken: 0
  };

  /* ═════════════════════════ 3. Мелкие утилиты ═════════════════════════ */

  function $(id) { return document.getElementById(id); }

  function setText(node, text) { if (node) node.textContent = text; }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* приватный режим */ }
  }

  function makeId(lat, lon) {
    return 'c' + Math.round(lat * 1000) + '_' + Math.round(lon * 1000);
  }

  /* Температура без знака «+»: «21°», «-8°», «0°» */
  function tempText(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    return Math.round(value) + '°';
  }

  function roundOr(value, fallback) {
    return (typeof value === 'number' && isFinite(value)) ? Math.round(value) : fallback;
  }

  /* fetch с таймаутом; бросает исключение при любой проблеме */
  function fetchJSON(url, timeout) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, timeout || 12000);
    var opts = controller ? { signal: controller.signal, cache: 'no-store' } : { cache: 'no-store' };
    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /* ═════════════════════════ 4. Локальное время города ═════════════════════════ */

  var partsFormatters = {};

  function getPartsFormatter(tz) {
    if (!Object.prototype.hasOwnProperty.call(partsFormatters, tz)) {
      var fmt = null;
      try {
        fmt = new Intl.DateTimeFormat('en-GB', {
          timeZone: tz, hourCycle: 'h23',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit'
        });
      } catch (e) { fmt = null; }
      partsFormatters[tz] = fmt;
    }
    return partsFormatters[tz];
  }

  /* Локальные дата/время в часовом поясе города (без опоры на время браузера) */
  function localInfo(tz) {
    var out = { date: '', hour: 0, minute: 0, minutes: 0, month: 1, day: 1, year: 1970 };
    var fmt = getPartsFormatter(tz);
    var parts = null;
    if (fmt) { try { parts = fmt.formatToParts(new Date()); } catch (e) { parts = null; } }

    if (parts) {
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p.type === 'year') out.year = parseInt(p.value, 10);
        else if (p.type === 'month') out.month = parseInt(p.value, 10);
        else if (p.type === 'day') out.day = parseInt(p.value, 10);
        else if (p.type === 'hour') out.hour = parseInt(p.value, 10) % 24;
        else if (p.type === 'minute') out.minute = parseInt(p.value, 10);
      }
    } else {
      var d = new Date();
      out.year = d.getUTCFullYear(); out.month = d.getUTCMonth() + 1; out.day = d.getUTCDate();
      out.hour = d.getUTCHours(); out.minute = d.getUTCMinutes();
    }
    out.date = out.year + '-' + pad2(out.month) + '-' + pad2(out.day);
    out.minutes = out.hour * 60 + out.minute;
    return out;
  }

  function hhmm(tz) {
    var li = localInfo(tz);
    return pad2(li.hour) + ':' + pad2(li.minute);
  }

  function isoMinutes(iso) {
    if (!iso || iso.length < 16) return null;
    return parseInt(iso.slice(11, 13), 10) * 60 + parseInt(iso.slice(14, 16), 10);
  }

  function isoTime(iso) {
    return (iso && iso.length >= 16) ? iso.slice(11, 16) : '—:—';
  }

  /* Фаза суток: 'sunrise' | 'day' | 'sunset' | 'night' */
  function dayPhase(li, sunriseIso, sunsetIso) {
    var sr = isoMinutes(sunriseIso);
    var ss = isoMinutes(sunsetIso);
    if (sr === null || ss === null) {
      return (li.hour >= 7 && li.hour < 19) ? 'day' : 'night';
    }
    var m = li.minutes;
    if (m >= ss - 55 && m <= ss + 35) return 'sunset';
    if (m >= sr - 40 && m < sr + 25) return 'sunrise';
    if (m < sr || m > ss) return 'night';
    return 'day';
  }

  function dateInfo(isoDate) {
    var y = parseInt(isoDate.slice(0, 4), 10);
    var m = parseInt(isoDate.slice(5, 7), 10);
    var d = parseInt(isoDate.slice(8, 10), 10);
    var wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return { y: y, m: m, d: d, wd: wd };
  }

  /* ═════════════════════════ 5. Состояние погоды → фон ═════════════════════════ */

  function isRainCode(code) {
    return (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  }
  function isSnowCode(code) {
    return (code >= 71 && code <= 77) || code === 85 || code === 86;
  }
  function isFogCode(code) { return code === 45 || code === 48; }
  function isStormCode(code) { return code >= 95; }

  /* Строка спрайта для карточки главного экрана */
  function cardStateFor(code, isDay, phase) {
    if (isStormCode(code) || isRainCode(code)) return 'rain';
    if (isSnowCode(code) || isFogCode(code)) return 'cloudy';
    if (phase === 'sunset' && isDay) return 'sunset';
    if (!isDay) return 'night';
    if (code >= 2) return 'cloudy';
    return 'clear';
  }

  /* Ячейка большого фона детального экрана */
  function detailStateFor(code, isDay, phase, month) {
    if (isStormCode(code)) return 'thunder';
    if (isSnowCode(code)) return 'snow';
    if (isFogCode(code)) return 'fog';
    if (isRainCode(code)) return 'rain';
    if (phase === 'sunset' && isDay) return 'sunset';

    if (!isDay) {
      /* северное сияние: ночь + ясно */
      if (code === 0 || code === 1) return 'aurora';
      return 'night';
    }
    if (month >= 3 && month <= 5 && code <= 1) return 'spring';   // сакура
    if (code >= 2) return 'evening';                             // облачно днём
    return 'clear';
  }

  function iconKindFor(code, isDay) {
    if (isStormCode(code)) return 'thunder';
    if (isSnowCode(code)) return 'snow';
    if (isFogCode(code)) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if (isRainCode(code)) return 'rain';
    if (code === 0) return isDay ? 'sun' : 'moon';
    if (code === 1 || code === 2) return isDay ? 'sun-cloud' : 'moon-cloud';
    return 'cloud';
  }

  /* Живые состояния считаются от текущего времени, а не от момента загрузки */
  function liveStates(w) {
    var li = localInfo(w.tz);
    var phase = dayPhase(li, w.today.sunrise, w.today.sunset);
    var isDay = (phase === 'day' || phase === 'sunset');
    return {
      li: li,
      phase: phase,
      isDay: isDay,
      cardState: cardStateFor(w.current.code, isDay, phase),
      detailState: detailStateFor(w.current.code, isDay, phase, li.month),
      icon: iconKindFor(w.current.code, isDay)
    };
  }

  /* ═════════════════════════ 6. Иконки ═════════════════════════ */

  /* ---- 6.1 Пиксельные иконки (тема pixel): 12×12 «пиксель-арт» ---------- */
  var PIXEL_PALETTE = {
    K: '#141a24', Y: '#ffd23d', O: '#ff9d2e', W: '#f6faff', w: '#dbe6f6',
    g: '#a7b6cb', G: '#5d6d84', b: '#4aa3ff', B: '#2f6fd0', C: '#dceeff',
    r: '#ff6a4d', p: '#ff9ad5', v: '#8f7bff', t: '#5de0c0'
  };

  var PIXEL_ART = {
    sun: [
      '............',
      '.....YY.....',
      '..Y.......Y.',
      '...YYYYYY...',
      '..YYYYYYYY..',
      'Y.YYYYYYYY.Y',
      'Y.YYYYYYYY.Y',
      '..YYYYYYYY..',
      '...YYYYYY...',
      '..Y.......Y.',
      '.....YY.....',
      '............'
    ],
    moon: [
      '............',
      '.....www..Y.',
      '...wwwwww...',
      '..wwww......',
      '.wwww.......',
      '.wwww.....Y.',
      '.wwww.......',
      '..wwww......',
      '...wwwwww...',
      '.....www....',
      '............',
      '............'
    ],
    cloud: [
      '............',
      '............',
      '....KKK.....',
      '...KWWWK....',
      '..KWWWWWKK..',
      '.KWWWWWWWWK.',
      '.KWWWWWWWWK.',
      'KWWWWWWWWWWK',
      'KWWWWWWWWWWK',
      '.KKKKKKKKKK.',
      '............',
      '............'
    ],
    'sun-cloud': [
      '.......YY...',
      '.......YY...',
      '....KKK.Y...',
      '...KWWWK....',
      '..KWWWWWKK..',
      '.KWWWWWWWWK.',
      '.KWWWWWWWWK.',
      'KWWWWWWWWWWK',
      'KWWWWWWWWWWK',
      '.KKKKKKKKKK.',
      '............',
      '............'
    ],
    'moon-cloud': [
      '............',
      '.......ww...',
      '....KKK.ww..',
      '...KWWWK.ww.',
      '..KWWWWWKK..',
      '.KWWWWWWWWK.',
      '.KWWWWWWWWK.',
      'KWWWWWWWWWWK',
      'KWWWWWWWWWWK',
      '.KKKKKKKKKK.',
      '............',
      '............'
    ],
    fog: [
      '............',
      '..wwwwwwww..',
      '.wwwwwwwwww.',
      '............',
      '.gggggggggg.',
      '....gggg....',
      '.gggggggggg.',
      '...gggggg...',
      '.gggggggggg.',
      '............',
      '............',
      '............'
    ],
    drizzle: [
      '....KKK.....',
      '...KWWWK....',
      '..KWWWWWKK..',
      '.KWWWWWWWWK.',
      'KWWWWWWWWWWK',
      '.KKKKKKKKKK.',
      '............',
      '..b..b..b...',
      '............',
      '..b..b..b...',
      '............',
      '............'
    ],
    rain: [
      '....KKK.....',
      '...KWWWK....',
      '..KWWWWWKK..',
      '.KWWWWWWWWK.',
      'KWWWWWWWWWWK',
      '.KKKKKKKKKK.',
      '............',
      '..b...b...b.',
      '.b...b...b..',
      '..b...b...b.',
      '.b...b...b..',
      '............'
    ],
    snow: [
      '....KKK.....',
      '...KWWWK....',
      '..KWWWWWKK..',
      '.KWWWWWWWWK.',
      'KWWWWWWWWWWK',
      '.KKKKKKKKKK.',
      '............',
      '..C...C...C.',
      '............',
      '....C...C...',
      '............',
      '............'
    ],
    thunder: [
      '....KKK.....',
      '...KWWWK....',
      '..KWWWWWKK..',
      '.KWWWWWWWWK.',
      'KWWWWWWWWWWK',
      '.KKKKKKKKKK.',
      '.....YY.....',
      '....YY......',
      '...YYYY.....',
      '.....YY.....',
      '....YY......',
      '............'
    ],
    aurora: [
      '..tt........',
      '.tttt.......',
      '.tttttt.....',
      '..ttttttt...',
      '....ttttttt.',
      '......ttttt.',
      '...vv.......',
      '..vvvv......',
      '...vvvvv....',
      '.....vvvvv..',
      '.......vvv..',
      '.C......C...'
    ]
  };

  function pixelIconSVG(art) {
    var rows = art.length, cols = art[0].length, out = '';
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        var color = PIXEL_PALETTE[art[y].charAt(x)];
        if (!color) continue;
        out += '<rect x="' + x + '" y="' + y + '" width="1.06" height="1.06" fill="' + color + '"/>';
      }
    }
    return '<svg class="icon-svg" viewBox="0 0 ' + cols + ' ' + rows + '" ' +
           'preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" ' +
           'xmlns="http://www.w3.org/2000/svg">' + out + '</svg>';
  }

  /* ---- 6.2 Иконки укиё-э (тема ukiyo-e): рисовая бумага + тушь ---------- */

  function ukiyoCloud(cx, cy, scale) {
    var shapes = '<circle cx="-11" cy="2" r="9"/>' +
                 '<circle cx="0" cy="-4" r="12"/>' +
                 '<circle cx="12" cy="2" r="10"/>' +
                 '<rect x="-20" y="2" width="40" height="12" rx="6"/>';
    return '<g transform="translate(' + cx + ' ' + cy + ') scale(' + scale + ')">' +
             '<g fill="#2b2620" stroke="#2b2620" stroke-width="6">' + shapes + '</g>' +
             '<g fill="#f2e8d6">' + shapes + '</g>' +
           '</g>';
  }

  function ukiyoWrap(inner) {
    return '<svg class="icon-svg" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid meet" ' +
           'xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>';
  }

  var UKIYO_ICONS = {
    sun: function () {
      return ukiyoWrap(
        '<circle cx="32" cy="30" r="11" fill="#c8452f"/>' +
        '<circle cx="32" cy="30" r="17" fill="none" stroke="#c8452f" stroke-opacity=".45" stroke-width="2"/>' +
        '<circle cx="32" cy="30" r="22" fill="none" stroke="#c8452f" stroke-opacity=".22" stroke-width="2"/>'
      );
    },
    moon: function () {
      return ukiyoWrap(
        '<path d="M40 12a20 20 0 1 0 0 40 25 25 0 0 1 0-40Z" fill="#efe3cb" stroke="#2b2620" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<path d="M20 22h6M26 32h4" stroke="#2b2620" stroke-width="1.4" stroke-linecap="round" stroke-opacity=".5"/>'
      );
    },
    cloud: function () {
      return ukiyoWrap(ukiyoCloud(32, 32, 1.05));
    },
    'sun-cloud': function () {
      return ukiyoWrap('<circle cx="45" cy="19" r="8.5" fill="#c8452f"/>' + ukiyoCloud(28, 40, 0.86));
    },
    'moon-cloud': function () {
      return ukiyoWrap('<path d="M50 12a11 11 0 1 0 0 22 14 14 0 0 1 0-22Z" fill="#efe3cb" stroke="#2b2620" stroke-width="1.4"/>' +
                        ukiyoCloud(28, 40, 0.86));
    },
    fog: function () {
      return ukiyoWrap(
        '<g stroke="#2b2620" stroke-width="3.4" stroke-linecap="round" fill="none" opacity=".82">' +
        '<path d="M12 24h40"/><path d="M19 33h33"/><path d="M12 42h40"/><path d="M21 51h28"/>' +
        '</g>'
      );
    },
    drizzle: function () {
      return ukiyoWrap(ukiyoCloud(32, 26, 0.8) +
        '<g fill="#3d5a80"><circle cx="22" cy="48" r="2.4"/><circle cx="32" cy="50" r="2.4"/><circle cx="42" cy="48" r="2.4"/></g>');
    },
    rain: function () {
      return ukiyoWrap(ukiyoCloud(32, 26, 0.8) +
        '<g stroke="#3d5a80" stroke-width="2.8" stroke-linecap="round">' +
        '<path d="M23 44l-3 8"/><path d="M33 44l-3 8"/><path d="M43 44l-3 8"/></g>');
    },
    snow: function () {
      return ukiyoWrap(ukiyoCloud(32, 26, 0.8) +
        '<g stroke="#3d5a80" stroke-width="2.2" stroke-linecap="round">' +
        '<path d="M22 44v9M17.7 48.4l8.6 4.2M26.3 48.4l-8.6 4.2"/>' +
        '<path d="M42 44v9M37.7 48.4l8.6 4.2M46.3 48.4l-8.6 4.2"/>' +
        '</g>');
    },
    thunder: function () {
      return ukiyoWrap(ukiyoCloud(32, 24, 0.8) +
        '<path d="M35 38l-10 14h7l-4 12 15-17h-7l5-9z" fill="#d9a33a" stroke="#2b2620" stroke-width="1.6" stroke-linejoin="round"/>');
    },
    aurora: function () {
      return ukiyoWrap(
        '<g fill="none" stroke-linecap="round">' +
        '<path d="M10 46c6-21 16-31 26-31 7 0 11 4 15 9" stroke="#4fae95" stroke-width="5.5" opacity=".9"/>' +
        '<path d="M17 53c5-15 13-23 22-23 6 0 9 3 12 7" stroke="#8f7bff" stroke-width="4.5" opacity=".72"/>' +
        '<path d="M25 57c3-8 8-13 14-13" stroke="#c8452f" stroke-width="3.4" opacity=".62"/>' +
        '</g>'
      );
    }
  };

  function iconSVG(kind) {
    if (state.theme === 'ukiyo-e' && UKIYO_ICONS[kind]) return UKIYO_ICONS[kind]();
    return pixelIconSVG(PIXEL_ART[kind] || PIXEL_ART.cloud);
  }

  /* ═════════════════════════ 7. Спрайты-фоны ═════════════════════════ */

  /* Плавная смена фона: два слоя .sprite-layer перекрестно затухают */
  function applySprite(container, url, size, position) {
    if (!container) return;
    var key = url + '|' + size + '|' + position;
    if (container.dataset.spriteKey === key) return;
    container.dataset.spriteKey = key;

    var layers = container.querySelectorAll('.sprite-layer');
    if (!layers.length) return;

    var active = container.querySelector('.sprite-layer.is-active');
    var target;
    if (!active) target = layers[0];
    else target = (active === layers[0] && layers[1]) ? layers[1] : layers[0];

    target.style.backgroundImage = 'url("' + url + '")';
    target.style.backgroundSize = size;
    target.style.backgroundPosition = position;

    if (!active) { target.classList.add('is-active'); return; }

    void target.offsetWidth;          // перезапуск transition
    target.classList.add('is-active');
    active.classList.remove('is-active');
  }

  /* backGROUNDS.png: 2 колонки (pixel / ukiyo-e) × 5 строк.
     Для городов с сюжетом — back_<story>.png, сетка задаётся в STORY_CARD_FIT. */
  function cardSprite(cardState, story, isDay) {
    if (story && STORY_CARDS[story]) {
      var fit = STORY_CARD_FIT[story] || STORY_CARD_FIT.tokyo;
      return {
        url: STORY_CARDS[story],
        size: fit.size,
        position: fit.posX[isDay ? 'day' : 'night'] + ' ' + fit.posY[state.theme]
      };
    }
    var col = (state.theme === 'ukiyo-e') ? 1 : 0;
    var row = CARD_ROWS[cardState] || 0;
    return {
      url: SPRITE_CARDS,
      size: '200% 500%',
      position: (col * 100) + '% ' + ((row / 4) * 100) + '%'
    };
  }

  /* back_2.png / back_2uki-e.png: 5 колонок × 2 строки.
     Для городов с сюжетом — back_2_<story>.png, сетка задаётся в STORY_DETAIL_FIT. */
  function detailSprite(detailState, story, isDay) {
    if (story && STORY_DETAIL[story]) {
      var dfit = STORY_DETAIL_FIT[story] || STORY_DETAIL_FIT.tokyo;
      return {
        url: STORY_DETAIL[story],
        size: dfit.size,
        position: (isDay ? 0 : 100) + '% ' + dfit.posY[state.theme] + '%'
      };
    }
    var cell = DETAIL_CELL[detailState] || DETAIL_CELL.clear;
    return {
      url: SPRITE_DETAIL[state.theme] || SPRITE_DETAIL.pixel,
      size: '500% 200%',
      position: ((cell[0] / 4) * 100) + '% ' + (cell[1] * 100) + '%'
    };
  }

  /* Сюжет города: 'tokyo' для Токио и Киото, иначе null */
  function storyFor(city) {
    if (!city || !city.name) return null;
    var name = String(city.name).trim().toLowerCase();
    return CITY_STORIES[name] || null;
  }

  /* Ключ текущего кадра: у сюжетных спрайтов важны только день и ночь,
     у общих — погодное состояние (по нему же tick() понимает, что пора менять фон) */
  function spriteKeyFor(story, cardState, isDay) {
    return story ? (story + ':' + (isDay ? 'day' : 'night')) : cardState;
  }

  /* День/ночь по местным часам города — только для фона-заглушки,
     пока не пришли данные API (там фаза считается по восходу и закату) */
  function dayGuess(tz) {
    var h = localInfo(tz).hour;
    return h >= 7 && h < 19;
  }

  /* ═════════════════════════ 8. Работа с API ═════════════════════════ */

  function weatherURL(city) {
    return FORECAST_API +
      '?latitude=' + city.latitude +
      '&longitude=' + city.longitude +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m' +
      '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max' +
      '&timezone=auto&forecast_days=10';
  }

  function hourIndex(times, li) {
    var key = li.date + 'T' + pad2(li.hour) + ':00';
    for (var i = 0; i < times.length; i++) {
      if (times[i] >= key) return i;
    }
    return Math.max(0, times.length - 24);
  }

  function normalize(city, raw) {
    var tz = raw.timezone || city.timezone || 'UTC';
    var cur = raw.current || {};
    var daily = raw.daily || {};
    var hourly = raw.hourly || {};

    var dTime = daily.time || [];
    var li = localInfo(tz);
    var todayIdx = dTime.indexOf(li.date);
    if (todayIdx < 0) todayIdx = 0;

    var sunrise = (daily.sunrise || [])[todayIdx] || null;
    var sunset = (daily.sunset || [])[todayIdx] || null;

    var hTime = hourly.time || [];
    var hTemp = hourly.temperature_2m || [];
    var hCode = hourly.weather_code || [];
    var hPop = hourly.precipitation_probability || [];

    var start = hourIndex(hTime, li);
    var hours = [];
    for (var i = start; i < hTime.length && hours.length < 24; i++) {
      hours.push({
        time: hTime[i],
        temp: hTemp[i],
        code: hCode[i],
        pop: (typeof hPop[i] === 'number') ? hPop[i] : null
      });
    }

    var days = [];
    var dMax = daily.temperature_2m_max || [];
    var dMin = daily.temperature_2m_min || [];
    var dCode = daily.weather_code || [];
    var dPop = daily.precipitation_probability_max || [];
    for (var d = 0; d < dTime.length && d < 10; d++) {
      days.push({
        date: dTime[d], code: dCode[d], max: dMax[d], min: dMin[d],
        pop: (typeof dPop[d] === 'number') ? dPop[d] : null,
        sunrise: (daily.sunrise || [])[d] || null,
        sunset: (daily.sunset || [])[d] || null
      });
    }

    return {
      city: city,
      tz: tz,
      fetched: Date.now(),
      current: {
        temp: cur.temperature_2m,
        feels: cur.apparent_temperature,
        humidity: cur.relative_humidity_2m,
        wind: cur.wind_speed_10m,
        precip: cur.precipitation,
        code: (typeof cur.weather_code === 'number') ? cur.weather_code : (dCode[todayIdx] || 0),
        apiIsDay: (typeof cur.is_day === 'number') ? !!cur.is_day : null
      },
      today: {
        max: (days[0] && typeof days[0].max === 'number') ? days[0].max : cur.temperature_2m,
        min: (days[0] && typeof days[0].min === 'number') ? days[0].min : cur.temperature_2m,
        pop: days[0] ? days[0].pop : null,
        sunrise: sunrise,
        sunset: sunset
      },
      hours: hours,
      days: days,
      desc: WMO[cur.weather_code] || WMO[dCode[todayIdx]] || 'Погода'
    };
  }

  function loadWeather(city, force) {
    var cached = state.weather[city.id];
    if (!force && cached && (Date.now() - cached.fetched) < CACHE_TTL) return Promise.resolve(cached);
    if (state.loading[city.id]) return state.loading[city.id];

    var promise = fetchJSON(weatherURL(city), 15000).then(function (raw) {
      var w = normalize(city, raw);
      state.weather[city.id] = w;
      delete state.errors[city.id];
      saveCache();
      updateCard(city);
      if (state.activeCityId === city.id) renderDetail(city.id);
      return w;
    }).catch(function (err) {
      state.errors[city.id] = (err && err.message) ? err.message : 'network';
      updateCard(city);
      if (state.activeCityId === city.id) renderDetail(city.id);
      throw err;
    });

    var cleanup = function (v) { delete state.loading[city.id]; return v; };
    state.loading[city.id] = promise.then(cleanup, function (e) { cleanup(); throw e; });
    return state.loading[city.id];
  }

  function refreshAll(force) {
    var list = state.cities.slice();
    if (!list.length) { renderStatus(); return Promise.resolve(); }
    var idx = 0, failed = 0;

    function worker() {
      if (idx >= list.length) return Promise.resolve();
      var city = list[idx++];
      return loadWeather(city, force).then(null, function () { failed++; }).then(worker);
    }
    var workers = [];
    for (var i = 0; i < Math.min(3, list.length); i++) workers.push(worker());

    renderStatus(true);
    return Promise.all(workers).then(function () {
      renderStatus(false, failed);
      return failed;
    });
  }

  function saveCache() {
    var out = {};
    Object.keys(state.weather).forEach(function (id) { out[id] = state.weather[id]; });
    writeJSON(KEY_CACHE, out);
  }

  function loadCache(cities) {
    var raw = readJSON(KEY_CACHE, {});
    var out = {};
    cities.forEach(function (c) {
      var w = raw[c.id];
      if (w && w.current && typeof w.tz === 'string') {
        w.city = c;
        out[c.id] = w;
      }
    });
    return out;
  }

  /* ---- сохранённые города ---- */

  function loadCities() {
    var raw = readJSON(KEY_CITIES, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (c) {
      return c && typeof c.latitude === 'number' && typeof c.longitude === 'number' && c.name;
    }).map(function (c) {
      if (!c.id) c.id = makeId(c.latitude, c.longitude);
      if (!c.timezone) c.timezone = 'UTC';
      return c;
    });
  }

  function saveCities() { writeJSON(KEY_CITIES, state.cities); }

  function findCity(id) {
    for (var i = 0; i < state.cities.length; i++) {
      if (state.cities[i].id === id) return state.cities[i];
    }
    return null;
  }

  function addCity(city) {
    if (findCity(city.id)) { toast('Этот город уже в списке'); return false; }
    state.cities.push(city);
    saveCities();
    renderMain();
    loadWeather(city).then(null, function () {});
    toast('Добавлено: ' + city.name);
    return true;
  }

  function removeCity(id) {
    var city = findCity(id);
    if (!city) return;
    state.cities = state.cities.filter(function (c) { return c.id !== id; });
    delete state.weather[id];
    delete state.errors[id];
    delete state.cardNodes[id];
    saveCities();
    saveCache();
    renderMain();
    toast('Удалено: ' + city.name);
  }

  /* ═════════════════════════ 9. Главный экран ═════════════════════════ */

  function renderMain() {
    var list = $('cityList');
    var ids = state.cities.map(function (c) { return c.id; }).join('|');

    if (ids !== state.renderedIds) {
      state.renderedIds = ids;
      state.cardNodes = {};
      list.textContent = '';
      state.cities.forEach(function (city, i) {
        var card = buildCard(city, i);
        state.cardNodes[city.id] = card;
        list.appendChild(card);
      });
    } else {
      state.cities.forEach(function (city) { updateCard(city); });
    }

    $('emptyState').hidden = state.cities.length > 0;
    list.hidden = state.cities.length === 0;
  }

  function buildCard(city, index) {
    var card = document.createElement('article');
    card.className = 'city-card';
    card.dataset.cityId = city.id;
    card.style.setProperty('--i', String(index));

    var story = storyFor(city);
    if (story) card.dataset.story = story;

    card.innerHTML =
      '<div class="card-bg"><div class="sprite-layer"></div><div class="sprite-layer"></div></div>' +
      '<div class="card-fx"></div>' +
      '<div class="card-scrim"></div>' +
      '<div class="card-content">' +
        '<div class="card-left">' +
          '<div class="card-city"></div>' +
          '<div class="card-time"></div>' +
          '<div class="card-desc"></div>' +
        '</div>' +
        '<div class="card-right">' +
          '<div class="card-temp-row"><span class="card-temp"></span><span class="card-icon"></span></div>' +
          '<div class="card-range"></div>' +
        '</div>' +
      '</div>' +
      '<button type="button" class="card-remove" aria-label="Удалить город">×</button>';

    card.addEventListener('click', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('.card-remove')) return;
      openDetail(city.id);
    });

    var removeBtn = card.querySelector('.card-remove');
    removeBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (removeBtn.dataset.confirm === '1') { removeCity(city.id); return; }
      removeBtn.dataset.confirm = '1';
      removeBtn.classList.add('is-confirm');
      removeBtn.textContent = '✓';
      toast('Нажмите ✓, чтобы удалить «' + city.name + '»');
      setTimeout(function () {
        removeBtn.dataset.confirm = '';
        removeBtn.classList.remove('is-confirm');
        removeBtn.textContent = '×';
      }, 3500);
    });

    updateCard(city, card);
    return card;
  }

  function updateCard(city, node) {
    var card = node || state.cardNodes[city.id];
    if (!card) return;

    var w = state.weather[city.id];
    var cityEl  = card.querySelector('.card-city');
    var timeEl  = card.querySelector('.card-time');
    var descEl  = card.querySelector('.card-desc');
    var tempEl  = card.querySelector('.card-temp');
    var rangeEl = card.querySelector('.card-range');
    var iconEl  = card.querySelector('.card-icon');
    var fxEl    = card.querySelector('.card-fx');
    var bgEl    = card.querySelector('.card-bg');

    setText(cityEl, city.name);
    setText(timeEl, hhmm(city.timezone));

    var story = storyFor(city);

    if (!w) {
      var err = state.errors[city.id];
      setText(descEl, err ? 'Нет данных — проверьте связь' : 'Загрузка…');
      setText(tempEl, '—');
      setText(rangeEl, '');
      iconEl.innerHTML = '';
      card.classList.remove('is-error');
      if (err) card.classList.add('is-error');
      fxEl.className = 'card-fx';
      var isDayGuess = dayGuess(city.timezone);
      card.dataset.state = spriteKeyFor(story, 'clear', isDayGuess);
      var ph = cardSprite('clear', story, isDayGuess);
      applySprite(bgEl, ph.url, ph.size, ph.position);
      return;
    }

    var st = liveStates(w);
    card.classList.remove('is-error');
    card.dataset.state = spriteKeyFor(story, st.cardState, st.isDay);

    setText(descEl, w.desc);
    setText(tempEl, tempText(w.current.temp));
    setText(rangeEl, 'Макс.: ' + roundOr(w.today.max, '—') + '°, мин.: ' + roundOr(w.today.min, '—') + '°');
    iconEl.innerHTML = iconSVG(st.icon);

    var fx = 'none';
    if (st.icon === 'thunder') fx = 'storm';
    else if (st.icon === 'rain' || st.icon === 'drizzle') fx = 'rain';
    else if (st.icon === 'snow') fx = 'snow';
    fxEl.className = 'card-fx fx-' + fx;

    var sp = cardSprite(st.cardState, story, st.isDay);
    applySprite(bgEl, sp.url, sp.size, sp.position);
  }

  function renderStatus(loading, failed) {
    var bar = $('statusBar');
    if (!bar) return;
    if (loading) {
      bar.hidden = false;
      bar.className = 'status-bar is-loading';
      bar.textContent = 'Обновляем погоду…';
      return;
    }
    if (failed) {
      bar.hidden = false;
      bar.className = 'status-bar is-error';
      bar.textContent = 'Не удалось обновить ' + failed + ' ' + plural(failed, 'город', 'города', 'городов') + '. Проверьте соединение.';
      return;
    }
    if (!state.cities.length) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.className = 'status-bar';
    bar.textContent = 'Обновлено в ' + hhmm(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  /* ═════════════════════════ 10. Экран поиска ═════════════════════════ */

  var searchTimer = null;
  var searchToken = 0;

  function openSearch() {
    if (location.hash === '#search') { showScreen('search'); focusSearch(); return; }
    location.hash = 'search';
  }

  function focusSearch() {
    var input = $('searchInput');
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 120);
  }

  function renderPresets() {
    var presets = (window.PRESET_CITIES || []).slice(0, 14).map(function (c) {
      return {
        id: makeId(c.latitude, c.longitude),
        name: c.name, admin1: c.admin1 || '', country: c.country || '',
        latitude: c.latitude, longitude: c.longitude, timezone: c.timezone || 'UTC'
      };
    });
    setSearchInfo('Популярные города — начните вводить название, чтобы найти любой город мира.');
    renderResults(presets);
  }

  function setSearchInfo(text) { setText($('searchInfo'), text); }

  function onSearchInput() {
    var q = $('searchInput').value.trim();
    $('btnSearchClear').hidden = !q;
    clearTimeout(searchTimer);
    if (!q) { renderPresets(); return; }
    searchTimer = setTimeout(function () { runSearch(q); }, 380);
  }

  function runSearch(q) {
    var token = ++searchToken;
    setSearchInfo('Ищем «' + q + '»…');
    geocode(q).then(function (list) {
      if (token !== searchToken) return;
      if (!list.length) {
        setSearchInfo('Ничего не найдено. Попробуйте другое название.');
        $('searchResults').textContent = '';
        return;
      }
      setSearchInfo('Найдено: ' + list.length + '. Нажмите «Добавить», чтобы сохранить город.');
      renderResults(list);
    }).catch(function () {
      if (token !== searchToken) return;
      var local = localSearch(q);
      if (local.length) {
        setSearchInfo('Сеть недоступна — показаны города из встроенного списка.');
        renderResults(local);
      } else {
        setSearchInfo('Поиск недоступен без интернета. Проверьте соединение.');
        $('searchResults').textContent = '';
      }
    });
  }

  function geocode(q) {
    var url = GEO_API + '?name=' + encodeURIComponent(q) + '&count=12&language=ru&format=json';
    return fetchJSON(url, 12000).then(function (data) {
      var results = data && data.results ? data.results : [];
      var seen = {};
      return results.filter(function (r) {
        if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number') return false;
        var id = makeId(r.latitude, r.longitude);
        if (seen[id]) return false;
        seen[id] = true;
        return true;
      }).map(function (r) {
        return {
          id: makeId(r.latitude, r.longitude),
          name: r.name,
          admin1: r.admin1 || '',
          country: r.country || '',
          latitude: r.latitude,
          longitude: r.longitude,
          timezone: r.timezone || 'UTC'
        };
      });
    });
  }

  function localSearch(q) {
    var needle = q.toLowerCase();
    var presets = window.PRESET_CITIES || [];
    var out = [];
    for (var i = 0; i < presets.length && out.length < 12; i++) {
      var c = presets[i];
      if (c.name.toLowerCase().indexOf(needle) !== -1 ||
          (c.admin1 && c.admin1.toLowerCase().indexOf(needle) !== -1) ||
          (c.country && c.country.toLowerCase().indexOf(needle) !== -1)) {
        out.push({
          id: makeId(c.latitude, c.longitude),
          name: c.name, admin1: c.admin1 || '', country: c.country || '',
          latitude: c.latitude, longitude: c.longitude, timezone: c.timezone || 'UTC'
        });
      }
    }
    return out;
  }

  function renderResults(list) {
    var box = $('searchResults');
    box.textContent = '';
    var frag = document.createDocumentFragment();

    list.forEach(function (city) {
      var row = document.createElement('div');
      row.className = 'result';

      var main = document.createElement('div');
      main.className = 'result-main';

      var name = document.createElement('div');
      name.className = 'result-name';
      name.textContent = city.name;

      var sub = document.createElement('div');
      sub.className = 'result-sub';
      var subParts = [];
      if (city.admin1 && city.admin1 !== city.name) subParts.push(city.admin1);
      if (city.country) subParts.push(city.country);
      sub.textContent = subParts.join(', ') || '—';

      var coords = document.createElement('div');
      coords.className = 'result-coords';
      coords.textContent = city.latitude.toFixed(3) + '°, ' + city.longitude.toFixed(3) + '°';

      main.appendChild(name);
      main.appendChild(sub);
      main.appendChild(coords);
      row.appendChild(main);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-small';
      if (findCity(city.id)) {
        btn.textContent = 'В списке';
        btn.classList.add('is-disabled');
        btn.disabled = true;
      } else {
        btn.textContent = 'Добавить';
        btn.addEventListener('click', function () {
          btn.disabled = true;
          btn.textContent = 'В списке';
          btn.classList.add('is-disabled');
          if (addCity(city)) goHome();
        });
      }
      row.appendChild(btn);
      frag.appendChild(row);
    });

    box.appendChild(frag);
  }

  /* ═════════════════════════ 11. Детальный экран ═════════════════════════ */

  function openDetail(cityId) {
    var hash = '#city/' + cityId;
    if (location.hash === hash) { state.activeCityId = cityId; showScreen('detail'); renderDetail(cityId); }
    else location.hash = hash;
  }

  function renderDetail(cityId) {
    var city = findCity(cityId);
    if (!city) { goHome(); return; }

    state.activeCityId = cityId;
    var w = state.weather[cityId];
    var story = storyFor(city);

    setText($('detailCity'), city.name);

    if (!w) {
      var err = state.errors[cityId];
      setText($('detailSub'), subtitle(city, null));
      setText($('detailDesc'), err ? 'Не удалось загрузить данные. Нажмите ⟳, чтобы повторить.' : 'Загрузка данных…');
      setText($('detailTemp'), '—');
      setText($('detailRange'), '');
      $('detailIcon').innerHTML = '';
      $('detailMeta').innerHTML = '';
      $('dailyList').textContent = '';
      $('hourlyStrip').textContent = '';
      clearChart();
      var ph = detailSprite('clear', story, dayGuess(city.timezone));
      applySprite($('detailBg'), ph.url, ph.size, ph.position);
      if (!err) loadWeather(city).then(null, function () {});
      return;
    }

    var st = liveStates(w);
    setText($('detailSub'), subtitle(city, st.li));
    setText($('detailDesc'), w.desc);
    setText($('detailTemp'), tempText(w.current.temp));
    setText($('detailRange'), 'Макс.: ' + roundOr(w.today.max, '—') + '°, мин.: ' + roundOr(w.today.min, '—') + '°');
    $('detailIcon').innerHTML = iconSVG(st.icon);
    $('detailMeta').innerHTML = metaHTML(w);

    var sp = detailSprite(st.detailState, story, st.isDay);
    applySprite($('detailBg'), sp.url, sp.size, sp.position);

    var fx = 'none';
    if (st.icon === 'thunder') fx = 'storm';
    else if (st.icon === 'rain' || st.icon === 'drizzle') fx = 'rain';
    else if (st.icon === 'snow') fx = 'snow';
    $('detailFx').className = 'detail-fx fx-' + fx;

    renderHourlyStrip(w, st);
    renderDaily(w);
    drawChart();
  }

  function subtitle(city, li) {
    var when = '';
    if (li) {
      var full = dateInfo(li.date);
      when = WEEKDAYS_FULL[full.wd] + ', ' + full.d + ' ' + MONTHS_GEN[full.m - 1] + ' · ' +
             pad2(li.hour) + ':' + pad2(li.minute) + ' местное время';
    } else {
      when = hhmm(city.timezone) + ' местное время';
    }
    var place = [];
    if (city.admin1 && city.admin1 !== city.name) place.push(city.admin1);
    if (city.country) place.push(city.country);
    return when + (place.length ? ' · ' + place.join(', ') : '');
  }

  function metaHTML(w) {
    var items = [
      ['Ощущается', tempText(w.current.feels)],
      ['Влажность', roundOr(w.current.humidity, '—') + '%'],
      ['Ветер', roundOr(w.current.wind, '—') + ' км/ч'],
      ['Осадки', roundOr(w.today.pop, 0) + '%'],
      ['Восход', isoTime(w.today.sunrise)],
      ['Закат', isoTime(w.today.sunset)]
    ];
    var out = '';
    for (var i = 0; i < items.length; i++) {
      out += '<div class="meta-item"><span class="meta-label">' + items[i][0] +
             '</span><span class="meta-value">' + items[i][1] + '</span></div>';
    }
    return out;
  }

  function renderHourlyStrip(w, st) {
    var box = $('hourlyStrip');
    box.textContent = '';
    var frag = document.createDocumentFragment();

    w.hours.forEach(function (h, i) {
      var isDay = (function () {
        /* день/ночь для часа: сравниваем с восходом и закатом дня этого часа */
        var day = null;
        for (var d = 0; d < w.days.length; d++) {
          if (w.days[d].date === h.time.slice(0, 10)) { day = w.days[d]; break; }
        }
        if (!day) return st.isDay;
        var m = isoMinutes(h.time + ':00');
        var sr = isoMinutes(day.sunrise), ss = isoMinutes(day.sunset);
        if (sr === null || ss === null) return st.isDay;
        return (m >= sr && m <= ss);
      })();

      var chip = document.createElement('div');
      chip.className = 'hour-chip' + (i === 0 ? ' is-now' : '');
      chip.innerHTML =
        '<span class="hour-time">' + h.time.slice(11, 16) + '</span>' +
        '<span class="hour-icon">' + iconSVG(iconKindFor(h.code, isDay)) + '</span>' +
        '<span class="hour-temp">' + tempText(h.temp) + '</span>' +
        '<span class="hour-pop">' + (typeof h.pop === 'number' ? h.pop + '%' : '') + '</span>';
      frag.appendChild(chip);
    });

    box.appendChild(frag);
  }

  function renderDaily(w) {
    var box = $('dailyList');
    box.textContent = '';

    var gMin = Infinity, gMax = -Infinity;
    w.days.forEach(function (d) {
      if (typeof d.max === 'number' && d.max > gMax) gMax = d.max;
      if (typeof d.min === 'number' && d.min < gMin) gMin = d.min;
    });
    if (!isFinite(gMin) || !isFinite(gMax)) { gMin = 0; gMax = 1; }
    var span = (gMax - gMin) || 1;

    var frag = document.createDocumentFragment();
    w.days.forEach(function (d, i) {
      var info = dateInfo(d.date);
      var row = document.createElement('div');
      row.className = 'day-row';

      var label = (i === 0) ? 'Сегодня' : (i === 1) ? 'Завтра' : WEEKDAYS_SHORT[info.wd];
      var left = Math.max(0, Math.min(100, ((d.min - gMin) / span) * 100));
      var right = Math.max(0, Math.min(100, ((d.max - gMin) / span) * 100));
      var width = Math.max(6, right - left);

      row.innerHTML =
        '<div class="day-date"><span class="day-wd">' + label + '</span>' +
          '<span class="day-dm">' + info.d + ' ' + MONTHS_GEN[info.m - 1].slice(0, 3) + '</span></div>' +
        '<div class="day-icon">' + iconSVG(iconKindFor(d.code, true)) + '</div>' +
        '<div class="day-pop">' + (typeof d.pop === 'number' && d.pop > 0 ? d.pop + '%' : '') + '</div>' +
        '<div class="day-range">' +
          '<span class="day-min">' + roundOr(d.min, '—') + '°</span>' +
          '<span class="day-bar"><i style="left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%"></i></span>' +
          '<span class="day-max">' + roundOr(d.max, '—') + '°</span>' +
        '</div>';
      frag.appendChild(row);
    });

    box.appendChild(frag);
  }

  /* ---- график температуры на 24 часа (Canvas, без библиотек) ---- */

  function clearChart() {
    var canvas = $('hourlyChart');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawChart() {
    var canvas = $('hourlyChart');
    var w = state.weather[state.activeCityId];
    if (!canvas || !w || !w.hours || w.hours.length < 2) { clearChart(); return; }

    var rect = canvas.getBoundingClientRect();
    var cssW = Math.max(240, rect.width || canvas.parentNode.clientWidth || 300);
    var cssH = Math.max(120, rect.height || 170);
    var dpr = Math.min(window.devicePixelRatio || 1, 3);

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var styles = getComputedStyle(document.body);
    var lineColor = (styles.getPropertyValue('--chart-line') || '#ffd23d').trim();
    var fillColor = (styles.getPropertyValue('--chart-fill') || 'rgba(255,210,61,.25)').trim();
    var gridColor = (styles.getPropertyValue('--chart-grid') || 'rgba(255,255,255,.14)').trim();
    var textColor = (styles.getPropertyValue('--chart-text') || '#eaf1ff').trim();
    var fontFamily = (styles.getPropertyValue('--chart-font') || 'sans-serif').trim();

    var temps = [];
    var lastValid = null;
    for (var k = 0; k < w.hours.length; k++) {
      var t = w.hours[k].temp;
      if (typeof t === 'number' && isFinite(t)) lastValid = t;
      temps.push(lastValid);
    }
    var firstValid = null;
    for (k = 0; k < temps.length; k++) { if (temps[k] !== null) { firstValid = temps[k]; break; } }
    if (firstValid === null) { clearChart(); return; }
    for (k = 0; k < temps.length; k++) { if (temps[k] === null) temps[k] = firstValid; }
    if (temps.length < 2) { clearChart(); return; }

    var min = Math.min.apply(null, temps);
    var max = Math.max.apply(null, temps);
    if (max - min < 2) { var mid = (max + min) / 2; min = mid - 1.5; max = mid + 1.5; }
    var span = max - min;
    min -= span * 0.22; max += span * 0.22;
    span = max - min;

    var padL = 14, padR = 14, padT = 26, padB = 26;
    var innerW = Math.max(20, cssW - padL - padR);
    var innerH = Math.max(20, cssH - padT - padB);
    var n = w.hours.length;

    function px(i) { return padL + (i / (n - 1)) * innerW; }
    function py(t) { return padT + (1 - (t - min) / span) * innerH; }

    /* сетка */
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    [0, 0.5, 1].forEach(function (f) {
      var y = Math.round(padT + f * innerH) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + innerW, y);
      ctx.stroke();
    });

    /* заливка под линией */
    var grad = ctx.createLinearGradient(0, padT, 0, padT + innerH);
    grad.addColorStop(0, fillColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.moveTo(px(0), py(temps[0]));
    for (var i = 1; i < n; i++) ctx.lineTo(px(i), py(temps[i]));
    ctx.lineTo(px(n - 1), padT + innerH);
    ctx.lineTo(px(0), padT + innerH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    /* линия */
    ctx.beginPath();
    ctx.moveTo(px(0), py(temps[0]));
    for (i = 1; i < n; i++) ctx.lineTo(px(i), py(temps[i]));
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    /* точки и подписи каждые 3 часа */
    ctx.font = '11px ' + fontFamily;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (i = 0; i < n; i += 3) {
      var x = px(i), y = py(temps[i]);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
      ctx.fillStyle = textColor;
      var label = Math.round(temps[i]) + '°';
      var ly = y - 9;
      if (ly < padT - 12) ly = y + 16;
      ctx.fillText(label, Math.min(Math.max(x, 16), cssW - 16), ly);
    }

    /* подписи часов по оси X */
    ctx.fillStyle = textColor;
    ctx.globalAlpha = 0.72;
    for (i = 0; i < n; i += 3) {
      var hx = Math.min(Math.max(px(i), 18), cssW - 18);
      ctx.fillText(w.hours[i].time.slice(11, 13) + ':00', hx, cssH - 8);
    }
    ctx.globalAlpha = 1;
  }

  var resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!$('screenDetail').hidden) drawChart();
    }, 150);
  }

  /* ═════════════════════════ 12. Темы ═════════════════════════ */

  function applyTheme(theme, silent) {
    state.theme = (theme === 'ukiyo-e') ? 'ukiyo-e' : 'pixel';
    document.body.setAttribute('data-theme', state.theme);
    try { localStorage.setItem(KEY_THEME, state.theme); } catch (e) {}

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.theme === 'ukiyo-e' ? '#15110c' : '#0b0e14');

    Array.prototype.forEach.call(document.querySelectorAll('.theme-btn'), function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-theme-value') === state.theme);
    });

    /* перерисовать спрайты и иконки под новую тему */
    state.cities.forEach(function (city) { updateCard(city); });
    if (state.activeCityId) {
      renderDetail(state.activeCityId);
      if (!$('screenDetail').hidden) drawChart();
    }

    /* у каждой темы может быть свой фон приложения */
    applyAppBackground();

    tgTheme();
    if (!silent) toast(state.theme === 'ukiyo-e' ? 'Стиль: укиё-э' : 'Стиль: пиксель');
  }

  /* ═════════════════════════ 12.1 Свой фон (IndexedDB) ═════════════════════════ */
  /* Свой фон хранится Blob'ом в IndexedDB: ключи customBg_pixel и customBg_ukiyoe.
     Для каждой темы он подменяет back_gif.gif в слое #app-bg; сервер не участвует. */

  var BG_DB     = 'weather-app-bg';
  var BG_STORE  = 'backgrounds';
  var BG_MAX    = 5 * 1024 * 1024;
  var BG_KEY    = { pixel: 'customBg_pixel', 'ukiyo-e': 'customBg_ukiyoe' };
  var BG_LABEL  = { pixel: 'Pixel', 'ukiyo-e': 'Ukiyo-e' };
  var BG_THEMES = ['pixel', 'ukiyo-e'];

  var bgState = {
    tab: 'pixel',
    stored:    { pixel: null, 'ukiyo-e': null },   // Blob, который лежит в IndexedDB
    storedUrl: { pixel: '',   'ukiyo-e': '' },
    staged:    { pixel: null, 'ukiyo-e': null },   // выбран, но ещё не применён
    stagedUrl: { pixel: '',   'ukiyo-e': '' },
    stagedName:{ pixel: '',   'ukiyo-e': '' }
  };

  /* ---- IndexedDB ---- */

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('IndexedDB недоступен')); return; }
      var req = indexedDB.open(BG_DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(BG_STORE)) db.createObjectStore(BG_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB')); };
    });
  }

  function bgGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(BG_STORE, 'readonly');
        var req = tx.objectStore(BG_STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
        tx.oncomplete = function () { db.close(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
        tx.onabort = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function bgWrite(key, blob) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(BG_STORE, 'readwrite');
        var store = tx.objectStore(BG_STORE);
        if (blob) store.put(blob, key); else store.delete(key);
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); reject(tx.error); };
        tx.onabort = function () { db.close(); reject(tx.error); };
      });
    });
  }

  /* ---- Blob ↔ object URL ---- */

  function makeUrl(blob) {
    if (!blob || !window.URL || typeof URL.createObjectURL !== 'function') return '';
    try { return URL.createObjectURL(blob); } catch (e) { return ''; }
  }

  function dropUrl(url) {
    if (!url) return;
    try { URL.revokeObjectURL(url); } catch (e) {}
  }

  function setStored(theme, blob) {
    dropUrl(bgState.storedUrl[theme]);
    bgState.stored[theme] = blob || null;
    bgState.storedUrl[theme] = makeUrl(blob);
  }

  function setStaged(theme, blob, name) {
    dropUrl(bgState.stagedUrl[theme]);
    bgState.staged[theme] = blob || null;
    bgState.stagedUrl[theme] = makeUrl(blob);
    bgState.stagedName[theme] = name || '';
  }

  /* ---- Применение к слою фона ---- */

  function applyAppBackground() {
    var layer = $('app-bg');
    if (!layer) return;
    var url = bgState.storedUrl[state.theme] || '';
    if (url) layer.style.backgroundImage = 'url("' + url + '")';
    else layer.style.removeProperty('background-image');   // вернётся back_gif.gif из style.css
  }

  function loadBackgrounds() {
    return Promise.all(BG_THEMES.map(function (theme) {
      return bgGet(BG_KEY[theme]).then(function (blob) {
        if (blob) setStored(theme, blob);
      }, function () { /* приватный режим или IndexedDB недоступен */ });
    })).then(function () { applyAppBackground(); });
  }

  /* ---- Интерфейс модального окна ---- */

  function bgPaneEl(attr, theme) {
    return document.querySelector('[' + attr + '="' + theme + '"]');
  }

  function bgSizeText(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' КБ';
    return bytes + ' Б';
  }

  function renderBgPane(theme) {
    var preview = bgPaneEl('data-bg-preview', theme);
    var status  = bgPaneEl('data-bg-status', theme);
    var apply   = bgPaneEl('data-bg-apply', theme);
    var reset   = bgPaneEl('data-bg-reset', theme);

    var stagedUrl = bgState.stagedUrl[theme];
    var storedUrl = bgState.storedUrl[theme];
    var src = stagedUrl || storedUrl || 'back_gif.gif';

    if (preview) preview.style.backgroundImage = 'url("' + src + '")';
    if (apply) apply.disabled = !bgState.staged[theme];
    if (reset) reset.disabled = !bgState.staged[theme] && !bgState.stored[theme];

    if (!status) return;
    if (bgState.staged[theme]) {
      status.textContent = 'Выбрано: «' + (bgState.stagedName[theme] || 'изображение') + '» · ' +
        bgSizeText(bgState.staged[theme].size) + '. Нажмите «Применить», чтобы сохранить.';
    } else if (bgState.stored[theme]) {
      status.textContent = 'Свой фон сохранён и показывается в теме «' + BG_LABEL[theme] + '».';
    } else {
      status.textContent = 'Сейчас используется стандартный фон (back_gif.gif).';
    }
  }

  function renderBgModal() {
    BG_THEMES.forEach(renderBgPane);
    Array.prototype.forEach.call(document.querySelectorAll('.bg-tab'), function (btn) {
      var on = btn.getAttribute('data-bg-tab') === bgState.tab;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.bg-pane'), function (pane) {
      pane.hidden = pane.getAttribute('data-bg-pane') !== bgState.tab;
    });
  }

  function openBgModal() {
    bgState.tab = (state.theme === 'ukiyo-e') ? 'ukiyo-e' : 'pixel';
    renderBgModal();
    $('bgModal').hidden = false;
  }

  function closeBgModal() {
    /* несохранённые превью не переживают закрытие окна */
    BG_THEMES.forEach(function (theme) { setStaged(theme, null, ''); });
    renderBgModal();
    $('bgModal').hidden = true;
  }

  function pickBgFile(theme, input) {
    var file = (input && input.files) ? input.files[0] : null;
    if (input) input.value = '';                 // повторный выбор того же файла
    if (!file) return;

    var isImage = file.type ? file.type.indexOf('image/') === 0
                            : /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name || '');
    if (!isImage) { alert('Можно загрузить только изображение'); return; }
    if (file.size > BG_MAX) { alert('Файл слишком большой, максимум 5 МБ'); return; }

    setStaged(theme, file, file.name);
    renderBgPane(theme);
  }

  function applyBgFile(theme) {
    var blob = bgState.staged[theme];
    if (!blob) return;
    bgWrite(BG_KEY[theme], blob).then(function () {
      setStored(theme, blob);
      setStaged(theme, null, '');
      applyAppBackground();
      renderBgModal();
      toast(theme === state.theme
        ? 'Свой фон применён'
        : 'Фон сохранён для темы «' + BG_LABEL[theme] + '»');
    }, function () {
      alert('Не удалось сохранить фон: браузер не дал доступ к IndexedDB.');
    });
  }

  function resetBgFile(theme) {
    bgWrite(BG_KEY[theme], null).then(function () {
      setStored(theme, null);
      setStaged(theme, null, '');
      applyAppBackground();
      renderBgModal();
      toast('Стандартный фон возвращён');
    }, function () {
      alert('Не удалось сбросить фон: браузер не дал доступ к IndexedDB.');
    });
  }

  /* ═════════════════════════ 13. Навигация ═════════════════════════ */

  function showScreen(name) {
    $('screenMain').hidden = (name !== 'main');
    $('screenSearch').hidden = (name !== 'search');
    $('screenDetail').hidden = (name !== 'detail');
    document.body.dataset.screen = name;
    tgBackButton(name !== 'main');
  }

  function goHome() {
    if (location.hash && history.length > 1) history.back();
    else location.hash = '';
  }

  function handleRoute() {
    var hash = (location.hash || '').replace(/^#\/?/, '');

    if (hash.indexOf('city/') === 0) {
      var id = hash.slice(5);
      if (findCity(id)) {
        showScreen('detail');
        renderDetail(id);
        return;
      }
      location.replace('#');
      return;
    }
    if (hash === 'search') {
      state.activeCityId = null;
      showScreen('search');
      focusSearch();
      return;
    }
    state.activeCityId = null;
    showScreen('main');
    renderStatus();
  }

  /* ═════════════════════════ 14. Уведомления ═════════════════════════ */

  var toastTimer = null;
  function toast(text) {
    var box = $('toast');
    box.textContent = text;
    box.hidden = false;
    box.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      box.classList.remove('is-visible');
      setTimeout(function () { box.hidden = true; }, 260);
    }, 2600);
  }

  /* ═════════════════════════ 15. Telegram Mini App ═════════════════════════ */

  var tg = null;

  function tgInit() {
    try {
      tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
      if (!tg) return;
      if (typeof tg.ready === 'function') tg.ready();
      if (typeof tg.expand === 'function') tg.expand();
      if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
      if (tg.BackButton && typeof tg.BackButton.onClick === 'function') {
        tg.BackButton.onClick(goHome);
      }
      tgTheme();
    } catch (e) { tg = null; }
  }

  function tgTheme() {
    if (!tg) return;
    try {
      if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor(state.theme === 'ukiyo-e' ? '#15110c' : '#0b0e14');
      if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor(state.theme === 'ukiyo-e' ? '#15110c' : '#0b0e14');
    } catch (e) {}
  }

  function tgBackButton(show) {
    if (!tg || !tg.BackButton) return;
    try { show ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {}
  }

  /* ═════════════════════════ 16. Тик часов ═════════════════════════ */

  function tick() {
    state.cities.forEach(function (city) {
      var card = state.cardNodes[city.id];
      if (!card) return;
      var timeEl = card.querySelector('.card-time');
      setText(timeEl, hhmm(city.timezone));

      var w = state.weather[city.id];
      if (!w) return;
      var st = liveStates(w);
      /* фон зависит от времени суток — обновляем при смене фазы
         (у сюжетных спрайтов — при смене день/ночь) */
      var story = storyFor(city);
      var key = spriteKeyFor(story, st.cardState, st.isDay);
      if (card.dataset.state !== key) {
        card.dataset.state = key;
        var sp = cardSprite(st.cardState, story, st.isDay);
        applySprite(card.querySelector('.card-bg'), sp.url, sp.size, sp.position);
      }
    });

    if (state.activeCityId && !$('screenDetail').hidden) {
      var w = state.weather[state.activeCityId];
      var city = findCity(state.activeCityId);
      if (w && city) setText($('detailSub'), subtitle(city, localInfo(w.tz)));
    }
  }

  /* ═════════════════════════ 17. Инициализация ═════════════════════════ */

  function bindEvents() {
    Array.prototype.forEach.call(document.querySelectorAll('.theme-btn'), function (btn) {
      btn.addEventListener('click', function () { applyTheme(btn.getAttribute('data-theme-value')); });
    });

    $('btnRefresh').addEventListener('click', function () {
      toast('Обновляем погоду…');
      refreshAll(true).then(function (failed) {
        toast(failed ? 'Часть городов не обновилась' : 'Погода обновлена');
      });
    });

    $('btnAdd').addEventListener('click', openSearch);
    $('btnEmptyAdd').addEventListener('click', openSearch);
    $('btnSearchBack').addEventListener('click', goHome);
    $('btnDetailBack').addEventListener('click', goHome);

    $('btnDetailRefresh').addEventListener('click', function () {
      var city = findCity(state.activeCityId);
      if (!city) return;
      toast('Обновляем…');
      delete state.errors[city.id];
      loadWeather(city, true).then(function () {
        renderDetail(city.id);
        toast('Готово');
      }, function () {
        renderDetail(city.id);
        toast('Не удалось обновить');
      });
    });

    $('searchInput').addEventListener('input', onSearchInput);
    $('btnSearchClear').addEventListener('click', function () {
      $('searchInput').value = '';
      $('btnSearchClear').hidden = true;
      renderPresets();
      $('searchInput').focus();
    });

    window.addEventListener('hashchange', handleRoute);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    /* ---- окно «Свой фон» ---- */
    $('btnSettings').addEventListener('click', openBgModal);
    $('btnBgClose').addEventListener('click', closeBgModal);
    $('bgModal').addEventListener('click', function (ev) {
      var t = ev.target;
      if (t && t.getAttribute && t.getAttribute('data-bg-close') !== null) closeBgModal();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.bg-tab'), function (btn) {
      btn.addEventListener('click', function () {
        bgState.tab = btn.getAttribute('data-bg-tab');
        renderBgModal();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-bg-input]'), function (input) {
      input.addEventListener('change', function () { pickBgFile(input.getAttribute('data-bg-input'), input); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-bg-apply]'), function (btn) {
      btn.addEventListener('click', function () { applyBgFile(btn.getAttribute('data-bg-apply')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-bg-reset]'), function (btn) {
      btn.addEventListener('click', function () { resetBgFile(btn.getAttribute('data-bg-reset')); });
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !$('bgModal').hidden) closeBgModal();
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        tick();
        refreshAll(false);
      }
    });
  }

  function init() {
    state.theme = (function () {
      try { return localStorage.getItem(KEY_THEME) === 'ukiyo-e' ? 'ukiyo-e' : 'pixel'; }
      catch (e) { return 'pixel'; }
    })();

    state.cities = loadCities();
    state.weather = loadCache(state.cities);

    applyTheme(state.theme, true);
    tgInit();
    bindEvents();
    handleRoute();
    renderMain();
    renderStatus();

    /* фон из IndexedDB подхватывается асинхронно, поверх уже показанного back_gif.gif */
    loadBackgrounds();

    refreshAll(false);

    setInterval(tick, CLOCK_MS);
    setInterval(function () { refreshAll(false); }, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

# Погода — Telegram Mini App

Личное погодное приложение: статические файлы, без бэкенда, без ИИ и без прокси.
Данные — напрямую из бесплатного [Open-Meteo](https://open-meteo.com/). Геолокация не используется:
города добавляются вручную через поиск и хранятся в `localStorage`.

## Файлы

| Файл | Назначение |
|---|---|
| `index.html` | Разметка трёх экранов (главный, поиск, детальный прогноз) |
| `style.css` | Две темы, карточки, анимации фонов, эффекты дождя/снега/грозы |
| `app.js` | API, спрайты, иконки, график на Canvas, роутер, темы |
| `cities.js` | Встроенный список городов (подсказки и офлайн-резерв поиска) |
| `backGROUNDS.png` | Спрайт карточек: 2 колонки (pixel \| ukiyo-e) × 5 строк (Ясно, Ночь, Облачно, Дождь, Закат) |
| `back_2.png` | Фон детального экрана, тема **pixel**: 5 колонок × 2 строки |
| `back_2uki-e.png` | Фон детального экрана, тема **ukiyo-e**: 5 колонок × 2 строки |

Порядок ячеек детального спрайта: Ясно, Закат, Ночь, Дождь, Весна (сакура) / Северное сияние, Туман, Вечер, Снег, Гроза.

## API

```
поиск:  https://geocoding-api.open-meteo.com/v1/search?name=Москва&count=12&language=ru&format=json
погода: https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..
        &current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m
        &hourly=temperature_2m,weather_code,precipitation_probability,is_day
        &daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max
        &timezone=auto&forecast_days=10
```

Ключ API не нужен. Часовой пояс каждого города приходит из ответа (`timezone`), локальное время
считается через `Intl.DateTimeFormat`, а не через часы устройства.

## Хранение данных (localStorage)

* `savedCities` — список городов
* `theme` — `pixel` или `ukiyo-e`
* `weatherCache` — последние ответы API (мгновенный показ при запуске)

## Публикация на GitHub Pages (приложение работает без вашего компьютера)

```bash
cd weather-app
git init
git add .
git commit -m "Weather mini app"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/weather-app.git
git push -u origin main
```

Дальше в репозитории: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
Через минуту приложение откроется по адресу `https://ВАШ_ЛОГИН.github.io/weather-app/`.

Все пути относительные, поэтому подпапка репозитория тоже работает.

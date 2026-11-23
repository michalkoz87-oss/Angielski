# Angielski krok po kroku

Aplikacja do samodzielnej nauki angielskiego dla kilku osób naraz. Każda osoba ma własny profil, poziom, plan nauki, powtórki i postępy.

Kod i materiały są rozwijane w repozytorium `michalkoz87-oss/Angielski` (gałąź `main`). Wcześniejsza kopia na gałęzi `claude/english-learning-program-b1-b2-qamrc9` w repozytorium `Nauka` nie jest już aktualizowana.

## Poziomy

| Poziom | Kurs | Sesja | Nowe słowa tygodniowo | Dla kogo |
| --- | --- | --- | --- | --- |
| A1 → A2 | Pierwsze kroki | ok. 20 min | 24 | dzieci od ok. 8 lat i dorośli zaczynający od zera |
| A2 → B1 | Na co dzień | ok. 25 min | 32 | uczniowie od ok. 11 lat i dorośli |
| B1 → B2 | Swobodnie | ok. 35 min | 40 | nastolatki od 13 lat i dorośli |
| B2 → C1 | Droga do C1 | ok. 40 min | 40 | dorośli |

Każdy kurs ma 24 tygodnie po 6 sesji. Sesja to powtórki, nowe słowa i lekcja dnia: czytanie (pon.), gramatyka (wt.), słuchanie (śr.), pisanie (czw.), słowa w użyciu i mówienie (pt.), test tygodnia i kontakt z językiem (sob.).

Stan treści: plan 24 tygodni jest gotowy dla wszystkich poziomów; materiały lekcji są opublikowane dla tygodni wymienionych w `data/courses.json` (pole `availableWeeks`). Tydzień bez materiałów aplikacja pokazuje jako „w przygotowaniu”.

## Jak korzystać

- **W Claude:** opublikowana strona `https://claude.ai/artifact/J8G6SVDDMsNkSvUakot9Qv`. Postęp zapisuje się na koncie Claude i synchronizuje między urządzeniami. Dorosłe profile mogą korzystać ze sprawdzania tekstów i rozmów z Claude.
- **Bez konta (GitHub Pages):** `https://michalkoz87-oss.github.io/Angielski/`. Strona działa po włączeniu w ustawieniach repozytorium: Settings → Pages → Deploy from a branch → `main`, katalog `/`. Repozytorium jest gotową stroną statyczną bez kroku budowania. Postęp zapisuje się tylko w przeglądarce danego urządzenia; w Ustawieniach aplikacji jest kopia zapasowa do pliku. Funkcje korzystające z Claude są w tej wersji niedostępne.
- **Lokalnie:** `npm install`, potem `npm run dev` i `http://localhost:5173/`.

## Budowa

```
index.html, css/            strona i style (tokeny kolorów, tryb jasny i ciemny)
js/main.js                  start, nawigacja, ekrany startowe (osoba → poziom → plan)
js/core/                    zapis i synchronizacja (store, sync-claude, model), powtórki (srs),
                            harmonogram (schedule), ćwiczenia (exercises), treści (content), dźwięk, Claude
js/views/                   ekrany: Dziś, sesja i jej kroki, Plan, Słownik, Postępy, Ustawienia
data/courses.json           lista poziomów i opublikowanych tygodni
data/courses/<poziom>/      program.json (plan 24 tygodni i limity treści) oraz weeks/wNN-*.json
scripts/                    walidator treści, katalog tygodni, serwer lokalny, budowanie strony do Claude
tests/                      testy jednostkowe i testy w przeglądarce
```

## Dodawanie treści

Format plików tygodnia opisuje `docs/CONTENT.md`; limity dla danego poziomu są w `data/courses/<poziom>/program.json` (pole `content`).

```
node scripts/validate-content.mjs --course b2c1 --week 2   # sprawdzenie jednego tygodnia
node scripts/validate-content.mjs                          # wszystkie kursy
node scripts/update-catalog.mjs                            # odświeża listę opublikowanych tygodni
npm run build:artifact                                     # dist/artifact: strona do publikacji w Claude
```

## Testy

```
npm test                                   # łączenie zapisów z kilku urządzeń
node tests/e2e/smoke.mjs b2c1 6            # pełny tydzień nauki na wybranym poziomie
node scripts/build-artifact.mjs --preview && node tests/e2e/sync.mjs   # synchronizacja dwóch urządzeń
```

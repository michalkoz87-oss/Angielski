# Format treści kursu

Każdy tydzień kursu to dwa pliki w `data/weeks/`:

- `wNN-vocab.json` — 40 haseł słownikowych (karty do powtórek),
- `wNN-lessons.json` — lekcje tygodnia: czytanie, gramatyka, słuchanie, pisanie, mówienie, ćwiczenia.

`NN` to numer tygodnia z zerem wiodącym (`01`…`24`). Plan całego kursu (tematy, gramatyka, proporcje poziomów) jest w `data/program.json`.

Poprawność plików sprawdza `node scripts/validate-content.mjs` (cały katalog) albo `node scripts/validate-content.mjs --week 7` (jeden tydzień). Walidator musi przejść bez błędów.

## Zasady ogólne

- Angielski brytyjski w pisowni i transkrypcji (colour, organise, /ˈwɔːtə/). Naturalny, współczesny język — taki, jakiego używa wykształcony native speaker.
- Polski poprawny i naturalny, z polskimi znakami. Tłumaczenia mają oddawać znaczenie w danym kontekście, nie być kalką.
- Odbiorca: dorosły Polak na poziomie B1/B2, cel C1. Wyjaśnienia po polsku, przykłady po angielsku.
- Żadnego Markdownu poza `**pogrubieniem**` i `*kursywą*` w polach opisowych (`bodyPl`, `explanationPl`, `whyPl`, `note`). Żadnego HTML.
- Znaczniki słów docelowych:
  - w `example` hasła: dokładnie jeden znacznik `{{forma}}` obejmujący hasło w formie użytej w zdaniu (ciągły fragment tekstu),
  - w tekstach lekcji (`reading.paragraphs`, `writing.modelAnswer`): `{{forma|id}}`, np. `{{came across|w01-23}}`, gdzie `id` to hasło z tego samego tygodnia.
- Pytania wielokrotnego wyboru: dokładnie jedna poprawna odpowiedź, pozostałe jednoznacznie błędne. Bez opcji typu „wszystkie powyższe”. Aplikacja sama miesza kolejność opcji.
- Odpowiedzi wpisywane (`answers`): lista **wszystkich** akceptowalnych wariantów (formy ściągnięte i pełne, warianty pisowni). Porównanie ignoruje wielkość liter, końcową interpunkcję i rodzaj apostrofu.

## `wNN-vocab.json`

```json
{
  "week": 1,
  "theme": "Personality & character",
  "items": [
    {
      "id": "w01-01",
      "term": "reliable",
      "type": "word",
      "pos": "adj",
      "level": "B2",
      "ipa": "/rɪˈlaɪəbl/",
      "pl": "niezawodny, godny zaufania",
      "def": "that you can trust to do what is expected or promised",
      "example": "Anna is the most {{reliable}} person on our team.",
      "examplePl": "Anna jest najbardziej niezawodną osobą w naszym zespole.",
      "collocations": ["a reliable source", "highly reliable"],
      "family": ["rely (v)", "reliability (n)", "unreliable (adj)"],
      "note": "Nie mylić z *reliant* (zależny od kogoś)."
    },
    {
      "id": "w01-02",
      "term": "come across as",
      "type": "phrasal",
      "pos": "phr v",
      "level": "B2",
      "ipa": "/kʌm əˈkrɒs əz/",
      "pl": "sprawiać wrażenie (jakiegoś)",
      "def": "to give other people a particular impression of yourself",
      "example": "He {{comes across as}} rather arrogant, but he is just shy.",
      "examplePl": "Sprawia wrażenie dość aroganckiego, ale jest po prostu nieśmiały.",
      "collocations": ["come across as confident", "come across as rude"]
    }
  ]
}
```

| Pole | Wymagane | Opis |
| --- | --- | --- |
| `id` | tak | `wNN-XX`, kolejno od `01` do `40`. Hasła 01–10 to zestaw dnia 1, 11–20 dnia 2, 21–30 dnia 3, 31–40 dnia 4. |
| `term` | tak | Forma słownikowa. Czasowniki bez „to”. Idiomy i kolokacje w formie podstawowej (`make ends meet`). |
| `type` | tak | `word`, `phrasal`, `collocation` albo `idiom`. |
| `pos` | tak | `n`, `v`, `adj`, `adv`, `phr v`, `phrase`, `idiom`, `prep`, `conj`. |
| `level` | tak | `B2` albo `C1` (wg CEFR). |
| `ipa` | tak | Transkrypcja brytyjska całego hasła, w ukośnikach. |
| `pl` | tak | Polski odpowiednik (1–3 warianty po przecinku), w znaczeniu z przykładu. |
| `def` | tak | Prosta definicja po angielsku (słownictwo łatwiejsze niż hasło), bez użycia samego hasła. |
| `example` | tak | Jedno naturalne zdanie (8–22 słowa) z jednym znacznikiem `{{…}}`. Kontekst ma podpowiadać znaczenie. |
| `examplePl` | tak | Tłumaczenie zdania przykładowego. |
| `collocations` | tak | 1–3 typowe połączenia lub wzorce (`be keen on doing sth`). Dla idiomów może być pusta lista. |
| `family` | nie | Do 4 słów z rodziny wyrazów z częścią mowy w nawiasie. |
| `note` | nie | Krótka uwaga po polsku: fałszywy przyjaciel, typowy błąd Polaków, rejestr, różnica BrE/AmE. Tylko gdy wnosi coś istotnego. |

Skład tygodnia: 22 `word` (±2), 8 `phrasal` (±1), 6 `collocation` (±1), 4 `idiom` (±1). W każdej dziesiątce (zestawie dnia) mieszanka typów. Żadne hasło nie powtarza się między tygodniami.

## `wNN-lessons.json`

```json
{
  "week": 1,
  "intro": "2–3 zdania po polsku: o czym jest tydzień i co będziesz umieć po jego ukończeniu.",
  "reading": { },
  "grammar": { },
  "listening": { },
  "writing": { },
  "speaking": { },
  "practice": { }
}
```

### `reading`

```json
{
  "title": "First impressions",
  "paragraphs": ["Tekst z {{znacznikami|w01-02}}…", "…"],
  "glossary": [{ "term": "to dread", "pl": "bać się czegoś, co ma nadejść" }],
  "questions": [
    { "type": "mc", "q": "Why did the writer change her mind about Tom?", "options": ["…", "…", "…", "…"], "answer": 2, "explanationPl": "…" },
    { "type": "tf", "q": "The writer met Tom at university.", "answer": "false", "explanationPl": "…" }
  ],
  "discussion": ["Do you trust your first impressions of people? Why?", "…"]
}
```

- Tekst: 3–7 akapitów, razem 300–460 słów, spójny i ciekawy (artykuł, blog, historia, wywiad), poziom zgodny z tygodniem.
- Co najmniej 12 różnych haseł tygodnia w naturalnym użyciu, oznaczonych `{{forma|id}}`. Wykorzystuj też gramatykę tygodnia.
- `glossary`: 4–8 trudniejszych słów z tekstu spoza haseł tygodnia.
- `questions`: dokładnie 6, w tym co najmniej 3 typu `mc` (4 opcje, `answer` to indeks 0–3). Typ `tf` ma `answer`: `"true"`, `"false"` albo `"not_given"`. Odpowiedź musi wynikać z tekstu; `explanationPl` wskazuje, z którego fragmentu.
- `discussion`: 2–3 pytania do przemyślenia.

### `grammar`

```json
{
  "title": "Present simple vs present continuous",
  "titlePl": "Present simple a present continuous",
  "summaryPl": "1–2 zdania: kiedy używamy tej struktury.",
  "sections": [
    {
      "heading": "Czynności stałe i tymczasowe",
      "bodyPl": "Wyjaśnienie po polsku, konkretne i krótkie.",
      "examples": [{ "en": "She works in a bank.", "pl": "Pracuje w banku (na stałe)." }]
    }
  ],
  "pitfallsPl": [{ "wrong": "I am knowing him.", "right": "I know him.", "whyPl": "…" }],
  "exercises": [
    { "type": "mc", "prompt": "Look! It ___ outside.", "options": ["snows", "is snowing", "snow"], "answer": 1, "explanationPl": "…" },
    { "type": "gap", "prompt": "I ___ (not / understand) this word.", "answers": ["don't understand", "do not understand"], "explanationPl": "…" },
    { "type": "transform", "prompt": "It isn't necessary to book a table.", "keyword": "NEED", "gapped": "You ___ a table.", "answers": ["don't need to book", "do not need to book"], "explanationPl": "…" }
  ],
  "testItems": []
}
```

- `sections`: 3–6, każda z 2–5 przykładami (`en` + `pl`). Zakres według `grammarScope` w `data/program.json`.
- `pitfallsPl`: 3–5 typowych błędów Polaków z wyjaśnieniem.
- `exercises`: dokładnie 12, od łatwiejszych do trudniejszych, co najmniej 4 wpisywane (`gap` lub `transform`). `prompt` typu `gap` i pole `gapped` typu `transform` zawierają dokładnie jedno `___`. `keyword` wielkimi literami; odpowiedź `transform` to 2–5 słów zawierających słowo kluczowe.
- `testItems`: dokładnie 5 dodatkowych zadań (`mc` lub `gap`) do testu tygodnia, innych niż w `exercises`.

### `listening`

```json
{
  "dictation": [{ "text": "She's been working here since she left university." }],
  "monologue": {
    "title": "A voicemail from a flatmate",
    "speaker": "a young woman leaving a message for her flatmate",
    "script": ["Akapit 1…", "Akapit 2…"],
    "questions": [{ "type": "mc", "q": "…", "options": ["…", "…", "…", "…"], "answer": 0, "explanationPl": "…" }]
  }
}
```

- `dictation`: dokładnie 6 zdań po 6–16 słów, z gramatyką i słownictwem tygodnia. Tekst czyta syntezator mowy, więc bez skrótów, cyfr i nazw trudnych do zapisania ze słuchu.
- `monologue.script`: 2–5 akapitów, razem 170–260 słów, język mówiony (wiadomość głosowa, fragment podcastu, relacja).
- `monologue.questions`: dokładnie 4 pytania `mc`.

### `writing`

```json
{
  "taskEn": "Write a description of a person you admire…",
  "taskPl": "Opisz osobę, którą podziwiasz…",
  "genre": "description",
  "minWords": 100,
  "maxWords": 160,
  "checklistPl": ["Wstęp: kim jest ta osoba", "…"],
  "usefulPhrases": ["What I admire most about … is …"],
  "modelAnswer": "Tekst wzorcowy z {{hasłami|w01-01}}…"
}
```

- `minWords` 80–180, `maxWords` 120–220. `checklistPl`: 3–5 punktów. `usefulPhrases`: 5–8.
- `modelAnswer`: mieści się w limicie słów i używa co najmniej 5 haseł tygodnia (`{{forma|id}}`).

### `speaking`

```json
{
  "prompts": [{ "q": "How would your best friend describe you?", "followUp": "Do you agree with them?" }],
  "shadowing": ["I tend to be quite cautious when I meet new people."],
  "roleplay": {
    "titlePl": "Rozmowa o nowym współlokatorze",
    "scenarioPl": "Opis sytuacji po polsku.",
    "yourRole": "You are looking for a flatmate…",
    "partnerRole": "You are a friend who knows a possible candidate…",
    "opening": "So, I hear you're looking for a new flatmate?",
    "goalsPl": ["Opisz, jakiej osoby szukasz", "Zapytaj o wady kandydata"]
  }
}
```

- `prompts`: dokładnie 5. `shadowing`: dokładnie 5 zdań (8–18 słów) do powtarzania na głos. `goalsPl`: 2–4.

### `practice`

```json
{
  "gapFill": [{ "sentence": "I ___ an old school friend at the station yesterday.", "answerId": "w01-17", "answers": ["bumped into"] }],
  "matching": [{ "left": "make", "right": "a good impression" }],
  "wordFormation": [{ "sentence": "Her ___ makes her a great colleague.", "base": "RELIABLE", "answers": ["reliability"] }]
}
```

- `gapFill`: dokładnie 10 nowych zdań (innych niż `example`), każde z jednym `___`, każde do innego hasła tygodnia. `answers` w formie pasującej do zdania.
- `matching`: dokładnie 8 par (połówki kolokacji albo hasło i definicja), bez dwuznaczności: każda lewa strona pasuje tylko do jednej prawej.
- `wordFormation`: dokładnie 6 zdań; `base` wielkimi literami, odpowiedź to inne słowo z tej samej rodziny.

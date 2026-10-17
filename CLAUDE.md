# Bass Drop

Hobbystyczna apka w przeglądarce do robienia bitów z basem 808: syntezator basu z sekwencerem, syntezowane bębny z rolkami, sidechain od stopy, mikser, kontroler MIDI, nagrywanie, sampler pętli i cięcie wczytanych kawałków (mp3 itp.) na pętle i uderzenia. Wszystko po stronie przeglądarki (Web Audio, Web MIDI), bez backendu.

Właściciel: **Michał Zaręba** (GitHub: `michalzareba0001`). Tego zapisu imienia i nazwiska używaj w licencjach, stopkach i podpisach. Właściciel pisze po polsku. **Cały tekst w interfejsie jest po polsku**, komentarze w kodzie po angielsku.

## Polecenia

```bash
npm install
npm run dev        # Vite na http://localhost:5180
npm run typecheck  # tsc, bez emitowania
npm run build      # tsc && vite build → dist/
```

Przed każdym commitem: `npm run typecheck` musi przejść bez błędów.

## Wdrożenie

Repo jest podpięte do **Vercel**: każdy push na `main` buduje i publikuje produkcję, każda inna gałąź dostaje własny link do podglądu. Ustawienia domyślne dla Vite (build `npm run build`, output `dist`). Strona musi być na HTTPS, bo tego wymagają Web MIDI, mikrofon i AudioWorklet (localhost jest wyjątkiem).

## Stack

Vite + React 19 + TypeScript (strict) + Zustand (z `persist`) + idb-keyval. Żadnych bibliotek audio: wszystko na czystym Web Audio API.

Odwiedziny liczy **Vercel Web Analytics** (`@vercel/analytics`, komponent `<Analytics>` w `main.tsx`): anonimowo, bez ciasteczek, więc bez baneru zgody. W trybie deweloperskim tylko loguje do konsoli. Statystyki są w panelu Vercel, zakładka Analytics. Poza tym nic nie wychodzi z przeglądarki: nagrania i ustawienia zostają lokalnie.

## Najważniejsza zasada architektury

**Silnik dźwięku żyje poza Reactem.** Moduły w `src/audio/` to zwykłe klasy-singletony bez importów z Reacta. React tylko wywołuje ich metody i czyta stan. Nie trzymaj węzłów audio, oscylatorów ani zegara sekwencera w komponentach ani w stanie Reacta: przerysowanie nie może rozjechać rytmu ani uciąć dźwięku.

Animacje (mierniki, przebieg, kursor sekwencera) rysujemy w `requestAnimationFrame` przez refy albo zmienne CSS, a nie przez `setState` w każdej klatce.

## Struktura

```
src/
  audio/
    engine.ts     syntezator basu (głos mono, glide, spadek wysokości, przester, filtr, LFO) + wyjście master
    drums.ts      syntezowane bębny: kick, snare, clap, zamknięty i otwarty hi-hat (choke)
    mixer.ts      kanały miksera: duck (sidechain) → fader → mute/solo → mix, analizery do mierników
    sequencer.ts  sekwencer z look-ahead (timer 25 ms planuje ~120 ms do przodu na zegarze audio)
    sampler.ts    odtwarzanie klipów na padach (pętle, przycinanie, wysokość)
    beats.ts      analiza kawałka: obwiednia uderzeń (spectral flux), tempo, siatka taktów, pojedyncze uderzenia
    beats.worker.ts  uruchamia beats.ts w Web Workerze
    slicer.ts     wczytany kawałek (tylko w pamięci), odsłuch, wycinanie pętli i uderzeń, dopasowanie do tempa
    recorder.ts   nagrywanie przez AudioWorklet z dokładnością do próbki
    midi.ts       Web MIDI: nuty, pitch bend, CC (mapowanie gałek), sustain, pady na kanale 10
    params.ts     definicje parametrów syntezatora, presety, sekcje gałek
    util.ts       hold() (cancelAndHoldAtTime z fallbackiem), formatowanie dB
    wav.ts        eksport WAV 16-bit
  control.ts      klej między wejściami (ekran, klawiatura, MIDI) a modułami audio
  store.ts        Zustand: useStore (zapisywany) + useRuntime (ulotny stan UI)
  lib/clips.ts    dźwięk nagrań w IndexedDB + liczenie peaków do miniatur
  components/     interfejs (Knob, Rack, Sequencer, DrumMachine, Mixer, Piano, MidiPanel, RecorderPanel, TrackSlicer, Sampler, ClipLibrary, Waveform, Screen)
docs/             instrukcja użytkownika (instrukcja.pdf) i zrzuty ekranu do README
```

Instrukcja w `docs/instrukcja.pdf` ma zrzuty ekranu i opisuje każdy przycisk. Po zmianach w interfejsie (nowe przyciski, inne nazwy, nowe sekcje) zaktualizuj ją razem z README: zrzuty robione Playwrightem z `npm run dev`, tekst jako HTML drukowany do PDF w Chromium.

## Tor sygnału

```
syntezator → shaper → filtr → synthOut ──→ [mikser: bass]  ─┐
bębny ────────────────────────────────→ [mikser: drums] ─┤
pady samplera ─────────────────────────→ [mikser: padN]  ─┼→ mix → master → limiter → soft clip → analyser → głośniki
odsłuch klipów ───────────────────────→ previewBus ──────┘
```

- Każde uderzenie stopy wywołuje `mixer.duck(t)`, który przycisza kanały z włączonym SC. Stopa nie przycisza niczego, gdy kanał bębnów jest wyciszony albo nie gra przez solo innego kanału.
- Nagrywanie podpina się pod `engine.out` (soft clip), więc nagrywa cały miks, albo pod mikrofon.

## Zasady, których trzymamy się w kodzie audio

- **Zapas głośności**: `synthOut` 0.72, wyjście bębnów 0.65, `mix` 0.6, próg limitera −3 dB. Kompresor w Web Audio sam dokłada makeup gain, więc niski próg wypycha master pod sufit i mierniki stale świecą na czerwono. Soft clip na końcu nigdy nie przekracza ±0.98. Po zmianach poziomów sprawdź szczyty: kanały poniżej 1.0, master około −1 dB.
- **Planowanie w czasie**: wszystko, co gra w rytmie, planuj na zegarze `AudioContext` (parametr `t`), a nie przez `setTimeout`.
- **Automatyka parametrów**: przed nową automatyką na już animowanym parametrze użyj `hold(param, t)` z `util.ts`. Do przyciszania sidechainem używamy `setTargetAtTime` w obie strony, bo `linearRamp` przy nakładających się uderzeniach potrafił zejść poniżej ustawionego poziomu.
- **Pierwszy dźwięk wymaga gestu użytkownika**: `engine.ensure()` tworzy `AudioContext`. Jeśli kontekst jest zawieszony (na przykład MIDI przyszło przed kliknięciem), pokazujemy przycisk „Kliknij, żeby włączyć dźwięk”.

## Stan i zapis

- `useStore` zapisuje się w localStorage pod kluczem **`bass-drop`** (zawiera wzory, parametry, mikser, pady, mapowanie MIDI). W `store.ts` jest migracja ze starego klucza `sub-drop-808`. Nowe pola dodawaj z wartością domyślną także w funkcji `merge`, żeby starsze zapisy się nie wysypały.
- Akcje w store, które zmieniają dźwięk, od razu wołają odpowiedni moduł (`engine.setParam`, `drums.configure`, `mixer.configure`, `sampler.update`). Po starcie `main.tsx` wysyła zapisany stan do modułów.
- Dźwięk nagrań jest w IndexedDB pod kluczami **`sd808-clip:<id>`**, a metadane w store. Nie zmieniaj tego prefiksu ani nazwy procesora workletu `sd-capture` bez migracji, bo użytkownik ma już zapisane nagrania.
- Wzór bębnów: wartość kroku 0 = nic, 1 = uderzenie, 2 = rolka 1/32, 3 = trioli, 4 = rolka 1/64.
- Kanały miksera: `bass`, `drums`, `pad0` … `pad7`.
- Wczytany kawałek nie jest zapisywany (siedzi w `slicer.buf` i w samplerze pod kluczem `__track`). Zapisują się tylko wycięte fragmenty, jako zwykłe nagrania.

## Cięcie kawałków (`beats.ts`, `slicer.ts`, `TrackSlicer`)

- Analiza idzie w workerze: STFT 1024/512 (2048/1024 powyżej 50 kHz), log-spectral flux w trzech pasmach (całość, poniżej 150 Hz, poniżej 4 kHz).
- Tempo: autokorelacja obwiedni spłaszczonej potęgą 0.6, mieszanka 0.3 pasma poniżej 4 kHz + 0.7 całości, z preferencją okolic 120 BPM. Potem dopasowanie siatki do całego utworu (co 0.005 BPM) i przyciąganie do całego BPM. Te wagi są dobrane na syntetycznych bitach (boom-bap 75/85/92,5, trap 140, house 124, backbeat 126). Zmieniaj je tylko po sprawdzeniu na podobnym zestawie, bo łatwo o tempo o połowę za wolne albo za szybkie. Drum and bass (174) wychodzi jako 87, na to jest przycisk 2×.
- Początek taktu: ćwierćnuta z najmocniejszym „dołem bez środka” (stopa, nie werbel).
- Cięcia zaczynają się `PRE_ROLL` (3 ms) przed linią siatki albo przed atakiem uderzenia (`slicer.refine`).
- Dopasowanie do tempa projektu zmienia prędkość jak gramofon (razem z wysokością), przez `OfflineAudioContext`. Pętla ma wtedy dokładnie N taktów w tempie projektu.

## Interfejs

- **Sekcje w zakładkach** (`TABS` w `store.ts`, `App.tsx`): Bas (presety, ekran, gałki, wzór, klawiatura), Bębny, Sampler (pady, kawałek → pętle, nagrywanie, biblioteka nagrań), Mikser, Więcej (MIDI, skróty, informacje). Widać jedną naraz. Aktywna zakładka zapisuje się w `useStore.tab`.
- Wszystkie strony zostają zamontowane, a ukryte mają atrybut `hidden`, żeby nie tracić ich stanu (np. zaznaczenia w cięciu kawałka). Nowe panele dodawaj do właściwej `<Page>`, nie na koniec aplikacji.
- Górny pasek jest przyklejony: logo, Graj/Stop, BPM, Nagraj i zakładki. Na telefonie (do 700 px) zakładki są paskiem na dole ekranu. Kropka na zakładce oznacza: Sampler gra albo nagrywa, w Mikserze jest wyciszony kanał albo solo.
- Plik audio upuszczony w dowolnym miejscu strony przełącza na Sampler i wczytuje się do cięcia.
- Jeden ciemny wygląd w stylu sprzętowego syntezatora. Kolory i fonty są tokenami w `:root` w `src/styles.css`: kolory 808 (`--red`, `--orange`, `--yellow`, `--cream`) i fonty Big Shoulders Display, Barlow, Barlow Semi Condensed, IBM Plex Mono. Używaj tokenów zamiast nowych kolorów.
- Tokeny kolorów to hex, bo kod dokleja do nich kanał alfa (`COL.fill + '55'`).
- Skróty klawiszowe: A W S E D F T G Y H U J K (klawisze syntezatora), Z/X (oktawa), spacja (start/stop), R (nagrywanie), 1–8 (pady), Shift+1…5 (zakładki). Lista jest też w zakładce Więcej (`SHORTCUTS` w `App.tsx`).
- Apka ma działać też na telefonie: siatki przewijają się poziomo we własnych kontenerach, a strona nie może przewijać się na boki.

## Testowanie

- W trybie deweloperskim `window.__bassDrop` daje dostęp do `{ engine, mixer, drums, sequencer, sampler, slicer }`. Na przykład `__bassDrop.mixer.peak('bass')` zwraca szczyt kanału, a `__bassDrop.mixer.ducking('bass')` to, jak mocno sidechain akurat przycisza bas.
- Mierniki i animacje stoją, gdy karta jest w tle, bo `requestAnimationFrame` nie działa. Poziomy mierz wtedy w pętli z `setTimeout`.
- Dźwięk startuje dopiero po prawdziwym kliknięciu; `element.click()` z JavaScriptu nie liczy się jako gest.
- MIDI nie działa w osadzonych ramkach ani bez HTTPS. Testuj w Chrome lub Chromium.

## Pomysły na dalszy rozwój

- Kilka wzorów (A, B, C, D) i łańcuch utworu, akcenty, swing, wybór tonacji.
- Rozciąganie w czasie bez zmiany wysokości, wyciąganie samej perkusji z miksu (HPSS), przepisywanie rytmu kawałka na wzór bębnów.
- Efekty (reverb i delay na górze pasma, bitcrusher), drugi oscylator, własne presety.
- Zapis i wczytanie całego projektu do pliku, eksport wzoru do MIDI, eksport utworu do WAV bez nagrywania na żywo.

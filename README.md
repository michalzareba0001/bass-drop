# Bass Drop

Bas 808 w przeglądarce: syntezator z sekwencerem, syntezowane bębny z rolkami, sidechain, mikser, kontroler MIDI, nagrywanie, sampler pętli i cięcie własnych kawałków (mp3, wav…) na pętle i uderzenia z automatycznym wykrywaniem tempa.

## Uruchomienie

```bash
npm install
npm run dev
```

Otwórz adres z terminala (domyślnie http://localhost:5180) w Chrome lub Chromium. Na localhost działają MIDI i mikrofon bez HTTPS.

## Skróty

- A W S E D F T G Y H U J K: klawisze syntezatora, Z/X zmienia oktawę
- Spacja: start/stop wzoru
- R: nagrywanie
- 1–8: pady samplera

## Struktura

- `src/audio/` – silnik dźwięku poza Reactem: `engine` (syntezator i wyjście), `drums` (bębny), `mixer` (kanały, mute/solo, sidechain), `sequencer`, `recorder` (AudioWorklet), `sampler`, `beats` + `slicer` (analiza i cięcie kawałków), `midi`, `wav`
- `src/control.ts` – łączy wejścia (ekran, klawiatura, MIDI) z modułami audio
- `src/store.ts` – stan w Zustand; ustawienia zapisują się w localStorage, dźwięk nagrań w IndexedDB
- `src/components/` – interfejs

## Na serwer

`npm run build` tworzy statyczne pliki w `dist/`. Hosting musi mieć HTTPS (wymaga tego Web MIDI, mikrofon i AudioWorklet).
